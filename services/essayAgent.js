const fs = require('fs/promises');
const path = require('path');
const supabase = require('./supabase');
const { generateJson } = require('./llmClient');

const SESSION_DIR = path.join(process.cwd(), '.essay-agent', 'sessions');
const MAX_TRANSCRIPT_ITEMS = 30;
const MAX_TOOL_STEPS = 5;
const MAX_TOOL_CALLS_PER_PLAN = 3;
const MAX_PENDING_PROPOSALS = 4;

function nowIso() {
  return new Date().toISOString();
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTerms(value) {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how',
    'i', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their',
    'this', 'to', 'what', 'when', 'where', 'which', 'who', 'why', 'with'
  ]);
  return [
    ...new Set(
      normalizeSearchText(value)
        .split(' ')
        .filter(term => term.length > 2 && !stopWords.has(term))
    )
  ];
}

function clip(text, limit = 1200) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
}

function clipList(list, limit = 6, itemLimit = 220) {
  return (Array.isArray(list) ? list : [])
    .filter(Boolean)
    .map(item => clip(item, itemLimit))
    .slice(0, limit);
}

function matchesSlashCommand(input, command) {
  return new RegExp(`^\\/${command}(?:\\s|$)`, 'i').test(String(input || '').trim());
}

function dedupeList(list, limit = 8) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean))].slice(0, limit);
}

function sessionFile(id) {
  return path.join(SESSION_DIR, `${id}.json`);
}

async function ensureSessionDir() {
  await fs.mkdir(SESSION_DIR, { recursive: true });
}

async function saveSession(session) {
  await ensureSessionDir();
  session.updated_at = nowIso();
  await fs.writeFile(sessionFile(session.id), JSON.stringify(session, null, 2), 'utf8');
  return session;
}

async function loadSession(id) {
  const raw = await fs.readFile(sessionFile(id), 'utf8');
  return JSON.parse(raw);
}

function getReasoningMode(selectedBooks = []) {
  return selectedBooks.length >= 2 ? 'cross_book_synthesis' : 'single_source_argument';
}

function createInitialMemory({ topic, audience, tone, selectedBooks, uploadedDocs }) {
  const bookTitles = selectedBooks.map(book => book.title);
  const crossBook = getReasoningMode(selectedBooks) === 'cross_book_synthesis';

  return {
    phase: 'planning',
    reasoning_mode: getReasoningMode(selectedBooks),
    topic,
    audience: audience || '',
    tone: tone || '',
    current_goal: crossBook
      ? 'Build a synthesis essay that discovers intersections, tensions, and new claims across the selected books.'
      : 'Build a grounded essay from the selected sources with explicit evidence and a strong argument spine.',
    source_focus: bookTitles,
    working_thesis: '',
    narrative_arc: '',
    outline: [],
    argument_map: [],
    intersections: [],
    tensions: [],
    evidence_gaps: [],
    open_questions: [],
    style_directives: crossBook
      ? [
          'Do not summarize each book separately.',
          'Synthesize the books into a new framework.',
          'Surface tensions and complementarity explicitly.',
          'Write like a strong college paper with a clear thesis, conceptual precision, and coherent paragraph transitions.',
          'Distill sophisticated ideas into readable prose without flattening them into slogans or banal takeaways.'
        ]
      : [
          'Ground every major claim in the source material.',
          'Use a research-forward but readable tone.',
          'Write like a strong college paper with a clear thesis, conceptual precision, and coherent paragraph transitions.',
          'Distill sophisticated ideas into readable prose without flattening them into slogans or banal takeaways.'
        ],
    source_ledger: dedupeList([
      ...bookTitles.map(title => `Book: ${title}`),
      ...uploadedDocs.map(doc => `Document: ${doc.title || 'Untitled document'}`)
    ], 12),
    revision_policy: 'Conservative: once a draft exists, suggest changes and wait for explicit approval before applying them.',
    next_actions: crossBook
      ? ['Map intersections', 'Gather evidence from each book', 'Draft synthesis frame']
      : ['Inspect the strongest sources', 'Build outline', 'Draft opening'],
    recent_findings: uploadedDocs.length ? [`${uploadedDocs.length} supporting document(s) attached.`] : []
  };
}

async function createEssaySession({ topic, audience, tone, backend, model, bookIds = [], uploadedDocs = [] }) {
  const selectedBooks = await fetchBookSummaries(bookIds);
  const resolvedBackend = backend || process.env.WRITING_AGENT_BACKEND || 'ollama';
  const resolvedModel = model || (
    resolvedBackend === 'openai'
      ? (process.env.OPENAI_MODEL || 'gpt-4o')
      : (process.env.OLLAMA_MODEL || 'qwen3:8b')
  );
  const session = {
    id: randomId(),
    created_at: nowIso(),
    updated_at: nowIso(),
    topic,
    audience: audience || '',
    tone: tone || '',
    backend: resolvedBackend,
    model: resolvedModel,
    selected_book_ids: bookIds,
    selected_books: selectedBooks,
    uploaded_docs: uploadedDocs.map(doc => ({
      id: doc.id || randomId(),
      title: doc.title || 'Untitled document',
      source: doc.source || 'upload',
      mime_type: doc.mime_type || 'text/plain',
      content: String(doc.content || '').slice(0, 30000)
    })),
    transcript: [],
    draft_markdown: '',
    memory: createInitialMemory({ topic, audience, tone, selectedBooks, uploadedDocs }),
    last_tool_trace: [],
    last_plan: null,
    last_evidence_packet: null,
    pending_draft_updates: []
  };

  await saveSession(session);
  return session;
}

async function fetchBookSummaries(bookIds = []) {
  if (!bookIds.length) return [];
  const { data: books } = await supabase
    .from('books')
    .select('id, title, author, category, why_reading, status')
    .in('id', bookIds);

  return (books || []).map(book => ({
    id: book.id,
    title: book.title,
    author: book.author,
    category: book.category || '',
    why_reading: book.why_reading || '',
    status: book.status || ''
  }));
}

