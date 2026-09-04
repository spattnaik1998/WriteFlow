#!/usr/bin/env node
/**
 * npm run dev:sandbox            — create (or refresh) the dev sandbox book
 * npm run dev:sandbox -- --remove  — delete it and its notes
 *
 * A book that exists only for development to write to. The database is shared with the
 * writing copy, and a note save posts the whole chapter and upserts on
 * (book_id, chapter_name) — so testing against a real book can silently overwrite whatever
 * has been typed there since the page loaded. This gives development a write target where
 * that cannot happen.
 *
 * Its chapters are deliberately awkward: out of sequence, front and back matter, an
 * embedded PNG, an unsupported image format, a dead linked image, and a paragraph long
 * enough to force pagination — i.e. every case the PDF exporter has to get right.
 */

require('dotenv').config();
const zlib = require('zlib');
const supabase = require('../services/supabase');

const SANDBOX_TITLE = 'Dev Sandbox (safe to ignore)';
const SANDBOX_AUTHOR = 'WriteFlow development';

// ── A real PNG, built here rather than pasted as a base64 blob, so the fixture is a
//    legible piece of code and the image is big enough to exercise scaling. ──────────
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function makeTestPng(width = 320, height = 180) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour RGB
  // bytes 10-12 stay zero: deflate, adaptive filtering, no interlace

  // One filter byte per row, then RGB triples — a diagonal gradient with a grid, so any
  // squashing or mis-scaling in the export is obvious at a glance.
  const raw = Buffer.alloc(height * (1 + width * 3));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const grid = x % 40 === 0 || y % 40 === 0;
      raw[at++] = grid ? 30 : Math.round((x / width) * 255);
      raw[at++] = grid ? 30 : Math.round((y / height) * 255);
      raw[at++] = grid ? 30 : 140;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const LONG_PARAGRAPH = (
  'This paragraph exists to overflow a page. ' +
  'The exporter now sets real page margins so pdfkit paginates a block of prose instead ' +
  'of running it past the footer, and this is the fixture that proves it. '
).repeat(24);

function chapters() {
  const png = `data:image/png;base64,${makeTestPng().toString('base64')}`;
  return [
    // Deliberately not in sequence in the array — sortNotesByChapter has to fix that.
    ['Chapter 10: Late chapter', `<div>Sorts after chapter 9, not after chapter 1.</div>`],
    ['Introduction', '<div>Front matter. Must come first in the export.</div>'],
    ['Chapter 2: Images', [
      '<div>An embedded PNG, which the exporter should scale to the page width:</div>',
      `<div><img src="${png}" alt="Generated gradient with a 40px grid"></div>`,
      '<div>A format pdfkit cannot embed, which should become a labelled placeholder:</div>',
      '<div><img src="data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==" alt="WebP"></div>',
      '<div>A link that cannot be fetched, which should also degrade to a placeholder:</div>',
      '<div><img src="https://example.invalid/missing.png" alt="Dead link"></div>'
    ].join('')],
    ['Chapter 1', [
      '<h2>Formatting</h2>',
      '<div>A paragraph, then a list, then a quote.</div>',
      '<ul><li>Well-being should survive as one word.</li><li>So should state-of-the-art.</li></ul>',
      '<blockquote><div>A quote inside a div — the block type has to survive the wrapper.</div></blockquote>',
      '<hr>',
      `<div>${LONG_PARAGRAPH}</div>`
    ].join('')],
    ['Conclusion', '<div>Back matter. Must come last in the export.</div>']
  ];
}

async function findSandbox() {
  const { data, error } = await supabase.from('books').select('*').eq('title', SANDBOX_TITLE).limit(1);
  if (error) throw new Error(error.message);
  return data && data[0] ? data[0] : null;
}

async function remove() {
  const book = await findSandbox();
  if (!book) {
    console.log('\n  No sandbox book to remove.\n');
    return;
  }
  await supabase.from('notes').delete().eq('book_id', book.id);
  await supabase.from('ideas').delete().eq('book_id', book.id);
  const { error } = await supabase.from('books').delete().eq('id', book.id);
  if (error) throw new Error(error.message);
  console.log(`\n  Removed "${SANDBOX_TITLE}" and its notes.\n`);
}

async function create() {
  let book = await findSandbox();
  if (!book) {
    const { data, error } = await supabase
      .from('books')
      .insert([{ title: SANDBOX_TITLE, author: SANDBOX_AUTHOR }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    book = data;
    console.log(`\n  Created "${SANDBOX_TITLE}" (${book.id})`);
  } else {
    console.log(`\n  Refreshing "${SANDBOX_TITLE}" (${book.id})`);
  }

  for (const [chapter_name, content] of chapters()) {
    const { error } = await supabase
      .from('notes')
      .upsert([{ book_id: book.id, chapter_name, content }], { onConflict: 'book_id,chapter_name' });
    if (error) throw new Error(`${chapter_name}: ${error.message}`);
    console.log(`    ${chapter_name}`);
  }

  console.log('\n  Test against this book, never against a real one.');
  console.log('  Remove it with: npm run dev:sandbox -- --remove\n');
}

const main = process.argv.includes('--remove') ? remove : create;
main().catch(error => {
  console.error('dev:sandbox failed:', error.message);
  process.exit(1);
});
