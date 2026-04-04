const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');

// GET /api/analytics — aggregated reading & writing stats
router.get('/', async (req, res) => {
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const weekAgo      = new Date(Date.now() -  7 * 86400000).toISOString();

    const [
      { data: books },
      { data: sessions60 },
      { data: allSessions },
      { data: allNotes },
      { data: profile },
      { count: ideasTotal },
      { count: ideasThisWeek }
    ] = await Promise.all([
      supabase.from('books').select('id, title, status'),
      supabase.from('sessions')
        .select('started_at, activity')
        .gte('started_at', sixtyDaysAgo)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: true }),
      supabase.from('sessions').select('activity'),
      supabase.from('notes').select('book_id, content'),
      supabase.from('user_profile').select('reading_goal_annual').eq('id', 'default').maybeSingle(),
      supabase.from('ideas').select('*', { count: 'exact', head: true }),
      supabase.from('ideas').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo)
    ]);

    // ── Book counts ──────────────────────────────────────────────────────────
    const allBooks   = books || [];
    const completed  = allBooks.filter(b => b.status === 'done' || b.status === 'completed');
    const inProgress = allBooks.filter(b => !b.status || b.status === 'reading');

    // ── Words-per-day map from sessions (last 60 days) ───────────────────────
    const wordsByDay = {};
    (sessions60 || []).forEach(s => {
      const day   = s.started_at.slice(0, 10);
      const words = (s.activity || []).reduce((n, e) => n + (e.word_count || 0), 0);
      wordsByDay[day] = (wordsByDay[day] || 0) + words;
    });

    // 14-day sparkline (oldest → newest)
    const sparkline = Array.from({ length: 14 }, (_, i) => {
      const d   = new Date(Date.now() - (13 - i) * 86400000);
      const key = d.toISOString().slice(0, 10);
      return {
        date:  key,
        words: wordsByDay[key] || 0,
        label: d.toLocaleDateString('en-US', { weekday: 'short' })
      };
    });

    const wordsThisWeek = sparkline.slice(7).reduce((s, d)  => s + d.words, 0);
    const wordsLastWeek = sparkline.slice(0, 7).reduce((s, d) => s + d.words, 0);

    // ── Streak: consecutive days ending today with any writing ───────────────
    let streak = 0;
    for (let i = 0; i <= 60; i++) {
      const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      if (wordsByDay[key]) { streak++; } else if (i > 0) { break; }
    }

    // ── Total words ever across all sessions ─────────────────────────────────
    const totalWords = (allSessions || []).reduce(
      (s, sess) => s + (sess.activity || []).reduce((n, e) => n + (e.word_count || 0), 0), 0
    );

    // ── Word count per book (from notes content) ─────────────────────────────
    const wordsByBook = {};
    (allNotes || []).forEach(n => {
      if (!wordsByBook[n.book_id]) wordsByBook[n.book_id] = 0;
      wordsByBook[n.book_id] +=
        (n.content || '').trim().split(/\s+/).filter(Boolean).length;
    });

    const booksWithProgress = inProgress.slice(0, 5).map(b => ({
      id:        b.id,
      title:     b.title,
      wordCount: wordsByBook[b.id] || 0
    }));
    const maxWords = Math.max(...booksWithProgress.map(b => b.wordCount), 1);

    // ── Reading goal ─────────────────────────────────────────────────────────
    const readingGoal = profile?.reading_goal_annual || 12;

    res.json({
      books: {
        total:        allBooks.length,
        completed:    completed.length,
        inProgress:   inProgress.length,
        withProgress: booksWithProgress,
        maxWords
      },
      readingGoal,
      streak,
      wordsThisWeek,
      wordsLastWeek,
      totalWords,
      ideas: { total: ideasTotal || 0, thisWeek: ideasThisWeek || 0 },
      sparkline
    });
  } catch (err) {
    console.error('[analytics]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/analytics/goal — persist the user's annual reading target
router.put('/goal', async (req, res) => {
  const n = parseInt(req.body.goal, 10);
  if (!n || n < 1 || n > 365) return res.status(400).json({ error: 'Goal must be 1–365' });

  const { error } = await supabase
    .from('user_profile')
    .upsert({ id: 'default', reading_goal_annual: n }, { onConflict: 'id' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ goal: n });
});

module.exports = router;
