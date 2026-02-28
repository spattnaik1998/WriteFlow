const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');

// GET /api/profile — load brand voice profile
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('user_profile')
    .select('id, positioning, audience, tone')
    .eq('id', 'default')
    .single();

  if (error || !data) return res.json({});
  res.json(data);
});

// PUT /api/profile — upsert brand voice profile
router.put('/', async (req, res) => {
  const { positioning, audience, tone } = req.body;

  const { data, error } = await supabase
    .from('user_profile')
    .upsert({ id: 'default', positioning, audience, tone }, { onConflict: 'id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
