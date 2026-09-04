/**
 * Notes are stored as contenteditable HTML, so a pasted screenshot lives in the row as
 * `data:image/png;base64,...`. Sending that column straight to a model bills for hundreds
 * of thousands of tokens of base64, crowds the real notes out of any prompt with a
 * character budget, and tells the model nothing — an image only reaches a model through
 * the vision API, never as text in a prompt.
 *
 * Everything that takes note content out of the database for a model, a relevance score or
 * a word count has to route it through noteToPlainText first. This is a lint over the
 * source: it fails when a new site reads a note's `.content` raw.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Sites that legitimately handle the stored HTML itself rather than text for a model.
const ALLOWED = [
  // The PDF exporter renders the images, so it needs the markup.
  { file: 'routes/export.js', reason: 'renders images into the PDF via htmlToBlocks' },
  // CRUD: reads and writes the column verbatim.
  { file: 'routes/notes.js', reason: 'stores and returns note content unchanged' },
  { file: 'routes/essays.js', reason: 'essay drafts, not note HTML' },
  // Full-text search over the stored column, then the snippet is built for display.
  { file: 'routes/search.js', reason: 'ilike over the stored column' },
  // Loads notes once and converts them there, so every note.content downstream in this
  // file is already plain text. Guarded by testEssayAgentConvertsAtItsSingleLoadPoint.
  { file: 'services/essayAgent.js', reason: 'converts once at its single notes load point' }
];

function sourceFiles() {
  const files = [];
  for (const dir of ['routes', 'services']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (name.endsWith('.js')) files.push(`${dir}/${name}`);
    }
  }
  return files;
}

// A read of note content that is NOT immediately wrapped in a text extractor.
// noteToPlainText is the one for prompts; noteText (services/noteDuplicates.js) is the
// same parse used for comparing notes to each other. Matches n.content / note.content /
// notes.content, the shapes used across the routes.
const RAW_READ = /(?<!noteToPlainText\()(?<!noteText\()\b(?:n|note|notes)\??\.content\b/;

function testNoRouteFeedsStoredHtmlStraightToAModel() {
  const offenders = [];

  for (const file of sourceFiles()) {
    if (ALLOWED.some(a => a.file === file)) continue;

    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.split('//')[0];
      if (!RAW_READ.test(code)) return;
      // Writes into the column, and existence checks that never reach a prompt, are fine.
      if (/\.content\s*=/.test(code)) return;
      if (/\.content\s*\)?\s*(\?\.trim\(\)|\.trim\(\))?\s*\)?\s*(\?|;|\)\s*(continue|return))/.test(code)) return;
      if (/if\s*\(!?/.test(code) && /trim\(\)/.test(code)) return;
      offenders.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'note content must go through noteToPlainText() before reaching a model, a relevance ' +
    'score or a word count:\n  ' + offenders.join('\n  ')
  );
}

function testTheAllowListStaysHonest() {
  // An entry that no longer exists is a stale exemption hiding a real site.
  ALLOWED.forEach(({ file }) => {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `allow-listed file ${file} no longer exists`);
  });
}

function testTheHelperIsActuallyImportedWhereItIsUsed() {
  for (const file of sourceFiles()) {
    if (file === 'services/noteHtml.js') continue; // defines it
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (!source.includes('noteToPlainText(')) continue;
    assert.ok(
      /require\(['"][./]*(?:\.\.\/)?services\/noteHtml['"]\)|require\(['"]\.\/noteHtml['"]\)/.test(source),
      `${file} calls noteToPlainText but never requires it`
    );
  }
}

// The essay agent is exempt from the line-by-line lint because it converts once, up front.
// That exemption is only safe while there is exactly one place notes enter the file.
function testEssayAgentConvertsAtItsSingleLoadPoint() {
  const source = fs.readFileSync(path.join(ROOT, 'services/essayAgent.js'), 'utf8');
  const lines = source.split('\n');

  const loads = lines
    .map((line, i) => ({ line, n: i }))
    .filter(({ line }) => line.includes("from('notes')"));

  assert.strictEqual(
    loads.length, 1,
    'essayAgent must load notes in exactly one place — a second query would bypass the ' +
    'conversion and put stored HTML back into the search index and the prompts'
  );

  const after = lines.slice(loads[0].n, loads[0].n + 25).join('\n');
  assert.ok(
    after.includes('noteToPlainText('),
    'the notes loaded by essayAgent must be converted to text at the load point'
  );
}

testNoRouteFeedsStoredHtmlStraightToAModel();
testTheAllowListStaysHonest();
testTheHelperIsActuallyImportedWhereItIsUsed();
testEssayAgentConvertsAtItsSingleLoadPoint();

console.log('promptHygiene tests passed');
