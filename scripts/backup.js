#!/usr/bin/env node
/**
 * npm run backup
 *
 * Writes every Supabase table to backups/writeflow-<timestamp>.json. Read-only against the
 * database, so it is safe to run while the writing copy is in use.
 *
 * backups/ is gitignored: these files contain the full text of every note and must never
 * reach GitHub.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');
const { createSnapshot, snapshotFilename, isUsableSnapshot } = require('../services/backup');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

async function main() {
  const snapshot = await createSnapshot(supabase);

  const failed = Object.keys(snapshot.errors);
  if (!isUsableSnapshot(snapshot)) {
    console.error('\n  Refusing to write a snapshot with no notes in it.');
    if (failed.length) {
      failed.forEach(table => console.error(`    ${table}: ${snapshot.errors[table]}`));
    }
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, snapshotFilename(new Date(snapshot.created_at)));
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));

  const sizeMb = (fs.statSync(file).size / (1024 * 1024)).toFixed(1);
  console.log(`\n  Snapshot written: ${path.relative(process.cwd(), file)}  (${sizeMb} MB)\n`);

  Object.entries(snapshot.counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([table, count]) => console.log(`    ${String(count).padStart(6)}  ${table}`));

  if (failed.length) {
    console.log('\n  Tables that could not be read (snapshot is otherwise complete):');
    failed.forEach(table => console.log(`    ${table}: ${snapshot.errors[table]}`));
  }
  console.log('');
}

main().catch(error => {
  console.error('Backup failed:', error.message);
  process.exit(1);
});
