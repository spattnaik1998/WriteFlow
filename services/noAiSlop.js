/**
 * The no-AI-slop editing contract, adapted from Peter Yang's `no-ai-slop` skill
 * (https://github.com/petergyang/no-ai-slop, skills/no-ai-slop/SKILL.md).
 *
 * Two halves, the same shape as services/writingQuality.js:
 *
 *   NO_AI_SLOP_CONTRACT   the rules, injected into the generation prompt
 *   findSlop(text)        a mechanical detector over the model's output
 *
 * The detector exists because the prompt alone does not hold. A model told to avoid
 * "It's not X, it's Y" still produces it, and the only reliable check is to look at the
 * finished text. Callers regenerate against the findings rather than trusting the
 * instruction, the same asymmetry writingQuality.js enforces: the model can fail its own
 * output, but it can never pass what the mechanical gate rejects.
 */

const NO_AI_SLOP_CONTRACT = `NO AI SLOP CONTRACT

Write like a sharp human, not a content model.

Principles
- Be concrete. Names, numbers, mechanisms and examples beat abstractions. "Cut deploy time from 40 minutes to 4", not "improved efficiency".
- Apply the portability test: if a sentence could move unchanged to another book, author or subject, it is filler. Cut it or make it specific.
- Show, do not tell. Let the fact carry the emphasis. Never label a point important, surprising, subtle or counterintuitive.
- Use active voice with human subjects. Never let an inanimate thing perform a human verb.
- Make verbs do the work: "decided", not "made a decision"; "can", not "has the ability to".
- Prefer "is" and "has" where they are clearer than an inflated verb.
- If the clear word is right, repeat it. Do not rotate synonyms for style.
- Vary sentence shape. No stacked fragments, no repeated rhythm.

Never write these
- Binary contrasts: "It's not X, it's Y", "The question isn't X, it's Y", "not just X but Y". State the second half directly.
- Throat-clearing openers: "Here's the thing", "Let me be clear", "I'll be honest", "The uncomfortable truth is".
- Faux-insight setups: "What nobody tells you", "The part everyone misses", "What most people get wrong".
- Colon reveals: a noun phrase, a colon, then a dramatic lowercase reveal. Write a plain sentence.
- Superficial analysis: trailing -ing clauses that pretend to explain ("highlighting", "underscoring", "reflecting", "showcasing").
- Importance puffery: "a testament to", "marks a pivotal moment", "plays a vital role", "underscores its significance".
- Interpretive metadiscourse: "the key point is", "this distinction matters", "that matters more than it sounds", "in other words".
- Weasel attribution: "experts agree", "studies show", "many argue", "widely regarded as". Name the source or drop the claim.
- Negative listing: "Not a X. Not a Y. A Z." Just say Z.
- Rhetorical setups: "What if I told you", "Think about it:", "Plot twist:", and self-answered question/answer pairs.
- Fake-profound kickers: a final cute metaphor or mic-drop line. End on the clearest concrete sentence instead.
- Summary-recap endings: "In conclusion", "Ultimately", "Overall", or a closing paragraph that restates the piece.

Never use these words
delve, foster, leverage, utilize, facilitate, empower, streamline, robust, cutting-edge, paradigm shift, game changer, tapestry, realm, beacon, multifaceted, meticulous, intricate, paramount, transformative, elevate, embark, supercharge, harness, ever-evolving, "this is huge", "this changes everything".

Never use these phrases
"it's worth noting", "it's important to note", "at the end of the day", "when it comes to", "at its core", "in today's world", "in the age of", "in the world of", "the reality is", "the truth is", "in terms of", "going forward", "let's dive in".

Formatting
- No emoji. No hashtags. No @mentions.
- No markdown. Asterisks and underscores render literally where these posts are published, so write a book title as plain text, never as *italics* or **bold**.
- No bullet lists where prose reads better.
- Em dashes are a rhythm crutch: use none.

Invent nothing. Every claim, number and example must come from the source material provided.`;

// ── Mechanical detection ─────────────────────────────────────────────────────
// Each rule names the pattern the way the skill names it, so a finding can be handed
// straight back to the model as an instruction it already understands.

const BANNED_WORDS = [
  'delve', 'delves', 'delving', 'foster', 'fosters', 'fostering', 'leverage', 'leverages',
  'leveraging', 'utilize', 'utilizes', 'utilizing', 'facilitate', 'facilitates', 'empower',
  'empowers', 'empowering', 'streamline', 'streamlines', 'streamlining', 'robust',
  'cutting-edge', 'tapestry', 'realm', 'beacon', 'multifaceted', 'meticulous', 'meticulously',
  'intricate', 'intricately', 'paramount', 'transformative', 'elevate', 'elevates',
  'elevating', 'embark', 'embarks', 'supercharge', 'supercharges', 'ever-evolving'
];

