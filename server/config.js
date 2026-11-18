// All settings come from environment variables (set in Render, or a local .env file).
// Old variable names from the first version still work, so nothing needs re-entering.
require('dotenv').config({ quiet: true });

const env = process.env;
const first = (...names) => {
  for (const n of names) if (env[n] && env[n].trim()) return env[n].trim();
  return null;
};
const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const config = {
  port: Number(env.PORT) || 3000,
  productName: first('PRODUCT_NAME') || 'My Story',

  supabaseUrl: first('SUPABASE_URL'),
  secretKey: first('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
  publicKey: first('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'),

  photosBucket: first('PHOTOS_BUCKET') || 'lifebook-photos',
  pdfsBucket: first('PDFS_BUCKET') || 'lifebook-pdfs',

  // People who get the admin page. NOTIFY_ADMIN_EMAIL (old name) is honoured too.
  adminEmails: [...new Set([...list(env.ADMIN_EMAILS), ...list(env.NOTIFY_ADMIN_EMAIL)])],

  // Optional: if set, people must enter this code to create an account.
  inviteCode: first('INVITE_CODE'),

  // Optional: email (password resets + "your book is ready" messages).
  resendKey: first('RESEND_API_KEY'),
  emailFrom: first('EMAIL_FROM') || 'My Story <onboarding@resend.dev>',

  // Public address of the site, used in emails. Render supplies RENDER_EXTERNAL_URL itself.
  appUrl: (first('APP_URL', 'RENDER_EXTERNAL_URL') || '').replace(/\/+$/, '') || null,

  maxPhotoBytes: 20 * 1024 * 1024,
  maxTextChars: 30000,
};

/** Lists anything that is missing, in plain English, for the setup check. */
config.problems = function problems() {
  const out = [];
  if (!config.supabaseUrl) out.push('SUPABASE_URL is not set.');
  if (!config.secretKey) out.push('SUPABASE_SECRET_KEY (the service_role / secret key) is not set.');
  if (!config.publicKey) out.push('SUPABASE_PUBLISHABLE_KEY (the anon / publishable key) is not set.');
  return out;
};

module.exports = config;
