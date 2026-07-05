const assert = require('assert');
const {
  ESSAY_QUALITY_SYSTEM_PROMPT,
  normalizeEssayProse,
  findEssayQualityIssues
} = require('../services/writingQuality');

function testPromptContainsCoreContract() {
  assert.match(ESSAY_QUALITY_SYSTEM_PROMPT, /continuous argumentative prose/i);
  assert.match(ESSAY_QUALITY_SYSTEM_PROMPT, /final copy-edit pass/i);
  assert.match(ESSAY_QUALITY_SYSTEM_PROMPT, /dangling clauses/i);
}

function testNormalizeEssayProseConvertsListsIntoParagraphs() {
  const raw = [
    '- Power becomes legible only when institutions turn private habits into public incentives',
    '- The second idea extends the first by showing why reform often creates new dependencies'
  ].join('\n');

  const normalized = normalizeEssayProse(raw, { allowHeadings: false });

  assert.doesNotMatch(normalized, /^-/m);
  assert.match(normalized, /public incentives/);
  assert.match(normalized, /\.$/);
}

function testQualityIssuesCatchListAndUnfinishedSentence() {
  const issues = findEssayQualityIssues('- A fragmentary idea without closure');

  assert.ok(issues.some(issue => /list markers/i.test(issue)));
  assert.ok(issues.some(issue => /terminal punctuation/i.test(issue)));
}

function run() {
  testPromptContainsCoreContract();
  testNormalizeEssayProseConvertsListsIntoParagraphs();
  testQualityIssuesCatchListAndUnfinishedSentence();
  console.log('writingQuality tests passed');
}

run();
