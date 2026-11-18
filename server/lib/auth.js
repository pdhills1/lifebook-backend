const config = require('../config');
const db = require('./db');
const { getAdmin } = require('./supabase');
const { unauthorized, forbidden } = require('./errors');

// Checking a token with Supabase costs a network round trip, and the website saves on every
// pause in typing, so a verified token is remembered briefly.
const TOKEN_TTL_MS = 60 * 1000;
const tokenCache = new Map();

function remember(token, value) {
  if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value);
  tokenCache.set(token, { value, until: Date.now() + TOKEN_TTL_MS });
}
const forget = (token) => tokenCache.delete(token);

const isAdminEmail = (email) => !!email && config.adminEmails.includes(email.toLowerCase());
const nameFrom = (user) =>
  (user.user_metadata?.display_name || '').trim() || (user.email ? user.email.split('@')[0] : 'Author');

/** Finds (or creates) the profile for a signed-in user, keeping role/email in step. */
async function ensureProfile(user) {
  let profile = await db.getProfile(user.id);
  const shouldBeAdmin = isAdminEmail(user.email);
  if (!profile) {
    return db.createProfile({
      id: user.id,
      displayName: nameFrom(user),
      email: user.email || null,
      role: shouldBeAdmin ? 'admin' : 'author',
    });
  }
  const patch = {};
  if (user.email && profile.email !== user.email) patch.email = user.email;
  if (shouldBeAdmin && profile.role !== 'admin') patch.role = 'admin';
  if (Object.keys(patch).length) profile = await db.updateProfile(user.id, patch);
  return profile;
}

async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();

  const hit = tokenCache.get(token);
  if (hit && hit.until > Date.now()) {
    req.user = hit.value;
    req.token = token;
    return next();
  }

  const { data, error } = await getAdmin().auth.getUser(token);
  if (error || !data?.user) {
    forget(token);
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  const profile = await ensureProfile(data.user);
  const user = { id: data.user.id, email: data.user.email, profile };
  remember(token, user);
  req.user = user;
  req.token = token;
  next();
}

function requireAdmin(req, _res, next) {
  if (req.user?.profile?.role !== 'admin') throw forbidden('That page is only for the administrator.');
  next();
}

module.exports = { authenticate, requireAdmin, ensureProfile, forget, isAdminEmail };
