const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const {
  generateLivingIdeas,
  livingIdeaToIdeaRow,
  livingIdeaToDbRow
} = require('../services/livingIdeaEngine');

function countExistingIdeas(existing) {
  return Array.isArray(existing) ? existing.length : 0;
}

async function fetchBook(bookId) {
  const { data, error } = await supabase
    .from('books')
    .select('id, title, author')
    .eq('id', bookId)
    .single();
  if (error || !data) {
    const err = new Error('Book not found');
    err.status = 404;
    throw err;
  }
  return data;
}

async function fetchExistingIdeas(bookId) {
  const { data, error } = await supabase
    .from('ideas')
    .select('id, title, body')
    .eq('book_id', bookId)
    .order('number', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function persistLivingIdeas({ bookId, chapterName, livingIdeas, existingCount }) {
  const firstReviewAt = new Date(Date.now() + 86400000).toISOString();
  const ideaRows = livingIdeas.map((idea, index) => livingIdeaToIdeaRow(idea, {
    bookId,
    chapterName,
    number: existingCount + index + 1,
    nextReviewAt: firstReviewAt
  }));

  const { data: savedIdeas, error: ideaErr } = await supabase
    .from('ideas')
    .insert(ideaRows)
    .select();
  if (ideaErr) throw ideaErr;

  const livingRows = livingIdeas.map((idea, index) => livingIdeaToDbRow(idea, {
    ideaId: savedIdeas[index]?.id || null,
    bookId,
    chapterName
  }));

  const { data: savedLivingIdeas, error: livingErr } = await supabase
    .from('living_ideas')
    .insert(livingRows)
    .select();
  if (livingErr) throw livingErr;

  return {
    idea_cards: savedIdeas || [],
    living_ideas: savedLivingIdeas || []
  };
}

router.post('/distill', async (req, res) => {
  const { book_id, chapter_name, raw_notes, backend, model } = req.body || {};
  if (!book_id || !String(raw_notes || '').trim()) {
    return res.status(400).json({ error: 'book_id and raw_notes required' });
  }

  try {
    const book = await fetchBook(book_id);
    const existingIdeas = await fetchExistingIdeas(book_id);
    const result = await generateLivingIdeas({
      bookTitle: book.title,
      author: book.author || '',
      chapterName: chapter_name || 'Unknown Chapter',
      rawNotes: String(raw_notes || ''),
      existingIdeas,
      backend,
      model
    });

    const saved = await persistLivingIdeas({
      bookId: book_id,
      chapterName: chapter_name || null,
      livingIdeas: result.ideas,
      existingCount: countExistingIdeas(existingIdeas)
    });

    res.status(201).json({
      ...saved,
      saved: true,
      backend: result.backend,
      model: result.model,
      fallback_reason: result.fallback_reason
    });
  } catch (error) {
    console.error('[living-ideas/distill] failed:', error.message);
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  const { book_id, idea_id } = req.query;
  let query = supabase
    .from('living_ideas')
    .select('*, ideas(title, body, tags, number)')
    .order('created_at', { ascending: false });

  if (book_id) query = query.eq('book_id', book_id);
  if (idea_id) query = query.eq('idea_id', idea_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('living_ideas')
    .select('*, ideas(title, body, tags, number), books(title, author)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Living idea not found' });
  res.json(data);
});

router.patch('/:id', async (req, res) => {
  const allowed = [
    'claim',
    'definition',
    'mechanism',
    'evidence',
    'examples',
    'boundary_conditions',
    'counterarguments',
    'open_questions',
    'compressed_principle',
    'source_fragments',
    'connection_summary',
    'mastery',
    'metadata'
  ];
  const updates = {};
  allowed.forEach(key => {
    if (req.body && req.body[key] !== undefined) updates[key] = req.body[key];
  });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No supported fields to update' });
  }

  const { data, error } = await supabase
    .from('living_ideas')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('living_ideas')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
