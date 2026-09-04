/**
 * Notes are authored in a contenteditable div and persisted as raw HTML (see
 * onNotesInput / saveCurrentChapter in index.html), so a stored note carries
 * <div>/<br> line structure, inline formatting from the toolbar, whatever markup a
 * paste dragged in — and, the reason this module exists, pasted screenshots and
 * graphs as <img src="data:image/png;base64,...">.
 *
 * htmlToBlocks() flattens that markup into renderer-agnostic blocks so an exporter
 * can lay out paragraphs and images instead of spilling the tags (and megabytes of
 * base64) onto the page as literal text.
 *
 * Block shapes:
 *   { type: 'paragraph' | 'bullet' | 'quote', text }
 *   { type: 'heading', level, text }
 *   { type: 'rule' }
 *   { type: 'image', mime, data: Buffer, alt }   — inline data: URI, decoded
 *   { type: 'image', url, alt }                  — external src, caller must fetch
 *   { type: 'image', alt, error }                — unusable src, caller shows a note
 */

// Tags that end the current run of text. Only the ones that also imply a *kind* of
// block (headings, list items, quotes) set a type; the rest just break the line.
const TYPED_TAGS = {
  h1: 'heading', h2: 'heading', h3: 'heading',
  h4: 'heading', h5: 'heading', h6: 'heading',
  li: 'bullet',
  blockquote: 'quote'
};

const BREAKING_TAGS = new Set([
  'div', 'p', 'br', 'ul', 'ol', 'dl', 'dt', 'dd', 'pre', 'section', 'article',
  'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption'
]);

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', middot: '·', times: '×', deg: '°',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£'
};

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
const LIST_MARKER_RE = /^\s*(?:[-*+•●▪]\s+|\d+[.)]\s+)/;

function decodeEntities(text) {
  return String(text).replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch (_error) {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

// contenteditable carries no meaningful whitespace of its own — line structure lives in
// the tags — so every run of spacing (non-breaking spaces included) collapses to one space.
function collapse(text) {
  return decodeEntities(text).replace(/[\s ]+/g, ' ').trim();
}

function readAttribute(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = re.exec(attrs || '');
  if (!match) return '';
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
}

function imageBlockFromTag(attrs) {
  const alt = collapse(readAttribute(attrs, 'alt'));
  const src = readAttribute(attrs, 'src').trim();

  if (!src) return { type: 'image', alt, error: 'Image has no source' };

  const dataUri = /^data:([a-z0-9.+/-]*);base64,([\s\S]*)$/i.exec(src);
  if (dataUri) {
    const mime = (dataUri[1] || '').toLowerCase() || 'application/octet-stream';
    let data = null;
    try {
      data = Buffer.from(dataUri[2].replace(/\s+/g, ''), 'base64');
    } catch (_error) {
      data = null;
    }
    if (!data || !data.length) {
      return { type: 'image', mime, alt, error: 'Image data could not be decoded' };
    }
    return { type: 'image', mime, data, alt };
  }

  if (/^https?:\/\//i.test(src)) return { type: 'image', url: src, alt };

  // blob: and file: srcs only resolve in the browser session that made them.
  return { type: 'image', alt, error: 'Image source is not readable outside the browser' };
}

// Notes saved before the editor became rich text are plain strings. Treat markers only at
// the start of a line: the old exporter split on any '-' anywhere, which shredded ordinary
// hyphenated words ("well-being") into separate bullets.
function plainTextToBlocks(text) {
  const blocks = [];
  String(text).split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (LIST_MARKER_RE.test(trimmed)) {
      const body = collapse(trimmed.replace(LIST_MARKER_RE, ''));
      if (body) blocks.push({ type: 'bullet', text: body });
      return;
    }
    const body = collapse(trimmed);
    if (body) blocks.push({ type: 'paragraph', text: body });
  });
  return blocks;
}

function htmlToBlocks(input) {
  const raw = String(input || '');
  if (!raw.trim()) return [];
  if (!/<[a-z!/]/i.test(raw)) return plainTextToBlocks(raw);

  // Word and web pastes bring along comments, doctypes and <style> blocks whose contents
  // would otherwise read as body text.
  const html = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[[\s\S]*?\]>/g, '')
    .replace(/<![^>]*>/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  const blocks = [];
  let buffer = '';
  let pendingType = null;
  let headingLevel = 2;

  // Emit whatever text has accumulated. When the buffer is empty the pending type is
  // *kept*, so an opening <blockquote> followed by an inner <div> does not lose the quote.
  const flush = () => {
    const text = collapse(buffer);
    buffer = '';
    if (!text) return;
    if (pendingType === 'heading') blocks.push({ type: 'heading', level: headingLevel, text });
    else if (pendingType === 'bullet') blocks.push({ type: 'bullet', text });
    else if (pendingType === 'quote') blocks.push({ type: 'quote', text });
    else blocks.push({ type: 'paragraph', text });
    pendingType = null;
  };

  let cursor = 0;
  let match;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(html)) !== null) {
    buffer += html.slice(cursor, match.index);
    cursor = TAG_RE.lastIndex;

    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3] || '';

    if (tag === 'img') {
      if (!closing) {
        flush();
        blocks.push(imageBlockFromTag(attrs));
      }
      continue;
    }

    if (tag === 'hr') {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }

    const typed = TYPED_TAGS[tag];
    if (typed) {
      flush();
      if (!closing) {
        pendingType = typed;
        if (typed === 'heading') headingLevel = Number(tag[1]) || 2;
      }
      continue;
    }

    if (BREAKING_TAGS.has(tag)) flush();
    // Everything else (b, i, u, span, font, a, code, sub, sup…) is inline: its text
    // flows into the current block and the tag itself is dropped.
  }
  buffer += html.slice(cursor);
  flush();

  return blocks;
}

module.exports = {
  htmlToBlocks,
  plainTextToBlocks
};
