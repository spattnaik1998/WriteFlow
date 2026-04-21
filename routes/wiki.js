const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { ingestSourceToWiki, queryWiki, questionAssumptionsAgainstWiki, lintWiki } = require('../services/openai');
const { parseLinks, diffLinkSet } = require('../services/wikiLinks');

// ─── helpers ───────────────────────────────────────────────────────────────

function parseDateRange(query) {
  const days = Math.min(Math.max(parseInt(query.days || '30', 10) || 30, 1), 365);
  const from = query.from
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(query.from) ? `${query.from}T00:00:00.000Z` : query.from)
    : null;
  const to = query.to
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(query.to) ? `${query.to}T23:59:59.999Z` : query.to)
    : new Date();
  const computedFrom = from || new Date(to.getTime() - days * 86400000);

  if (Number.isNaN(computedFrom.getTime()) || Number.isNaN(to.getTime())) return null;

  return {
    days,
    from: computedFrom.toISOString(),
    to: to.toISOString()
  };
}

function scorePage(page, q) {
  if (!q) return 1;
  const query = q.toLowerCase();
  const title = (page.title || '').toLowerCase();
  const slug = (page.slug || '').toLowerCase();
  const body = (page.markdown_content || '').toLowerCase();
  return (title.includes(query) ? 5 : 0) +
         (slug.includes(query) ? 3 : 0) +
         (body.includes(query) ? 1 : 0);
}

function pageSnippet(page, q) {
  const body = (page.markdown_content || '').replace(/\s+/g, ' ').trim();
  if (!body) return '';
  if (!q) return body.slice(0, 180);
  const idx = body.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, idx - 70);
  return body.slice(start, start + 220);
}

async function upsertPageAndLinks(page, supabaseClient) {
  const { slug, title, page_type, markdown_content, metadata } = page;

  // fetch existing page for prev_markdown / version tracking
  const { data: existing } = await supabaseClient
    .from('wiki_pages')
    .select('id, markdown_content, metadata')
    .eq('slug', slug)
    .single();

  const version = (existing?.metadata?.version || 0) + 1;
  const prev_markdown = existing?.markdown_content || '';

  const newMeta = {
    ...(existing?.metadata || {}),
    ...metadata,
    version,
    prev_markdown: version > 1 ? prev_markdown : ''
  };

  let pageId;
  if (existing) {
    const { data: updated } = await supabaseClient
      .from('wiki_pages')
      .update({ title, page_type, markdown_content, metadata: newMeta })
      .eq('slug', slug)
      .select('id')
      .single();
    pageId = updated?.id;
  } else {
    const { data: inserted } = await supabaseClient
      .from('wiki_pages')
      .insert([{ slug, title, page_type, markdown_content, metadata: newMeta }])
      .select('id')
      .single();
    pageId = inserted?.id;
  }

  if (!pageId) return;

  // re-derive wiki_links for this page
  const newLinks  = parseLinks(markdown_content);
  const oldLinks  = existing ? parseLinks(prev_markdown) : [];
  const { added, removed } = diffLinkSet(oldLinks, newLinks);

  if (removed.length > 0) {
    await supabaseClient
      .from('wiki_links')
      .delete()
      .eq('source_page_id', pageId)
      .in('target_slug', removed.map(l => l.slug));
  }

  if (added.length > 0) {
    await supabaseClient
      .from('wiki_links')
      .insert(added.map(l => ({
        source_page_id: pageId,
        target_slug:    l.slug,
        link_context:   l.context
      })));
  }

  return pageId;
}

// ─── GET /api/wiki/pages ─────────────────────────────────────────────────────
router.get('/pages', async (req, res) => {
  const { type, limit = 100, offset = 0 } = req.query;

  let query = supabase
    .from('wiki_pages')
    .select('id, slug, title, page_type, metadata, updated_at', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (type) query = query.eq('page_type', type);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ pages: data || [], total: count || 0 });
});

