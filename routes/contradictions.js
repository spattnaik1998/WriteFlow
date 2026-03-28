const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { detectContradictions } = require('../services/openai');

// POST /api/contradictions/detect — run contradiction detection for a book
router.post('/detect', async (req, res) => {
  const { book_id } = req.body;
  if (!book_id) {
    return res.status(400).json({ error: 'book_id required' });
  }

  // Fetch all ideas for this book
  const { data: ideas, error: ideasErr } = await supabase
    .from('ideas')
    .select('id, title, body')
    .eq('book_id', book_id);

  if (ideasErr) return res.status(500).json({ error: ideasErr.message });

  // Need at least 2 ideas to detect contradictions
  if (!ideas || ideas.length < 2) {
    return res.status(400).json({ error: 'At least 2 ideas required to detect contradictions' });
  }

  try {
    const contradictions = await detectContradictions({ ideas });

    // Upsert each contradiction into the database
    if (contradictions.length > 0) {
      const toInsert = contradictions.map(c => ({
        book_id,
        idea_a_id: c.idea_a_id,
        idea_b_id: c.idea_b_id,
        contradiction_type: c.contradiction_type,
        description: c.description,
        severity: c.severity,
        resolution_options: c.resolution_options,
        status: 'unresolved'
      }));

      const { data: saved, error: saveErr } = await supabase
        .from('contradictions')
        .upsert(toInsert, { onConflict: 'idea_a_id, idea_b_id' })
        .select();

      if (saveErr) {
        console.error('Supabase upsert error:', saveErr.message);
        // Still return the generated contradictions even if save fails
        return res.json({ contradictions, saved: false });
      }

      return res.json({ contradictions: saved, saved: true });
    }

    res.json({ contradictions: [], saved: true });
  } catch (err) {
    console.error('Contradiction detection error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contradictions?book_id=... — fetch saved contradictions for a book
router.get('/', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('contradictions')
    .select('*')
    .eq('book_id', book_id)
    .order('severity', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PATCH /api/contradictions/:id — update contradiction status
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'status required (unresolved|resolved|accepted_tension)' });
  }

  const validStatuses = ['unresolved', 'resolved', 'accepted_tension'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { data, error } = await supabase
    .from('contradictions')
    .update({ status })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
