/**
 * Parses Kindle My Clippings.txt content.
 * Returns [{ bookTitle, highlights: [{type, location, text}] }]
 * Pure function — no I/O, no external calls.
 */
function parseKindleClippings(fileText) {
  const text = fileText.replace(/^﻿/, ''); // strip UTF-8/UTF-16 BOM
  const raw = text.split('==========');
  const books = {};

  for (const entry of raw) {
    const lines = entry.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;

    const bookLine = lines[0];
    const metaLine = lines[1];
    if (!bookLine) continue;

    const isHighlight = /highlight/i.test(metaLine);
    const isNote      = /\bnote\b/i.test(metaLine);
    if (!isHighlight && !isNote) continue; // skip bookmarks

    const locMatch = metaLine.match(/location[s]?\s+([\d]+(?:[–\-][\d]+)?)/i);
    const location = locMatch ? locMatch[1] : '';

    const body = lines.slice(2).join(' ').trim();
    if (!body) continue;

    if (!books[bookLine]) books[bookLine] = [];
    books[bookLine].push({
      type:     isHighlight ? 'highlight' : 'note',
      location,
      text:     body
    });
  }

  return Object.entries(books).map(([bookTitle, highlights]) => ({ bookTitle, highlights }));
}

module.exports = { parseKindleClippings };
