const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { generateBookPdf } = require('../lib/pdf-generator'); // built in the next stage
const { sendBookFinishedEmails } = require('../lib/email');

const router = express.Router();

// POST /api/book/finish
router.post('/book/finish', async (req, res) => {
  const { data: book, error } = await supabaseAdmin
    .from('books')
    .select('*')
    .eq('owner_id', req.user.id)
    .maybeSingle();

  if (error || !book) {
    return res.status(404).json({ error: 'Book not found' });
  }

  await supabaseAdmin
    .from('books')
    .update({ status: 'finished', finished_at: new Date().toISOString() })
    .eq('id', book.id);

  // Respond immediately — PDF generation can take a while with photos
  // embedded, so we don't block the HTTP request on it.
  res.status(202).json({ status: 'generating', bookId: book.id });

  // Fire-and-forget background work. Errors are logged, not thrown, since
  // the HTTP response has already been sent.
  (async () => {
    try {
      const pdfStoragePath = await generateBookPdf(book.id);
      await supabaseAdmin
        .from('books')
        .update({ pdf_storage_path: pdfStoragePath })
        .eq('id', book.id);
      await sendBookFinishedEmails({
        authorEmail: req.user.email,
        authorName: req.user.profile.display_name,
        bookId: book.id,
        pdfStoragePath,
      });
    } catch (err) {
      console.error(`PDF generation failed for book ${book.id}:`, err);
      // pdf_storage_path stays null; pdf-status endpoint reports "failed"
      // by checking status === 'finished' && pdf_storage_path === null
      // alongside a generated_at timestamp older than a short grace window.
    }
  })();
});

// GET /api/book/pdf-status
router.get('/book/pdf-status', async (req, res) => {
  const { data: book, error } = await supabaseAdmin
    .from('books')
    .select('status, pdf_storage_path, finished_at')
    .eq('owner_id', req.user.id)
    .maybeSingle();

  if (error || !book) {
    return res.status(404).json({ error: 'Book not found' });
  }

  if (book.status !== 'finished') {
    return res.json({ status: 'in_progress' });
  }

  if (book.pdf_storage_path) {
    const { data: signed } = await supabaseAdmin.storage
      .from(process.env.PDFS_BUCKET)
      .createSignedUrl(book.pdf_storage_path, 60 * 60 * 24); // 24hr link
    return res.json({ status: 'ready', pdfUrl: signed?.signedUrl || null });
  }

  // Finished but no PDF yet — still generating, unless it's been
  // suspiciously long, in which case surface a failure.
  const generatingForMs = Date.now() - new Date(book.finished_at).getTime();
  if (generatingForMs > 5 * 60 * 1000) {
    return res.json({ status: 'failed', error: 'PDF generation is taking longer than expected' });
  }
  res.json({ status: 'generating' });
});

module.exports = router;
