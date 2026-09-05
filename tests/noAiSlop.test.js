/**
 * The no-AI-slop mechanical gate.
 *
 * The prompt contract is not testable here — it is text handed to a model. What is
 * testable, and what actually holds the line, is the detector that reads the model's
 * output afterwards. These cases are the patterns from the skill, each with a clean
 * counterexample so the detector does not simply flag everything.
 */

const assert = require('assert');
const {
  NO_AI_SLOP_CONTRACT,
  BANNED_WORDS,
  BANNED_PHRASES,
  findSlop,
  describeSlop,
  wordCount
} = require('../services/noAiSlop');

const ids = text => findSlop(text).map(f => f.id);

function testCleanProseIsNotFlagged() {
  // Concrete, specific, active — the thing the contract asks for. Zero findings, or the
  // gate would reject good writing and the repair pass would make it worse.
  const clean = [
    'Kahneman gave the bat-and-ball problem to students at Princeton, MIT and Harvard.',
    'More than half answered ten cents. He ran it again in 1983 and got the same split.',
    'The students who scored highest on the SAT were no more likely to check their answer.'
  ].join(' ');
  assert.deepStrictEqual(findSlop(clean), []);
}

function testBannedWordsAreCaught() {
  assert.ok(ids('We leverage the framework to delve into the realm of ideas.').includes('banned-word'));
  assert.ok(ids('A robust and transformative approach.').includes('banned-word'));
  // Inflection matters: "delving" and "utilizes" must be caught too.
  assert.ok(ids('He is delving deeper.').includes('banned-word'));
  assert.ok(ids('The system utilizes caching.').includes('banned-word'));
}

function testBannedWordsMatchOnWordBoundaries() {
  // "realm" is banned; "Realmuto" and "beacons" as part of another word must not trip it.
  assert.deepStrictEqual(findSlop('Realmuto caught nine innings.'), []);
  assert.deepStrictEqual(findSlop('The fostering of a child is a legal process.').length > 0, true);
}

function testBannedPhrasesAreCaught() {
  assert.ok(ids("It's worth noting that the number fell.").includes('banned-phrase'));
  assert.ok(ids('At the end of the day, he shipped it.').includes('banned-phrase'));
  assert.ok(ids('This marks a pivotal moment for the field.').includes('banned-phrase'));
}

function testBinaryContrasts() {
  assert.ok(ids("It's not a tool. It's a habit.").includes('binary-contrast'));
  assert.ok(ids('It is not about speed, it is about attention.').includes('binary-contrast'));
  assert.ok(ids("The question isn't the model, it's the eval.").includes('binary-question'));
  assert.ok(ids('Not just faster but cheaper.').includes('not-just-but'));
  // A plain negation is not a binary contrast.
  assert.deepStrictEqual(findSlop('It is not a habit he kept for long.'), []);
}

function testColonRevealsButNotOrdinaryColons() {
  assert.ok(ids('The best part: it learns from every correction you make.').includes('colon-reveal'));
  // A colon introducing a list is legitimate and must pass.
  assert.deepStrictEqual(
    findSlop('He tracked three things: sleep, caffeine and the time he started writing.'),
    []
  );
}

function testSuperficialAnalysisAndPuffery() {
  assert.ok(ids('The launch adds search, highlighting the commitment to workflows.')
    .includes('superficial-analysis'));
  assert.ok(ids('The result stands as a testament to the method.').includes('banned-phrase'));
}

function testWeaselAttribution() {
  assert.ok(ids('Experts agree the effect is real.').includes('weasel-attribution'));
  assert.ok(ids('Studies show a decline.').includes('weasel-attribution'));
  // A named source is the fix, and must pass.
  assert.deepStrictEqual(findSlop('Tversky and Kahneman reported the effect in 1974.'), []);
}

function testSummaryEndingsAndRhetoricalSetups() {
  assert.ok(ids('He shipped it.\nUltimately, the lesson is patience.').includes('summary-ending'));
  assert.ok(ids('What if I told you the opposite was true?').includes('rhetorical-setup'));
}

