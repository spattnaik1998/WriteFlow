const express  = require('express');
const router   = express.Router();
const { runDevilsAdvocate } = require('../services/openai');

// POST /api/advocate
// Body: { topic: string, essay_text: string }
// Returns structured devil's advocate critique
router.post('/', async (req, res) => {
  const { topic, essay_text } = req.body;

  if (!topic || !essay_text) {
    return res.status(400).json({ error: 'topic and essay_text are required' });
  }
  if (essay_text.trim().length < 50) {
    return res.status(400).json({ error: 'Essay is too short for meaningful analysis (minimum 50 characters)' });
  }

  try {
    const analysis = await runDevilsAdvocate({ topic, essayText: essay_text });
    res.json(analysis);
  } catch (err) {
    console.error('[advocate] OpenAI error:', err.message);
    res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
});

module.exports = router;
