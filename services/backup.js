/**
 * Point-in-time snapshot of the Supabase tables.
 *
 * Everything the app stores lives in one Supabase project, reached with the service-role
 * key — which bypasses RLS — and several routes cascade-delete (routes/books.js deletes a
 * book's conversations, articles, ideas, essays and notes before the book itself). There
 * is no undo at the database layer, so a snapshot on disk is the only restore point.
 *
 * The client is injected rather than required, so this is testable without a database and
 * can be pointed at a different project if one is ever added.
 */

// Every table in supabase_schema.sql. Ordered notes-first so the most valuable rows are
// captured even if a later table errors.
const TABLES = [
  'notes',
  'books',
  'ideas',
  'essays',
  'living_ideas',
  'arguments',
  'articles',
  'concept_maps',
  'contradictions',
  'conversations',
  'sessions',
  'user_profile',
  'wiki_pages',
  'wiki_links',
  'wiki_ingest_log'
];

// Supabase caps a select at 1000 rows regardless of what you ask for, so every table has
// to be paged. A book's notes are already in the hundreds.
const PAGE_SIZE = 1000;

async function fetchAllRows(client, table, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

/**
 * Read every table into a plain object. A table that fails is recorded in `errors` rather
 * than aborting the run — a partial snapshot that contains the notes is worth far more
 * than no snapshot because an unrelated table was unreadable.
 */
async function createSnapshot(client, { tables = TABLES, pageSize = PAGE_SIZE } = {}) {
  const snapshot = {
    created_at: new Date().toISOString(),
    schema_version: 1,
    tables: {},
    counts: {},
    errors: {}
  };

  for (const table of tables) {
    try {
      const rows = await fetchAllRows(client, table, pageSize);
      snapshot.tables[table] = rows;
      snapshot.counts[table] = rows.length;
    } catch (error) {
      snapshot.errors[table] = error.message;
    }
  }

  return snapshot;
}

/** Filesystem-safe, sorts chronologically: writeflow-2026-09-04T22-56-01Z.json */
function snapshotFilename(date = new Date()) {
  const stamp = date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `writeflow-${stamp}.json`;
}

/** True when the snapshot is worth keeping — an empty notes table means something broke. */
function isUsableSnapshot(snapshot) {
  return Boolean(snapshot) && Number(snapshot.counts?.notes) > 0;
}

module.exports = {
  TABLES,
  fetchAllRows,
  createSnapshot,
  snapshotFilename,
  isUsableSnapshot
};