const BANNED_PHRASES = [
  'paradigm shift', 'game changer', 'game-changer', 'this is huge', 'this changes everything',
  "it's worth noting", 'it is worth noting', "it's important to note", 'it is important to note',
  'at the end of the day', 'when it comes to', 'at its core', "in today's world",
  'in the age of', 'in the world of', 'the reality is', 'the truth is', 'in terms of',
  'with regard to', 'going forward', 'in this article', "let's dive in", 'a testament to',
  'marks a pivotal moment', 'plays a vital role', 'solidifies its position',
  'underscores its significance', 'experts agree', 'studies show', 'many argue',
  'widely regarded as', 'industry reports suggest', 'the key point is',
  'this distinction matters', 'in other words', 'what if i told you', 'plot twist',
  "here's the thing", 'here is the thing', 'let me be clear', "i'll be honest",
  'the uncomfortable truth', 'what nobody tells you', 'the part everyone misses',
  'what most people get wrong', 'in conclusion'
];

const PATTERN_RULES = [
  { id: 'binary-contrast',
    re: /\b(?:it'?s|it is|this is|that'?s|that is)\s+not\s+(?:just\s+)?[^.?!]{1,60}[.,]\s*(?:it'?s|it is|this is|that'?s|that is)\b/i,
    fix: 'binary contrast ("It\'s not X, it\'s Y") - state the second half directly' },
  { id: 'binary-question',
    re: /\bthe (?:question|issue|problem|point) is(?:n'?t| not)\b[^.?!]{1,80}[,.]\s*it'?s\b/i,
    fix: 'binary contrast ("The question isn\'t X, it\'s Y") - make the claim directly' },
  { id: 'not-just-but',
    re: /\bnot just\b[^.?!]{1,60}\bbut\b/i,
    fix: '"not just X but Y" - say Y directly' },
  { id: 'superficial-analysis',
    re: /,\s*(?:highlighting|underscoring|reflecting|showcasing|underlining|demonstrating|signalling|signaling)\b/i,
    fix: 'trailing -ing clause that pretends to explain - state the consequence instead' },
  { id: 'summary-ending',
    re: /(?:^|\n)\s*(?:in conclusion|ultimately|overall|in summary|to sum up)\b/i,
    fix: 'summary-recap ending - end on the last concrete point' },
  { id: 'weasel-attribution',
    re: /\b(?:experts|researchers|scientists|studies|research|many people|most people)\s+(?:agree|say|show|suggest|believe|argue|think)\b/i,
    fix: 'weasel attribution - name the source or drop the claim' },
  { id: 'rhetorical-setup',
    re: /\b(?:what if i told you|think about it|plot twist|ask yourself)\b/i,
    fix: 'rhetorical setup - make the point without the wind-up' },
  { id: 'em-dash',
    re: /—/,
    fix: 'em dash used as a rhythm crutch - use a comma, period or parentheses' },
  // Posts are pasted straight into X, which does not render markdown: *title* shows the
  // asterisks. Requiring a non-space character on each side of the marker keeps
  // "17 * 24" and snake_case identifiers out of the findings.
  { id: 'markdown-emphasis',
    re: /\*\*?\S[^*\n]{0,120}\S\*\*?|(?:^|\s)_\S[^_\n]{0,120}\S_(?=\s|$|[.,;:!?])/,
    fix: 'markdown emphasis renders literally where this is published - write it as plain text' },
  { id: 'emoji',
    re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    fix: 'emoji - remove' },
  { id: 'hashtag',
    re: /(?:^|\s)#\w+/,
    fix: 'hashtag - remove' },
  { id: 'mention',
    re: /(?:^|\s)@\w+/,
    fix: '@mention - remove' }
];

// A noun phrase, a colon, then a lowercase dramatic reveal. Requires the tail to be a
// clause rather than a comma-separated series, so real list and label colons pass.
const COLON_REVEAL_RE = /(?:^|[.!?]\s)[A-Z][^.!?:\n]{4,60}:\s+[a-z][^.!?\n,]{10,}[.!?]/;

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every slop pattern present in `text`, as { id, match, fix }.
 * An empty array means the text passes the mechanical gate.
 */
function findSlop(text) {
  const source = String(text || '');
  if (!source.trim()) return [];

  const findings = [];
  const seen = new Set();
  const add = (id, match, fix) => {
    const key = `${id}:${String(match).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ id, match: String(match).trim(), fix });
  };

  for (const word of BANNED_WORDS) {
    const hit = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').exec(source);
    if (hit) add('banned-word', hit[0], `"${word}" is banned, use a plain word`);
  }

  for (const phrase of BANNED_PHRASES) {
    const hit = new RegExp(escapeRegExp(phrase), 'i').exec(source);
    if (hit) add('banned-phrase', hit[0], `"${phrase}" is filler, cut it`);
  }

  for (const rule of PATTERN_RULES) {
    const hit = rule.re.exec(source);
    if (hit) add(rule.id, hit[0], rule.fix);
  }

  const colon = COLON_REVEAL_RE.exec(source);
  if (colon) add('colon-reveal', colon[0].trim(), 'colon reveal - rewrite as a plain sentence');

  return findings;
}

/** One line per finding, in the form the model is asked to correct. */
function describeSlop(findings) {
  return (findings || [])
    .map(f => `- ${f.fix}. Found: "${f.match.slice(0, 80)}"`)
    .join('\n');
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

module.exports = {
  NO_AI_SLOP_CONTRACT,
  BANNED_WORDS,
  BANNED_PHRASES,
  findSlop,
  describeSlop,
  wordCount
};