// ─── GET /api/wiki/pages/:slug ───────────────────────────────────────────────
router.get('/pages/:slug', async (req, res) => {
  const { slug } = req.params;

  const { data: page, error } = await supabase
    .from('wiki_pages')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !page) return res.status(404).json({ error: 'Page not found' });

  // resolve backlinks: pages that link TO this slug
  const { data: linkRows } = await supabase
    .from('wiki_links')
    .select('source_page_id, link_context')
    .eq('target_slug', slug);

  let backlinks = [];
  if (linkRows && linkRows.length > 0) {
    const ids = linkRows.map(r => r.source_page_id);
    const { data: sourcePages } = await supabase
      .from('wiki_pages')
      .select('id, slug, title, page_type')
      .in('id', ids);

    backlinks = (sourcePages || []).map(p => ({
      ...p,
      context: linkRows.find(r => r.source_page_id === p.id)?.link_context || ''
    }));
  }

  res.json({ ...page, backlinks });
});

// ─── POST /api/wiki/pages/:slug (manual edit) ────────────────────────────────
router.post('/pages/:slug', async (req, res) => {
  const { slug } = req.params;
  const { markdown_content, title } = req.body;

  if (!markdown_content) return res.status(400).json({ error: 'markdown_content required' });

  const { data: existing, error: fetchErr } = await supabase
    .from('wiki_pages')
    .select('*')
    .eq('slug', slug)
    .single();

  if (fetchErr || !existing) return res.status(404).json({ error: 'Page not found' });

  const updates = {
    markdown_content,
    title: title || existing.title,
    metadata: {
      ...existing.metadata,
      user_edited: true,
      version: (existing.metadata?.version || 0) + 1,
      prev_markdown: existing.markdown_content
    }
  };

  const { data: updated, error } = await supabase
    .from('wiki_pages')
    .update(updates)
    .eq('slug', slug)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // re-derive links
  const newLinks = parseLinks(markdown_content);
  const oldLinks = parseLinks(existing.markdown_content);
  const { added, removed } = diffLinkSet(oldLinks, newLinks);

  if (removed.length > 0) {
    await supabase.from('wiki_links').delete()
      .eq('source_page_id', existing.id)
      .in('target_slug', removed.map(l => l.slug));
  }
  if (added.length > 0) {
    await supabase.from('wiki_links').insert(
      added.map(l => ({ source_page_id: existing.id, target_slug: l.slug, link_context: l.context }))
    );
  }

  await supabase.from('wiki_ingest_log').insert([{
    op: 'manual_edit',
    source_ref: { slug },
    pages_touched: [{ slug, action: 'updated', summary: 'Manual edit' }]
  }]);

  res.json(updated);
});

// ─── POST /api/wiki/ingest (single chapter) ──────────────────────────────────
router.post('/ingest', async (req, res) => {
  const { book_id, chapter_name } = req.body;
  if (!book_id || !chapter_name) {
    return res.status(400).json({ error: 'book_id and chapter_name required' });
  }

  const [{ data: book }, { data: notes }, { data: ideas }, { data: allPages }] = await Promise.all([
    supabase.from('books').select('title, author').eq('id', book_id).single(),
    supabase.from('notes').select('content').eq('book_id', book_id).eq('chapter_name', chapter_name).single(),
    supabase.from('ideas').select('title, body, tags').eq('book_id', book_id).eq('chapter_name', chapter_name),
    supabase.from('wiki_pages').select('slug, title, page_type, markdown_content').limit(200)
  ]);

  if (!book) return res.status(404).json({ error: 'Book not found' });
  if (!notes?.content) return res.status(400).json({ error: 'No notes found for this chapter' });

  const source = {
    bookTitle:   book.title,
    author:      book.author || '',
    chapterName: chapter_name,
    rawNotes:    notes.content,
    ideas:       ideas || []
  };

  const wikiIndex = (allPages || []).map(p => ({
    slug:    p.slug,
    title:   p.title,
    type:    p.page_type,
    digest:  (p.markdown_content || '').slice(0, 300)
  }));

  let result;
  try {
    result = await ingestSourceToWiki({ source, wikiIndex });
  } catch (e) {
    console.error('[wiki ingest] failed:', e.message);
    return res.status(500).json({ error: e.message });
  }

  const touched = [];
  let totalTokens = result.tokens_used || 0;

  for (const action of result.actions) {
    if (action.op === 'noop') {
      touched.push({ slug: action.slug, action: 'noop', summary: action.reason });
      continue;
    }

    const metadata = {
      source_book_ids:  [book_id],
      source_idea_ids:  (ideas || []).map(i => i.id).filter(Boolean),
      stale:            false,
      user_edited:      false
    };

    await upsertPageAndLinks({
      slug:             action.slug,
      title:            action.title || action.slug,
      page_type:        action.page_type || 'entity',
      markdown_content: action.markdown || '',
      metadata
    }, supabase);

    touched.push({ slug: action.slug, action: action.op, summary: action.summary || '' });
  }

  const { data: logRow } = await supabase
    .from('wiki_ingest_log')
    .insert([{
      op:            'ingest_chapter',
      source_ref:    { book_id, chapter_name, book_title: book.title },
      pages_touched: touched,
      tokens_used:   totalTokens
    }])
    .select('id')
    .single();

  res.json({ touched, log_id: logRow?.id });
});

