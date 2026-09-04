/**
 * Finds notes whose text appears under more than one book.
 *
 * The editor used to attribute a save to whatever book was selected at that moment, while
 * the editor still held the previous book's text — so clicking from one book to another
 * could copy a whole chapter into the wrong book. That race is fixed (index.html tracks
 * _editorBookId), but rows written before the fix are still in the database, and nothing
 * in the app surfaces them.
 *
 * Comparison runs on the note's *text*, extracted with the same parser the PDF exporter
 * uses, so two copies that differ only in HTML wrappers (a <div> where the other has a
 * <p>, a stray <span> from a paste) still match. Matching is exact on that text: a
 * fuzzy threshold would start flagging chapters that merely discuss the same subject,
 * which is a judgement call about the writing rather than a mechanical fact.
 */

const crypto = require('crypto');
const { htmlToBlocks } = require('./noteHtml');

/** The note's visible prose, normalised. Images are ignored — only text identifies a leak. */
function noteText(content) {
  return htmlToBlocks(content)
    .filter(block => block.type !== 'image' && block.type !== 'rule')
    .map(block => String(block.text || ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(content) {
  const text = noteText(content);
  if (!text) return null;
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Group notes by identical text, keeping only groups that span more than one book.
 * Two chapters of the *same* book sharing text is a duplicate the user made on purpose
 * (or a copy-paste of their own), not the cross-book leak this looks for.
 *
 * Returns groups sorted with the largest text first — the most consequential leaks.
 */
function findCrossBookDuplicates(notes, { minChars = 40 } = {}) {
  const groups = new Map();

  for (const note of notes || []) {
    const text = noteText(note?.content);
    // Very short notes ("TODO", "n/a") collide by coincidence, not by leakage.
    if (!text || text.length < minChars) continue;

    const key = fingerprint(note.content);
    if (!groups.has(key)) groups.set(key, { fingerprint: key, text, notes: [] });
    groups.get(key).notes.push(note);
  }

  return [...groups.values()]
    .filter(group => new Set(group.notes.map(n => n.book_id)).size > 1)
    .map(group => ({
      ...group,
      chars: group.text.length,
      // Oldest first: the earliest row is the one that was genuinely typed, the later
      // copies are what the race wrote. Ties keep input order.
      notes: [...group.notes].sort((a, b) =>
        (Date.parse(a?.created_at || '') || 0) - (Date.parse(b?.created_at || '') || 0))
    }))
    .sort((a, b) => b.chars - a.chars);
}

/**
 * Within a group, the row to keep and the rows that are copies. The oldest row wins:
 * the leak wrote the *newer* row, always.
 */
function splitOriginalFromCopies(group) {
  const [original, ...copies] = group.notes;
  return { original, copies };
}

module.exports = {
  noteText,
  fingerprint,
  findCrossBookDuplicates,
  splitOriginalFromCopies
};
