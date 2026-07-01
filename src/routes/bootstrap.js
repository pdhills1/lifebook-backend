const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { getNonRepeatableChapterIds } = require('../lib/schema');

const router = express.Router();

// POST /api/bootstrap — idempotent. Safe to call on every login.
router.post('/bootstrap', async (req, res) => {
  const userId = req.user.id;

  let { data: book, error: bookError } = await supabaseAdmin
    .from('books')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle();

  if (bookError) {
    return res.status(500).json({ error: 'Failed to look up book' });
  }

  if (!book) {
    const { data: createdBook, error: createError } = await supabaseAdmin
      .from('books')
      .insert({ owner_id: userId, title: 'My Story', status: 'in_progress' })
      .select()
      .single();
    if (createError) {
      return res.status(500).json({ error: 'Failed to create book' });
    }
    book = createdBook;
  }

  // Ensure every non-repeatable chapter has exactly one entry.
  const { data: existingEntries, error: entriesError } = await supabaseAdmin
    .from('entries')
    .select('chapter_id')
    .eq('book_id', book.id);

  if (entriesError) {
    return res.status(500).json({ error: 'Failed to look up chapter entries' });
  }

  const existingChapterIds = new Set((existingEntries || []).map((e) => e.chapter_id));
  const missingChapterIds = getNonRepeatableChapterIds().filter(
    (id) => !existingChapterIds.has(id)
  );

  if (missingChapterIds.length > 0) {
    const rowsToInsert = missingChapterIds.map((chapterId) => ({
      book_id: book.id,
      chapter_id: chapterId,
    }));
    const { error: insertError } = await supabaseAdmin.from('entries').insert(rowsToInsert);
    if (insertError) {
      return res.status(500).json({ error: 'Failed to create chapter entries' });
    }
  }

  res.status(200).json({ bookId: book.id, bookTitle: book.title, status: book.status });
});

module.exports = router;
