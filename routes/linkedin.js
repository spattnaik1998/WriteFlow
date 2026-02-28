const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');
const { generateLinkedInPosts, repurposeThreadToLinkedIn } = require('../services/openai');

// POST /api/linkedin/post — generate 3 LinkedIn post variants from chapter notes
router.post('/post', async (req, res) => {
  const { book_id, chapter_name, content, brand_profile } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });
  if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });

  const { data: book, error: bookErr } = await supabase
    .from('books')
    .select('title, author')
    .eq('id', book_id)
    .single();

  if (bookErr) return res.status(404).json({ error: 'Book not found' });

  const { data: ideas } = await supabase
    .from('ideas')
    .select('title, body')
    .eq('book_id', book_id)
    .limit(5);

  try {
    const posts = await generateLinkedInPosts({
      bookTitle:    book.title,
      author:       book.author,
      chapterName:  chapter_name,
      notesContent: content,
      ideas:        ideas || [],
      brandProfile: brand_profile || null
    });
    res.json(posts);
  } catch (err) {
    console.error('LinkedIn post generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin/repurpose — reformat a thread into one LinkedIn post
router.post('/repurpose', async (req, res) => {
  const { thread, book_id, brand_profile } = req.body;
  if (!thread || !Array.isArray(thread) || thread.length === 0) {
    return res.status(400).json({ error: 'thread array required' });
  }

  let bookTitle = '', author = '';
  if (book_id) {
    const { data: book } = await supabase
      .from('books')
      .select('title, author')
      .eq('id', book_id)
      .single();
    if (book) { bookTitle = book.title; author = book.author; }
  }

  try {
    const result = await repurposeThreadToLinkedIn({
      thread,
      bookTitle,
      author,
      brandProfile: brand_profile || null
    });
    res.json(result);
  } catch (err) {
    console.error('Thread repurpose error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
