/**
 * Session tracking routes.
 *
 * A Session models one continuous writing period. It records which
 * books/chapters the user touched (activity), then generates a GPT-4o
 * briefing (recap) that surfaces key threads and a prep question for the
 * next session.
 *
 * Public interface (smallest useful surface):
 *   POST   /api/sessions            — start a session
 *   PATCH  /api/sessions/:id        — update activity / mark ended
 *   GET    /api/sessions/last       — last ended session (excludes current)
 *   POST   /api/sessions/:id/recap  — generate or return cached recap
 *   POST   /api/sessions/:id/quiz   — generate or return cached 5-question quiz
 */
const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');
const { generateSessionRecap, generateSessionQuiz } = require('../services/openai');

// ── Start a session ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { data, error } = await supabase
    .from('sessions')
    .insert([{ started_at: new Date().toISOString(), activity: [] }])
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ id: data.id });
});

// ── Update activity and/or mark session ended ─────────────────────────────
// Body: { activity?: [...], ended?: true }
router.patch('/:id', async (req, res) => {
  const { activity, ended } = req.body;
  const updates = {};
  if (Array.isArray(activity)) updates.activity = activity;
  if (ended) updates.ended_at = new Date().toISOString();

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', req.params.id)
    .select('id, ended_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Get the last ended session (exclude currently active one) ─────────────
// Query: ?current_id=<uuid>  (to skip the just-created session)
router.get('/last', async (req, res) => {
  const { current_id } = req.query;

  let query = supabase
    .from('sessions')
    .select('*')
    .not('ended_at', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(1);

  if (current_id) query = query.neq('id', current_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const session = data?.[0];
  if (!session) return res.json(null);

  // Skip sessions with no meaningful activity (< 20 words written)
  const totalWords = (session.activity || []).reduce((s, e) => s + (e.word_count || 0), 0);
  if (totalWords < 20) return res.json(null);

  res.json(session);
});

// ── Generate (or return cached) GPT-4o recap for a session ───────────────
router.post('/:id/recap', async (req, res) => {
  const { data: session, error: sessErr } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (sessErr || !session) return res.status(404).json({ error: 'Session not found' });

  // Return cached recap without hitting GPT-4o again
  if (session.recap) return res.json({ recap: session.recap });

  const activity = session.activity || [];
  if (!activity.length) return res.json({ recap: null });

  // Hydrate each activity entry with current note content from the DB.
  // We group by book so we can pass a structured books array to the LLM.
  const bookMap = {};
  for (const entry of activity) {
    const { data: note } = await supabase
      .from('notes')
      .select('content')
      .eq('book_id', entry.book_id)
      .eq('chapter_name', entry.chapter_name)
      .maybeSingle();

    if (!bookMap[entry.book_id]) {
      bookMap[entry.book_id] = {
        title:    entry.book_title  || 'Untitled',
        author:   entry.book_author || '',
        chapters: []
      };
    }
    bookMap[entry.book_id].chapters.push({
      chapter_name: entry.chapter_name,
      word_count:   entry.word_count || 0,
      // Limit each snippet to 600 chars to keep the prompt tight
      snippet:      (note?.content || '').slice(0, 600)
    });
  }

  const totalWords = activity.reduce((s, e) => s + (e.word_count || 0), 0);

  const recap = await generateSessionRecap({
    books: Object.values(bookMap),
    totalWords
  });

  // Persist recap so subsequent loads are instant
  await supabase
    .from('sessions')
    .update({ recap })
    .eq('id', req.params.id);

  res.json({ recap });
});

// ── Generate (or return cached) 5-question quiz for a session ────────────
router.post('/:id/quiz', async (req, res) => {
  const { data: session, error: sessErr } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (sessErr || !session) return res.status(404).json({ error: 'Session not found' });

  // Return cached quiz — no need to burn tokens again
  if (session.quiz) return res.json({ questions: session.quiz });

  const activity = session.activity || [];
  if (!activity.length) return res.json({ questions: [] });

  // Hydrate with current note content (same pattern as recap)
  const bookMap = {};
  for (const entry of activity) {
    const { data: note } = await supabase
      .from('notes')
      .select('content')
      .eq('book_id', entry.book_id)
      .eq('chapter_name', entry.chapter_name)
      .maybeSingle();

    if (!bookMap[entry.book_id]) {
      bookMap[entry.book_id] = { title: entry.book_title || 'Untitled', author: entry.book_author || '', chapters: [] };
    }
    bookMap[entry.book_id].chapters.push({
      chapter_name: entry.chapter_name,
      word_count:   entry.word_count || 0,
      snippet:      (note?.content || '').slice(0, 800)   // slightly more context for quiz
    });
  }

  let questions;
  try {
    questions = await generateSessionQuiz({ books: Object.values(bookMap) });
  } catch (e) {
    console.error('[quiz] generateSessionQuiz failed:', e.message);
    return res.json({ questions: [] });
  }

  // Cache so subsequent loads are instant
  await supabase.from('sessions').update({ quiz: questions }).eq('id', req.params.id);

  res.json({ questions });
});

module.exports = router;
