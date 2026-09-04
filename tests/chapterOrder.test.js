const assert = require('assert');
const {
  parseChapterNumber,
  sortNotesByChapter,
  sortChapterNames
} = require('../services/chapterOrder');

const names = notes => sortNotesByChapter(notes).map(n => n.chapter_name);

function testParsesChapterNumbersFromRealNames() {
  assert.strictEqual(parseChapterNumber('Chapter 1'), 1);
  assert.strictEqual(parseChapterNumber('Chapter 7: Computing Bounty'), 7);
  assert.strictEqual(parseChapterNumber('Chapter 14 Long-Term Recommendations'), 14);
  assert.strictEqual(parseChapterNumber('Ch. 3 — Moore’s Law'), 3);
  assert.strictEqual(parseChapterNumber('12) Learning to Race with Machines'), 12);
  assert.strictEqual(parseChapterNumber('Introduction'), null);
  assert.strictEqual(parseChapterNumber(''), null);
}

function testChapterNumberIsNotStolenFromProseInTheTitle() {
  // "Chessboard" starts with "Ch" — the number must still come from "Chapter 3".
  assert.strictEqual(
    parseChapterNumber("Chapter 3: Moore's Law and the Second Half of the Chessboard"),
    3
  );
}

function testSortsTheRealBookIntoSequentialOrder() {
  // The exact rows and DB order from the Second Machine Age export, chapter_order all NULL.
  const shuffled = [
    'Chapter 7: Computing Bounty',
    'Chapter 4: Digitization of Everything',
    'Chapter 10: The Biggest Winners',
    'Chapter 1',
    'Chapter 11: Implications of Bounty and Spread',
    'Chapter 15: Tech and the Future',
    'Chapter 12: Learning to Race with Machines',
    'Chapter 2: Skills of the New Machines',
    "Chapter 3: Moore's Law and the Second Half of the Chessboard",
    'Chapter 14 Long-Term Recommendations',
    'Chapter 5: Innovation -- Declining or Recombining',
    'Chapter 13: Policy Recommendations',
    'Chapter 8: Beyond GDP',
    'Chapter 9: The Spread',
    'Chapter 6: Artificial and Human Intelligence in Second Machine Age'
  ].map(chapter_name => ({ chapter_name, chapter_order: null }));

  const ordered = names(shuffled);
  const numbers = ordered.map(n => parseChapterNumber(n));
  assert.deepStrictEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.strictEqual(ordered[0], 'Chapter 1');
  assert.strictEqual(ordered[14], 'Chapter 15: Tech and the Future');
}

function testExplicitChapterOrderWins() {
  const ordered = names([
    { chapter_name: 'Chapter 9: The Spread', chapter_order: null },
    { chapter_name: 'Kindle Highlights', chapter_order: 999 },
    { chapter_name: 'Chapter 2: Skills', chapter_order: null }
  ]);
  assert.deepStrictEqual(ordered, ['Chapter 2: Skills', 'Chapter 9: The Spread', 'Kindle Highlights']);
}

function testZeroMeansUnsetBecauseThatIsTheColumnDefault() {
  // `chapter_order integer default 0` (supabase_schema.sql:26, 203) and nothing in the app
  // ever sets it, so every note written since that column was added arrives as 0. Treating
  // 0 as a real position ties every new chapter at 0 and orders them by creation time —
  // the shuffled export this module exists to prevent.
  const ordered = names([
    { chapter_name: 'Chapter 10: Late chapter', chapter_order: 0, created_at: '2026-09-04T23:17:05.113Z' },
    { chapter_name: 'Introduction', chapter_order: 0, created_at: '2026-09-04T23:17:05.189Z' },
    { chapter_name: 'Chapter 2: Images', chapter_order: 0, created_at: '2026-09-04T23:17:05.340Z' },
    { chapter_name: 'Chapter 1', chapter_order: 0, created_at: '2026-09-04T23:17:05.418Z' },
    { chapter_name: 'Conclusion', chapter_order: 0, created_at: '2026-09-04T23:17:05.481Z' }
  ]);
  assert.deepStrictEqual(ordered, [
    'Introduction',
    'Chapter 1',
    'Chapter 2: Images',
    'Chapter 10: Late chapter',
    'Conclusion'
  ]);
}

function testARealChapterOrderStillOutranksTheNameEvenWhenOthersAreZero() {
  const ordered = names([
    { chapter_name: 'Chapter 9: The Spread', chapter_order: 0 },
    { chapter_name: 'Kindle Highlights', chapter_order: 999 },
    { chapter_name: 'Chapter 2: Skills', chapter_order: 0 }
  ]);
  assert.deepStrictEqual(ordered, ['Chapter 2: Skills', 'Chapter 9: The Spread', 'Kindle Highlights']);
}