// ─── POST /api/wiki/ingest/book ──────────────────────────────────────────────
router.post('/ingest/book', async (req, res) => {
  const { book_id } = req.body;
  if (!book_id) return res.status(400).json({ error: 'book_id required' });

  const { data: notesList } = await supabase
    .from('notes')
    .select('chapter_name, chapter_order')
    .eq('book_id', book_id)
    .order('chapter_order', { ascending: true });

  if (!notesList || notesList.length === 0) {
    return res.status(400).json({ error: 'No chapters found for this book' });
  }

  res.json({ status: 'started', chapters: notesList.length, message: 'Book ingest running in background' });

  // run sequentially in background
  (async () => {
    for (const { chapter_name } of notesList) {
      try {
        const [{ data: book }, { data: notes }, { data: ideas }, { data: allPages }] = await Promise.all([
          supabase.from('books').select('title, author').eq('id', book_id).single(),
          supabase.from('notes').select('content').eq('book_id', book_id).eq('chapter_name', chapter_name).single(),
          supabase.from('ideas').select('title, body, tags').eq('book_id', book_id).eq('chapter_name', chapter_name),
          supabase.from('wiki_pages').select('slug, title, page_type, markdown_content').limit(200)
        ]);

        if (!notes?.content?.trim()) continue;

        const source = {
          bookTitle: book.title, author: book.author || '',
          chapterName: chapter_name, rawNotes: notes.content, ideas: ideas || []
        };
        const wikiIndex = (allPages || []).map(p => ({
          slug: p.slug, title: p.title, type: p.page_type, digest: (p.markdown_content || '').slice(0, 300)
        }));

        const result = await ingestSourceToWiki({ source, wikiIndex });
        for (const action of result.actions) {
          if (action.op === 'noop') continue;
          await upsertPageAndLinks({
            slug: action.slug, title: action.title || action.slug,
            page_type: action.page_type || 'entity',
            markdown_content: action.markdown || '',
            metadata: { source_book_ids: [book_id], stale: false, user_edited: false }
          }, supabase);
        }

        await supabase.from('wiki_ingest_log').insert([{
          op: 'ingest_chapter',
          source_ref: { book_id, chapter_name, book_title: book.title },
          pages_touched: result.actions.filter(a => a.op !== 'noop')
            .map(a => ({ slug: a.slug, action: a.op, summary: a.summary || '' })),
          tokens_used: result.tokens_used || 0
        }]);

        await new Promise(r => setTimeout(r, 1000)); // rate-limit ≤1/sec
      } catch (e) {
        console.error(`[wiki ingest/book] chapter "${chapter_name}" failed:`, e.message);
      }
    }
    console.log(`[wiki ingest/book] completed book ${book_id}`);
  })();
});

