/**
 * Regression test for cross-book note leakage.
 *
 * Notes were being written into the wrong book: selectedBook / CURRENT_BOOK_ID /
 * currentChapterId all advance the instant a book is clicked, but the editor keeps
 * showing the previous book's text until loadBookContent()'s network round-trip
 * resolves. Any save during that window was attributed to the newly selected book.
 *
 * This pulls the real functions out of index.html (so the test tracks the shipped code,
 * not a copy) and replays the race against a minimal DOM stub.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = path.join(__dirname, '..', 'index.html');
const source = fs.readFileSync(INDEX, 'utf8');

// Pull `function name(...) { ... }` out of the page by brace matching.
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `function ${name} not found in index.html`);
  let depth = 0;
  let seenBrace = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') { depth += 1; seenBrace = true; }
    else if (ch === '}') {
      depth -= 1;
      if (seenBrace && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

function makeEditor() {
  return {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    get innerText() { return String(this._html).replace(/<[^>]*>/g, ' '); },
    focus() {},
    classList: { add() {}, remove() {}, toggle() {} }
  };
}

function buildApp() {
  const editor = makeEditor();
  const apiCalls = [];

  const context = {
    // ── app state ────────────────────────────────────────────────
    chapterNotes: {},
    chapterIds: {},
    chapterCompleted: {},
    selectedBook: null,
    CURRENT_BOOK_ID: null,
    currentChapterId: null,
    _editorBookId: null,
    _editorChapter: null,
    _saveTimer: null,
    IS_LIVE_MODE: true,
    BOOKS: [{ id: 'bookA', title: 'Age of Revolutions' }, { id: 'bookB', title: 'The Complacent Class' }],

    // ── stubs ────────────────────────────────────────────────────
    document: {
      getElementById: id => (id === 'mainNotes' ? editor : { innerHTML: '', value: '', textContent: '', classList: editor.classList, appendChild() {} }),
      querySelectorAll: () => [],
      querySelector: () => ({ innerHTML: '' })
    },
    api: (method, route, body) => { apiCalls.push({ method, route, body }); return Promise.resolve({}); },
    showToast: () => {},
    trackSessionNote: () => {},
    stripHtml: html => String(html).replace(/<[^>]*>/g, ' '),
    renderAccordion: () => {},
    updateChapterDoneBtn: () => {},
    setTimeout: (fn) => { fn(); return 1; },   // run the debounce immediately
    clearTimeout: () => {},
    console
  };

  vm.createContext(context);
  for (const fn of ['setEditorContent', 'clearEditorContent', 'saveCurrentChapter', 'onNotesInput']) {
    vm.runInContext(extractFunction(fn), context);
  }

  return { context, editor, apiCalls };
}

function notesWrittenTo(context, bookId) {
  return context.chapterNotes[bookId] || {};
}

function testTypingIsAttributedToTheOpenBook() {
  const { context, editor, apiCalls } = buildApp();

  context.selectedBook = 'bookA';
  context.CURRENT_BOOK_ID = 'bookA';
  context.currentChapterId = 'Chapter 1';
  vm.runInContext(`setEditorContent('bookA', 'Chapter 1', '<div>Tocqueville as prophet</div>')`, context);

  editor.innerHTML = '<div>Tocqueville as prophet, expanded</div>';
  vm.runInContext('onNotesInput()', context);

  assert.strictEqual(
    notesWrittenTo(context, 'bookA')['Chapter 1'],
    '<div>Tocqueville as prophet, expanded</div>'
  );
  assert.deepStrictEqual(apiCalls.map(c => c.body.book_id), ['bookA']);
  assert.strictEqual(apiCalls[0].body.chapter_name, 'Chapter 1');
}

function testEditorContentCannotBeSavedDuringABookSwitch() {
  const { context, editor, apiCalls } = buildApp();

  // Book A open, editor holding A's notes.
  context.selectedBook = 'bookA';
  context.CURRENT_BOOK_ID = 'bookA';
  context.currentChapterId = 'Chapter 1';
  vm.runInContext(`setEditorContent('bookA', 'Chapter 1', '<div>A notes</div>')`, context);

  // User clicks Book B. selectBook() advances the globals and detaches the editor,
  // then awaits loadBookContent() — this is the vulnerable window.
  vm.runInContext('clearEditorContent()', context);
  context.selectedBook = 'bookB';
  context.CURRENT_BOOK_ID = 'bookB';
  // currentChapterId deliberately left stale at 'Chapter 1', as it is in the real flow.

  apiCalls.length = 0;

  // Anything that fires in this window — a stray input event, a paste, an IME commit —
  // must not be attributed to either book.
  editor.innerHTML = '<div>A notes</div>';
  vm.runInContext('onNotesInput()', context);
  vm.runInContext('saveCurrentChapter()', context);

  assert.deepStrictEqual(notesWrittenTo(context, 'bookB'), {}, 'book B must not receive book A content');
  assert.deepStrictEqual(apiCalls, [], 'no note should be persisted while the editor is detached');
}

function testSavesResumeCorrectlyOnceTheNewBookHasLoaded() {
  const { context, editor, apiCalls } = buildApp();

  vm.runInContext(`setEditorContent('bookA', 'Chapter 1', '<div>A notes</div>')`, context);
  vm.runInContext('clearEditorContent()', context);
  context.selectedBook = 'bookB';
  context.CURRENT_BOOK_ID = 'bookB';

  // loadBookContent resolves and hands the editor to book B.
  vm.runInContext(`setEditorContent('bookB', 'Chapter 3', '')`, context);
  apiCalls.length = 0;

  editor.innerHTML = '<div>Complacent Class notes</div>';
  vm.runInContext('onNotesInput()', context);

  assert.strictEqual(notesWrittenTo(context, 'bookB')['Chapter 3'], '<div>Complacent Class notes</div>');
  assert.strictEqual(notesWrittenTo(context, 'bookA')['Chapter 3'], undefined);
  assert.deepStrictEqual(apiCalls.map(c => ({ b: c.body.book_id, c: c.body.chapter_name })),
    [{ b: 'bookB', c: 'Chapter 3' }]);
}

function testLateSaveGoesToTheBookItWasTypedIn() {
  // The debounce fires after the user has already moved on: it must still land on book A.
  const { context, editor, apiCalls } = buildApp();
  const pending = [];
  context.setTimeout = fn => { pending.push(fn); return 1; };

  vm.runInContext(`setEditorContent('bookA', 'Chapter 8', '')`, context);
  context.selectedBook = 'bookA';
  context.CURRENT_BOOK_ID = 'bookA';
  editor.innerHTML = '<div>Political stagnation</div>';
  vm.runInContext('onNotesInput()', context);

  // Switch to book B before the debounce fires.
  vm.runInContext('clearEditorContent()', context);
  context.selectedBook = 'bookB';
  context.CURRENT_BOOK_ID = 'bookB';
  vm.runInContext(`setEditorContent('bookB', 'Chapter 1', '')`, context);

  pending.forEach(fn => fn());

  assert.strictEqual(apiCalls.length, 1);
  assert.strictEqual(apiCalls[0].body.book_id, 'bookA', 'the pending save belongs to book A');
  assert.strictEqual(apiCalls[0].body.chapter_name, 'Chapter 8');
  assert.strictEqual(apiCalls[0].body.content, '<div>Political stagnation</div>');
}

function testPrototypeModeNeverHitsTheApi() {
  const { context, editor, apiCalls } = buildApp();
  context.IS_LIVE_MODE = false;
  vm.runInContext(`setEditorContent('tfs', 'Chapter 1', '')`, context);
  editor.innerHTML = '<div>sample</div>';
  vm.runInContext('onNotesInput()', context);

  assert.strictEqual(notesWrittenTo(context, 'tfs')['Chapter 1'], '<div>sample</div>');
  assert.deepStrictEqual(apiCalls, [], 'prototype mode must stay offline');
}

// Proves the test above is not vacuous: the pre-fix attribution really did leak.
function testLegacyAttributionWouldHaveLeaked() {
  const context = {
    chapterNotes: {},
    selectedBook: 'bookB',        // already advanced by selectBook()
    currentChapterId: 'Chapter 1' // still stale from book A
  };
  vm.createContext(context);
  vm.runInContext(`
    function legacySave(editorHtml) {
      if (!selectedBook || !currentChapterId) return;
      if (!chapterNotes[selectedBook]) chapterNotes[selectedBook] = {};
      chapterNotes[selectedBook][currentChapterId] = editorHtml;
    }
    legacySave('<div>A notes</div>');
  `, context);

  assert.strictEqual(
    context.chapterNotes.bookB['Chapter 1'],
    '<div>A notes</div>',
    'the old selectedBook/currentChapterId attribution leaks — this is the bug being fixed'
  );
}

// Guards against someone reintroducing a raw editor write that skips provenance.
function testEveryEditorWriteGoesThroughTheProvenanceHelpers() {
  const raw = source
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /mainNotes'?\)?\.innerHTML\s*=/.test(line) || /\bmainNotes\.innerHTML\s*=/.test(line));

  // Only the helper itself may assign the editor's innerHTML directly.
  const offenders = raw.filter(({ line }) => !line.includes("document.getElementById('mainNotes').innerHTML = html || ''"));
  assert.deepStrictEqual(
    offenders.map(o => `${o.n}: ${o.line.trim()}`),
    [],
    'editor content must be set via setEditorContent()/clearEditorContent() so it carries provenance'
  );
}

testTypingIsAttributedToTheOpenBook();
testEditorContentCannotBeSavedDuringABookSwitch();
testSavesResumeCorrectlyOnceTheNewBookHasLoaded();
testLateSaveGoesToTheBookItWasTypedIn();
testPrototypeModeNeverHitsTheApi();
testLegacyAttributionWouldHaveLeaked();
testEveryEditorWriteGoesThroughTheProvenanceHelpers();

console.log('noteAttribution tests passed');
