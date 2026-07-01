const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const {
  getAllChapters,
  getCoreQuestionIds,
  getChapter,
} = require('../lib/schema');

const router = express.Router();

async function getSignedUrl(bucket, path) {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60); // 1 hour
  if (error) return null;
  return data.signedUrl;
}

// GET /api/book — overview with per-chapter progress + list of Chapter 8 people
router.get('/book', async (req, res) => {
  const userId = req.user.id;

  const { data: book, error: bookError } = await supabaseAdmin
    .from('books')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle();

  if (bookError || !book) {
    return res.status(404).json({ error: 'Book not found. Call /api/bootstrap first.' });
  }

  const { data: entries, error: entriesError } = await supabaseAdmin
    .from('entries')
    .select('id, chapter_id, person_name, relationship, sort_order')
    .eq('book_id', book.id);

  if (entriesError) {
    return res.status(500).json({ error: 'Failed to load chapter entries' });
  }

  const entryIds = entries.map((e) => e.id);
  const { data: answers, error: answersError } = entryIds.length
    ? await supabaseAdmin
        .from('answers')
        .select('entry_id, question_id, answer_text, photo_storage_path')
        .in('entry_id', entryIds)
    : { data: [], error: null };

  if (answersError) {
    return res.status(500).json({ error: 'Failed to load answers' });
  }

  const answersByEntry = {};
  for (const a of answers) {
    if (!answersByEntry[a.entry_id]) answersByEntry[a.entry_id] = [];
    answersByEntry[a.entry_id].push(a);
  }

  const chapters = getAllChapters().map((chapterDef) => {
    const coreIds = getCoreQuestionIds(chapterDef.id);
    const chapterEntries = entries.filter((e) => e.chapter_id === chapterDef.id);

    if (!chapterDef.repeatable) {
      const entry = chapterEntries[0];
      const givenAnswers = entry ? answersByEntry[entry.id] || [] : [];
      const coreAnswered = givenAnswers.filter(
        (a) =>
          coreIds.includes(a.question_id) &&
          (a.answer_text?.trim() || a.photo_storage_path)
      ).length;
      return {
        chapterId: chapterDef.id,
        title: chapterDef.title,
        repeatable: false,
        coreAnswered,
        coreTotal: coreIds.length,
        complete: coreIds.length > 0 && coreAnswered === coreIds.length,
      };
    }

    // Repeatable (Chapter 8): completeness is per-person; report aggregate.
    const peopleProgress = chapterEntries.map((entry) => {
      const givenAnswers = answersByEntry[entry.id] || [];
      const coreAnswered = givenAnswers.filter(
        (a) =>
          coreIds.includes(a.question_id) &&
          (a.answer_text?.trim() || a.photo_storage_path)
      ).length;
      return { entryId: entry.id, complete: coreAnswered === coreIds.length };
    });

    return {
      chapterId: chapterDef.id,
      title: chapterDef.title,
      repeatable: true,
      peopleCount: chapterEntries.length,
      peopleComplete: peopleProgress.filter((p) => p.complete).length,
      complete: chapterEntries.length > 0 && peopleProgress.every((p) => p.complete),
    };
  });

  const people = entries
    .filter((e) => e.chapter_id === 'ch08')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((e) => ({ entryId: e.id, name: e.person_name, relationship: e.relationship }));

  res.json({
    bookId: book.id,
    title: book.title,
    status: book.status,
    chapters,
    people,
  });
});

// GET /api/chapter/:chapterId?entryId=<uuid>
router.get('/chapter/:chapterId', async (req, res) => {
  const userId = req.user.id;
  const { chapterId } = req.params;
  const { entryId } = req.query;

  const chapterDef = getChapter(chapterId);
  if (!chapterDef) {
    return res.status(404).json({ error: 'Unknown chapter' });
  }

  const { data: book } = await supabaseAdmin
    .from('books')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  if (!book) {
    return res.status(404).json({ error: 'Book not found' });
  }

  let entryQuery = supabaseAdmin
    .from('entries')
    .select('id')
    .eq('book_id', book.id)
    .eq('chapter_id', chapterId);

  if (chapterDef.repeatable) {
    if (!entryId) {
      return res.status(422).json({ error: 'entryId is required for this chapter' });
    }
    entryQuery = entryQuery.eq('id', entryId);
  }

  const { data: entries, error: entryError } = await entryQuery;
  if (entryError || !entries?.length) {
    return res.status(404).json({ error: 'Chapter entry not found' });
  }
  const entry = entries[0];

  const { data: rawAnswers, error: answersError } = await supabaseAdmin
    .from('answers')
    .select('question_id, answer_text, photo_storage_path, photo_caption')
    .eq('entry_id', entry.id);
  if (answersError) {
    return res.status(500).json({ error: 'Failed to load answers' });
  }

  const answers = {};
  for (const a of rawAnswers) {
    if (a.photo_storage_path) {
      answers[a.question_id] = {
        photoUrl: await getSignedUrl(process.env.PHOTOS_BUCKET, a.photo_storage_path),
        caption: a.photo_caption || null,
      };
    } else {
      answers[a.question_id] = { text: a.answer_text };
    }
  }

  const { data: rawBonusPhotos, error: bonusError } = await supabaseAdmin
    .from('bonus_photos')
    .select('id, photo_storage_path, caption, sort_order')
    .eq('entry_id', entry.id)
    .order('sort_order', { ascending: true });
  if (bonusError) {
    return res.status(500).json({ error: 'Failed to load bonus photos' });
  }

  const bonusPhotos = await Promise.all(
    rawBonusPhotos.map(async (p) => ({
      id: p.id,
      photoUrl: await getSignedUrl(process.env.PHOTOS_BUCKET, p.photo_storage_path),
      caption: p.caption,
    }))
  );

  res.json({ chapterId, entryId: entry.id, answers, bonusPhotos });
});

module.exports = router;
