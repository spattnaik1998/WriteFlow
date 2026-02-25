require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const booksRouter     = require('./routes/books');
const notesRouter     = require('./routes/notes');
const distillRouter   = require('./routes/distill');
const searchRouter    = require('./routes/search');
const chatRouter      = require('./routes/chat');
const narrativeRouter = require('./routes/narrative');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

// API routes
app.use('/api/books',     booksRouter);
app.use('/api/notes',     notesRouter);
app.use('/api/distill',   distillRouter);
app.use('/api/search',    searchRouter);
app.use('/api/chat',      chatRouter);
app.use('/api/narrative', narrativeRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  WriteFlow server running at http://localhost:${PORT}\n`);
});
