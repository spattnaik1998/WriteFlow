const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { distillNotes, generateBroadIdeas } = require('../services/openai');

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

    // Persist each idea card to Supabase
    const toInsert = ideas.map((idea, i) => ({
      book_id,
      chapter_name: chapter_name || null,
      title:        idea.title,
      body:         idea.body,
      tags:         idea.tags || [],
      number:       (existing?.length || 0) + i + 1
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
      body:      body  || '',
      tags:      tags  || [],
      number:    (count || 0) + 1,
      is_manual: true
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

module.exports = router;