async function fetchSessionContext(session) {
  const bookIds = session.selected_book_ids || [];
  const context = {
    books: [],
    wiki_pages: []
  };

  if (bookIds.length > 0) {
    const [
      { data: books },
      { data: notes },
      { data: ideas },
      { data: articles }
    ] = await Promise.all([
      supabase.from('books').select('id, title, author, category, why_reading, status').in('id', bookIds),
      supabase.from('notes').select('book_id, chapter_name, content, updated_at').in('book_id', bookIds).order('updated_at', { ascending: false }),
      supabase.from('ideas').select('book_id, chapter_name, title, body, tags, number').in('book_id', bookIds).order('number', { ascending: true }),
      supabase.from('articles').select('book_id, title, domain, snippet, url, stance').in('book_id', bookIds).order('created_at', { ascending: false })
    ]);

    const notesByBook = {};
    const ideasByBook = {};
    const articlesByBook = {};
    (notes || []).forEach(note => {
      if (!notesByBook[note.book_id]) notesByBook[note.book_id] = [];
      notesByBook[note.book_id].push(note);
    });
    (ideas || []).forEach(idea => {
      if (!ideasByBook[idea.book_id]) ideasByBook[idea.book_id] = [];
      ideasByBook[idea.book_id].push(idea);
    });
    (articles || []).forEach(article => {
      if (!articlesByBook[article.book_id]) articlesByBook[article.book_id] = [];
      articlesByBook[article.book_id].push(article);
    });

    context.books = (books || []).map(book => ({
      id: book.id,
      title: book.title,
      author: book.author || '',
      category: book.category || '',
      why_reading: book.why_reading || '',
      status: book.status || '',
      notes: notesByBook[book.id] || [],
      ideas: ideasByBook[book.id] || [],
      articles: articlesByBook[book.id] || []
    }));
  }

  const wikiTerms = queryTerms(session.topic).slice(0, 6);
  if (wikiTerms.length > 0) {
    const { data: wikiPages } = await supabase
      .from('wiki_pages')
      .select('slug, title, page_type, markdown_content, updated_at')
      .limit(240);

    context.wiki_pages = (wikiPages || [])
      .map(page => ({
        ...page,
        score: searchScore({
          title: page.title,
          slug: page.slug,
          body: page.markdown_content
        }, session.topic)
      }))
      .filter(page => page.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }

  return context;
}

function searchScore(source, query) {
  const terms = queryTerms(query);
  const title = normalizeSearchText(source.title);
  const slug = normalizeSearchText(source.slug);
  const body = normalizeSearchText(source.body);
  let score = 0;
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;
  if (title && normalizedQuery === title) score += 18;
  if (slug && normalizedQuery === slug) score += 16;
  if (title && normalizedQuery.includes(title)) score += 10;
  if (slug && normalizedQuery.includes(slug)) score += 8;
  if (title && title.includes(normalizedQuery)) score += 8;
  if (slug && slug.includes(normalizedQuery)) score += 6;
  terms.forEach(term => {
    if (title.includes(term)) score += 5;
    if (slug.includes(term)) score += 4;
    if (body.includes(term)) {
      score += 1;
      score += Math.min(body.split(term).length - 1, 4);
    }
  });
  return score;
}

function relevantExcerpt(text, query, limit = 900) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const terms = queryTerms(query);
  const lower = raw.toLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(pos => pos >= 0);
  if (!positions.length) return clip(raw, limit);
  const start = Math.max(0, Math.min(...positions) - Math.floor(limit / 4));
  return raw.slice(start, start + limit);
}

