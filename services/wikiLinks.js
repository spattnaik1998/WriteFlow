const LINK_RE = /\[\[([a-z0-9-]+)\]\]/g;

/**
 * Parse [[slug]] links from markdown, returning each with surrounding context.
 * @param {string} markdown
 * @returns {{ slug: string, context: string }[]}
 */
function parseLinks(markdown) {
  if (!markdown) return [];
  const results = [];
  let match;
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(markdown)) !== null) {
    const start   = Math.max(0, match.index - 100);
    const end     = Math.min(markdown.length, match.index + match[0].length + 100);
    const context = markdown.slice(start, end).replace(/\n/g, ' ').trim();
    results.push({ slug: match[1], context });
  }
  return results;
}

/**
 * Replace [[slug]] tokens with clickable anchor tags for frontend rendering.
 * @param {string} markdown
 * @param {Set<string>} existingSlugs  — set of slugs that have wiki pages (for red-link styling)
 * @returns {string}
 */
function renderLinks(markdown, existingSlugs = new Set()) {
  if (!markdown) return '';
  return markdown.replace(/\[\[([a-z0-9-]+)\]\]/g, (_, slug) => {
    const cls = existingSlugs.has(slug) ? 'wiki-link' : 'wiki-link wiki-link--red';
    return `<a class="${cls}" data-slug="${slug}">${slug}</a>`;
  });
}

/**
 * Diff two link arrays and return sets of added/removed slugs for efficient upsert.
 * @param {{ slug: string, context: string }[]} oldLinks
 * @param {{ slug: string, context: string }[]} newLinks
 * @returns {{ added: { slug: string, context: string }[], removed: { slug: string }[] }}
 */
function diffLinkSet(oldLinks, newLinks) {
  const oldSlugs = new Set(oldLinks.map(l => l.slug));
  const newSlugs = new Set(newLinks.map(l => l.slug));

  const added   = newLinks.filter(l => !oldSlugs.has(l.slug));
  const removed = oldLinks.filter(l => !newSlugs.has(l.slug)).map(l => ({ slug: l.slug }));

  return { added, removed };
}

module.exports = { parseLinks, renderLinks, diffLinkSet };
