const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const db = require('../lib/db');
const storage = require('../lib/storage');
const mailer = require('../lib/mailer');
const { getAdmin } = require('../lib/supabase');
const { buildOverview } = require('../lib/progress');
const { pdfPayload } = require('../lib/context');
const { bad, notFound, forbidden } = require('../lib/errors');
const { safeName } = require('./build');

const router = express.Router();

async function summarise(profile, book) {
  const base = {
    userId: profile.id, name: profile.display_name, email: profile.email, role: profile.role, joinedAt: profile.created_at,
    status: 'not_started', title: null, percent: 0, chaptersDone: 0, chaptersTotal: 0, lastActive: null, pdf: null,
  };
  if (!book) return base;
  const overview = buildOverview(await db.loadBookState(book));
  return {
    ...base, title: book.title, status: book.status === 'finished' ? 'finished' : overview.answeredTotal ? 'in_progress' : 'not_started',
    percent: overview.percent, chaptersDone: overview.chaptersDone, chaptersTotal: overview.chaptersTotal,
    lastActive: book.last_active_at || book.updated_at, pdf: pdfPayload(book), pdfReady: !!book.pdf_storage_path && book.pdf_status === 'ready',
  };
}

router.get('/authors', async (_req, res) => {
  const [profiles, books] = await Promise.all([db.listProfiles(), db.listBooks()]);
  const byOwner = Object.fromEntries(books.map((b) => [b.owner_id, b]));
  const out = [];
  // a few at a time, so a big list doesn't flood the database
  for (let i = 0; i < profiles.length; i += 5) {
    out.push(...(await Promise.all(profiles.slice(i, i + 5).map((p) => summarise(p, byOwner[p.id])))));
  }
  res.json({ authors: out });
});

router.get('/authors/:userId/pdf', async (req, res) => {
  const book = await db.getBookByOwner(req.params.userId);
  if (!book?.pdf_storage_path) throw notFound('That book has not been built yet.');
  const profile = await db.getProfile(req.params.userId);
  const url = await storage.signedPdfUrl(book.pdf_storage_path, `${safeName(book.title)} - ${safeName(profile?.display_name)}.pdf`);
  res.json({ url });
});

// A temporary password for someone who is locked out (shown once, so it can be read out or sent).
router.post('/authors/:userId/reset-password', async (req, res) => {
  const profile = await db.getProfile(req.params.userId);
  if (!profile) throw notFound('That person could not be found.');
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters
  const bytes = crypto.randomBytes(12);
  const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
  const { error } = await getAdmin().auth.admin.updateUserById(profile.id, { password });
  if (error) throw bad(error.message);
  res.json({ password });
});

// Removes a person and everything they've written or uploaded.
router.delete('/authors/:userId', async (req, res) => {
  if (req.params.userId === req.user.id) throw forbidden('You can\'t remove your own account from here.');
  const profile = await db.getProfile(req.params.userId);
  if (!profile) throw notFound('That person could not be found.');
  await storage.removeFolder(storage.photos(), profile.id);
  await storage.removeFolder(storage.pdfs(), profile.id);
  const { error } = await getAdmin().auth.admin.deleteUser(profile.id); // database rows cascade from the account
  if (error) throw bad(error.message);
  res.json({ deleted: true });
});

// The "is everything set up properly?" panel.
router.get('/status', async (_req, res) => {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  try { await db.listProfiles(); add('Database', true, 'Connected and the tables are in place.'); }
  catch (e) { add('Database', false, 'Could not read the tables. Have you run setup.sql in Supabase? (' + e.message.slice(0, 120) + ')'); }
  try {
    const { data, error } = await getAdmin().storage.listBuckets();
    if (error) throw error;
    const have = new Set(data.map((b) => b.name));
    const missing = [config.photosBucket, config.pdfsBucket].filter((n) => !have.has(n));
    add('Photo storage', !missing.length, missing.length ? `Missing: ${missing.join(', ')}` : 'Both private storage areas exist.');
  } catch (e) { add('Photo storage', false, 'Could not reach storage: ' + e.message); }

  add('Email', mailer.enabled(), mailer.enabled()
    ? `On (sending from ${config.emailFrom}). Finished books and password resets are emailed.`
    : 'Off. Books can still be downloaded, but nothing is emailed and "forgot password" can\'t send links. Add RESEND_API_KEY to turn it on.');
  add('Administrators', config.adminEmails.length > 0, config.adminEmails.length ? config.adminEmails.join(', ') : 'No ADMIN_EMAILS set, so nobody can see this page.');
  add('Sign-up', true, config.inviteCode ? 'Invite code required.' : 'Open: anyone with the link can create an account. Set INVITE_CODE to restrict this.');
  add('Site address', !!config.appUrl, config.appUrl || 'Not set. Emails will use the address the site is opened from.');
  res.json({ checks });
});

module.exports = router;