function searchLibrary(context, session, query) {
  const hits = [];

  context.books.forEach(book => {
    hits.push({
      type: 'book',
      source_id: book.id,
      label: `${book.title} by ${book.author}`,
      score: searchScore({ title: book.title, slug: book.title, body: `${book.category} ${book.why_reading}` }, query),
      snippet: clip(book.why_reading || book.category || '')
    });

    (book.ideas || []).forEach(idea => {
      hits.push({
        type: 'idea',
        source_id: `${book.id}:${idea.title}`,
        label: `${book.title} / ${idea.title}`,
        score: searchScore({ title: idea.title, slug: idea.title, body: idea.body }, query),
        snippet: relevantExcerpt(idea.body, query, 360)
      });
    });

    (book.notes || []).forEach(note => {
      hits.push({
        type: 'note',
        source_id: `${book.id}:${note.chapter_name}`,
        label: `${book.title} / ${note.chapter_name}`,
        score: searchScore({ title: note.chapter_name, slug: note.chapter_name, body: note.content }, query),
        snippet: relevantExcerpt(note.content, query, 420)
      });
    });

    (book.articles || []).forEach(article => {
      hits.push({
        type: 'article',
        source_id: article.url,
        label: `${book.title} / ${article.title}`,
        score: searchScore({ title: article.title, slug: article.domain, body: article.snippet }, query),
        snippet: clip(article.snippet, 260)
      });
    });
  });

  (session.uploaded_docs || []).forEach(doc => {
    hits.push({
      type: 'document',
      source_id: doc.id,
      label: doc.title,
      score: searchScore({ title: doc.title, slug: doc.title, body: doc.content }, query),
      snippet: relevantExcerpt(doc.content, query, 420)
    });
  });

  (context.wiki_pages || []).forEach(page => {
    hits.push({
      type: 'wiki',
      source_id: page.slug,
      label: `Wiki / ${page.title}`,
      score: searchScore({ title: page.title, slug: page.slug, body: page.markdown_content }, query),
      snippet: relevantExcerpt(page.markdown_content, query, 420)
    });
  });

  const filteredHits = hits.filter(hit => hit.score > 0);
  if (!filteredHits.length && session.uploaded_docs?.length) {
    return (session.uploaded_docs || []).slice(0, 3).map(doc => ({
      type: 'document',
      source_id: doc.id,
      label: doc.title,
      score: 1,
      snippet: relevantExcerpt(doc.content, query || session.topic, 420)
    }));
  }

  return filteredHits
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function bestMatchingDocument(session, focus = '', docId = '') {
  const docs = Array.isArray(session.uploaded_docs) ? session.uploaded_docs : [];
  if (!docs.length) return null;
  if (docId) {
    const exact = docs.find(item => item.id === docId);
    if (exact) return exact;
  }
  if (docs.length === 1) return docs[0];
  return docs
    .map(doc => ({
      doc,
      score: searchScore({ title: doc.title, slug: doc.title, body: doc.content }, focus || session.topic)
    }))
    .sort((a, b) => b.score - a.score)[0]?.doc || docs[0];
}

function readBookFocus(context, bookId, focus) {
  const book = context.books.find(item => item.id === bookId);
  if (!book) throw new Error('Book not found in session context');

  const notes = (book.notes || [])
    .map(note => ({
      chapter_name: note.chapter_name,
      score: searchScore({ title: note.chapter_name, slug: note.chapter_name, body: note.content }, focus),
      excerpt: relevantExcerpt(note.content, focus, 700)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const ideas = (book.ideas || [])
    .map(idea => ({
      title: idea.title,
      tags: idea.tags || [],
      score: searchScore({ title: idea.title, slug: idea.title, body: idea.body }, focus),
      excerpt: relevantExcerpt(idea.body, focus, 360)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const articles = (book.articles || [])
    .map(article => ({
      title: article.title,
      domain: article.domain,
      stance: article.stance,
      score: searchScore({ title: article.title, slug: article.domain, body: article.snippet }, focus),
      snippet: clip(article.snippet, 240)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return {
    book: {
      id: book.id,
      title: book.title,
      author: book.author,
      category: book.category,
      why_reading: clip(book.why_reading, 240)
    },
    notes,
    ideas,
    articles
  };
}

function readDocumentFocus(session, docId, focus) {
  const doc = bestMatchingDocument(session, focus, docId);
  if (!doc) throw new Error('Document not found');
  return {
    document: {
      id: doc.id,
      title: doc.title,
      source: doc.source,
      mime_type: doc.mime_type
    },
    excerpt: relevantExcerpt(doc.content, focus, 1200)
  };
}

function inspectWiki(context, focus) {
  return (context.wiki_pages || [])
    .map(page => ({
      slug: page.slug,
      title: page.title,
      type: page.page_type,
      score: searchScore({ title: page.title, slug: page.slug, body: page.markdown_content }, focus),
      excerpt: relevantExcerpt(page.markdown_content, focus, 500)
    }))
    .filter(page => page.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function inferBookTerms(book, focus) {
  const pool = [
    book.title,
    book.category,
    book.why_reading,
    ...(book.notes || []).slice(0, 8).map(note => `${note.chapter_name} ${relevantExcerpt(note.content, focus, 220)}`),
    ...(book.ideas || []).slice(0, 8).map(idea => `${idea.title} ${relevantExcerpt(idea.body, focus, 180)}`)
  ].join(' ');

  const counts = new Map();
  queryTerms(pool).forEach(term => {
    counts.set(term, (counts.get(term) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([term]) => term);
}

function compareBooks(context, session, focus) {
  const books = context.books.filter(book => session.selected_book_ids.includes(book.id));
  if (!books.length) return { books: [], intersections: [], tensions: [], synthesis_opportunities: [] };

  const perBook = books.map(book => ({
    id: book.id,
    title: book.title,
    author: book.author,
    strongest_notes: (book.notes || [])
      .map(note => ({
        chapter_name: note.chapter_name,
        score: searchScore({ title: note.chapter_name, slug: note.chapter_name, body: note.content }, focus),
        excerpt: relevantExcerpt(note.content, focus, 240)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
    strongest_ideas: (book.ideas || [])
      .map(idea => ({
        title: idea.title,
        score: searchScore({ title: idea.title, slug: idea.title, body: idea.body }, focus),
        excerpt: relevantExcerpt(idea.body, focus, 220)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
    terms: inferBookTerms(book, focus)
  }));

  const termOwners = new Map();
  perBook.forEach(book => {
    book.terms.forEach(term => {
      const current = termOwners.get(term) || [];
      current.push(book.title);
      termOwners.set(term, current);
    });
  });

  const sharedTerms = [...termOwners.entries()]
    .filter(([, owners]) => owners.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([term, owners]) => ({
      term,
      books: owners
    }));

  const intersections = sharedTerms.map(item =>
    `${item.term}: appears across ${item.books.join(', ')} and may be a bridge concept for the essay.`
  );

  const tensions = [];
  if (perBook.length >= 2) {
    for (let index = 0; index < perBook.length - 1; index += 1) {
      const left = perBook[index];
      const right = perBook[index + 1];
      const leftIdea = left.strongest_ideas[0]?.title || left.strongest_notes[0]?.chapter_name || left.title;
      const rightIdea = right.strongest_ideas[0]?.title || right.strongest_notes[0]?.chapter_name || right.title;
      tensions.push(`How does "${leftIdea}" from ${left.title} complicate or sharpen "${rightIdea}" from ${right.title}?`);
    }
  }

  return {
    books: perBook.map(book => ({
      id: book.id,
      title: book.title,
      author: book.author,
      strongest_notes: book.strongest_notes,
      strongest_ideas: book.strongest_ideas
    })),
    shared_terms: sharedTerms,
    intersections,
    tensions,
    synthesis_opportunities: dedupeList([
      ...intersections,
      ...tensions
    ], 8)
  };
}

function buildBookContextPacket(book, focus) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    why_reading: clip(book.why_reading, 220),
    chapter_index: (book.notes || []).map(note => note.chapter_name),
    strongest_notes: (book.notes || [])
      .map(note => ({
        chapter_name: note.chapter_name,
        score: searchScore({ title: note.chapter_name, slug: note.chapter_name, body: note.content }, focus),
        excerpt: relevantExcerpt(note.content, focus, 420)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
    strongest_ideas: (book.ideas || [])
      .map(idea => ({
        title: idea.title,
        score: searchScore({ title: idea.title, slug: idea.title, body: idea.body }, focus),
        excerpt: relevantExcerpt(idea.body, focus, 320)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
  };
}

function summarizeContextForPrompt(context, session) {
  const books = context.books.map(book => ({
    id: book.id,
    title: book.title,
    author: book.author,
    note_count: book.notes.length,
    idea_count: book.ideas.length,
    article_count: book.articles.length
  }));

  return {
    topic: session.topic,
    audience: session.audience,
    tone: session.tone,
    selected_books: books,
    selected_book_packets: context.books
      .filter(book => session.selected_book_ids.includes(book.id))
      .map(book => buildBookContextPacket(book, session.topic))
      .slice(0, 3),
    uploaded_docs: (session.uploaded_docs || []).map(doc => ({
      id: doc.id,
      title: doc.title,
      chars: doc.content.length,
      excerpt: relevantExcerpt(doc.content, session.topic, 240)
    })),
    wiki_pages: (context.wiki_pages || []).map(page => ({
      slug: page.slug,
      title: page.title,
      type: page.page_type
    }))
  };
}

function mergeMemory(memory, patch = {}) {
  const merged = { ...(memory || {}) };
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;

    if (Array.isArray(value)) {
      if (Array.isArray(merged[key])) {
        merged[key] = dedupeList([...merged[key], ...value], 10);
      } else {
        merged[key] = dedupeList(value, 10);
      }
      return;
    }

    if (typeof value === 'object') {
      merged[key] = { ...(merged[key] || {}), ...value };
      return;
    }

    merged[key] = value;
  });
  return merged;
}

function compactTranscript(transcript = []) {
  return transcript.slice(-MAX_TRANSCRIPT_ITEMS).map(entry => ({
    role: entry.role,
    content: clip(entry.content, entry.role === 'tool' ? 1000 : entry.role === 'user' ? 900 : 700),
    name: entry.name || undefined
  }));
}

function compactToolTrace(toolTrace = []) {
  return toolTrace.map(item => ({
    tool: item.tool,
    reason: item.reason,
    result: clip(JSON.stringify(item.result), 1200)
  }));
}

function hasExistingDraft(session) {
  return Boolean(String(session.draft_markdown || '').trim());
}

function userAllowsDirectRewrite(userMessage) {
  const lower = String(userMessage || '').toLowerCase();
  return /\b(replace the draft|overwrite the draft|rewrite everything|start over|fresh draft|full rewrite)\b/.test(lower);
}

function userRequestsParagraph(userMessage) {
  const lower = String(userMessage || '').toLowerCase();
  return /\b(paragraph|opening paragraph|intro paragraph|write a paragraph|draft a paragraph)\b/.test(lower);
}

function shouldUseProposalMode(session, plan, userMessage) {
  if (userRequestsParagraph(userMessage)) return true;
  if (plan.response_mode === 'outline') return false;
  if (userAllowsDirectRewrite(userMessage)) return false;
  return ['draft', 'paragraph', 'critique'].includes(plan.response_mode || 'draft') || hasExistingDraft(session);
}

function draftToSingleParagraph(text) {
  return String(text || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPendingProposal(rawProposal, session, evidencePacket) {
  const afterMarkdown = typeof rawProposal?.after_markdown === 'string'
    ? rawProposal.after_markdown.trim()
    : '';
  if (!afterMarkdown || afterMarkdown === String(session.draft_markdown || '').trim()) {
    return null;
  }

  const hasDraft = Boolean(String(session.draft_markdown || '').trim());
  const requestedPatchMode = ['full_replace', 'append_paragraph'].includes(rawProposal.patch_mode)
    ? rawProposal.patch_mode
    : 'section_patch';

  return {
    id: randomId(),
    title: clip(rawProposal.title || 'Suggested draft update', 120),
    rationale: clip(rawProposal.rationale || 'The harness found a conservative improvement grounded in the evidence packet.', 280),
    change_summary: clip(rawProposal.change_summary || rawProposal.focus_section || 'Tightens the argument while preserving the existing draft structure.', 240),
    focus_section: clip(rawProposal.focus_section || 'Draft-wide suggestion', 120),
    patch_mode: hasDraft ? requestedPatchMode : 'append_paragraph',
    before_excerpt: String(rawProposal.before_excerpt || session.draft_markdown || '').trim(),
    after_excerpt: String(rawProposal.after_excerpt || afterMarkdown || '').trim(),
    after_markdown: afterMarkdown,
    working_thesis: clip(rawProposal.working_thesis || evidencePacket?.working_thesis || '', 220),
    created_at: nowIso()
  };
}

function applyProposalPatch(currentDraft, proposal) {
  const draft = String(currentDraft || '');
  const beforeExcerpt = String(proposal.before_excerpt || '').trim();
  const afterExcerpt = String(proposal.after_excerpt || '').trim();

  if (proposal.patch_mode === 'append_paragraph') {
    const nextDraft = draft.trim()
      ? `${draft.trim()}\n\n${afterExcerpt || proposal.after_markdown || ''}`.trim()
      : (afterExcerpt || proposal.after_markdown || '').trim();
    return {
      draft: nextDraft,
      applied_as: 'append_paragraph'
    };
  }

  if (proposal.patch_mode !== 'full_replace' && beforeExcerpt && afterExcerpt && draft.includes(beforeExcerpt)) {
    return {
      draft: draft.replace(beforeExcerpt, afterExcerpt),
      applied_as: 'section_patch'
    };
  }

  return {
    draft: proposal.after_markdown || draft,
    applied_as: 'full_replace'
  };
}

async function executeTool({ tool, args }, context, session) {
  if (tool === 'search_library') {
    return searchLibrary(context, session, args.query || session.topic);
  }
  if (tool === 'read_book') {
    return readBookFocus(context, args.book_id, args.focus || session.topic);
  }
  if (tool === 'read_document') {
    return readDocumentFocus(session, args.doc_id || args.document_id || args.id, args.focus || args.query || session.topic);
  }
  if (tool === 'inspect_wiki') {
    return inspectWiki(context, args.query || session.topic);
  }
  if (tool === 'compare_books') {
    return compareBooks(context, session, args.focus || session.topic);
  }
  throw new Error(`Unknown tool: ${tool}`);
}

function clearSessionMemory(session) {
  session.memory = createInitialMemory({
    topic: session.topic,
    audience: session.audience,
    tone: session.tone,
    selectedBooks: session.selected_books || [],
    uploadedDocs: session.uploaded_docs || []
  });
  session.transcript = [];
  session.last_tool_trace = [];
  session.last_plan = null;
  session.last_evidence_packet = null;
  session.pending_draft_updates = [];
  return session;
}

function buildDefaultPlan(session, userMessage) {
  const lower = String(userMessage || '').toLowerCase();
  const isOutline = /\boutline|structure|framework\b/.test(lower);
  const isCritique = /\bstress|critique|weak|assumption|pressure\b/.test(lower);
  const isRevision = /\brevise|rewrite|tighten|improve\b/.test(lower);
  const isParagraph = userRequestsParagraph(userMessage);
  const multiBook = (session.selected_books || []).length >= 2;
  const hasSelectedBooks = (session.selected_books || []).length > 0;
  const hasDocs = Array.isArray(session.uploaded_docs) && session.uploaded_docs.length > 0;

  return {
    phase: isCritique ? 'critique' : (isRevision ? 'revise' : (isOutline ? 'outline' : (isParagraph ? 'paragraph' : 'draft'))),
    reasoning_mode: multiBook ? 'cross_book_synthesis' : 'single_source_argument',
    response_mode: isOutline ? 'outline' : (isCritique ? 'critique' : (isParagraph ? 'paragraph' : 'draft')),
    draft_goal: isOutline
      ? 'Produce a high-quality outline before full drafting.'
      : (isParagraph ? 'Draft a single paragraph that can be accepted into the final essay.' : 'Advance the essay with evidence-backed prose.'),
    source_questions: multiBook
      ? ['What ideas intersect across the selected books?', 'Where do the sources disagree or complicate each other?']
      : ['What source material most directly supports the current claim?'],
    style_directives: multiBook
      ? [
          'Avoid book-by-book summary.',
          'Produce synthesis, not comparison grids.',
          'Write in continuous prose grounded in the user\'s notes.',
          'Aim for the clarity and argumentative coherence of a strong college paper.'
        ]
      : [
          'Stay grounded in direct source material.',
          'Write in continuous prose grounded in the user\'s notes.',
          'Aim for the clarity and argumentative coherence of a strong college paper.'
        ],
    tool_calls: [
      ...(hasDocs ? [{ tool: 'read_document', args: { focus: userMessage || session.topic }, reason: 'Pull the strongest excerpt from the uploaded notes first.' }] : []),
      ...(!multiBook && hasSelectedBooks ? [{ tool: 'read_book', args: { book_id: session.selected_books[0].id, focus: userMessage || session.topic }, reason: 'Inspect the checked book directly so the draft uses the selected notes.' }] : []),
      { tool: 'search_library', args: { query: userMessage || session.topic }, reason: 'Find the most relevant source fragments first.' },
      ...(multiBook ? [{ tool: 'compare_books', args: { focus: userMessage || session.topic }, reason: 'Map the cross-book intersections and tensions.' }] : [])
    ].slice(0, MAX_TOOL_CALLS_PER_PLAN),
    memory_patch: {
      phase: isOutline ? 'outlining' : (isCritique ? 'critiquing' : (isParagraph ? 'paragraph_drafting' : 'drafting')),
      next_actions: isOutline
        ? ['Turn the outline into a draft opening.']
        : (isParagraph ? ['Review the proposed paragraph and accept it or request changes.'] : ['Tighten the thesis with evidence.'])
    }
  };
}

function synthesizeProposalFromDraft(finalPayload, session, evidencePacket, plan) {
  const draftMarkdown = String(finalPayload?.draft_markdown || '').trim();
  if (!draftMarkdown) return null;

  const paragraphMode = plan?.response_mode === 'paragraph';
  const paragraphText = paragraphMode ? draftToSingleParagraph(draftMarkdown) : '';
  const proposalText = paragraphMode ? paragraphText : draftMarkdown;
  if (!proposalText) return null;

  return buildPendingProposal({
    title: paragraphMode ? 'Proposed paragraph' : 'Proposed draft update',
    rationale: finalPayload?.assistant_message || 'The harness prepared a draft update and is waiting for your approval.',
    change_summary: paragraphMode
      ? 'Adds one paragraph to the draft after you approve it.'
      : 'Applies the generated draft only after you approve it.',
    focus_section: paragraphMode ? 'Next paragraph' : 'Draft workspace',
    patch_mode: paragraphMode
      ? 'append_paragraph'
      : (hasExistingDraft(session) ? 'full_replace' : 'append_paragraph'),
    before_excerpt: paragraphMode ? '' : String(session.draft_markdown || ''),
    after_excerpt: proposalText,
    after_markdown: hasExistingDraft(session)
      ? (paragraphMode ? `${String(session.draft_markdown || '').trim()}\n\n${proposalText}`.trim() : draftMarkdown)
      : proposalText,
    working_thesis: evidencePacket?.working_thesis || ''
  }, session, evidencePacket);
}

function synthesizeProposalFromEvidence(session, evidencePacket, plan) {
  const paragraphMode = plan?.response_mode === 'paragraph' || !hasExistingDraft(session);
  const scaffoldParagraph = draftToSingleParagraph([
    evidencePacket?.working_thesis || '',
    ...(Array.isArray(evidencePacket?.argument_map) ? evidencePacket.argument_map.slice(0, 2) : []),
    ...(Array.isArray(evidencePacket?.intersections) ? evidencePacket.intersections.slice(0, 1) : [])
  ].filter(Boolean).join(' '));

  if (!scaffoldParagraph) return null;

  return buildPendingProposal({
    title: paragraphMode ? 'Proposed paragraph from evidence' : 'Proposed draft update from evidence',
    rationale: 'The harness reconstructed a proposal directly from the retrieved evidence so you still have something concrete to approve.',
    change_summary: paragraphMode
      ? 'Builds a paragraph directly from the strongest retrieved notes.'
      : 'Builds a draft update directly from the strongest retrieved notes.',
    focus_section: paragraphMode ? 'Next paragraph' : 'Draft workspace',
    patch_mode: paragraphMode ? 'append_paragraph' : (hasExistingDraft(session) ? 'full_replace' : 'append_paragraph'),
    before_excerpt: paragraphMode ? '' : String(session.draft_markdown || ''),
    after_excerpt: scaffoldParagraph,
    after_markdown: hasExistingDraft(session)
      ? `${String(session.draft_markdown || '').trim()}\n\n${scaffoldParagraph}`.trim()
      : scaffoldParagraph,
    working_thesis: evidencePacket?.working_thesis || ''
  }, session, evidencePacket);
}

async function planEssayTurn(session, context, userMessage) {
  const systemPrompt = `You are the planning engine for WriteFlow's essay harness.

Your job is to decide how the essay agent should think next.

If multiple books are selected, follow this rule set:
- Do not summarize Book A and then Book B.
- Find conceptual overlaps, tensions, contradictions, and complementarities.
- Build a new framework that none of the sources fully states alone.
- Emulate an essayistic, synthetic mode similar to "The Dragon and Its Contradictions."

Return ONLY valid JSON:
{
  "phase": "outline" | "evidence" | "draft" | "revise" | "critique",
  "reasoning_mode": "cross_book_synthesis" | "single_source_argument" | "chapter_refinement",
  "response_mode": "outline" | "draft" | "critique" | "analysis",
  "draft_goal": "string",
  "source_questions": ["string"],
  "style_directives": ["string"],
  "tool_calls": [
    {
      "tool": "search_library" | "read_book" | "read_document" | "inspect_wiki" | "compare_books",
      "args": {},
      "reason": "why this tool is needed"
    }
  ],
  "memory_patch": {
    "phase": "string",
    "current_goal": "string",
    "open_questions": ["string"],
    "evidence_gaps": ["string"],
    "next_actions": ["string"]
  }
}

Rules:
- Use at most 3 tool calls.
- Prefer search_library first when the user asks a new question.
- If one book is selected, ALWAYS include a read_book call to inspect its actual chapter notes — use chapter_index in session_context to pick the most relevant focus chapter.
- If two or more books are selected, use compare_books instead of read_book to surface cross-book intersections and tensions.
- Only call read_document if a supporting document is likely useful.
- If the user asks for critique or stress testing, plan for critique rather than more drafting.
- Never produce a plan with only search_library when books are selected — always pair it with read_book or compare_books.`;

  const userPrompt = JSON.stringify({
    session_context: summarizeContextForPrompt(context, session),
    memory: session.memory,
    user_message: userMessage,
    current_draft: clip(session.draft_markdown, 5000),
    transcript: compactTranscript(session.transcript)
  }, null, 2);

  try {
    const llm = await generateJson({
      backend: session.backend,
      model: session.model || undefined,
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 1400
    });

    const plan = llm.data || {};
    const normalizedResponseMode = plan.response_mode === 'analysis'
      ? (userRequestsParagraph(userMessage) ? 'paragraph' : 'draft')
      : (plan.response_mode || 'draft');

    const normalizedPlan = {
      phase: plan.phase || 'draft',
      reasoning_mode: plan.reasoning_mode || session.memory?.reasoning_mode || getReasoningMode(session.selected_books),
      response_mode: normalizedResponseMode,
      draft_goal: clip(plan.draft_goal || 'Advance the essay deliberately.', 260),
      source_questions: clipList(plan.source_questions, 6, 220),
      style_directives: clipList(plan.style_directives, 6, 180),
      tool_calls: (Array.isArray(plan.tool_calls) ? plan.tool_calls : [])
        .filter(call => call && call.tool)
        .slice(0, MAX_TOOL_CALLS_PER_PLAN),
      memory_patch: plan.memory_patch || {},
      backend: llm.backend,
      model: llm.model,
      fallback_reason: llm.fallback_reason || ''
    };

    if (!normalizedPlan.tool_calls.length) {
      normalizedPlan.tool_calls = buildDefaultPlan(session, userMessage).tool_calls;
    }

    // Guarantee direct chapter note inspection for single-book sessions when the planner omitted it
    const hasDirectInspection = normalizedPlan.tool_calls.some(tc => tc.tool === 'read_book' || tc.tool === 'compare_books');
    const singleBook = (session.selected_books || []).length === 1;
    if (!hasDirectInspection && singleBook && normalizedPlan.tool_calls.length < MAX_TOOL_CALLS_PER_PLAN) {
      normalizedPlan.tool_calls.push({
        tool: 'read_book',
        args: { book_id: session.selected_books[0].id, focus: userMessage || session.topic },
        reason: 'Inspect the selected book chapter notes directly so the draft is grounded in the actual source material.'
      });
    }

    return normalizedPlan;
  } catch (error) {
    return {
      ...buildDefaultPlan(session, userMessage),
      backend: session.backend,
      model: session.model,
      fallback_reason: error.message
    };
  }
}

async function buildEvidencePacket(session, context, plan, toolTrace, userMessage) {
  const systemPrompt = `You are the evidence synthesizer inside WriteFlow's essay harness.

You are not drafting the final essay yet. You are distilling the inspected evidence into a compact thinking packet for the drafter.

If multiple books are present:
- focus on shared structures, tensions, contradictions, and synthesis opportunities
- do not produce book-by-book summaries
- identify a novel through-line where possible

Return ONLY valid JSON:
{
  "working_thesis": "string",
  "narrative_arc": "string",
  "outline": ["string"],
  "argument_map": ["string"],
  "intersections": ["string"],
  "tensions": ["string"],
  "evidence_ledgers": ["string"],
  "evidence_gaps": ["string"],
  "open_questions": ["string"],
  "recommended_sections": ["string"]
}

Rules:
- Every statement must be grounded in the provided tool results.
- Keep each item concise and actionable.
- Prefer conceptual precision over generic summary language.
- Preserve the user's framing and vocabulary where possible.
- Prefer 4-6 outline lines and 3-6 argument map lines.`;

  const userPrompt = JSON.stringify({
    topic: session.topic,
    audience: session.audience,
    tone: session.tone,
    plan,
    memory: session.memory,
    user_message: userMessage,
    context_summary: summarizeContextForPrompt(context, session),
    tool_trace: compactToolTrace(toolTrace)
  }, null, 2);

  try {
    const llm = await generateJson({
      backend: session.backend,
      model: session.model || undefined,
      systemPrompt,
      userPrompt,
      temperature: 0.2,
      maxTokens: 1800
    });

    return {
      working_thesis: clip(llm.data?.working_thesis || session.memory?.working_thesis || '', 360),
      narrative_arc: clip(llm.data?.narrative_arc || session.memory?.narrative_arc || '', 260),
      outline: clipList(llm.data?.outline, 8, 220),
      argument_map: clipList(llm.data?.argument_map, 8, 260),
      intersections: clipList(llm.data?.intersections, 8, 220),
      tensions: clipList(llm.data?.tensions, 8, 220),
      evidence_ledgers: clipList(llm.data?.evidence_ledgers, 10, 220),
      evidence_gaps: clipList(llm.data?.evidence_gaps, 8, 220),
      open_questions: clipList(llm.data?.open_questions, 8, 220),
      recommended_sections: clipList(llm.data?.recommended_sections, 8, 220),
      backend: llm.backend,
      model: llm.model,
      fallback_reason: llm.fallback_reason || ''
    };
  } catch (error) {
    return {
      working_thesis: session.memory?.working_thesis || '',
      narrative_arc: session.memory?.narrative_arc || '',
      outline: clipList(session.memory?.outline, 8, 220),
      argument_map: clipList(session.memory?.argument_map, 8, 260),
      intersections: [],
      tensions: [],
      evidence_ledgers: toolTrace.map(item => `${item.tool}: ${clip(item.reason || '', 120)}${item.result ? ` / ${clip(JSON.stringify(item.result), 140)}` : ''}`).slice(0, 8),
      evidence_gaps: ['The evidence packet fell back to heuristic mode. Tighten the next prompt if needed.'],
      open_questions: clipList(plan.source_questions, 6, 220),
      recommended_sections: [],
      backend: session.backend,
      model: session.model,
      fallback_reason: error.message
    };
  }
}

async function draftEssayResponse(session, context, plan, evidencePacket, toolTrace, userMessage) {
  const proposalMode = shouldUseProposalMode(session, plan, userMessage);
  const systemPrompt = `You are WriteFlow's essay drafting engine.

Write like a sharp student writer producing a strong college paper: clear thesis, disciplined argument, coherent paragraph transitions, and real conceptual explanation.
The purpose of the writing is to distill sophisticated concepts so the audience can actually understand them without diluting the ideas.
Treat the user's notes as the governing source material and preserve their intellectual framing, distinctions, and implied causal logic.

When multiple books are selected:
- produce synthesis rather than serial summary
- surface tensions, contradictions, and complementarities
- articulate a coherent intellectual framework
- create claims that emerge from the combination of sources, not just each source in isolation

Return ONLY valid JSON:
{
  "mode": "direct_update" | "proposal_only",
  "assistant_message": "brief explanation of what changed and what to do next",
  "draft_markdown": "full markdown draft or outline",
  "proposals": [
    {
      "title": "string",
      "rationale": "string",
      "change_summary": "string",
      "focus_section": "string",
      "patch_mode": "section_patch" | "full_replace" | "append_paragraph",
      "before_excerpt": "string",
      "after_excerpt": "string",
      "after_markdown": "full markdown draft if this proposal is applied",
      "working_thesis": "string"
    }
  ],
  "memory_patch": {
    "phase": "string",
    "working_thesis": "string",
    "narrative_arc": "string",
    "outline": ["string"],
    "argument_map": ["string"],
    "intersections": ["string"],
    "tensions": ["string"],
    "source_ledger": ["string"],
    "evidence_gaps": ["string"],
    "open_questions": ["string"],
    "next_actions": ["string"],
    "recent_findings": ["string"],
    "style_directives": ["string"]
  }
}

Rules:
- Ground claims in the evidence packet and tool outputs.
- If response_mode is "outline", return a refined outline rather than a full essay.
- If response_mode is "paragraph", write exactly one paragraph and do not use headings.
- If response_mode is "critique", revise or annotate the draft by identifying weak assumptions and unsupported jumps.
- When response_mode is "draft", prefer continuous prose paragraphs rather than headings unless the user explicitly asked for headings or an outline.
- Explain terms and relationships when they are sophisticated or non-obvious.
- Avoid bland, pointed, corporate, or banal prose.
- Avoid bullet-list energy inside paragraphs; write with argumentative flow.
- Use the selected notes to anchor the paper's claims and examples.
- Preserve any strong material already in the draft unless the user asked to rewrite it.
- If proposal_mode is true, do not silently overwrite the draft. Instead return 1-3 conservative proposals and keep "draft_markdown" equal to the current draft.
- Prefer "section_patch" proposals that update one section or passage at a time.
- In paragraph mode, return a single proposal with patch_mode "append_paragraph" unless the user is clearly revising an existing paragraph.
- Only use "full_replace" if the improvement truly requires restructuring the whole draft.
- When proposing a section patch, "before_excerpt" must match text from the current draft and "after_excerpt" should be the minimally changed replacement.
- Do not include headings inside a paragraph response.
- Default to prose, not section headings.
- Do not fabricate quotations.`;

  const userPrompt = JSON.stringify({
    topic: session.topic,
    audience: session.audience,
    tone: session.tone,
    user_message: userMessage,
    plan,
    working_memory: session.memory,
    evidence_packet: evidencePacket,
    recent_tool_trace: compactToolTrace(toolTrace),
    current_draft: clip(session.draft_markdown, 9000),
    context_summary: summarizeContextForPrompt(context, session),
    proposal_mode: proposalMode,
    paragraph_mode: plan.response_mode === 'paragraph'
  }, null, 2);

  try {
    const llm = await generateJson({
      backend: session.backend,
      model: session.model || undefined,
      systemPrompt,
      userPrompt,
      temperature: 0.35,
      maxTokens: 2600
    });

    return {
      mode: llm.data?.mode || (proposalMode ? 'proposal_only' : 'direct_update'),
      assistant_message: llm.data?.assistant_message || 'I advanced the essay with a tighter synthesis pass.',
      draft_markdown: typeof llm.data?.draft_markdown === 'string'
        ? llm.data.draft_markdown
        : session.draft_markdown,
      proposals: Array.isArray(llm.data?.proposals) ? llm.data.proposals : [],
      memory_patch: llm.data?.memory_patch || {},
      backend: llm.backend,
      model: llm.model,
      fallback_reason: llm.fallback_reason || ''
    };
  } catch (error) {
    const fallbackDraft = plan.response_mode === 'paragraph'
      ? draftToSingleParagraph([
          evidencePacket.working_thesis || `The core argument about ${session.topic} is still consolidating.`,
          evidencePacket.argument_map?.[0] || '',
          evidencePacket.intersections?.[0] || evidencePacket.outline?.[0] || ''
        ].filter(Boolean).join(' '))
      : (session.draft_markdown || [
          `# ${session.topic}`,
          '',
          '## Working Thesis',
          evidencePacket.working_thesis || 'A thesis is still forming.',
          '',
          '## Outline',
          ...(evidencePacket.outline.length ? evidencePacket.outline.map(item => `- ${item}`) : ['- Gather stronger evidence before drafting.']),
          '',
          '## Open Questions',
          ...(evidencePacket.open_questions.length ? evidencePacket.open_questions.map(item => `- ${item}`) : ['- Tighten the thesis with another pass.'])
        ].join('\n'));

    return {
      mode: proposalMode ? 'proposal_only' : 'direct_update',
      assistant_message: 'I mapped the evidence and preserved the current workspace, but the drafting step fell back to a structured scaffold.',
      draft_markdown: fallbackDraft,
      proposals: [],
      memory_patch: {
        phase: plan.phase === 'critique' ? 'critique-ready' : 'draft-scaffolded',
        next_actions: ['Run another drafting pass when the model is healthy.', 'Use the current thesis and outline as the revision spine.']
      },
      backend: session.backend,
      model: session.model,
      fallback_reason: error.message
    };
  }
}

async function runEssayAgentTurn(session, userMessage) {
  if (matchesSlashCommand(userMessage, 'clear')) {
    clearSessionMemory(session);
    session.transcript.push({
      role: 'assistant',
      content: 'Cleared the harness memory, tool trace, and pending changes. Your selected sources and approved draft were preserved.',
      created_at: nowIso()
    });
    await saveSession(session);
    return {
      session,
      assistant_message: 'Cleared the harness memory, tool trace, and pending changes. Your selected sources and approved draft were preserved.',
      draft_markdown: session.draft_markdown,
      memory: session.memory,
      pending_draft_updates: [],
      tool_trace: [],
      plan: null,
      evidence_packet: null,
      backend: session.backend,
      model: session.model,
      fallback_reason: ''
    };
  }

  const context = await fetchSessionContext(session);
  session.transcript.push({ role: 'user', content: userMessage, created_at: nowIso() });

  const plan = await planEssayTurn(session, context, userMessage);
  const toolTrace = [];
  const usedTools = new Set();

  for (const toolCall of plan.tool_calls.slice(0, MAX_TOOL_STEPS)) {
    const toolKey = `${toolCall.tool}:${JSON.stringify(toolCall.args || {})}`;
    if (usedTools.has(toolKey)) continue;
    usedTools.add(toolKey);

    try {
      const result = await executeTool(toolCall, context, session);
      const toolEntry = {
        role: 'tool',
        name: toolCall.tool,
        created_at: nowIso(),
        content: JSON.stringify(result)
      };
      session.transcript.push(toolEntry);
      toolTrace.push({
        tool: toolCall.tool,
        args: toolCall.args || {},
        reason: toolCall.reason || '',
        result
      });
    } catch (error) {
      toolTrace.push({
        tool: toolCall.tool,
        args: toolCall.args || {},
        reason: toolCall.reason || '',
        error: error.message
      });
    }
  }

  const evidencePacket = await buildEvidencePacket(session, context, plan, toolTrace, userMessage);

  const finalPayload = await draftEssayResponse(
    session,
    context,
    plan,
    evidencePacket,
    toolTrace,
    userMessage
  );

  const pendingProposals = (finalPayload.proposals || [])
    .map(proposal => buildPendingProposal(proposal, session, evidencePacket))
    .filter(Boolean)
    .slice(0, MAX_PENDING_PROPOSALS);
  const fallbackProposal = finalPayload.mode === 'proposal_only' && pendingProposals.length === 0
    ? (synthesizeProposalFromDraft(finalPayload, session, evidencePacket, plan)
      || synthesizeProposalFromEvidence(session, evidencePacket, plan))
    : null;
  const effectiveProposals = fallbackProposal ? [fallbackProposal] : pendingProposals;

  session.memory = mergeMemory(session.memory, {
    ...plan.memory_patch,
    phase: plan.phase,
    reasoning_mode: plan.reasoning_mode,
    current_goal: plan.draft_goal || session.memory?.current_goal,
    style_directives: plan.style_directives,
    working_thesis: evidencePacket.working_thesis,
    narrative_arc: evidencePacket.narrative_arc,
    outline: evidencePacket.outline,
    argument_map: evidencePacket.argument_map,
    intersections: evidencePacket.intersections,
    tensions: evidencePacket.tensions,
    source_ledger: evidencePacket.evidence_ledgers,
    evidence_gaps: evidencePacket.evidence_gaps,
    open_questions: evidencePacket.open_questions,
    next_actions: evidencePacket.recommended_sections,
    recent_findings: [
      ...clipList(finalPayload.memory_patch?.recent_findings, 6, 220),
      ...toolTrace.map(item => {
        if (item.error) return `${item.tool} failed: ${item.error}`;
        return `${item.tool}: ${clip(item.reason, 140)}`;
      }).slice(0, 4)
    ],
    next_actions: finalPayload.mode === 'proposal_only'
      ? ['Review the pending draft updates.', 'Accept, dismiss, or request changes before the draft is updated.']
      : evidencePacket.recommended_sections
  });

  session.memory = mergeMemory(session.memory, finalPayload.memory_patch);
  if (finalPayload.mode === 'proposal_only') {
    session.pending_draft_updates = effectiveProposals;
  } else {
    session.draft_markdown = finalPayload.draft_markdown || session.draft_markdown;
    session.pending_draft_updates = [];
  }
  session.last_tool_trace = toolTrace;
  session.last_plan = plan;
  session.last_evidence_packet = evidencePacket;
  session.transcript.push({
    role: 'assistant',
    content: finalPayload.assistant_message,
    created_at: nowIso()
  });
  await saveSession(session);

  return {
    session,
    assistant_message: finalPayload.assistant_message,
    draft_markdown: session.draft_markdown,
    memory: session.memory,
    pending_draft_updates: session.pending_draft_updates || [],
    tool_trace: toolTrace,
    plan,
    evidence_packet: evidencePacket,
    backend: finalPayload.backend,
    model: finalPayload.model,
    fallback_reason: [plan.fallback_reason, evidencePacket.fallback_reason, finalPayload.fallback_reason].filter(Boolean).join(' | ')
  };
}

async function resolveDraftProposal(session, proposalId, action) {
  const proposals = Array.isArray(session.pending_draft_updates) ? session.pending_draft_updates : [];
  const proposal = proposals.find(item => item.id === proposalId);
  if (!proposal) {
    throw new Error('Proposal not found');
  }

  if (action === 'accept') {
    const applied = applyProposalPatch(session.draft_markdown, proposal);
    session.draft_markdown = applied.draft;
    session.pending_draft_updates = [];
    session.memory = mergeMemory(session.memory, {
      recent_findings: [`Accepted draft update: ${proposal.title} (${applied.applied_as})`],
      next_actions: ['Review the newly applied draft carefully before requesting another revision.']
    });
    session.transcript.push({
      role: 'assistant',
      content: `Applied proposed update: ${proposal.title} using ${applied.applied_as}.`,
      created_at: nowIso()
    });
  } else if (action === 'reject') {
    session.pending_draft_updates = proposals.filter(item => item.id !== proposalId);
    session.transcript.push({
      role: 'assistant',
      content: `Dismissed proposed update: ${proposal.title}`,
      created_at: nowIso()
    });
  } else {
    throw new Error('Unsupported action');
  }

  await saveSession(session);
  return session;
}

async function reviseDraftProposal(session, proposalId, feedback) {
  const proposals = Array.isArray(session.pending_draft_updates) ? session.pending_draft_updates : [];
  const proposal = proposals.find(item => item.id === proposalId);
  if (!proposal) {
    throw new Error('Proposal not found');
  }
  if (!String(feedback || '').trim()) {
    throw new Error('Revision feedback required');
  }

  const revisionInstruction = [
    `Revise the pending proposal titled "${proposal.title}".`,
    `Focus area: ${proposal.focus_section || 'Draft workspace'}.`,
    proposal.before_excerpt
      ? `Existing approved content to preserve unless needed:\n${proposal.before_excerpt}`
      : 'There is no approved text in this location yet; treat this as a new insertion.',
    `Current proposed text that needs revision:\n${proposal.after_excerpt || proposal.after_markdown || ''}`,
    `User revision instructions:\n${String(feedback).trim()}`,
    'Re-inspect the source material as needed, then produce a revised proposal that addresses the user instructions. Return mode "proposal_only" so the user can review the updated change before it is applied. Do not apply the revision to the draft automatically.'
  ].join('\n\n');

  const originalPending = proposals.map(item => ({ ...item }));
  session.pending_draft_updates = [];
  session.memory = mergeMemory(session.memory, {
    current_goal: `Revise pending proposal: ${proposal.title}`,
    next_actions: ['Re-evaluate the proposal against the sources.', 'Return an updated proposal for approval.']
  });

  try {
    const result = await runEssayAgentTurn(session, revisionInstruction);
    if (!Array.isArray(result.session.pending_draft_updates) || !result.session.pending_draft_updates.length) {
      session.pending_draft_updates = originalPending;
      session.transcript.push({
        role: 'assistant',
        content: `I revisited the proposal but did not produce a better revision yet, so I restored the previous proposed change for "${proposal.title}".`,
        created_at: nowIso()
      });
      await saveSession(session);
      return session;
    }

    result.session.pending_draft_updates = result.session.pending_draft_updates.map((item, index) =>
      index === 0 ? { ...item, id: proposal.id, created_at: nowIso() } : item
    );
    result.session.memory = mergeMemory(result.session.memory, {
      recent_findings: [`Revised pending proposal: ${proposal.title}`],
      next_actions: ['Review the updated proposal and choose yes, no, or request another change.']
    });
    await saveSession(result.session);
    return result.session;
  } catch (error) {
    session.pending_draft_updates = originalPending;
    await saveSession(session);
    throw error;
  }
}

module.exports = {
  createEssaySession,
  loadSession,
  saveSession,
  runEssayAgentTurn,
  resolveDraftProposal,
  reviseDraftProposal
};
