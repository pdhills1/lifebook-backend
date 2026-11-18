// Building the PDF. "Preview" makes a draft any time; "finish" makes the final book,
// marks the book finished and emails it. The work runs in the background and the website polls for the result.
const express = require('express');
const config = require('../config');
const db = require('../lib/db');
const storage = require('../lib/storage');
const mailer = require('../lib/mailer');
const { withBook, bookPayload, pdfPayload, overviewFor, touch } = require('../lib/context');
const { assembleBookContent } = require('../pdf/assemble');
const { renderBookPdf } = require('../pdf/render');
const { conflict, invalid, notFound } = require('../lib/errors');

const router = express.Router();
router.use(withBook);

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // keeps the email under typical provider limits
const safeName = (s) => String(s || 'My Story').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'My Story';

async function notifyFinished({ book, profile, email, buffer, appUrl, isUpdate }) {
  const filename = `${safeName(book.title)}.pdf`;
  const attachments = buffer.length <= MAX_ATTACHMENT_BYTES ? [{ filename, content: buffer }] : undefined;
  const sizeNote = attachments ? '' : '<p>The book is too large to attach, so please download it from the website.</p>';
  const open = appUrl ? mailer.button(appUrl, 'Open your book') : '';
  let authorOk = false;

  if (email) {
    const res = await mailer.send({
      to: email,
      subject: isUpdate ? `Your updated book is ready: ${book.title}` : `Your book is ready: ${book.title}`,
      text: `Your book "${book.title}" is ready - the PDF is attached (or download it from the website).`,
      html: mailer.layout('Your book is ready', `<p>Hello ${mailer.esc(profile.display_name)},</p>
        <p>Your book <strong>${mailer.esc(book.title)}</strong> has been put together. The finished PDF is attached to this email.</p>${sizeNote}${open}
        <p style="font-size:13px;color:#6D6356">You can carry on making changes at any time and create a new copy whenever you like.</p>`),
      attachments,
    });
    authorOk = res.ok;
    if (!res.ok) console.warn('Author email failed:', res.error);
  }
  for (const to of config.adminEmails.filter((a) => a !== (email || '').toLowerCase())) {
    const res = await mailer.send({
      to,
      subject: `${profile.display_name} has finished their book`,
      text: `${profile.display_name} (${email || 'no email'}) has ${isUpdate ? 'updated' : 'finished'} their book "${book.title}". The PDF is attached.`,
      html: mailer.layout(`${mailer.esc(profile.display_name)} has finished their book`,
        `<p><strong>${mailer.esc(book.title)}</strong> ${isUpdate ? 'has been updated' : 'is complete'}. The PDF is attached${attachments ? '' : ' (too large - download it from the admin page)'}.</p>${appUrl ? mailer.button(appUrl, 'Open the admin page') : ''}`),
      attachments,
    });
    if (!res.ok) console.warn('Admin email failed:', res.error);
  }
  return authorOk;
}

async function runBuild({ bookId, profile, email, final, appUrl }) {
  try {
    const book = await db.getBook(bookId);
    const wasFinished = book.status === 'finished';
    const { content, warnings } = await assembleBookContent(book, profile);
    const { buffer, warnings: renderWarnings } = await renderBookPdf(content);
    const path = `${book.owner_id}/book.pdf`;
    await storage.upload(storage.pdfs(), path, buffer, 'application/pdf');

    const now = new Date().toISOString();
    const patch = { pdf_status: 'ready', pdf_storage_path: path, pdf_built_at: now, pdf_error: null, pdf_is_final: final };
    if (final) Object.assign(patch, { status: 'finished', finished_at: book.finished_at || now });
    const updated = await db.updateBook(bookId, patch);
    if (warnings.length || renderWarnings.length) console.warn('Book built with notes:', [...warnings, ...renderWarnings]);

    if (final) {
      const emailed = await notifyFinished({ book: updated, profile, email, buffer, appUrl, isUpdate: wasFinished });
      if (emailed) await db.updateBook(bookId, { pdf_emailed_at: new Date().toISOString() });
    }
  } catch (err) {
    console.error(`Book build failed for ${bookId}:`, err);
    await db.updateBook(bookId, { pdf_status: 'failed', pdf_error: 'Something went wrong while building the book. Please try again in a moment.' }).catch(() => {});
  }
}

router.post('/book/build', async (req, res) => {
  const final = req.body?.final === true;
  const current = pdfPayload(req.book);
  if (current.status === 'building') return res.status(202).json({ pdf: current });

  if (final) {
    const { overview } = await overviewFor(req.book.id);
    if (!overview.allDone) {
      const todo = overview.chapters.filter((c) => !c.done).map((c) => c.title);
      throw invalid('A few chapters still need their key questions answered before the book can be finished.', { todo });
    }
  }
  const updated = await db.updateBook(req.book.id, {
    pdf_status: 'building', pdf_error: null, pdf_requested_at: new Date().toISOString(),
  });
  const appUrl = config.appUrl || `${req.protocol}://${req.get('host')}`;
  setImmediate(() => runBuild({ bookId: req.book.id, profile: req.user.profile, email: req.user.email, final, appUrl }));
  res.status(202).json({ pdf: pdfPayload(updated) });
});

router.get('/book/build-status', async (req, res) => {
  const book = await db.getBook(req.book.id);
  const pdf = pdfPayload(book);
  let url = null;
  if (pdf.status === 'ready' && book.pdf_storage_path) {
    url = await storage.signedPdfUrl(book.pdf_storage_path, `${safeName(book.title)}.pdf`);
  }
  res.json({ book: bookPayload(book), pdf, url, emailEnabled: mailer.enabled() });
});

module.exports = router;
module.exports.safeName = safeName;
