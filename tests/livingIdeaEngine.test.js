const assert = require('assert');
const {
  generateLivingIdeas,
  livingIdeaToDbRow,
  livingIdeaToIdeaRow,
  normalizeLivingIdea
} = require('../services/livingIdeaEngine');

async function testNormalizeLivingIdea() {
  const idea = normalizeLivingIdea({
    title: 'Why Fluency Masquerades as Truth',
    tags: ['cognition', 'behavior'],
    claim: 'System 2 often endorses fluent System 1 answers.',
    evidence: ['The bat-and-ball example shows intuitive error.'],
    examples: [{ text: 'A clean slogan can feel true before it is checked.' }],
    boundaries: ['High-stakes reviews can override the pattern.'],
    objections: ['Some intuitions are trained expertise.'],
    confidence: '0.82'
  });

  assert.strictEqual(idea.title, 'Why Fluency Masquerades as Truth');
  assert.deepStrictEqual(idea.tags, ['COGNITION', 'BEHAVIOR']);
  assert.strictEqual(idea.evidence[0].text, 'The bat-and-ball example shows intuitive error.');
  assert.strictEqual(idea.boundary_conditions[0], 'High-stakes reviews can override the pattern.');
  assert.strictEqual(idea.counterarguments[0], 'Some intuitions are trained expertise.');
  assert.strictEqual(idea.mastery.state, 'new');
  assert.strictEqual(idea.metadata.confidence, 0.82);
}

async function testGenerateLivingIdeasWithInjectedModel() {
  const calls = [];
  const result = await generateLivingIdeas({
    bookTitle: 'Thinking, Fast and Slow',
    author: 'Daniel Kahneman',
    chapterName: 'The Lazy Controller',
    rawNotes: 'System 2 is lazy and often accepts System 1 answers.',
    existingIdeas: [{ title: 'Old idea', body: 'Avoid duplication.' }],
    generateJsonFn: async (opts) => {
      calls.push(opts);
      return {
        backend: 'test',
        model: 'fake-json',
        data: {
          living_ideas: [{
            title: 'The Lazy Verifier',
            body: 'System 2 often acts less like a supervisor than a rubber stamp.',
            tags: ['cognition'],
            claim: 'Deliberate thought frequently endorses intuitive impressions.',
            definition: 'A pattern where expensive reasoning arrives after intuition.',
            mechanism: 'Fluent answers feel correct, reducing the trigger for scrutiny.',
            evidence: [{ text: 'Bat-and-ball error', source: 'chapter notes' }],
            examples: ['Misreading a simple math puzzle'],
            boundary_conditions: ['When explicit checking is required'],
            counterarguments: ['Experts can rely on trained intuition'],
            compressed_principle: 'Fluency lowers verification pressure.'
          }]
        }
      };
    }
  });

  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].systemPrompt, /Living Idea Distillation Engine/);
  assert.strictEqual(result.backend, 'test');
  assert.strictEqual(result.ideas.length, 1);
  assert.strictEqual(result.ideas[0].claim, 'Deliberate thought frequently endorses intuitive impressions.');
}

async function testRowMapping() {
  const idea = normalizeLivingIdea({
    title: 'The Lazy Verifier',
    body: 'A public card.',
    claim: 'A claim.',
    definition: 'A definition.'
  });
  const ideaRow = livingIdeaToIdeaRow(idea, {
    bookId: 'book-1',
    chapterName: 'Chapter 1',
    number: 3,
    nextReviewAt: '2026-01-01T00:00:00.000Z'
  });
  const dbRow = livingIdeaToDbRow(idea, {
    ideaId: 'idea-1',
    bookId: 'book-1',
    chapterName: 'Chapter 1'
  });

  assert.strictEqual(ideaRow.title, 'The Lazy Verifier');
  assert.strictEqual(ideaRow.number, 3);
  assert.strictEqual(dbRow.idea_id, 'idea-1');
  assert.strictEqual(dbRow.claim, 'A claim.');
  assert.strictEqual(dbRow.mastery.state, 'new');
}

async function run() {
  await testNormalizeLivingIdea();
  await testGenerateLivingIdeasWithInjectedModel();
  await testRowMapping();
  console.log('livingIdeaEngine tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
