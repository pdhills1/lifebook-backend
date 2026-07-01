const { createClient } = require('@supabase/supabase-js');

// The backend uses the SERVICE ROLE key, which bypasses Row Level Security.
// This is intentional and safe ONLY because every route below manually
// checks that the calling user owns the data they're touching (or is an
// admin) before running any query. RLS in the database remains as a second
// independent safety net in case a bug ever lets a bad query through.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = { supabaseAdmin };
