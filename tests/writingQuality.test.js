const assert = require('assert');
const {
  ESSAY_QUALITY_SYSTEM_PROMPT,
  normalizeEssayProse,
  findEssayQualityIssues,
  normalizeEvaluationReport
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

function testNormalizeEvaluationReportAppliesRubricGate() {
  const report = normalizeEvaluationReport({
    passed: true,
    scores: {
      synthesis_depth: 4.2,
      evidence_grounding: 3.2,
      paragraph_flow: 4,
      grammar_polish: 5
    },
    strengths: ['The draft has a clear argumentative spine.'],
    revision_priorities: ['Tie the second paragraph back to the source evidence.']
  }, {
    draftText: 'This is a clean paragraph, but it needs one more grounded example.',
    threshold: 3.5,
    evaluatedAt: '2026-07-05T00:00:00.000Z'
  });

  assert.strictEqual(report.passed, false);
  assert.strictEqual(report.scores.evidence_grounding, 3.2);
  assert.ok(report.blocking_issues.some(issue => /evidence grounding/i.test(issue)));
  assert.strictEqual(report.evaluated_at, '2026-07-05T00:00:00.000Z');
}
function run() {
  testPromptContainsCoreContract();
  testNormalizeEssayProseConvertsListsIntoParagraphs();
  testQualityIssuesCatchListAndUnfinishedSentence();
  testNormalizeEvaluationReportAppliesRubricGate();
  console.log('writingQuality tests passed');
}

run();
