const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');

// GET /api/books — list all books
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/books — create a book
router.post('/', async (req, res) => {
  const { title, author, category, why_reading, spine_color } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const { data, error } = await supabase
    .from('books')
    .insert([{ title, author, category, why_reading, spine_color, progress: 0 }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/books/:id — update progress or metadata
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const { data, error } = await supabase
    .from('books')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/books/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('books').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
