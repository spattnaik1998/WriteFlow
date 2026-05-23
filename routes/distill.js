const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { distillNotes, generateBroadIdeas } = require('../services/openai');

// SM-2 simplified spaced repetition helpers
function sm2NextInterval(currentInterval, rating) {
  if (rating === 'forgot')     return 1;
  if (rating === 'fuzzy')      return Math.max((currentInterval || 1) * 1.3, 1);
  if (rating === 'remembered') return Math.max((currentInterval || 1) * 2.5, 3);
  return 1;
}
function sm2MasteryDelta(rating) {
  if (rating === 'forgot')     return -15;
  if (rating === 'fuzzy')      return   5;
  if (rating === 'remembered') return  15;
  return 0;
}

// GET /api/distill/review — ideas due for spaced-repetition review
router.get('/review', async (req, res) => {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('ideas')
    .select('id, book_id, title, body, tags, mastery_score, next_review_at, review_count')
    .neq('chapter_name', '_broad')
    .lte('next_review_at', now)
    .not('next_review_at', 'is', null)
    .order('next_review_at', { ascending: true })
    .limit(10);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/distill/:id/review — record a review, advance SM-2 schedule
router.post('/:id/review', async (req, res) => {
  const { rating, reflection } = req.body;
  if (!['remembered', 'fuzzy', 'forgot'].includes(rating)) {
    return res.status(400).json({ error: 'rating must be remembered, fuzzy, or forgot' });
  }

  const { data: idea, error: fetchErr } = await supabase
    .from('ideas')
    .select('mastery_score, review_count, review_interval_days, reflection_notes')
    .eq('id', req.params.id)
    .single();
  if (fetchErr || !idea) return res.status(404).json({ error: 'Idea not found' });

  const nextInterval  = sm2NextInterval(idea.review_interval_days, rating);
  const nextReviewAt  = new Date(Date.now() + nextInterval * 86400000).toISOString();
  const newMastery    = Math.max(0, Math.min(100, (idea.mastery_score || 0) + sm2MasteryDelta(rating)));
  const notes         = Array.isArray(idea.reflection_notes) ? [...idea.reflection_notes] : [];
  if (typeof reflection === 'string' && reflection.trim()) {
    notes.push({ text: reflection.trim(), created_at: new Date().toISOString() });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('ideas')
    .update({
      mastery_score:        newMastery,
      next_review_at:       nextReviewAt,
      review_interval_days: nextInterval,
      review_count:         (idea.review_count || 0) + 1,
      reflection_notes:     notes,
      last_reviewed_at:     new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });
  res.json(updated);
});

// GET /api/distill/broad?book_id= — fetch cached broad ideas for a book
router.get('/broad', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .eq('book_id', book_id)
    .eq('chapter_name', '_broad')
    .order('number', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/distill/broad — generate (or regenerate) 5 broad ideas for a whole book
router.post('/broad', async (req, res) => {
  const { book_id } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data: book, error: bookErr } = await supabase
    .from('books')
    .select('title, author, category')
    .eq('id', book_id)
    .single();
  if (bookErr || !book) return res.status(404).json({ error: 'Book not found' });

  // Fetch all notes across all chapters
  const { data: notes } = await supabase
    .from('notes')
    .select('chapter_name, content')
    .eq('book_id', book_id)
    .order('chapter_order', { ascending: true });

  const allNotes = (notes || [])
    .filter(n => n.content?.trim())
    .map(n => `[${n.chapter_name || 'Chapter'}]:\n${n.content}`)
    .join('\n\n');

  let ideas;
  try {
    ideas = await generateBroadIdeas({
      bookTitle: book.title,
      author:    book.author   || '',
      category:  book.category || '',
      allNotes
    });
  } catch (e) {
    console.error('[broad ideas] generation failed:', e.message);
    return res.status(500).json({ error: 'Failed to generate ideas' });
  }

  // Delete old broad ideas for this book before saving new ones
  await supabase.from('ideas').delete().eq('book_id', book_id).eq('chapter_name', '_broad');

  const toInsert = ideas.map((idea, i) => ({
    book_id,
    chapter_name: '_broad',
    title:        idea.title,
    body:         idea.body,
    tags:         idea.tags || [],
    number:       i + 1
  }));

  const { data: saved, error: saveErr } = await supabase
    .from('ideas')
    .insert(toInsert)
    .select();

  if (saveErr) {
    console.error('Supabase insert error:', saveErr.message);
    return res.json({ ideas, saved: false });
  }

  res.json({ ideas: saved, saved: true });
});

// POST /api/distill — distil notes into idea cards
router.post('/', async (req, res) => {
  const { book_id, chapter_name, raw_notes } = req.body;
  if (!book_id || !raw_notes) {
    return res.status(400).json({ error: 'book_id and raw_notes required' });
  }

  // Fetch book details
  const { data: book, error: bookErr } = await supabase
    .from('books')
    .select('title, author')
    .eq('id', book_id)
    .single();

  if (bookErr) return res.status(404).json({ error: 'Book not found' });

  // Fetch any existing idea cards for context
  const { data: existing } = await supabase
    .from('ideas')
    .select('title, body')
    .eq('book_id', book_id);

  try {
    const ideas = await distillNotes({
      bookTitle: book.title,
      author:    book.author,
      chapterName: chapter_name || 'Unknown Chapter',
      rawNotes:  raw_notes,
      existingIdeas: existing || []
    });

    // Persist each idea card to Supabase; schedule first review for tomorrow
    const firstReviewAt = new Date(Date.now() + 86400000).toISOString();
    const toInsert = ideas.map((idea, i) => ({
      book_id,
      chapter_name:   chapter_name || null,
      title:          idea.title,
      body:           idea.body,
      tags:           idea.tags || [],
      number:         (existing?.length || 0) + i + 1,
      next_review_at: firstReviewAt
    }));

    const { data: saved, error: saveErr } = await supabase
      .from('ideas')
      .insert(toInsert)
      .select();

    if (saveErr) {
      // Return ideas even if save fails — don't break the UX
      console.error('Supabase insert error:', saveErr.message);
      return res.json({ ideas, saved: false });
    }

    res.json({ ideas: saved, saved: true });
  } catch (err) {
    console.error('Distil error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/distill?book_id=... — fetch all saved idea cards for a book
router.get('/', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .eq('book_id', book_id)
    .order('number', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/distill/:id — remove an idea card
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('ideas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// PATCH /api/distill/:id — update title, body, and/or tags
router.patch('/:id', async (req, res) => {
  const { title, body, tags } = req.body;
  const updates = {};
  if (title !== undefined) updates.title = title;
  if (body  !== undefined) updates.body  = body;
  if (tags  !== undefined) updates.tags  = tags;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabase
    .from('ideas')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/distill/manual — create a hand-written idea card
router.post('/manual', async (req, res) => {
  const { book_id, title, body, tags } = req.body;
  if (!book_id || !title) {
    return res.status(400).json({ error: 'book_id and title required' });
  }

  // Count existing ideas to set the next number
  const { count } = await supabase
    .from('ideas')
    .select('*', { count: 'exact', head: true })
    .eq('book_id', book_id);

  const { data, error } = await supabase
    .from('ideas')
    .insert([{
      book_id,
      title,
      body:           body  || '',
      tags:           tags  || [],
      number:         (count || 0) + 1,
      is_manual:      true,
      next_review_at: new Date(Date.now() + 86400000).toISOString()
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

module.exports = router;
