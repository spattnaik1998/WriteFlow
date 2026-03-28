const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { generateConceptMap } = require('../services/openai');

// POST /api/concepts/map — extract concept structure from notes
router.post('/map', async (req, res) => {
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

  // Fetch any existing concept map for context
  const { data: existing } = await supabase
    .from('concept_maps')
    .select('concepts, relationships')
    .eq('book_id', book_id)
    .eq('chapter_name', chapter_name || null)
    .single();

  try {
    const conceptMap = await generateConceptMap({
      bookTitle: book.title,
      author: book.author,
      chapterName: chapter_name || 'Unknown Chapter',
      rawNotes: raw_notes,
      existingConcepts: existing?.concepts || null
    });

    // Upsert the concept map
    const toInsert = {
      book_id,
      chapter_name: chapter_name || null,
      concepts: conceptMap.concepts || [],
      relationships: conceptMap.relationships || [],
      hierarchy: conceptMap.hierarchy || [],
      metadata: conceptMap.metadata || {}
    };

    const { data: saved, error: saveErr } = await supabase
      .from('concept_maps')
      .upsert(toInsert, { onConflict: 'book_id,chapter_name' })
      .select()
      .single();

    if (saveErr) {
      console.error('Supabase upsert error:', saveErr.message);
      return res.json({ conceptMap, saved: false });
    }

    res.json({ conceptMap: saved, saved: true });
  } catch (err) {
    console.error('Concept map generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/concepts?book_id=... — fetch all concept maps for a book
router.get('/', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('concept_maps')
    .select('*')
    .eq('book_id', book_id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// DELETE /api/concepts/:id — remove a concept map
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('concept_maps').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
