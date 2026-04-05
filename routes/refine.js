const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { refineChapterNotes } = require('../services/openai');

// POST /api/refine
// Body: { book_id, chapter_name, notes }
// Fetches surrounding chapter context, calls the Chapter Note Refiner agent.
// Returns: { refined_notes, changes_summary }
router.post('/', async (req, res) => {
  const { book_id, chapter_name, notes } = req.body;

  if (!chapter_name || !notes || !notes.trim())
    return res.status(400).json({ error: 'chapter_name and notes are required' });
  if (notes.trim().length < 10)
    return res.status(400).json({ error: 'Notes are too short to refine' });

  // Fetch book title + all notes for this book (for surrounding context)
  const [{ data: book }, { data: allNotes }] = await Promise.all([
    book_id
      ? supabase.from('books').select('title').eq('id', book_id).single()
      : Promise.resolve({ data: null }),
    book_id
      ? supabase.from('notes').select('chapter_name, content').eq('book_id', book_id).order('created_at', { ascending: true })
      : Promise.resolve({ data: [] })
  ]);

  const bookTitle = book?.title || 'Unknown Book';

  // Build prev / next chapter context for the agent
  const chapters = (allNotes || []).filter(n => n.content?.trim());
  const idx = chapters.findIndex(n => n.chapter_name === chapter_name);
  const prevContext = idx > 0          ? chapters[idx - 1].content.slice(0, 600) : null;
  const nextContext = idx < chapters.length - 1 ? chapters[idx + 1].content.slice(0, 600) : null;

  try {
    const result = await refineChapterNotes({
      bookTitle,
      chapterName: chapter_name,
      notes:       notes.trim(),
      prevContext,
      nextContext
    });
    res.json(result);
  } catch (err) {
    console.error('[refine] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
