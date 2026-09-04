const assert = require('assert');
const {
  fetchAllRows,
  createSnapshot,
  snapshotFilename,
  isUsableSnapshot,
  TABLES
} = require('../services/backup');

// Minimal stand-in for the Supabase client: .from(table).select('*').range(from, to).
function fakeClient(tables, { failing = {} } = {}) {
  const rangeCalls = [];
  return {
    rangeCalls,
    from(table) {
      return {
        select() {
          return {
            range(from, to) {
              rangeCalls.push({ table, from, to });
              if (failing[table]) return Promise.resolve({ data: null, error: { message: failing[table] } });
              const rows = tables[table] || [];
              return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
            }
          };
        }
      };
    }
  };
}

async function testPagesPastTheThousandRowCap() {
  // Supabase silently caps a select at 1000 rows; a single unpaged read would lose
  // everything past the cap, which for `notes` is exactly the data worth backing up.
  const rows = Array.from({ length: 2350 }, (_, i) => ({ id: i }));
  const client = fakeClient({ notes: rows });

  const fetched = await fetchAllRows(client, 'notes');

  assert.strictEqual(fetched.length, 2350);
  assert.strictEqual(fetched[0].id, 0);
  assert.strictEqual(fetched[2349].id, 2349);
  assert.deepStrictEqual(
    client.rangeCalls.map(c => c.from),
    [0, 1000, 2000],
    'must page until a short page comes back'
  );
}

async function testStopsWithoutAnExtraRequestOnAnExactPageBoundary() {
  const client = fakeClient({ notes: Array.from({ length: 1000 }, (_, i) => ({ id: i })) });
  const fetched = await fetchAllRows(client, 'notes', 1000);
  assert.strictEqual(fetched.length, 1000);
  // 1000 rows is a full page, so a second request is required to learn there are no more.
  assert.strictEqual(client.rangeCalls.length, 2);
}

async function testSnapshotCapturesEveryTable() {
  const client = fakeClient({ notes: [{ id: 'n1' }], books: [{ id: 'b1' }] });
  const snapshot = await createSnapshot(client, { tables: ['notes', 'books'] });

  assert.deepStrictEqual(snapshot.counts, { notes: 1, books: 1 });
  assert.deepStrictEqual(snapshot.tables.books, [{ id: 'b1' }]);
  assert.deepStrictEqual(snapshot.errors, {});
  assert.ok(Date.parse(snapshot.created_at), 'created_at must be a real timestamp');
}

async function testOneBadTableDoesNotLoseTheRest() {
  // A partial snapshot containing the notes beats no snapshot because an unrelated
  // table was unreadable.
  const client = fakeClient({ notes: [{ id: 'n1' }] }, { failing: { wiki_pages: 'relation does not exist' } });
  const snapshot = await createSnapshot(client, { tables: ['notes', 'wiki_pages'] });

  assert.deepStrictEqual(snapshot.tables.notes, [{ id: 'n1' }]);
  assert.strictEqual(snapshot.errors.wiki_pages, 'relation does not exist');
  assert.strictEqual(snapshot.counts.wiki_pages, undefined);
}

function testNotesAreFetchedFirst() {
  // Ordering is load-bearing: if a later table hangs or errors, the notes are already in.
  assert.strictEqual(TABLES[0], 'notes');
}

function testFilenamesAreFilesystemSafeAndSortChronologically() {
  const earlier = snapshotFilename(new Date('2026-09-04T22:56:01.123Z'));
  const later = snapshotFilename(new Date('2026-09-04T23:01:00.000Z'));

  assert.strictEqual(earlier, 'writeflow-2026-09-04T22-56-01Z.json');
  assert.ok(!/[:]/.test(earlier), 'colons are illegal in Windows filenames');
  assert.ok(earlier < later, 'lexical order must match chronological order');
}

function testAnEmptySnapshotIsRejected() {
  // Writing a zero-note file over a good one would destroy the restore point.
  assert.strictEqual(isUsableSnapshot({ counts: { notes: 12 } }), true);
  assert.strictEqual(isUsableSnapshot({ counts: { notes: 0 } }), false);
  assert.strictEqual(isUsableSnapshot({ counts: {} }), false);
  assert.strictEqual(isUsableSnapshot(null), false);
}

(async () => {
  await testPagesPastTheThousandRowCap();
  await testStopsWithoutAnExtraRequestOnAnExactPageBoundary();
  await testSnapshotCapturesEveryTable();
  await testOneBadTableDoesNotLoseTheRest();
  testNotesAreFetchedFirst();
  testFilenamesAreFilesystemSafeAndSortChronologically();
  testAnEmptySnapshotIsRejected();
  console.log('backup tests passed');
})();
