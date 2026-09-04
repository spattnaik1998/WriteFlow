/**
 * Chapters are stored with a `chapter_order` column, but nothing in the app ever writes
 * it — the notes editor posts only { book_id, chapter_name, content } — so in practice
 * the column is NULL on every row and `ORDER BY chapter_order` returns heap order. Exports
 * came out shuffled (7, 4, 10, 1, 11...) as a result.
 *
 * This module derives a sequential order instead: it honours chapter_order when a row
 * genuinely has one, and otherwise reads the chapter number out of the chapter name.
 *
 * Ordering buckets, in output order:
 *   0  front matter  — Introduction, Preface, Foreword…
 *   1  numbered      — by chapter_order when set, else the number parsed from the name
 *   2  unnumbered    — anything else, alphabetically
 *   3  back matter   — Conclusion, Epilogue, Appendix…
 */

// Listed in the order these sections conventionally appear in a book, so "Conclusion"
// precedes "Appendix" rather than losing to it alphabetically. Position in the array is
// the sort number within the bucket.
const FRONT_MATTER = ['foreword', 'preface', 'prologue', 'introduction', 'intro', 'opening'];
const BACK_MATTER = [
  'conclusion', 'epilogue', 'afterword', 'appendix',
  'glossary', 'bibliography', 'references', 'further reading', 'index'
];

const BUCKET = { FRONT: 0, NUMBERED: 1, OTHER: 2, BACK: 3 };

// Index of the matching section keyword, or -1. Matches only at the start of the name so
// a chapter merely mentioning "references" is not mistaken for the reference list.
function matterRank(name, keywords) {
  const head = String(name).trim().toLowerCase();
  return keywords.findIndex(word => head === word || head.startsWith(`${word} `) ||
    head.startsWith(`${word}:`) || head.startsWith(`${word},`) || head.startsWith(`${word}s `));
}

// "Chapter 7", "Chapter 7: Computing Bounty", "Ch. 7", "Ch 7", "7. Title", "7 — Title".
function parseChapterNumber(chapterName) {
  const name = String(chapterName || '');

  const labelled = /\bch(?:apter|apt|\.)?\s*(\d{1,4})\b/i.exec(name);
  if (labelled) return Number(labelled[1]);

  const leading = /^\s*(\d{1,4})\s*(?:[.):\-–—]|\s)/.exec(name);
  if (leading) return Number(leading[1]);

  return null;
}

function chapterSortKey(note) {
  const name = String(note?.chapter_name || '');
  const explicit = note?.chapter_order;

  // Only a real number counts — null/undefined/'' must fall through to name parsing.
  //
  // 0 falls through too, and that is not the `0 || fallback` bug it looks like: the column
  // is declared `chapter_order integer default 0`, and nothing in the app ever sets it (the
  // editor posts only book_id/chapter_name/content; only the Kindle import writes a value,
  // 999). So every note created since the column was added arrives as 0, meaning "unset".
  // Honouring it would tie every new chapter at position 0 and sort them by creation time,
  // ahead of the front matter — which is the shuffled export this module exists to fix.
  const isSet = explicit !== null && explicit !== undefined && explicit !== '' &&
    Number.isFinite(Number(explicit)) && Number(explicit) !== 0;
  if (isSet) {
    return { bucket: BUCKET.NUMBERED, number: Number(explicit) };
  }

  const parsed = parseChapterNumber(name);
  if (parsed !== null) return { bucket: BUCKET.NUMBERED, number: parsed };

  const front = matterRank(name, FRONT_MATTER);
  if (front !== -1) return { bucket: BUCKET.FRONT, number: front };

  const back = matterRank(name, BACK_MATTER);
  if (back !== -1) return { bucket: BUCKET.BACK, number: back };

  return { bucket: BUCKET.OTHER, number: 0 };
}

function compareNotes(a, b) {
  const keyA = chapterSortKey(a);
  const keyB = chapterSortKey(b);

  if (keyA.bucket !== keyB.bucket) return keyA.bucket - keyB.bucket;
  if (keyA.number !== keyB.number) return keyA.number - keyB.number;

  // Same chapter number (or both unnumbered): fall back to when the note was written,
  // then to the name, so the order is deterministic rather than whatever the DB returned.
  const timeA = Date.parse(a?.created_at || '');
  const timeB = Date.parse(b?.created_at || '');
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) return timeA - timeB;

  return String(a?.chapter_name || '').localeCompare(
    String(b?.chapter_name || ''),
    undefined,
    { numeric: true, sensitivity: 'base' }
  );
}

/** Sort note rows into reading order. Does not mutate the input. */
function sortNotesByChapter(notes) {
  return [...(notes || [])].sort(compareNotes);
}

/** Sort bare chapter-name strings by the same rules (idea cards carry no chapter_order). */
function sortChapterNames(names) {
  return [...(names || [])].sort((a, b) => compareNotes({ chapter_name: a }, { chapter_name: b }));
}

module.exports = {
  parseChapterNumber,
  chapterSortKey,
  compareNotes,
  sortNotesByChapter,
  sortChapterNames
};
