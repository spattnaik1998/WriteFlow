const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');

// GET /api/notes?book_id=... — all notes for a book
router.get('/', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('book_id', book_id)
    .order('chapter_order', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/notes — create or upsert a chapter note
router.post('/', async (req, res) => {
  const { book_id, chapter_name, chapter_order, content } = req.body;
  if (!book_id || !chapter_name) return res.status(400).json({ error: 'book_id and chapter_name required' });

  const { data, error } = await supabase
    .from('notes')
    .upsert([{ book_id, chapter_name, chapter_order, content: content ?? '' }], {
      onConflict: 'book_id,chapter_name'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/notes/:id — update note content
router.patch('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('notes')
    .update({ content: req.body.content })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/notes/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('notes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
