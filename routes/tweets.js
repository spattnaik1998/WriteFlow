const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');
const { generateTweets, generateThread } = require('../services/openai');

// POST /api/tweets — generate tweet-ready insights from a chapter's notes
router.post('/', async (req, res) => {
  const { book_id, chapter_name, content } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });

  const { data: book, error: bookErr } = await supabase
    .from('books')
    .select('title, author')
    .eq('id', book_id)
    .single();

  if (bookErr) return res.status(404).json({ error: 'Book not found' });

  // Fetch distilled ideas for richer context
  const { data: ideas } = await supabase
    .from('ideas')
    .select('title, body')
    .eq('book_id', book_id)
    .limit(5);

  try {
    const tweets = await generateTweets({
      bookTitle:    book.title,
      author:       book.author,
      chapterName:  chapter_name,
      notesContent: content,
      ideas:        ideas || []
    });
    res.json({ tweets });
  } catch (err) {
    console.error('Tweet generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tweets/thread — transform chapter notes into a cohesive Twitter thread
router.post('/thread', async (req, res) => {
  const { book_id, chapter_name, content } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });

  const { data: book, error: bookErr } = await supabase
    .from('books')
    .select('title, author')
    .eq('id', book_id)
    .single();

  if (bookErr) return res.status(404).json({ error: 'Book not found' });

  // Fetch distilled ideas to enrich the thread narrative
  const { data: ideas } = await supabase
    .from('ideas')
    .select('title, body')
    .eq('book_id', book_id)
    .limit(6);

  try {
    const thread = await generateThread({
      bookTitle:    book.title,
      author:       book.author,
      chapterName:  chapter_name,
      notesContent: content,
      ideas:        ideas || []
    });
    res.json({ thread });
  } catch (err) {
    console.error('Thread generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
