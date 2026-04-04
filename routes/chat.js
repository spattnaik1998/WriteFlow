const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { chatWithPartner, suggestWriting } = require('../services/openai');

// POST /api/chat — send a message to the AI reading partner
router.post('/', async (req, res) => {
  const { book_id, message, conversation_history, library_mode, current_chapter, notes_snapshot } = req.body;
  if (!book_id || !message) {
    return res.status(400).json({ error: 'book_id and message required' });
  }

  // Fetch book + all chapter notes + idea cards in parallel
  const [{ data: book }, { data: dbNotes }, { data: ideas }] = await Promise.all([
    supabase.from('books').select('title, author, category, why_reading').eq('id', book_id).single(),
    supabase.from('notes').select('content, chapter_name').eq('book_id', book_id),
    supabase.from('ideas').select('title, body, chapter_name, tags').eq('book_id', book_id).limit(25)
  ]);

  if (!book) return res.status(404).json({ error: 'Book not found' });

  // Merge in-memory snapshot over DB rows so the AI sees the very latest
  // content — including notes typed within the auto-save debounce window.
  let notes = dbNotes || [];
  if (notes_snapshot && typeof notes_snapshot === 'object') {
    const noteMap = {};
    notes.forEach(n => { noteMap[n.chapter_name] = { ...n }; });
    Object.entries(notes_snapshot).forEach(([chapter, content]) => {
      if (typeof content === 'string' && content.trim()) {
        noteMap[chapter] = { ...(noteMap[chapter] || {}), chapter_name: chapter, content };
      }
    });
    notes = Object.values(noteMap);
  }

  // Build structured notes context — current chapter first, then others
  // Each chapter is labelled so the AI knows what part of the book it belongs to
  const sortedNotes = [...notes].sort((a, b) => {
    if (a.chapter_name === current_chapter) return -1;
    if (b.chapter_name === current_chapter) return 1;
    return 0;
  });

  const allNotes = sortedNotes
    .filter(n => n.content && n.content.trim())
    .map(n => `[${n.chapter_name || 'Notes'}]\n${n.content.trim()}`)
    .join('\n\n---\n\n')
    .slice(0, 4000); // generous budget — GPT-4o handles long context well

  // Build cross-library context when library_mode is enabled
  let libraryContext = null;
  if (library_mode) {
    const { data: allBooks } = await supabase
      .from('books')
      .select('id, title, author')
      .neq('id', book_id);

    if (allBooks && allBooks.length > 0) {
      const { data: allIdeas } = await supabase
        .from('ideas')
        .select('title, body, book_id')
        .in('book_id', allBooks.map(b => b.id))
        .limit(50);

      const ideasByBook = {};
      (allIdeas || []).forEach(idea => {
        if (!ideasByBook[idea.book_id]) ideasByBook[idea.book_id] = [];
        ideasByBook[idea.book_id].push({ title: idea.title, body: idea.body });
      });

      libraryContext = allBooks
        .map(b => ({
          bookTitle: b.title,
          author:    b.author,
          ideas:     ideasByBook[b.id] || []
        }))
        .filter(b => b.ideas.length > 0);
    }
  }

  try {
    const reply = await chatWithPartner({
      userMessage:         message,
      bookTitle:           book.title,
      author:              book.author,
      category:            book.category || '',
      whyReading:          book.why_reading || '',
      currentChapter:      current_chapter  || null,
      notes:               allNotes,
      ideaCards:           ideas || [],
      conversationHistory: conversation_history || [],
      libraryContext
    });

    // Save message + reply to Supabase for conversation history
    await supabase.from('conversations').insert([
      { book_id, role: 'user',      content: message },
      { book_id, role: 'assistant', content: reply   }
    ]);

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/history?book_id=... — fetch conversation history
router.get('/history', async (req, res) => {
  const { book_id, limit = 40 } = req.query;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data, error } = await supabase
    .from('conversations')
    .select('role, content, created_at')
    .eq('book_id', book_id)
    .order('created_at', { ascending: true })
    .limit(Number(limit));

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/chat/suggest — AI writing suggestion for the Write tab
router.post('/suggest', async (req, res) => {
  const { book_id, current_text } = req.body;
  if (!book_id || !current_text) {
    return res.status(400).json({ error: 'book_id and current_text required' });
  }

  const [{ data: book }, { data: ideas }] = await Promise.all([
    supabase.from('books').select('title, author').eq('id', book_id).single(),
    supabase.from('ideas').select('title, body').eq('book_id', book_id).limit(6)
  ]);

  try {
    const suggestion = await suggestWriting({
      bookTitle:   book.title,
      author:      book.author,
      currentText: current_text,
      ideaCards:   ideas || []
    });
    res.json({ suggestion });
  } catch (err) {
    console.error('Suggest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
