const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { generateCrossSynthesis } = require('../services/openai');

const COMPLETED = ['completed', 'done'];

// POST /api/synthesis
// Body: { book_id_1, book_id_2 }
// Fetches both books' notes + ideas, calls the Cross-Book Synthesis agent,
// returns { title, subtitle, sections[] }.
router.post('/', async (req, res) => {
  const { book_id_1, book_id_2 } = req.body;

  if (!book_id_1 || !book_id_2)
    return res.status(400).json({ error: 'Both book_id_1 and book_id_2 are required' });
  if (book_id_1 === book_id_2)
    return res.status(400).json({ error: 'Select two different books' });

  // Fetch both books in parallel
  const [{ data: book1, error: e1 }, { data: book2, error: e2 }] = await Promise.all([
    supabase.from('books').select('id, title, author, status').eq('id', book_id_1).single(),
    supabase.from('books').select('id, title, author, status').eq('id', book_id_2).single()
  ]);

  if (e1 || !book1) return res.status(404).json({ error: 'First book not found' });
  if (e2 || !book2) return res.status(404).json({ error: 'Second book not found' });

  if (!COMPLETED.includes(book1.status))
    return res.status(400).json({ error: `"${book1.title}" is not marked as completed` });
  if (!COMPLETED.includes(book2.status))
    return res.status(400).json({ error: `"${book2.title}" is not marked as completed` });

  // Fetch notes + ideas for both books in parallel
  const [
    { data: notes1 }, { data: notes2 },
    { data: ideas1 }, { data: ideas2 }
  ] = await Promise.all([
    supabase.from('notes').select('chapter_name, content').eq('book_id', book_id_1),
    supabase.from('notes').select('chapter_name, content').eq('book_id', book_id_2),
    supabase.from('ideas').select('title, body, tags').eq('book_id', book_id_1).limit(20),
    supabase.from('ideas').select('title, body, tags').eq('book_id', book_id_2).limit(20)
  ]);

  try {
    const result = await generateCrossSynthesis({
      book1,  book2,
      notes1: notes1 || [],
      notes2: notes2 || [],
      ideas1: ideas1 || [],
      ideas2: ideas2 || []
    });
    res.json(result);
  } catch (err) {
    console.error('[synthesis] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