function testFormattingSlop() {
  assert.ok(ids('The result was clear — and fast.').includes('em-dash'));
  assert.ok(ids('A good result \u{1F680} for the team.').includes('emoji'));
  assert.ok(ids('Worth reading #books').includes('hashtag'));
  assert.ok(ids('Credit to @someone for the idea.').includes('mention'));
  // A hyphen and a colon are not em dashes.
  assert.deepStrictEqual(findSlop('The bat-and-ball problem is well known.'), []);
}

function testMarkdownEmphasisButNotArithmeticOrIdentifiers() {
  // Posts are pasted into X, which renders no markdown: the asterisks show up literally.
  assert.ok(ids('Brynjolfsson wrote *The Second Machine Age* in 2014.').includes('markdown-emphasis'));
  assert.ok(ids('He called it **the great decoupling**.').includes('markdown-emphasis'));
  assert.ok(ids('The _New Division of Labor_ came first.').includes('markdown-emphasis'));
  // A bare multiplication sign and a snake_case identifier must pass.
  assert.deepStrictEqual(findSlop('Multiply 17 * 24 and you get 408.'), []);
  assert.deepStrictEqual(findSlop('The column is called chapter_order in the schema.'), []);
}

function testFindingsCarryTheMatchAndAFix() {
  const [finding] = findSlop('We leverage the data.');
  assert.strictEqual(finding.id, 'banned-word');
  assert.match(finding.match, /leverage/i);
  assert.ok(finding.fix.length > 0, 'a finding must say how to fix it');
}

function testFindingsAreDeduplicated() {
  // The same banned word three times is one finding, so the repair prompt stays short.
  const findings = findSlop('leverage leverage leverage');
  assert.strictEqual(findings.filter(f => /leverage/i.test(f.match)).length, 1);
}

function testDescribeSlopRendersOneLinePerFinding() {
  const text = describeSlop(findSlop('We leverage the tapestry of ideas.'));
  assert.strictEqual(text.split('\n').length, 2);
  assert.ok(text.startsWith('- '));
}

function testEmptyInputIsClean() {
  assert.deepStrictEqual(findSlop(''), []);
  assert.deepStrictEqual(findSlop(null), []);
  assert.deepStrictEqual(findSlop(undefined), []);
  assert.deepStrictEqual(findSlop('   '), []);
}

function testWordCount() {
  assert.strictEqual(wordCount('one two three'), 3);
  assert.strictEqual(wordCount('  spaced   out  '), 2);
  assert.strictEqual(wordCount(''), 0);
  assert.strictEqual(wordCount(null), 0);
}

function testContractNamesThePatternsTheDetectorEnforces() {
  // If a rule is enforced mechanically but never stated in the prompt, the model gets
  // punished for something it was never told. Keep the two halves in sync.
  for (const term of ['binary contrast', 'colon reveal', 'weasel attribution', 'em dash',
                      'delve', 'leverage', 'in conclusion', 'hashtag']) {
    assert.ok(
      NO_AI_SLOP_CONTRACT.toLowerCase().includes(term.toLowerCase()),
      `the contract must mention "${term}", which findSlop enforces`
    );
  }
}

function testBannedListsAreLowercaseAndUnique() {
  for (const list of [BANNED_WORDS, BANNED_PHRASES]) {
    assert.deepStrictEqual(list, list.map(w => w.toLowerCase()), 'entries must be lowercase');
    assert.strictEqual(new Set(list).size, list.length, 'entries must be unique');
  }
}

testCleanProseIsNotFlagged();
testBannedWordsAreCaught();
testBannedWordsMatchOnWordBoundaries();
testBannedPhrasesAreCaught();
testBinaryContrasts();
testColonRevealsButNotOrdinaryColons();
testSuperficialAnalysisAndPuffery();
testWeaselAttribution();
testSummaryEndingsAndRhetoricalSetups();
testFormattingSlop();
testMarkdownEmphasisButNotArithmeticOrIdentifiers();
testFindingsCarryTheMatchAndAFix();
testFindingsAreDeduplicated();
testDescribeSlopRendersOneLinePerFinding();
testEmptyInputIsClean();
testWordCount();
testContractNamesThePatternsTheDetectorEnforces();
testBannedListsAreLowercaseAndUnique();

console.log('noAiSlop tests passed');
