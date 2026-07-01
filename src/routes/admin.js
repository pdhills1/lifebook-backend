const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { getAllChapters, getCoreQuestionIds } = require('../lib/schema');

const router = express.Router();

// GET /api/admin/users — every author with a progress summary
router.get('/admin/users', async (req, res) => {
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name')
    .eq('role', 'author');
  if (profilesError) {
    return res.status(500).json({ error: 'Failed to load users' });
  }

  const results = [];
  for (const profile of profiles) {
    const { data: book } = await supabaseAdmin
      .from('books')
      .select('id, status, updated_at')
      .eq('owner_id', profile.id)
      .maybeSingle();

    if (!book) {
      results.push({
        userId: profile.id,
        displayName: profile.display_name,
        bookStatus: 'not_started',
        chaptersComplete: 0,
        chaptersTotal: getAllChapters().length,
        lastUpdated: null,
      });
      continue;
    }

    const { data: entries } = await supabaseAdmin
      .from('entries')
      .select('id, chapter_id')
      .eq('book_id', book.id);
    const entryIds = (entries || []).map((e) => e.id);

    const { data: answers } = entryIds.length
      ? await supabaseAdmin
          .from('answers')
          .select('entry_id, question_id, answer_text, photo_storage_path')
          .in('entry_id', entryIds)
      : { data: [] };

    const answersByEntry = {};
    for (const a of answers || []) {
      if (!answersByEntry[a.entry_id]) answersByEntry[a.entry_id] = [];
      answersByEntry[a.entry_id].push(a);
    }

    let chaptersComplete = 0;
    for (const chapterDef of getAllChapters()) {
      const coreIds = getCoreQuestionIds(chapterDef.id);
      const chapterEntries = (entries || []).filter((e) => e.chapter_id === chapterDef.id);
      if (chapterEntries.length === 0) continue;

      const allEntriesComplete = chapterEntries.every((entry) => {
        const given = answersByEntry[entry.id] || [];
        const coreAnswered = given.filter(
          (a) => coreIds.includes(a.question_id) && (a.answer_text?.trim() || a.photo_storage_path)
        ).length;
        return coreIds.length > 0 && coreAnswered === coreIds.length;
      });
      if (allEntriesComplete) chaptersComplete += 1;
    }

    results.push({
      userId: profile.id,
      displayName: profile.display_name,
      bookStatus: book.status,
      chaptersComplete,
      chaptersTotal: getAllChapters().length,
      lastUpdated: book.updated_at,
    });
  }

  res.json(results);
});

// GET /api/admin/book/:userId — same shape as GET /api/book, for any user
router.get('/admin/book/:userId', async (req, res) => {
  const { userId } = req.params;

  const { data: book, error } = await supabaseAdmin
    .from('books')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle();

  if (error || !book) {
    return res.status(404).json({ error: 'Book not found for this user' });
  }

  // Reuses the same logic as GET /api/book by delegating to it would
  // require refactoring into a shared function — left as a follow-up
  // once the main book route is finalized, to avoid duplicating logic
  // that's still subject to change.
  res.json({
    bookId: book.id,
    title: book.title,
    status: book.status,
    note: 'Full chapter breakdown reuses GET /api/book logic — wire up as shared helper before deployment.',
  });
});

// GET /api/admin/book/:userId/pdf
router.get('/admin/book/:userId/pdf', async (req, res) => {
  const { userId } = req.params;

  const { data: book, error } = await supabaseAdmin
    .from('books')
    .select('pdf_storage_path, status')
    .eq('owner_id', userId)
    .maybeSingle();

  if (error || !book) {
    return res.status(404).json({ error: 'Book not found for this user' });
  }
  if (!book.pdf_storage_path) {
    return res.status(404).json({ error: 'PDF not yet generated for this user' });
  }

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(process.env.PDFS_BUCKET)
    .createSignedUrl(book.pdf_storage_path, 60 * 60 * 24);

  if (signError) {
    return res.status(500).json({ error: 'Failed to create download link' });
  }

  res.json({ pdfUrl: signed.signedUrl });
});

module.exports = router;
