const express = require('express');
const router  = express.Router();
const crypto = require('crypto');
const supabase = require('../services/supabase');
const { generateTweets, TWEET_TARGET_WORDS } = require('../services/openai');
const { noteToPlainText } = require('../services/noteHtml');
const { sortNotesByChapter } = require('../services/chapterOrder');
const { wordCount } = require('../services/noAiSlop');

// How much history to hand the model. Angles are short, so this stays cheap even for a
// book that has been posted about a dozen times; the cap is about prompt focus, not cost.
const HISTORY_LIMIT = 40;

// Postgres error for "relation does not exist" — the tweets table has not been created.
const MISSING_TABLE = '42P01';

function isMissingTable(error) {
  return error && (error.code === MISSING_TABLE || /schema cache|does not exist/i.test(error.message || ''));
}

const SCHEMA_HINT =
  'Post history is not being saved: the `tweets` table does not exist yet. ' +
  'Run the tweets block at the bottom of supabase_schema.sql in the Supabase SQL editor. ' +
  'Posts still generate, but they cannot be de-duplicated against earlier ones until then.';

// GET /api/tweets?book_id=... — posts previously generated for a book, newest first
router.get('/', async (req, res) => {
  const { book_id } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('tweets')
    .select('*')
    .eq('book_id', book_id)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTable(error)) return res.json({ posts: [], warning: SCHEMA_HINT });
    return res.status(500).json({ error: error.message });
  }
  res.json({ posts: data || [] });
});

// POST /api/tweets — generate long-form posts from an entire book
router.post('/', async (req, res) => {
  const { book_id, brand_profile } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data: book, error: bookErr } = await supabase
    .from('books')
    .select('title, author')
    .eq('id', book_id)
    .single();

  if (bookErr || !book) return res.status(404).json({ error: 'Book not found' });

  // The whole book, in reading order — not the chapter open in the editor. An argument
  // worth posting usually spans chapters.
  const { data: rawNotes, error: notesErr } = await supabase
    .from('notes')
    .select('chapter_name, chapter_order, content, created_at')
    .eq('book_id', book_id);

  if (notesErr) return res.status(500).json({ error: notesErr.message });

  const bookNotes = sortNotesByChapter(rawNotes)
    .map(n => ({ chapter_name: n.chapter_name, text: noteToPlainText(n.content) }))
    .filter(n => n.text.trim());

  if (!bookNotes.length) {
    return res.status(400).json({ error: 'This book has no notes to draw from yet.' });
  }

  const { data: ideas } = await supabase
    .from('ideas')
    .select('title, body')
    .eq('book_id', book_id)
    .order('number', { ascending: true });

  // Everything generated from this book before, so the model can avoid repeating itself.
  let previousPosts = [];
  let warning = null;
  const { data: history, error: historyErr } = await supabase
    .from('tweets')
    .select('content, angle')
    .eq('book_id', book_id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (historyErr) {
    if (!isMissingTable(historyErr)) return res.status(500).json({ error: historyErr.message });
    warning = SCHEMA_HINT;
  } else {
    previousPosts = history || [];
  }

  let posts;
  try {
    posts = await generateTweets({
      bookTitle:     book.title,
      author:        book.author,
      bookNotes,
      ideas:         ideas || [],
      previousPosts,
      brandProfile:  brand_profile || null
    });
  } catch (err) {
    console.error('Tweet generation error:', err.message);
    return res.status(500).json({ error: err.message });
  }

  if (!posts.length) return res.status(500).json({ error: 'The model returned no posts.' });

  const batchId = crypto.randomUUID();
  const enriched = posts.map(p => ({
    ...p,
    word_count: wordCount(p.text)
  }));

  // Persistence is non-fatal, the same way distill.js treats its inserts: the user should
  // get their posts even if the history write fails.
  if (!warning) {
    const { error: insertErr } = await supabase.from('tweets').insert(
      enriched.map(p => ({
        book_id,
        content:    p.text,
        angle:      p.angle || null,
        word_count: p.word_count,
        batch_id:   batchId
      }))
    );
    if (insertErr) {
      console.error('[tweets] history insert failed:', insertErr.message);
      warning = isMissingTable(insertErr)
        ? SCHEMA_HINT
        : `Posts generated, but saving them to history failed: ${insertErr.message}`;
    }
  }

  // A book with thin notes cannot reach the word target without the model inventing
  // material, which the contract forbids. Report the source size so the UI can say why
  // a batch came up short instead of leaving the user to guess.
  const sourceWords = bookNotes.reduce((sum, n) => sum + wordCount(n.text), 0);

  res.json({
    posts:            enriched,
    total_words:      enriched.reduce((sum, p) => sum + p.word_count, 0),
    target_words:     TWEET_TARGET_WORDS,
    chapters_used:    bookNotes.length,
    source_words:     sourceWords,
    avoided_previous: previousPosts.length,
    book:             { title: book.title, author: book.author },
    ...(warning ? { warning } : {})
  });
});

// DELETE /api/tweets/:id — drop one post from history so its angle can be reused
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('tweets').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