// ─── POST /api/wiki/ingest/backfill ─────────────────────────────────────────
router.post('/ingest/backfill', async (req, res) => {
  const { data: books } = await supabase
    .from('books')
    .select('id, title')
    .order('created_at', { ascending: true });

  if (!books || books.length === 0) {
    return res.status(400).json({ error: 'No books found' });
  }

  res.json({ status: 'started', books: books.length, message: 'Backfill running in background' });

  (async () => {
    for (const book of books) {
      const { data: notesList } = await supabase
        .from('notes')
        .select('chapter_name, chapter_order')
        .eq('book_id', book.id)
        .order('chapter_order', { ascending: true });

      if (!notesList || notesList.length === 0) continue;

      for (const { chapter_name } of notesList) {
        try {
          const [{ data: bookFull }, { data: notes }, { data: ideas }, { data: allPages }] = await Promise.all([
            supabase.from('books').select('title, author').eq('id', book.id).single(),
            supabase.from('notes').select('content').eq('book_id', book.id).eq('chapter_name', chapter_name).single(),
            supabase.from('ideas').select('title, body, tags').eq('book_id', book.id).eq('chapter_name', chapter_name),
            supabase.from('wiki_pages').select('slug, title, page_type, markdown_content').limit(200)
          ]);

          if (!notes?.content?.trim()) continue;

          const source = {
            bookTitle: bookFull.title, author: bookFull.author || '',
            chapterName: chapter_name, rawNotes: notes.content, ideas: ideas || []
          };
          const wikiIndex = (allPages || []).map(p => ({
            slug: p.slug, title: p.title, type: p.page_type, digest: (p.markdown_content || '').slice(0, 300)
          }));

          const result = await ingestSourceToWiki({ source, wikiIndex });
          for (const action of result.actions) {
            if (action.op === 'noop') continue;
            await upsertPageAndLinks({
              slug: action.slug, title: action.title || action.slug,
              page_type: action.page_type || 'entity',
              markdown_content: action.markdown || '',
              metadata: { source_book_ids: [book.id], stale: false, user_edited: false }
            }, supabase);
          }

          await supabase.from('wiki_ingest_log').insert([{
            op: 'backfill',
            source_ref: { book_id: book.id, chapter_name, book_title: bookFull.title },
            pages_touched: result.actions.filter(a => a.op !== 'noop')
              .map(a => ({ slug: a.slug, action: a.op, summary: a.summary || '' })),
            tokens_used: result.tokens_used || 0
          }]);

          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          console.error(`[wiki backfill] ${book.title} / "${chapter_name}" failed:`, e.message);
        }
      }
      console.log(`[wiki backfill] completed: ${book.title}`);
    }
    console.log('[wiki backfill] all books processed');
  })();
});

// ─── GET /api/wiki/search — time-bounded page search ─────────────────────────
router.get('/search', async (req, res) => {
  const range = parseDateRange(req.query);
  if (!range) return res.status(400).json({ error: 'Invalid date range' });

  const q = (req.query.q || '').trim();
  const type = (req.query.type || '').trim();

  let query = supabase
    .from('wiki_pages')
    .select('slug, title, page_type, markdown_content, metadata, updated_at, created_at')
    .gte('updated_at', range.from)
    .lte('updated_at', range.to)
    .order('updated_at', { ascending: false })
    .limit(300);

  if (type) query = query.eq('page_type', type);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const results = (data || [])
    .map(p => ({ ...p, score: scorePage(p, q), snippet: pageSnippet(p, q) }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 40)
    .map(({ markdown_content, ...p }) => p);

  res.json({ ...range, q, results });
});

// ─── GET /api/wiki/timeline — activity visualization data ────────────────────
router.get('/timeline', async (req, res) => {
  const range = parseDateRange(req.query);
  if (!range) return res.status(400).json({ error: 'Invalid date range' });

  const [{ data: logs, error: logErr }, { data: pages, error: pageErr }] = await Promise.all([
    supabase
      .from('wiki_ingest_log')
      .select('op, pages_touched, created_at')
      .gte('created_at', range.from)
      .lte('created_at', range.to)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('wiki_pages')
      .select('slug, title, page_type, updated_at, created_at')
      .gte('updated_at', range.from)
      .lte('updated_at', range.to)
      .order('updated_at', { ascending: false })
      .limit(500)
  ]);

  if (logErr) return res.status(500).json({ error: logErr.message });
  if (pageErr) return res.status(500).json({ error: pageErr.message });

  const buckets = {};
  const ensureBucket = (iso) => {
    const day = iso.slice(0, 10);
    if (!buckets[day]) buckets[day] = { date: day, events: 0, pages_touched: 0, page_updates: 0 };
    return buckets[day];
  };

  (logs || []).forEach(log => {
    const bucket = ensureBucket(log.created_at);
    bucket.events += 1;
    bucket.pages_touched += (log.pages_touched || []).length;
  });

  (pages || []).forEach(page => {
    const bucket = ensureBucket(page.updated_at || page.created_at);
    bucket.page_updates += 1;
  });

  const type_counts = {};
  (pages || []).forEach(p => {
    type_counts[p.page_type] = (type_counts[p.page_type] || 0) + 1;
  });

  res.json({
    ...range,
    activity: Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date)),
    type_counts,
    recent_pages: (pages || []).slice(0, 12),
    events: logs || []
  });
});

