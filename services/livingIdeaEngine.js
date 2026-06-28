const { generateJson } = require('./llmClient');

const MASTERY_DEFAULT = {
  state: 'new',
  score: 0,
  last_reviewed_at: null,
  next_review_at: null,
  failure_modes: [],
  strengths: [],
  review_interval_days: 1
};

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function asText(value, fallback = '') {
  return String(value || fallback).trim();
}

function clipText(value, limit = 1200) {
  const raw = asText(value).replace(/\s+/g, ' ');
  return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
}

function normalizeEvidenceList(value) {
  return asArray(value).map(item => {
    if (typeof item === 'string') {
      return { text: clipText(item, 600), source: '' };
    }
    return {
      text: clipText(item.text || item.claim || item.evidence || '', 600),
      source: asText(item.source || item.chapter || '')
    };
  }).filter(item => item.text);
}

function normalizeStringList(value, limit = 8) {
  return asArray(value)
    .map(item => typeof item === 'string' ? item : (item.text || item.name || item.summary || ''))
    .map(item => clipText(item, 500))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeLivingIdea(raw = {}, index = 0) {
  const title = asText(raw.title || raw.idea_title || raw.claim, `Living Idea ${index + 1}`);
  const claim = asText(raw.claim || raw.core_claim || raw.body || title);
  const definition = asText(raw.definition || raw.meaning || raw.explanation || claim);
  const mechanism = asText(raw.mechanism || raw.how_it_works || raw.causal_mechanism);
  const compressedPrinciple = asText(raw.compressed_principle || raw.principle || raw.theorem || claim);

  return {
    title,
    body: asText(raw.body || raw.summary || claim),
    tags: normalizeStringList(raw.tags, 4).map(tag => tag.toUpperCase()),
    claim,
    definition,
    mechanism,
    evidence: normalizeEvidenceList(raw.evidence || raw.supporting_evidence),
    examples: normalizeStringList(raw.examples || raw.applications),
    boundary_conditions: normalizeStringList(raw.boundary_conditions || raw.boundaries || raw.limits),
    counterarguments: normalizeStringList(raw.counterarguments || raw.counter_arguments || raw.objections),
    open_questions: normalizeStringList(raw.open_questions || raw.questions),
    compressed_principle: compressedPrinciple,
    source_fragments: normalizeStringList(raw.source_fragments || raw.source_quotes || raw.source_notes, 6),
    connection_summary: asText(raw.connection_summary || raw.broader_relevance || ''),
    mastery: {
      ...MASTERY_DEFAULT,
      ...(raw.mastery && typeof raw.mastery === 'object' ? raw.mastery : {})
    },
    metadata: {
      extraction_version: 1,
      confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
      original_index: index
    }
  };
}

function extractIdeasFromPayload(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['living_ideas', 'ideas', 'items', 'data']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function buildLivingIdeaPrompts({ bookTitle, author, chapterName, rawNotes, existingIdeas = [] }) {
  const systemPrompt = `You are WriteFlow's Living Idea Distillation Engine.

Your job is to convert rough reading notes into durable intellectual objects. Do not summarize the chapter. Extract reusable ideas that can be understood, tested, remembered, connected, and used in original writing.

For each living idea, return:
- title: punchy and specific
- body: 2-4 sentence public idea-card summary
- tags: 2-4 uppercase tags
- claim: what the idea asserts
- definition: what the idea means
- mechanism: how it works, especially causal logic
- evidence: array of { text, source } grounded in the notes
- examples: concrete examples or applications
- boundary_conditions: where the idea stops applying or becomes weaker
- counterarguments: strongest objections or skeptical pressures
- open_questions: unresolved questions
- compressed_principle: one sentence theorem-like compression
- source_fragments: short note fragments that support the idea
- connection_summary: how this idea may connect beyond this chapter
- confidence: 0.0 to 1.0

Rules:
- Produce 3 to 6 living ideas.
- Preserve the user's notes and framing.
- Do not fabricate quotes, page numbers, or external facts.
- Prefer mechanisms, tensions, and reusable principles over bland chapter summaries.
- Return valid JSON only: { "living_ideas": [...] }.`;

  const existing = existingIdeas.length
    ? existingIdeas.map(item => `- ${item.title}: ${clipText(item.body, 180)}`).join('\n')
    : 'None.';

  const userPrompt = `Book: "${bookTitle}" by ${author || 'Unknown author'}
Chapter: ${chapterName || 'Unknown chapter'}

Existing idea cards to avoid duplicating:
${existing}

Raw notes:
"""
${rawNotes}
"""

Create living ideas now.`;

  return { systemPrompt, userPrompt };
}

async function generateLivingIdeas({
  bookTitle,
  author,
  chapterName,
  rawNotes,
  existingIdeas = [],
  backend,
  model,
  generateJsonFn = generateJson
}) {
  if (!asText(rawNotes)) {
    throw new Error('rawNotes required');
  }

  const { systemPrompt, userPrompt } = buildLivingIdeaPrompts({
    bookTitle,
    author,
    chapterName,
    rawNotes,
    existingIdeas
  });

  const llm = await generateJsonFn({
    backend,
    model,
    systemPrompt,
    userPrompt,
    temperature: 0.45,
    maxTokens: 2600
  });

  const rawIdeas = extractIdeasFromPayload(llm.data);
  return {
    ideas: rawIdeas.map(normalizeLivingIdea).filter(item => item.claim && item.definition),
    backend: llm.backend,
    model: llm.model,
    fallback_reason: llm.fallback_reason || ''
  };
}

function livingIdeaToIdeaRow(livingIdea, { bookId, chapterName, number, nextReviewAt }) {
  return {
    book_id: bookId,
    chapter_name: chapterName || null,
    title: livingIdea.title,
    body: livingIdea.body || livingIdea.claim,
    tags: livingIdea.tags || [],
    number,
    next_review_at: nextReviewAt
  };
}

function livingIdeaToDbRow(livingIdea, { ideaId, bookId, chapterName }) {
  return {
    idea_id: ideaId,
    book_id: bookId,
    chapter_name: chapterName || null,
    claim: livingIdea.claim,
    definition: livingIdea.definition,
    mechanism: livingIdea.mechanism,
    evidence: livingIdea.evidence,
    examples: livingIdea.examples,
    boundary_conditions: livingIdea.boundary_conditions,
    counterarguments: livingIdea.counterarguments,
    open_questions: livingIdea.open_questions,
    compressed_principle: livingIdea.compressed_principle,
    source_fragments: livingIdea.source_fragments,
    connection_summary: livingIdea.connection_summary,
    mastery: livingIdea.mastery,
    metadata: livingIdea.metadata
  };
}

module.exports = {
  MASTERY_DEFAULT,
  buildLivingIdeaPrompts,
  generateLivingIdeas,
  normalizeLivingIdea,
  livingIdeaToIdeaRow,
  livingIdeaToDbRow
};
