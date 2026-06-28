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
const conceptsRouter      = require('./routes/concepts');
const exportRouter        = require('./routes/export');
const essaysRouter        = require('./routes/essays');
const sessionsRouter      = require('./routes/sessions');
const analyticsRouter     = require('./routes/analytics');
const advocateRouter      = require('./routes/advocate');
const argumentsRouter     = require('./routes/arguments');
const synthesisRouter     = require('./routes/synthesis');
const refineRouter        = require('./routes/refine');
const wikiRouter          = require('./routes/wiki');
const essayAgentRouter    = require('./routes/essayAgent');
const livingIdeasRouter   = require('./routes/livingIdeas');
const { requireAuth }     = require('./middleware/auth');

const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname)));

// Health check + auth config — must stay unauthenticated. The frontend's
// prototype-vs-live-mode detection depends on /api/health staying reachable
// before login, and /api/auth/config hands the (public-safe) anon key to the
// browser so it can initialise its own Supabase client for the OAuth flow.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});
app.get('/api/auth/config', (req, res) => {
  res.json({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY });
});

// Everything else under /api requires a signed-in, allow-listed user.
app.use('/api', requireAuth);

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
app.use('/api/concepts',      conceptsRouter);
app.use('/api/export',        exportRouter);
app.use('/api/essays',        essaysRouter);
app.use('/api/sessions',      sessionsRouter);
app.use('/api/analytics',    analyticsRouter);
app.use('/api/advocate',     advocateRouter);
app.use('/api/arguments',   argumentsRouter);
app.use('/api/synthesis',    synthesisRouter);
app.use('/api/refine',       refineRouter);
app.use('/api/wiki',         wikiRouter);
app.use('/api/essay-agent',  essayAgentRouter);
app.use('/api/living-ideas', livingIdeasRouter);

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
