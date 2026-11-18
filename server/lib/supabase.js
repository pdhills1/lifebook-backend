// Two Supabase clients:
//  - admin: uses the secret key. Only ever used on the server. Bypasses row-level security,
//           so every route checks ownership itself.
//  - anon:  uses the publishable key. Used only to check passwords at sign-in.
// The browser never talks to Supabase directly, so no keys are ever sent to it.
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let admin = null;
let anon = null;

const opts = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

function getAdmin() {
  if (!admin) admin = createClient(config.supabaseUrl, config.secretKey, opts);
  return admin;
}
function getAnon() {
  if (!anon) anon = createClient(config.supabaseUrl, config.publicKey, opts);
  return anon;
}
/** Used by the automated tests to swap in a fake. */
function __setClients(clients) {
  admin = clients.admin;
  anon = clients.anon;
}

module.exports = { getAdmin, getAnon, __setClients };