function testFrontAndBackMatterBracketTheNumberedChapters() {
  const ordered = names([
    { chapter_name: 'Conclusion', chapter_order: null },
    { chapter_name: 'Chapter 2: Skills', chapter_order: null },
    { chapter_name: 'Introduction', chapter_order: null },
    { chapter_name: 'Chapter 1', chapter_order: null },
    { chapter_name: 'Appendix A', chapter_order: null },
    { chapter_name: 'Preface', chapter_order: null }
  ]);
  // Front and back matter follow conventional book order, not alphabetical order —
  // Preface before Introduction, Conclusion before Appendix.
  assert.deepStrictEqual(ordered, [
    'Preface',
    'Introduction',
    'Chapter 1',
    'Chapter 2: Skills',
    'Conclusion',
    'Appendix A'
  ]);
}

function testChapterMerelyMentioningASectionWordIsNotTreatedAsBackMatter() {
  const ordered = names([
    { chapter_name: 'Indexing strategies for retrieval', chapter_order: null },
    { chapter_name: 'Chapter 1', chapter_order: null }
  ]);
  // "Indexing..." is unnumbered prose, not the book's index: it sorts after Chapter 1
  // but is bucketed as OTHER rather than BACK.
  assert.deepStrictEqual(ordered, ['Chapter 1', 'Indexing strategies for retrieval']);
}

function testUnnumberedChaptersSitBetweenNumberedAndBackMatter() {
  const ordered = names([
    { chapter_name: 'Epilogue', chapter_order: null },
    { chapter_name: 'Scattered thoughts', chapter_order: null },
    { chapter_name: 'Chapter 3: Third', chapter_order: null }
  ]);
  assert.deepStrictEqual(ordered, ['Chapter 3: Third', 'Scattered thoughts', 'Epilogue']);
}

function testTiesFallBackToCreationTimeThenName() {
  const ordered = names([
    { chapter_name: 'Chapter 4: Written second', chapter_order: null, created_at: '2026-08-12T04:13:11Z' },
    { chapter_name: 'Chapter 4: Written first', chapter_order: null, created_at: '2026-08-11T01:58:30Z' }
  ]);
  assert.deepStrictEqual(ordered, ['Chapter 4: Written first', 'Chapter 4: Written second']);
}

function testSortIsPureAndHandlesEmptyInput() {
  const input = [{ chapter_name: 'Chapter 2' }, { chapter_name: 'Chapter 1' }];
  const copy = [...input];
  sortNotesByChapter(input);
  assert.deepStrictEqual(input, copy, 'input array must not be mutated');
  assert.deepStrictEqual(sortNotesByChapter([]), []);
  assert.deepStrictEqual(sortNotesByChapter(null), []);
  assert.deepStrictEqual(sortNotesByChapter(undefined), []);
}

function testSortChapterNamesUsesTheSameRules() {
  assert.deepStrictEqual(
    sortChapterNames(['Chapter 10: Ten', 'General', 'Chapter 2: Two', 'Introduction']),
    ['Introduction', 'Chapter 2: Two', 'Chapter 10: Ten', 'General']
  );
}

function testNumberedChaptersSortNumericallyNotAlphabetically() {
  // The bug a plain string sort would reintroduce: "Chapter 10" before "Chapter 2".
  assert.deepStrictEqual(
    sortChapterNames(['Chapter 10: Ten', 'Chapter 9: Nine', 'Chapter 2: Two']),
    ['Chapter 2: Two', 'Chapter 9: Nine', 'Chapter 10: Ten']
  );
}

testParsesChapterNumbersFromRealNames();
testChapterNumberIsNotStolenFromProseInTheTitle();
testSortsTheRealBookIntoSequentialOrder();
testExplicitChapterOrderWins();
testZeroMeansUnsetBecauseThatIsTheColumnDefault();
testARealChapterOrderStillOutranksTheNameEvenWhenOthersAreZero();
testFrontAndBackMatterBracketTheNumberedChapters();
testChapterMerelyMentioningASectionWordIsNotTreatedAsBackMatter();
testUnnumberedChaptersSitBetweenNumberedAndBackMatter();
testTiesFallBackToCreationTimeThenName();
testSortIsPureAndHandlesEmptyInput();
testSortChapterNamesUsesTheSameRules();
testNumberedChaptersSortNumericallyNotAlphabetically();

console.log('chapterOrder tests passed');
