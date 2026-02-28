const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');
const { generateDigest } = require('../services/openai');

// POST /api/digest — aggregate last 7 days of ideas → newsletter digest
router.post('/', async (req, res) => {
  const { brand_profile } = req.body;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch recent ideas with book context
  const { data: recentIdeas, error: ideasErr } = await supabase
    .from('ideas')
    .select('id, book_id, title, body, tags, created_at')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false });

  if (ideasErr) return res.status(500).json({ error: ideasErr.message });

  if (!recentIdeas || recentIdeas.length === 0) {
    return res.status(400).json({ error: 'No ideas found in the past 7 days — distil some notes first.' });
  }

  // Fetch all books to get titles and authors
  const bookIds = [...new Set(recentIdeas.map(i => i.book_id))];
  const { data: books } = await supabase
    .from('books')
    .select('id, title, author')
    .in('id', bookIds);

  const bookMap = {};
  (books || []).forEach(b => { bookMap[b.id] = b; });

  // Group ideas by book
  const booksWithIdeas = bookIds.map(bid => {
    const b = bookMap[bid] || { title: 'Unknown', author: '' };
    return {
      title:  b.title,
      author: b.author || '',
      ideas:  recentIdeas.filter(i => i.book_id === bid).slice(0, 5)
    };
  });

  // Fetch most recent article across all books
  const { data: articles } = await supabase
    .from('articles')
    .select('title, url, domain')
    .order('created_at', { ascending: false })
    .limit(1);

  const topArticle = articles && articles.length > 0 ? articles[0] : null;

  try {
    const digest = await generateDigest({
      books:       booksWithIdeas,
      topArticle,
      brandProfile: brand_profile || null
    });

    // Assemble plain text for one-click copy
    const ideasText = (digest.key_ideas || [])
      .map(k => `📚 ${k.book}\n${k.title}: ${k.insight}`)
      .join('\n\n');

    const plain_text = [
      `SUBJECT: ${digest.subject_line}`,
      '',
      digest.opening_hook,
      '',
      '━━━ THIS WEEK\'S IDEAS ━━━',
      '',
      ideasText,
      '',
      topArticle ? `━━━ ARTICLE PICK ━━━\n\n${digest.article_pick}\n${topArticle.url}` : '',
      '',
      '━━━ CLOSING THOUGHT ━━━',
      '',
      digest.closing_thought
    ].filter(line => line !== null).join('\n');

    res.json({ ...digest, plain_text });
  } catch (err) {
    console.error('Digest generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
