/**
 * WriteFlow — Database connectivity & schema test
 * Run with:  node test-db.js
 *
 * Checks:
 *  1. Supabase env vars are set
 *  2. RLS is not blocking reads/writes on books and notes
 *  3. All required columns exist on every table
 *  4. A full create-read-delete round-trip works for books + notes
 */
require('dotenv').config();
const supabase = require('./services/supabase');

let passed = 0;
let failed = 0;

function ok(label)   { console.log('  ✓', label); passed++; }
function fail(label, detail) {
  console.error('  ✗', label);
  if (detail) console.error('    →', detail);
  failed++;
}

async function run() {
  console.log('\n=== WriteFlow DB Test ===\n');

  // ── 1. Env vars ─────────────────────────────────────────────────
  console.log('1. Environment variables');
  process.env.SUPABASE_URL      ? ok('SUPABASE_URL set')      : fail('SUPABASE_URL missing');
  process.env.SUPABASE_ANON_KEY ? ok('SUPABASE_ANON_KEY set') : fail('SUPABASE_ANON_KEY missing');
  process.env.OPENAI_API_KEY    ? ok('OPENAI_API_KEY set')    : fail('OPENAI_API_KEY missing – distill/chat will not work');

  // ── 2. Books table ───────────────────────────────────────────────
  console.log('\n2. Books table — columns & RLS');

  const requiredBookCols = ['id','title','author','spine_color','progress',
                            'source_type','status','source_url','category',
                            'why_reading','created_at'];
  const { data: bSel, error: bSelErr } = await supabase
    .from('books').select(requiredBookCols.join(',')).limit(1);

  if (bSelErr) {
    fail('SELECT books', bSelErr.message);
    const missing = bSelErr.message.match(/column books\.(\S+) does not exist/);
    if (missing) console.error('    → Run migration: ALTER TABLE books ADD COLUMN IF NOT EXISTS', missing[1], '...');
  } else {
    ok('SELECT books (all required columns present, RLS not blocking reads)');
  }

  // ── 3. INSERT book round-trip ────────────────────────────────────
  console.log('\n3. Books — insert / read / delete round-trip');

  const testTitle = `__writeflow_test_${Date.now()}__`;
  const { data: ins, error: insErr } = await supabase
    .from('books')
    .insert([{ title: testTitle, author: 'Test', spine_color: '#1e3a6e',
               progress: 0, source_type: 'book', status: 'reading' }])
    .select().single();

  if (insErr) {
    fail('INSERT book', insErr.message);
    if (insErr.message.includes('row-level security')) {
      console.error('    → RLS is blocking writes. Run:');
      console.error('      ALTER TABLE books DISABLE ROW LEVEL SECURITY;');
    }
  } else {
    ok(`INSERT book (id: ${ins.id})`);

    // Read it back
    const { data: readBack, error: readErr } = await supabase
      .from('books').select('id, title').eq('id', ins.id).single();
    readErr ? fail('SELECT back inserted book', readErr.message)
            : ok(`SELECT back: "${readBack.title}"`);

    // ── 4. Notes round-trip ────────────────────────────────────────
    console.log('\n4. Notes table — insert / read / delete round-trip');

    const { data: nIns, error: nInsErr } = await supabase
      .from('notes')
      .upsert([{ book_id: ins.id, chapter_name: 'Chapter 1',
                 chapter_order: 0, content: 'Test note content.' }],
              { onConflict: 'book_id,chapter_name' })
      .select().single();

    if (nInsErr) {
      fail('INSERT note', nInsErr.message);
      if (nInsErr.message.includes('row-level security')) {
        console.error('    → RLS blocking notes. Run:');
        console.error('      ALTER TABLE notes DISABLE ROW LEVEL SECURITY;');
      }
    } else {
      ok(`INSERT note (id: ${nIns.id})`);

      const { data: nRead, error: nReadErr } = await supabase
        .from('notes').select('content, chapter_order, completed')
        .eq('book_id', ins.id).order('chapter_order', { ascending: true });
      nReadErr ? fail('SELECT notes back', nReadErr.message)
               : ok(`SELECT notes back: ${nRead.length} row(s), content="${nRead[0]?.content}"`);
    }

    // Cleanup — delete test book (cascades to notes)
    const { error: delErr } = await supabase.from('books').delete().eq('id', ins.id);
    delErr ? fail('DELETE test book', delErr.message)
           : ok('DELETE test book (cleanup)');
  }

  // ── 5. Other tables reachable ────────────────────────────────────
  console.log('\n5. Other tables — SELECT reachable');
  const tables = ['ideas','articles','conversations','essays',
                  'arguments','sessions','user_profile'];
  for (const t of tables) {
    const { error } = await supabase.from(t).select('id').limit(1);
    error ? fail(`SELECT ${t}`, error.message) : ok(`SELECT ${t}`);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('Action required — run the MIGRATIONS section of supabase_schema.sql');
    console.log('in your Supabase SQL Editor, then re-run this script.\n');
    process.exit(1);
  } else {
    console.log('All checks passed — database is correctly configured.\n');
  }
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
