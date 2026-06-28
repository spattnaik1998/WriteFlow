const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

function makeThenable(value) {
  return {
    then(resolve) {
      return Promise.resolve(resolve(value));
    }
  };
}

function createQuery(table, state) {
  const query = {
    select() { return query; },
    eq(column, value) {
      state.filters.push({ table, column, value });
      return query;
    },
    order() { return query; },
    single() {
      if (table === 'books') return Promise.resolve({ data: state.book, error: null });
      if (table === 'living_ideas') return Promise.resolve({ data: state.singleLivingIdea, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    insert(rows) {
      state.inserts[table] = rows;
      return {
        select() {
          if (table === 'ideas') {
            return Promise.resolve({
              data: rows.map((row, index) => ({ ...row, id: `idea-${index + 1}` })),
              error: null
            });
          }
          if (table === 'living_ideas') {
            return Promise.resolve({
              data: rows.map((row, index) => ({ ...row, id: `living-${index + 1}` })),
              error: null
            });
          }
          return Promise.resolve({ data: rows, error: null });
        }
      };
    },
    update(updates) {
      state.updates[table] = updates;
      return {
        eq() {
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: { id: 'living-1', ...updates }, error: null });
                }
              };
            }
          };
        }
      };
    },
    delete() {
      state.deletes.push(table);
      return {
        eq() {
          return Promise.resolve({ error: null });
        }
      };
    },
    then(resolve) {
      if (table === 'ideas') return Promise.resolve(resolve({ data: state.existingIdeas, error: null }));
      if (table === 'living_ideas') return Promise.resolve(resolve({ data: state.livingIdeasList, error: null }));
      return Promise.resolve(resolve({ data: [], error: null }));
    }
  };
  return query;
}

async function withRoute({ fakeSupabase, fakeEngine }, callback) {
  const supabasePath = path.resolve(__dirname, '../services/supabase.js');
  const enginePath = path.resolve(__dirname, '../services/livingIdeaEngine.js');
  const routePath = path.resolve(__dirname, '../routes/livingIdeas.js');
  delete require.cache[routePath];
  require.cache[supabasePath] = { exports: fakeSupabase };
  require.cache[enginePath] = { exports: fakeEngine };

  const router = require(routePath);
  const app = express();
  app.use(express.json());
  app.use('/api/living-ideas', router);
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete require.cache[routePath];
    delete require.cache[supabasePath];
    delete require.cache[enginePath];
  }
}

async function testDistillRoutePersistsIdeaCardsAndLivingIdeas() {
  const state = {
    book: { id: 'book-1', title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman' },
    existingIdeas: [{ id: 'existing-1', title: 'Existing', body: 'Already here' }],
    livingIdeasList: [],
    singleLivingIdea: null,
    filters: [],
    inserts: {},
    updates: {},
    deletes: []
  };
  const fakeSupabase = { from: table => createQuery(table, state) };
  const fakeEngine = {
    generateLivingIdeas: async () => ({
      ideas: [{
        title: 'The Lazy Verifier',
        body: 'A public card.',
        tags: ['COGNITION'],
        claim: 'System 2 often rubber-stamps System 1.',
        definition: 'A pattern of low verification.',
        mechanism: 'Fluency reduces scrutiny.',
        evidence: [],
        examples: [],
        boundary_conditions: [],
        counterarguments: [],
        open_questions: [],
        compressed_principle: 'Fluency lowers verification pressure.',
        source_fragments: [],
        connection_summary: '',
        mastery: { state: 'new', score: 0 },
        metadata: {}
      }],
      backend: 'test',
      model: 'fake'
    }),
    livingIdeaToIdeaRow: (idea, ctx) => ({
      book_id: ctx.bookId,
      chapter_name: ctx.chapterName,
      title: idea.title,
      body: idea.body,
      tags: idea.tags,
      number: ctx.number,
      next_review_at: ctx.nextReviewAt
    }),
    livingIdeaToDbRow: (idea, ctx) => ({
      idea_id: ctx.ideaId,
      book_id: ctx.bookId,
      chapter_name: ctx.chapterName,
      claim: idea.claim,
      definition: idea.definition,
      mastery: idea.mastery
    })
  };

  await withRoute({ fakeSupabase, fakeEngine }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/living-ideas/distill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_id: 'book-1',
        chapter_name: 'Chapter 1',
        raw_notes: 'System 2 is lazy.'
      })
    });
    const data = await response.json();

    assert.strictEqual(response.status, 201);
    assert.strictEqual(data.idea_cards.length, 1);
    assert.strictEqual(data.living_ideas.length, 1);
    assert.strictEqual(state.inserts.ideas[0].number, 2);
    assert.strictEqual(state.inserts.living_ideas[0].idea_id, 'idea-1');
  });
}

async function testValidation() {
  const state = {
    book: null,
    existingIdeas: [],
    livingIdeasList: [],
    filters: [],
    inserts: {},
    updates: {},
    deletes: []
  };
  const fakeSupabase = { from: table => createQuery(table, state) };
  const fakeEngine = {
    generateLivingIdeas: async () => ({ ideas: [] }),
    livingIdeaToIdeaRow: () => ({}),
    livingIdeaToDbRow: () => ({})
  };

  await withRoute({ fakeSupabase, fakeEngine }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/living-ideas/distill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_id: 'book-1' })
    });
    const data = await response.json();

    assert.strictEqual(response.status, 400);
    assert.match(data.error, /book_id and raw_notes required/);
  });
}

async function run() {
  await testDistillRoutePersistsIdeaCardsAndLivingIdeas();
  await testValidation();
  console.log('livingIdeas route integration tests passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
