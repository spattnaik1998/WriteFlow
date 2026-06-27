const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is missing from .env — get it from Supabase ' +
    'Project Settings → API → service_role (secret), and never commit it.'
  );
}

// Server-side only — the service role key bypasses RLS by design. This is
// the documented Supabase pattern for trusted backends: keep RLS enabled
// and locked down at the DB layer, enforce who's allowed to call this
// server in the API layer instead (see middleware/auth.js).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = supabase;