// ─── POST /api/wiki/assumptions — question recent writing ────────────────────
router.post('/assumptions', async (req, res) => {
  const range = parseDateRange(req.body || {});
  if (!range) return res.status(400).json({ error: 'Invalid date range' });

  const [{ data: notes }, { data: essays }, { data: wikiPages }] = await Promise.all([
    supabase
      .from('notes')
      .select('book_id, chapter_name, content, updated_at')
      .gte('updated_at', range.from)
      .lte('updated_at', range.to)
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase
      .from('essays')
      .select('book_id, title, content, updated_at')
      .gte('updated_at', range.from)
      .lte('updated_at', range.to)
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase
      .from('wiki_pages')
      .select('slug, title, page_type, markdown_content, updated_at')
      .order('updated_at', { ascending: false })
      .limit(24)
  ]);

  const bookIds = [...new Set([...(notes || []), ...(essays || [])].map(x => x.book_id).filter(Boolean))];
  let bookMap = {};
  if (bookIds.length > 0) {
    const { data: books } = await supabase.from('books').select('id, title').in('id', bookIds);
    (books || []).forEach(b => { bookMap[b.id] = b.title; });
  }

  const recentWriting = [
    ...(essays || []).map(e => ({
      source: 'essay',
      title: e.title || 'Untitled essay',
      content: e.content || '',
      updated_at: e.updated_at
    })),
    ...(notes || []).map(n => ({
      source: 'notes',
      title: `${bookMap[n.book_id] || 'Book'} — ${n.chapter_name || 'Chapter notes'}`,
      content: n.content || '',
      updated_at: n.updated_at
    }))
  ].filter(w => w.content && w.content.trim().length > 40).slice(0, 16);

  if (recentWriting.length === 0) {
    return res.status(400).json({ error: `No substantial writing found in the last ${range.days} days` });
  }
  if (!wikiPages || wikiPages.length === 0) {
    return res.status(400).json({ error: 'No wiki pages available to audit against' });
  }

  try {
    const audit = await questionAssumptionsAgainstWiki({
      recentWriting,
      wikiPages,
      days: range.days
    });

    await supabase.from('wiki_ingest_log').insert([{
      op: 'query',
      source_ref: { kind: 'assumption_audit', days: range.days },
      pages_touched: (audit.assumptions || []).flatMap(a =>
        (a.cited_slugs || []).map(slug => ({ slug, action: 'audited' }))
      )
    }]);

    res.json({ ...range, writing_count: recentWriting.length, ...audit });
  } catch (err) {
    console.error('[wiki assumptions] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wiki/query ────────────────────────────────────────────────────
router.post('/query', async (req, res) => {
  const { question, persist = false } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  // pick top 8 candidate pages via substring match on title + body
  const q = question.toLowerCase();
  const { data: allPages } = await supabase
    .from('wiki_pages')
    .select('slug, title, page_type, markdown_content')
    .limit(300);

  const candidates = (allPages || [])
    .map(p => ({
      ...p,
      score: (p.title.toLowerCase().includes(q) ? 3 : 0) +
             (p.markdown_content.toLowerCase().includes(q) ? 1 : 0)
    }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // fall back to most-recently-updated if no keyword match
  const pagesToSearch = candidates.length > 0
    ? candidates
    : (allPages || []).slice(0, 8);

  let result;
  try {
    result = await queryWiki({ question, candidatePages: pagesToSearch });
  } catch (e) {
    console.error('[wiki query] failed:', e.message);
    return res.status(500).json({ error: e.message });
  }

  await supabase.from('wiki_ingest_log').insert([{
    op: 'query',
    source_ref: { question },
    pages_touched: (result.cited_slugs || []).map(s => ({ slug: s, action: 'read' }))
  }]);

  if (persist && result.confidence === 'high' && result.answer) {
    const slug = `query-${Date.now()}`;
    await upsertPageAndLinks({
      slug,
      title:            `Q: ${question.slice(0, 80)}`,
      page_type:        'query_answer',
      markdown_content: `# ${question}\n\n${result.answer}\n\n---\n*Cited pages: ${(result.cited_slugs || []).map(s => `[[${s}]]`).join(', ')}*`,
      metadata:         { stale: false, user_edited: false }
    }, supabase);
    result.saved_slug = slug;
  }

  res.json(result);
});

// ─── POST /api/wiki/lint ─────────────────────────────────────────────────────
router.post('/lint', async (req, res) => {
  const { data: allPages } = await supabase
    .from('wiki_pages')
    .select('id, slug, title, page_type, markdown_content');

  if (!allPages || allPages.length === 0) {
    return res.json({ contradictions: [], orphans: [], stale_claims: [], missing_entities: [] });
  }

  // find orphans (no inbound links, not special pages)
  const { data: inboundLinks } = await supabase
    .from('wiki_links')
    .select('target_slug');

  const linked = new Set((inboundLinks || []).map(l => l.target_slug));
  const specialTypes = new Set(['index', 'log', 'overview']);

  const pageDigests = allPages.map(p => ({
    slug:         p.slug,
    title:        p.title,
    type:         p.page_type,
    first_300:    (p.markdown_content || '').slice(0, 300),
    claim_count:  (p.markdown_content.match(/\*\*[^*]+\*\*/g) || []).length,
    is_orphan:    !linked.has(p.slug) && !specialTypes.has(p.page_type)
  }));

  let lintResult;
  try {
    lintResult = await lintWiki({ pageDigests });
  } catch (e) {
    console.error('[wiki lint] failed:', e.message);
    return res.status(500).json({ error: e.message });
  }

  // mark stale pages in DB
  const staleSlugs = (lintResult.stale_claims || []).map(s => s.slug);
  if (staleSlugs.length > 0) {
    for (const slug of staleSlugs) {
      const { data: pg } = await supabase.from('wiki_pages').select('metadata').eq('slug', slug).single();
      if (pg) {
        await supabase.from('wiki_pages')
          .update({ metadata: { ...pg.metadata, stale: true } })
          .eq('slug', slug);
      }
    }
  }

  // append orphans from structural check
  const structuralOrphans = pageDigests.filter(p => p.is_orphan).map(p => p.slug);
  const allOrphans = [...new Set([...(lintResult.orphans || []), ...structuralOrphans])];

  await supabase.from('wiki_ingest_log').insert([{
    op: 'lint',
    source_ref: { pages_checked: allPages.length },
    pages_touched: staleSlugs.map(s => ({ slug: s, action: 'stale' }))
  }]);

  res.json({ ...lintResult, orphans: allOrphans });
});

// ─── GET /api/wiki/log ───────────────────────────────────────────────────────
router.get('/log', async (req, res) => {
  const { limit = 50 } = req.query;
  const { data, error } = await supabase
    .from('wiki_ingest_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ─── GET /api/wiki/graph ─────────────────────────────────────────────────────
router.get('/graph', async (req, res) => {
  const [{ data: pages }, { data: links }] = await Promise.all([
    supabase.from('wiki_pages').select('slug, title, page_type'),
    supabase.from('wiki_links').select('source_page_id, target_slug')
  ]);

  const pageMap = {};
  (pages || []).forEach(p => { pageMap[p.slug] = p; });

  const idToSlug = {};
  (pages || []).forEach(p => { idToSlug[p.id] = p.slug; });

  const nodes = (pages || []).map(p => ({ id: p.slug, title: p.title, type: p.page_type }));

  // resolve source IDs to slugs
  const { data: pageIds } = await supabase.from('wiki_pages').select('id, slug');
  const idMap = {};
  (pageIds || []).forEach(p => { idMap[p.id] = p.slug; });

  const edges = (links || [])
    .map(l => ({ source: idMap[l.source_page_id], target: l.target_slug }))
    .filter(e => e.source && pageMap[e.target]); // only render edges where target exists

  res.json({ nodes, edges });
});

module.exports = router;
