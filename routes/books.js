const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');

// GET /api/books — list all books
router.get('/', async (req, res) => {
  // Try full column set first; fall back to guaranteed-safe columns if
  // the deployment hasn't run the latest schema migrations yet.
  let { data, error } = await supabase
    .from('books')
    .select('id, title, author, spine_color, progress, source_type, status, source_url, category, why_reading, created_at')
    .order('created_at', { ascending: false });

  if (error && error.message.includes('does not exist')) {
    // Older schema — select only the base columns that always exist
    ({ data, error } = await supabase
      .from('books')
      .select('id, title, author, spine_color, progress, created_at')
      .order('created_at', { ascending: false }));
  }

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/books/prefill?url= — scrape og meta tags to pre-fill the add-book form
router.get('/prefill', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({});

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 5000);
    const response   = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WriteFlow/1.0)' },
      signal:  controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) return res.json({});

    const html = await response.text();

    // og:title (both attribute orders), fallback to <title>
    const titleMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+property=["']og:title["']/i) ||
      html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);

    // article:author / og:author / author / byline
    const authorMatch =
      html.match(/<meta[^>]+(?:property|name)=["'](?:article:author|og:author|author|byline)["'][^>]+content=["']([^"']{1,200})["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']{1,200})["'][^>]+(?:property|name)=["'](?:article:author|og:author|author|byline)["']/i);

    // og:site_name, fallback to hostname
    const siteMatch =
      html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,200})["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']{1,200})["'][^>]+property=["']og:site_name["']/i);

    const domain = new URL(url).hostname.replace(/^www\./, '');

    return res.json({
      title:  titleMatch  ? titleMatch[1].trim()  : '',
      author: authorMatch ? authorMatch[1].trim() : '',
      domain: siteMatch   ? siteMatch[1].trim()   : domain
    });
  } catch {
    return res.json({});
  }
});

// POST /api/books — create a book
router.post('/', async (req, res) => {
  const { title, author, category, why_reading, spine_color,
          source_type, status, source_url } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  // Build insert row with required fields first
  const row = { title, author, spine_color, progress: 0 };

  // Probe which optional columns exist before inserting so we don't get a
  // "column does not exist" error on deployments with older schemas.
  // We do a single cheap probe and cache the result for the process lifetime.
  if (!router._colsProbed) {
    const { error: probeErr } = await supabase
      .from('books')
      .select('source_type, status, source_url, category, why_reading')
      .limit(0);
    router._hasExtCols = !probeErr;
    router._colsProbed = true;
  }

  if (router._hasExtCols) {
    row.source_type = source_type || 'book';
    row.status      = status      || 'reading';
    row.source_url  = source_url  || null;
    row.category    = category    || null;
    row.why_reading = why_reading || null;
  }

  const { data, error } = await supabase
    .from('books').insert([row]).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/books/:id — update progress or metadata
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const { data, error } = await supabase
    .from('books')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/books/:id — cascade delete book and all related data
router.delete('/:id', async (req, res) => {
  const bookId = req.params.id;

  try {
    // Delete all related data in order of foreign key dependencies
    await supabase.from('conversations').delete().eq('book_id', bookId);
    await supabase.from('articles').delete().eq('book_id', bookId);
    await supabase.from('ideas').delete().eq('book_id', bookId);
    await supabase.from('essays').delete().eq('book_id', bookId);
    await supabase.from('notes').delete().eq('book_id', bookId);

    // Finally, delete the book itself
    const { error } = await supabase.from('books').delete().eq('id', bookId);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
