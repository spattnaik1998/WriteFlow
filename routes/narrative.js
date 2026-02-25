const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { generateMacroNarrative } = require('../services/openai');

// GET /api/narrative/ideas — fetch all books with their ideas
router.get('/ideas', async (req, res) => {
  const { data: books, error: booksErr } = await supabase
    .from('books')
    .select('id, title, author')
    .order('created_at', { ascending: true });

  if (booksErr) return res.status(500).json({ error: booksErr.message });
  if (!books || books.length === 0) return res.json({ books: [] });

  const { data: ideas, error: ideasErr } = await supabase
    .from('ideas')
    .select('book_id, title, body, tags');

  if (ideasErr) return res.status(500).json({ error: ideasErr.message });

  // Group ideas by book
  const ideasByBook = {};
  (ideas || []).forEach(idea => {
    if (!ideasByBook[idea.book_id]) ideasByBook[idea.book_id] = [];
    ideasByBook[idea.book_id].push({ title: idea.title, body: idea.body, tags: idea.tags });
  });

  const result = books.map(b => ({
    id:     b.id,
    title:  b.title,
    author: b.author,
    ideas:  ideasByBook[b.id] || []
  }));

  res.json({ books: result });
});

// POST /api/narrative — generate macro narrative across books
router.post('/', async (req, res) => {
  const { book_ids } = req.body; // optional filter

  let query = supabase.from('books').select('id, title, author');
  if (book_ids && book_ids.length > 0) {
    query = query.in('id', book_ids);
  }

  const { data: books, error: booksErr } = await query;
  if (booksErr) return res.status(500).json({ error: booksErr.message });

  if (!books || books.length === 0) {
    return res.status(400).json({ error: 'Need ideas from at least 2 books to generate a narrative' });
  }

  let ideasQuery = supabase.from('ideas').select('book_id, title, body, tags');
  if (book_ids && book_ids.length > 0) {
    ideasQuery = ideasQuery.in('book_id', book_ids);
  }

  const { data: ideas, error: ideasErr } = await ideasQuery;
  if (ideasErr) return res.status(500).json({ error: ideasErr.message });

  // Group ideas by book
  const ideasByBook = {};
  (ideas || []).forEach(idea => {
    if (!ideasByBook[idea.book_id]) ideasByBook[idea.book_id] = [];
    ideasByBook[idea.book_id].push({ title: idea.title, body: idea.body, tags: idea.tags });
  });

  const booksWithIdeas = books.map(b => ({
    title:  b.title,
    author: b.author,
    ideas:  ideasByBook[b.id] || []
  })).filter(b => b.ideas.length > 0);

  if (booksWithIdeas.length < 2) {
    return res.status(400).json({ error: 'Need ideas from at least 2 books to generate a narrative' });
  }

  try {
    const result = await generateMacroNarrative({ books: booksWithIdeas });
    res.json(result);
  } catch (err) {
    console.error('Narrative generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
