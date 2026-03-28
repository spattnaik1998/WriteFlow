const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');

// GET /api/essays?book_id= — list essays for a book, newest first
router.get('/', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('essays')
    .select('*')
    .eq('book_id', book_id)
    .order('updated_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/essays — create an essay
router.post('/', async (req, res) => {
  const { book_id, title, content } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('essays')
    .insert([{ book_id, title: title || 'Untitled', content: content || '' }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/essays/:id — update title and/or content
router.patch('/:id', async (req, res) => {
  const { title, content } = req.body;
  const updates = {};
  if (title   !== undefined) updates.title   = title;
  if (content !== undefined) updates.content = content;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabase
    .from('essays')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
