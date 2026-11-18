// Email is optional. Without a RESEND_API_KEY everything still works; the site just
// skips the emails and says so where it matters (e.g. the "forgot password" screen).
const config = require('../config');

let client = null;
const enabled = () => !!config.resendKey;

function getClient() {
  if (!client) {
    const { Resend } = require('resend');
    client = new Resend(config.resendKey);
  }
  return client;
}

/** Never throws: returns { ok, error }. A failed email must not break the thing that triggered it. */
async function send({ to, subject, html, text, attachments }) {
  if (!enabled()) return { ok: false, error: 'Email is not set up.' };
  try {
    const res = await getClient().emails.send({ from: config.emailFrom, to, subject, html, text, attachments });
    if (res?.error) return { ok: false, error: res.error.message || String(res.error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A simple, readable email shell (inline styles only, as email clients require). */
function layout(title, bodyHtml) {
  return `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:28px;color:#2A2520;line-height:1.6">
  <h1 style="font-size:24px;margin:0 0 16px;color:#2E5E4E">${esc(title)}</h1>${bodyHtml}
  <p style="margin-top:32px;font-size:12px;color:#6D6356">${esc(config.productName)}</p></div>`;
}
const button = (href, label) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#2E5E4E;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">${esc(label)}</a></p>`;

module.exports = { enabled, send, layout, button, esc };
