const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { distillNotes } = require('../services/openai');

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

module.exports = router;
