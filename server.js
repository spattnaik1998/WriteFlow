require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const booksRouter         = require('./routes/books');
const notesRouter         = require('./routes/notes');
const distillRouter       = require('./routes/distill');
const searchRouter        = require('./routes/search');
const chatRouter          = require('./routes/chat');
const narrativeRouter     = require('./routes/narrative');
const tweetsRouter        = require('./routes/tweets');
const profileRouter       = require('./routes/profile');
const linkedinRouter      = require('./routes/linkedin');
const digestRouter        = require('./routes/digest');
const contradictionsRouter = require('./routes/contradictions');
const argumentsRouter      = require('./routes/arguments');
const conceptsRouter      = require('./routes/concepts');
const exportRouter        = require('./routes/export');
const essaysRouter        = require('./routes/essays');
const sessionsRouter      = require('./routes/sessions');
const analyticsRouter     = require('./routes/analytics');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

// API routes
app.use('/api/books',         booksRouter);
app.use('/api/notes',         notesRouter);
app.use('/api/distill',       distillRouter);
app.use('/api/search',        searchRouter);
app.use('/api/chat',          chatRouter);
app.use('/api/narrative',     narrativeRouter);
app.use('/api/tweets',        tweetsRouter);
app.use('/api/profile',       profileRouter);
app.use('/api/linkedin',      linkedinRouter);
app.use('/api/digest',        digestRouter);
app.use('/api/contradictions', contradictionsRouter);
app.use('/api/arguments',      argumentsRouter);
app.use('/api/concepts',      conceptsRouter);
app.use('/api/export',        exportRouter);
app.use('/api/essays',        essaysRouter);
app.use('/api/sessions',      sessionsRouter);
app.use('/api/analytics',    analyticsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const startServer = (port = 3000) => {
  const server = app.listen(port, () => {
    console.log(`\n  WriteFlow server running at http://localhost:${port}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
};

const PORT = process.env.PORT || 3000;
startServer(PORT);
