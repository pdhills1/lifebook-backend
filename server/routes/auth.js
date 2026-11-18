const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { getAdmin, getAnon } = require('../lib/supabase');
const { authenticate, ensureProfile, forget } = require('../lib/auth');
const mailer = require('../lib/mailer');
const { bad, conflict, forbidden, unauthorized } = require('../lib/errors');

const router = express.Router();

// Slow down guessing of passwords / invite codes.
const limiter = (max, minutes = 15) =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const sameSecret = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

function sessionPayload(session, user) {
  return {
    session: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at, // seconds since 1970
    },
    user: { id: user.id, email: user.email },
  };
}

async function signIn(email, password) {
  const { data, error } = await getAnon().auth.signInWithPassword({ email, password });
  if (error || !data?.session) throw unauthorized('That email and password don\'t match. Please try again.');
  return data;
}

router.post('/signup', limiter(20), async (req, res) => {
  const name = clean(req.body?.name);
  const email = clean(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (config.inviteCode && !sameSecret(clean(req.body?.inviteCode), config.inviteCode)) {
    throw forbidden('That invite code isn\'t right. Please check it with the person who invited you.');
  }
  if (!name || name.length > 80) throw bad('Please tell us your name.');
  if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email address.');
  if (password.length < 8) throw bad('Please choose a password with at least 8 characters.');

  // The server creates the account itself, which avoids Supabase's confirmation-email step
  // (and its strict email rate limit). The invite code is what keeps strangers out.
  const { error } = await getAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      throw conflict('There\'s already an account with that email. Try signing in instead.');
    }
    throw bad(error.message);
  }
  const data = await signIn(email, password);
  await ensureProfile(data.user);
  res.status(201).json(sessionPayload(data.session, data.user));
});

router.post('/login', limiter(30), async (req, res) => {
  const email = clean(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) throw bad('Please enter your email and password.');
  const data = await signIn(email, password);
  res.json(sessionPayload(data.session, data.user));
});

router.post('/refresh', limiter(300), async (req, res) => {
  const refreshToken = clean(req.body?.refreshToken);
  if (!refreshToken) throw unauthorized();
  const { data, error } = await getAnon().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) throw unauthorized('Your session has expired. Please sign in again.');
  res.json(sessionPayload(data.session, data.user));
});

router.post('/forgot', limiter(6, 60), async (req, res) => {
  const email = clean(req.body?.email).toLowerCase();
  // Always answer the same way, so this can't be used to find out who has an account.
  const reply = { ok: true, emailEnabled: mailer.enabled() };
  if (!EMAIL_RE.test(email) || !mailer.enabled()) return res.json(reply);

  const redirectTo = config.appUrl || `${req.protocol}://${req.get('host')}`;
  const { data, error } = await getAdmin().auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
  const link = data?.properties?.action_link;
  if (!error && link) {
    await mailer.send({
      to: email,
      subject: `Reset your ${config.productName} password`,
      text: `Use this link to choose a new password: ${link}\n\nIf you didn't ask for this, you can ignore this email.`,
      html: mailer.layout(
        'Choose a new password',
        `<p>Someone (hopefully you) asked to reset the password for this account.</p>${mailer.button(link, 'Choose a new password')}
         <p style="font-size:13px;color:#6D6356">If you didn't ask for this, you can safely ignore this email.</p>`
      ),
    });
  }
  res.json(reply);
});

// Used after following the emailed link: the link signs the person in briefly, and this sets the password.
router.post('/set-password', authenticate, async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password.length < 8) throw bad('Please choose a password with at least 8 characters.');
  const { error } = await getAdmin().auth.admin.updateUserById(req.user.id, { password });
  if (error) throw bad(error.message);
  res.json({ ok: true });
});

router.post('/logout', authenticate, (req, res) => {
  forget(req.token);
  res.json({ ok: true });
});

module.exports = router;
