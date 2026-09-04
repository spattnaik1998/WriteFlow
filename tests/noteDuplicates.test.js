const assert = require('assert');
const {
  noteText,
  findCrossBookDuplicates,
  findContainedNotes,
  splitOriginalFromCopies
} = require('../services/noteDuplicates');

const LONG = 'Tocqueville read the American experiment as a warning as much as a model, and the chapter turns on that ambiguity.';

function testTextIsComparedWithoutItsHtmlWrappers() {
  // The same text saved from two editor sessions rarely has identical markup.
  assert.strictEqual(
    noteText('<div>Hello&nbsp;world</div>'),
    noteText('<p>Hello world</p>')
  );
}

function testImagesDoNotAffectIdentity() {
  // A pasted screenshot is megabytes of base64; it must not be what decides a match.
  const withImage = `<div>${LONG}</div><div><img src="data:image/png;base64,iVBORw0KGgo="></div>`;
  assert.strictEqual(noteText(withImage), noteText(`<div>${LONG}</div>`));
}

function testFindsTheCrossBookLeak() {
  const groups = findCrossBookDuplicates([
    { id: 'n1', book_id: 'bookA', chapter_name: 'Chapter 1', content: `<div>${LONG}</div>`, created_at: '2026-06-01T10:00:00Z' },
    { id: 'n2', book_id: 'bookB', chapter_name: 'Chapter 1', content: `<p>${LONG}</p>`, created_at: '2026-06-01T10:00:18Z' },
    { id: 'n3', book_id: 'bookC', chapter_name: 'Chapter 4', content: '<div>Something else entirely, at length, so it clears the minimum.</div>' }
  ]);

  assert.strictEqual(groups.length, 1);
  assert.deepStrictEqual(groups[0].notes.map(n => n.id), ['n1', 'n2']);
}

function testDuplicatesWithinOneBookAreNotFlagged() {
  // Same book, two chapters: the user's own copy-paste, not the attribution race.
  const groups = findCrossBookDuplicates([
    { id: 'n1', book_id: 'bookA', chapter_name: 'Chapter 1', content: `<div>${LONG}</div>` },
    { id: 'n2', book_id: 'bookA', chapter_name: 'Chapter 2', content: `<div>${LONG}</div>` }
  ]);
  assert.deepStrictEqual(groups, []);
}

function testShortNotesAreIgnored() {
  // "TODO" under three books is a coincidence, not a leak.
  const groups = findCrossBookDuplicates([
    { id: 'n1', book_id: 'bookA', chapter_name: 'Chapter 1', content: '<div>TODO</div>' },
    { id: 'n2', book_id: 'bookB', chapter_name: 'Chapter 1', content: '<div>TODO</div>' }
  ]);
  assert.deepStrictEqual(groups, []);
}

function testEmptyNotesAreIgnored() {
  const groups = findCrossBookDuplicates([
    { id: 'n1', book_id: 'bookA', chapter_name: 'Chapter 1', content: '' },
    { id: 'n2', book_id: 'bookB', chapter_name: 'Chapter 1', content: '<div><br></div>' }
  ]);
  assert.deepStrictEqual(groups, []);
}

function testTheOldestRowIsTheOneKept() {
  // The race always wrote the *newer* row: the older one is what was actually typed.
  const group = findCrossBookDuplicates([
    { id: 'copy', book_id: 'bookB', chapter_name: 'Chapter 1', content: `<div>${LONG}</div>`, created_at: '2026-06-01T10:00:18Z' },
    { id: 'original', book_id: 'bookA', chapter_name: 'Chapter 1', content: `<div>${LONG}</div>`, created_at: '2026-06-01T10:00:00Z' }
  ])[0];

  const { original, copies } = splitOriginalFromCopies(group);
  assert.strictEqual(original.id, 'original');
  assert.deepStrictEqual(copies.map(c => c.id), ['copy']);
}

function testGroupsAreOrderedByHowMuchTextIsAtStake() {
  const longer = 'x'.repeat(400);
  const groups = findCrossBookDuplicates([
    { id: 'a1', book_id: 'b1', chapter_name: 'C', content: `<div>${LONG}</div>` },
    { id: 'a2', book_id: 'b2', chapter_name: 'C', content: `<div>${LONG}</div>` },
    { id: 'b1', book_id: 'b1', chapter_name: 'D', content: `<div>${longer}</div>` },
    { id: 'b2', book_id: 'b2', chapter_name: 'D', content: `<div>${longer}</div>` }
  ]);
  assert.strictEqual(groups.length, 2);
  assert.ok(groups[0].chars > groups[1].chars, 'biggest leak first');
}

