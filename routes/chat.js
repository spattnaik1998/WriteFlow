const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { chatWithPartner, suggestWriting } = require('../services/openai');

// POST /api/chat — send a message to the AI reading partner
router.post('/', async (req, res) => {
  const { book_id, message, conversation_history, library_mode } = req.body;
  if (!book_id || !message) {
    return res.status(400).json({ error: 'book_id and message required' });
  }

  // Fetch book + latest notes + ideas for context
  const [{ data: book }, { data: notes }, { data: ideas }] = await Promise.all([
    supabase.from('books').select('title, author').eq('id', book_id).single(),
    supabase.from('notes').select('content').eq('book_id', book_id),
    supabase.from('ideas').select('title, body').eq('book_id', book_id).limit(10)
  ]);

  if (!book) return res.status(404).json({ error: 'Book not found' });

  // Combine all notes into a single string for context
  const allNotes = notes?.map(n => n.content).join('\n\n') || '';

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
