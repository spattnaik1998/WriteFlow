const ESSAY_QUALITY_SYSTEM_PROMPT = `WRITING QUALITY CONTRACT

Use this contract for essay prose and refined notes unless the user explicitly asks for an outline or list.

- Write in continuous argumentative prose. Do not turn essay content into bullet points, numbered points, comparison tables, or detached fragments.
- Build paragraphs around claims: state the idea, explain the mechanism, ground it in the source material, then show why it matters.
- Synthesize instead of stacking summaries. When multiple sources are present, make the relationship between them do intellectual work.
- Prefer precise, complete sentences over compressed note-speak. No dangling clauses, abandoned comparisons, malformed transitions, or sentence fragments.
- Before returning, silently perform a final copy-edit pass for grammar, punctuation, repeated words, and paragraph flow.
- If evidence is thin, name the limitation in prose rather than padding with generic claims.
- Preserve the user's vocabulary and intellectual angle, but remove scaffolding phrases such as "this section will" and "both books agree".`;

const TERMINAL_PUNCTUATION_RE = /[.!?;:)"'\]]$/;
const LIST_MARKER_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+|[IVXLCDM]+[.)]\s+)/i;

function tidySentenceSpacing(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/([.!?]){2,}/g, '$1')
    .replace(/\b(\w+)\s+\1\b/gi, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureTerminalPunctuation(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || /^#{1,6}\s/.test(trimmed) || TERMINAL_PUNCTUATION_RE.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function normalizeEssayProse(text, options = {}) {
  const allowBullets = Boolean(options.allowBullets);
  const allowHeadings = options.allowHeadings !== false;
  const paragraphMode = Boolean(options.paragraphMode);
  const raw = tidySentenceSpacing(text);
  if (!raw) return '';

  const lines = raw.split('\n');
  const normalized = [];
  let listBuffer = [];

  const flushListBuffer = () => {
    if (!listBuffer.length) return;
    normalized.push(ensureTerminalPunctuation(listBuffer.join(' ')));
    listBuffer = [];
  };

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) {
      flushListBuffer();
      if (normalized[normalized.length - 1] !== '') normalized.push('');
      continue;
    }

    const isHeading = /^#{1,6}\s/.test(line);
    if (isHeading && allowHeadings && !paragraphMode) {
      flushListBuffer();
      normalized.push(line);
      continue;
    }

    if (!allowBullets && LIST_MARKER_RE.test(line)) {
      listBuffer.push(line.replace(LIST_MARKER_RE, '').trim());
      continue;
    }

    flushListBuffer();
    normalized.push(ensureTerminalPunctuation(line));
  }

  flushListBuffer();

  return tidySentenceSpacing(
    normalized
      .join(paragraphMode ? ' ' : '\n')
      .replace(/\n{3,}/g, '\n\n')
  );
}

function findEssayQualityIssues(text, options = {}) {
  const allowBullets = Boolean(options.allowBullets);
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const issues = [];

  if (!allowBullets && lines.some(line => LIST_MARKER_RE.test(line))) {
    issues.push('Essay prose contains list markers where continuous prose is expected.');
  }

  const unfinished = lines.filter(line =>
    !/^#{1,6}\s/.test(line) &&
    !TERMINAL_PUNCTUATION_RE.test(line) &&
    line.length > 30
  );
  if (unfinished.length) {
    issues.push('One or more substantial lines appear to end without terminal punctuation.');
  }

  return issues;
}

const EVALUATION_SCORE_KEYS = [
  'synthesis_depth',
  'evidence_grounding',
  'paragraph_flow',
  'grammar_polish'
];

function normalizeScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, Math.round(parsed * 10) / 10));
}

function normalizeIssueList(list, limit = 6) {
  return (Array.isArray(list) ? list : [])
    .filter(Boolean)
    .map(item => String(item).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeEvaluationReport(raw = {}, options = {}) {
  // Reuse the caller's deterministic scan when provided so the draft is not regex-scanned
  // twice; only recompute when the caller did not already do it.
  const deterministicIssues = Array.isArray(options.deterministicIssues)
    ? options.deterministicIssues
    : findEssayQualityIssues(options.draftText || '', { allowBullets: Boolean(options.allowBullets) });
  // A threshold of 0 is legitimate ("accept anything"); do not let `|| default` swallow it.
  const threshold = normalizeScore(options.threshold ?? raw.threshold ?? 3.5);
  const scores = EVALUATION_SCORE_KEYS.reduce((acc, key) => {
    acc[key] = normalizeScore(raw.scores?.[key] ?? raw[key]);
    return acc;
  }, {});
  scores.overall = normalizeScore(
    raw.scores?.overall ??
    raw.overall ??
    (EVALUATION_SCORE_KEYS.reduce((sum, key) => sum + scores[key], 0) / EVALUATION_SCORE_KEYS.length)
  );

  const rubricIssues = normalizeIssueList(raw.blocking_issues || raw.issues, 8);
  const failedScores = EVALUATION_SCORE_KEYS
    .filter(key => scores[key] < threshold)
    .map(key => `${key.replace(/_/g, ' ')} scored ${scores[key]}/5, below the ${threshold}/5 gate.`);
  const blockingIssues = normalizeIssueList([...deterministicIssues, ...rubricIssues, ...failedScores], 10);

  // The model may veto-fail its own draft, but can never grant a pass that the mechanical
  // gate (no blocking issues, overall at/above threshold) would otherwise deny.
  const passed = raw.passed !== false && !blockingIssues.length && scores.overall >= threshold;

  return {
    passed,
    threshold,
    scores,
    blocking_issues: blockingIssues,
    revision_priorities: normalizeIssueList(raw.revision_priorities, 6),
    strengths: normalizeIssueList(raw.strengths, 5),
    summary: String(raw.summary || '').replace(/\s+/g, ' ').trim().slice(0, 420),
    evaluated_at: options.evaluatedAt || new Date().toISOString()
  };
}
module.exports = {
  ESSAY_QUALITY_SYSTEM_PROMPT,
  EVALUATION_SCORE_KEYS,
  normalizeEssayProse,
  findEssayQualityIssues,
  normalizeEvaluationReport
};