function testHandlesEmptyAndMissingInput() {
  assert.deepStrictEqual(findCrossBookDuplicates([]), []);
  assert.deepStrictEqual(findCrossBookDuplicates(null), []);
  assert.deepStrictEqual(findCrossBookDuplicates(undefined), []);
}

// ── findContainedNotes: the leak often copied a prefix, not the whole chapter ────────

const HOME = LONG + ' It then continues for a long while with material that only ever ' +
  'existed in the chapter the notes actually belong to, which is what makes the shorter ' +
  'row safe to delete.';

function testFindsACopyWhoseTextSurvivesInALongerNoteElsewhere() {
  const found = findContainedNotes([
    { id: 'home', book_id: 'software', chapter_name: 'Chapter 1', content: `<div>${HOME}</div>` },
    { id: 'misfiled', book_id: 'economics', chapter_name: 'Introduction', content: `<p>${LONG}</p>` }
  ]);

  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].note.id, 'misfiled');
  assert.deepStrictEqual(found[0].containers.map(c => c.id), ['home']);
}

function testContainmentIgnoresHtmlDifferences() {
  const found = findContainedNotes([
    { id: 'home', book_id: 'b1', chapter_name: 'C', content: `<div>${HOME}</div>` },
    { id: 'copy', book_id: 'b2', chapter_name: 'C', content: `<p>${LONG}</p><div><img src="data:image/png;base64,iVBORw0KGgo="></div>` }
  ]);
  assert.deepStrictEqual(found.map(f => f.note.id), ['copy']);
}

function testContainmentWithinOneBookIsNotFlagged() {
  // Notes building on each other inside a book are normal writing, not a leak.
  const found = findContainedNotes([
    { id: 'a', book_id: 'same', chapter_name: 'C1', content: `<div>${HOME}</div>` },
    { id: 'b', book_id: 'same', chapter_name: 'C2', content: `<div>${LONG}</div>` }
  ]);
  assert.deepStrictEqual(found, []);
}

function testExactDuplicatesAreNotReportedAsContained() {
  // Equal length is an exact duplicate; findCrossBookDuplicates owns that case because
  // it knows which of the two to keep. Containment must stay strict.
  const found = findContainedNotes([
    { id: 'a', book_id: 'b1', chapter_name: 'C', content: `<div>${LONG}</div>` },
    { id: 'b', book_id: 'b2', chapter_name: 'C', content: `<div>${LONG}</div>` }
  ]);
  assert.deepStrictEqual(found, []);
}

function testShortNotesAreNotSweptUpByContainment() {
  const found = findContainedNotes([
    { id: 'home', book_id: 'b1', chapter_name: 'C', content: `<div>${HOME}</div>` },
    { id: 'tiny', book_id: 'b2', chapter_name: 'C', content: '<div>Tocqueville</div>' }
  ]);
  assert.deepStrictEqual(found, []);
}

function testContainmentHandlesEmptyAndMissingInput() {
  assert.deepStrictEqual(findContainedNotes([]), []);
  assert.deepStrictEqual(findContainedNotes(null), []);
  assert.deepStrictEqual(findContainedNotes(undefined), []);
}

testTextIsComparedWithoutItsHtmlWrappers();
testImagesDoNotAffectIdentity();
testFindsTheCrossBookLeak();
testDuplicatesWithinOneBookAreNotFlagged();
testShortNotesAreIgnored();
testEmptyNotesAreIgnored();
testTheOldestRowIsTheOneKept();
testGroupsAreOrderedByHowMuchTextIsAtStake();
testHandlesEmptyAndMissingInput();

testFindsACopyWhoseTextSurvivesInALongerNoteElsewhere();
testContainmentIgnoresHtmlDifferences();
testContainmentWithinOneBookIsNotFlagged();
testExactDuplicatesAreNotReportedAsContained();
testShortNotesAreNotSweptUpByContainment();
testContainmentHandlesEmptyAndMissingInput();

console.log('noteDuplicates tests passed');
