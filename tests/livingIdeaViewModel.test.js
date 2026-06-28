const assert = require('assert');
const view = require('../livingIdeaViewModel');

function fakeRoot(values) {
  return {
    querySelector(selector) {
      const match = selector.match(/data-field="([^"]+)"/);
      return { value: values[match?.[1]] || '' };
    }
  };
}

function testFallbackAndReadOnlyRendering() {
  const fallback = view.fallbackFromIdeaCard({
    ideaId: 'idea-1',
    title: '<Claim>',
    body: 'A dangerous <script> body',
    tags: ['memory', '<tag>']
  });
  const html = view.renderReadOnly(fallback);

  assert.strictEqual(fallback.idea_id, 'idea-1');
  assert.match(html, /older card does not have a living idea record/);
  assert.match(html, /&lt;Claim&gt;/);
  assert.match(html, /A dangerous &lt;script&gt; body/);
  assert.match(html, /&lt;tag&gt;/);
  assert.match(html, /Claim/);
  assert.match(html, /Counterarguments/);
}

function testEditFormAndParsing() {
  const idea = {
    claim: 'Ideas become memory through retrieval.',
    definition: 'A structured claim.',
    mechanism: 'Ask, answer, compress.',
    compressed_principle: 'Memory follows effort.',
    evidence: [{ text: 'Testing beats rereading.' }],
    examples: ['Teach the chapter'],
    boundary_conditions: ['When notes are grounded'],
    counterarguments: ['Fluency can mislead'],
    open_questions: ['How often should review happen?'],
    connection_summary: 'Connects note-taking and mastery.'
  };

  const html = view.renderEditForm(idea);
  assert.match(html, /Ideas become memory through retrieval/);
  assert.match(html, /Testing beats rereading/);

  const parsed = view.parseForm(fakeRoot({
    claim: ' Updated claim ',
    definition: 'Definition',
    mechanism: 'Mechanism',
    compressed_principle: 'Principle',
    evidence: 'Quote one\nQuote two',
    examples: 'Example one\n\nExample two',
    boundary_conditions: 'Boundary',
    counterarguments: 'Counter',
    open_questions: 'Question',
    connection_summary: 'Connection'
  }));

  assert.strictEqual(parsed.claim, 'Updated claim');
  assert.deepStrictEqual(parsed.evidence, [
    { text: 'Quote one', source: '' },
    { text: 'Quote two', source: '' }
  ]);
  assert.deepStrictEqual(parsed.examples, ['Example one', 'Example two']);
  assert.deepStrictEqual(parsed.boundary_conditions, ['Boundary']);
}

function testStatusLabel() {
  assert.strictEqual(view.statusLabel({ mastery: { state: 'needs_review', score: 42.4 } }), 'needs review / 42%');
  assert.strictEqual(view.statusLabel({}), 'new / 0%');
}

testFallbackAndReadOnlyRendering();
testEditFormAndParsing();
testStatusLabel();
console.log('livingIdea view model tests passed');
