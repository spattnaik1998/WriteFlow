const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { reconstructArgument } = require('../services/openai');

// POST /api/arguments/reconstruct — extract logical structure from notes
router.post('/reconstruct', async (req, res) => {
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

  // Fetch any existing argument for context
  const { data: existing } = await supabase
    .from('arguments')
    .select('primary_claim, premises')
    .eq('book_id', book_id)
    .eq('chapter_name', chapter_name || null)
    .single();

  try {
    const argument = await reconstructArgument({
      bookTitle: book.title,
      author: book.author,
      chapterName: chapter_name || 'Unknown Chapter',
      rawNotes: raw_notes,
      existingArgument: existing || null
    });

    // Upsert the argument
    const toInsert = {
      book_id,
      chapter_name: chapter_name || null,
      primary_claim: argument.primary_claim,
      premises: argument.premises || [],
      conclusions: argument.conclusions || [],
      logical_gaps: argument.logical_gaps || [],
      counter_arguments: argument.counter_arguments || [],
      metadata: argument.metadata || {}
    };

    const { data: saved, error: saveErr } = await supabase
      .from('arguments')
      .upsert(toInsert, { onConflict: 'book_id,chapter_name' })
      .select()
      .single();

    if (saveErr) {
      console.error('Supabase upsert error:', saveErr.message);
      return res.json({ argument, saved: false });
    }

    res.json({ argument: saved, saved: true });
  } catch (err) {
    console.error('Argument reconstruction error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arguments?book_id=... — fetch all arguments for a book
router.get('/', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('arguments')
    .select('*')
    .eq('book_id', book_id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// DELETE /api/arguments/:id — remove an argument record
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('arguments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
