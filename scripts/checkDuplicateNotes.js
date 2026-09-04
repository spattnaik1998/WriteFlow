#!/usr/bin/env node
/**
 * npm run check:duplicates              — report notes whose text appears under two books
 * npm run check:duplicates -- --delete <noteId>   — delete one specific duplicate row
 *
 * Reporting is read-only and safe to run while the writing copy is in use.
 *
 * Deletion takes a single note id and refuses anything the report has not identified as a
 * copy, so it cannot be pointed at an arbitrary row, and it will not delete the oldest row
 * in a group — that one is the note that was actually typed. Take a backup first
 * (`npm run backup`); this delete has no undo at the database layer.
 */

require('dotenv').config();
const supabase = require('../services/supabase');
const { fetchAllRows } = require('../services/backup');
const { findCrossBookDuplicates, splitOriginalFromCopies } = require('../services/noteDuplicates');

function parseArgs(argv) {
  const deleteIndex = argv.indexOf('--delete');
  return { deleteId: deleteIndex === -1 ? null : argv[deleteIndex + 1] || null };
}

function describe(note, booksById) {
  const book = booksById.get(note.book_id);
  const when = note.created_at ? new Date(note.created_at).toISOString().slice(0, 16).replace('T', ' ') : 'unknown';
  return `${book ? book.title : note.book_id} / ${note.chapter_name}   created ${when}\n      id ${note.id}`;
}

async function main() {
  const { deleteId } = parseArgs(process.argv.slice(2));

  const [notes, books] = await Promise.all([
    fetchAllRows(supabase, 'notes'),
    fetchAllRows(supabase, 'books')
  ]);
  const booksById = new Map(books.map(b => [b.id, b]));
  const groups = findCrossBookDuplicates(notes);

  if (groups.length === 0) {
    console.log(`\n  No cross-book duplicates among ${notes.length} notes.\n`);
    return;
  }

  console.log(`\n  ${groups.length} note text(s) appear under more than one book:\n`);
  groups.forEach((group, i) => {
    const { original, copies } = splitOriginalFromCopies(group);
    console.log(`  ${i + 1}. ${group.chars} characters — "${group.text.slice(0, 70)}..."`);
    console.log(`     KEEP  ${describe(original, booksById)}`);
    copies.forEach(copy => console.log(`     COPY  ${describe(copy, booksById)}`));
    console.log('');
  });

  if (!deleteId) {
    console.log('  Read-only. To remove one of the rows marked COPY:');
    console.log('    npm run backup');
    console.log('    npm run check:duplicates -- --delete <id>\n');
    return;
  }

  // Only a row this report marked COPY may be deleted — never the original, never a row
  // that is not part of a duplicate group at all.
  const deletable = new Map();
  groups.forEach(group => {
    splitOriginalFromCopies(group).copies.forEach(copy => deletable.set(copy.id, copy));
  });

  const target = deletable.get(deleteId);
  if (!target) {
    console.error(`  Refusing to delete ${deleteId}: it is not listed as a COPY above.`);
    console.error('  Only the newer row of a duplicate pair can be removed this way.\n');
    process.exit(1);
  }

  const { error } = await supabase.from('notes').delete().eq('id', target.id);
  if (error) {
    console.error(`  Delete failed: ${error.message}\n`);
    process.exit(1);
  }
  console.log(`  Deleted ${describe(target, booksById)}\n`);
}

main().catch(error => {
  console.error('check:duplicates failed:', error.message);
  process.exit(1);
});
