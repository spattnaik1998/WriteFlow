const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');
const { findBlogArticles, findScholarlyArticles } = require('../services/serper');
const { classifyArticleStances } = require('../services/openai');

// POST /api/search — find blog articles for a concept/book
router.post('/', async (req, res) => {
  const { book_id, concept_query } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  // Fetch book details
  const { data: book, error: bookErr } = await supabase
    .from('books')
    .select('title, author')
    .eq('id', book_id)
    .single();

  if (bookErr) return res.status(404).json({ error: 'Book not found' });

  // When no concept_query is supplied, pull distilled ideas from DB and use
  // their titles + tags to build a niche search query
  let ideasContext = [];
  if (!concept_query) {
    const { data: ideas } = await supabase
      .from('ideas')
      .select('title, tags')
      .eq('book_id', book_id)
      .limit(5);
    ideasContext = ideas || [];
  }

  try {
    const articles = await findBlogArticles({
      bookTitle:    book.title,
      author:       book.author,
      conceptQuery: concept_query || null,
      ideasContext,
      count: 6
    });

    // Classify article stances relative to the book's thesis
    let articlesWithStance = articles;
    if (articles.length > 0) {
      const thesis = `"${book.title}" by ${book.author} — ${concept_query || 'key arguments'}`;
      try {
        const stances = await classifyArticleStances({ articles, thesis });
        articlesWithStance = articles.map((a, i) => ({ ...a, stance: stances[i] || 'neutral' }));
      } catch (stanceErr) {
        console.warn('Stance classification failed, defaulting to neutral:', stanceErr.message);
        articlesWithStance = articles.map(a => ({ ...a, stance: 'neutral' }));
      }
    }

    // Save search results to Supabase for future reference
    if (articlesWithStance.length) {
      await supabase.from('articles').upsert(
        articlesWithStance.map(a => ({
          book_id,
          title:   a.title,
          url:     a.url,
          domain:  a.domain,
          snippet: a.snippet,
          favicon: a.favicon,
          stance:  a.stance || 'neutral'
        })),
        { onConflict: 'book_id,url', ignoreDuplicates: true }
      );
    }

    res.json(articlesWithStance);
  } catch (err) {
    console.error('Serper search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search/scholarly?concept=...&book_id=... — search Google Scholar for research papers
router.get('/scholarly', async (req, res) => {
  const { concept, book_id } = req.query;
  if (!concept) return res.status(400).json({ error: 'concept required' });

  let bookTitle = '';
  if (book_id) {
    const { data: book } = await supabase
      .from('books')
      .select('title')
      .eq('id', book_id)
      .single();
    if (book) bookTitle = book.title;
  }

  try {
    const articles = await findScholarlyArticles({ concept, bookTitle });
    res.json(articles);
  } catch (err) {
    console.error('Scholar search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search/saved?book_id=... — get previously saved articles
router.get('/saved', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('book_id', book_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
