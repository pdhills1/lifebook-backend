const express = require('express');
const db = require('../lib/db');
const storage = require('../lib/storage');
const schema = require('../lib/schema');
const { withBook, ownEntry, bookPayload, overviewFor, touch } = require('../lib/context');
const { bad, invalid, notFound } = require('../lib/errors');

const router = express.Router();
router.use(withBook);

// The whole book overview: chapters, progress and the state of the PDF.
router.get('/book', async (req, res) => {
  const { book, overview } = await overviewFor(req.book.id);
  res.json({ book: bookPayload(book), overview, me: meOf(req) });
});

function meOf(req) {
  const p = req.user.profile;
  return { id: req.user.id, email: req.user.email, name: p.display_name, role: p.role };
}

// One chapter (or one person inside the repeatable chapter), with photo links ready to show.
router.get('/chapter/:chapterId', async (req, res) => {
  const chapter = schema.getChapter(req.params.chapterId);
  if (!chapter) throw notFound('That chapter does not exist.');

  const entries = await db.ensureChapterEntries(req.book.id, schema.chapters.filter((c) => !c.repeatable).map((c) => c.id));
  let entry;
  if (chapter.repeatable) {
    entry = await ownEntry(req, req.query.entryId);
    if (entry.chapter_id !== chapter.id) throw notFound();
  } else {
    entry = entries.find((e) => e.chapter_id === chapter.id && !e.person_name);
  }

  const [answers, bonus] = await Promise.all([db.listAnswers([entry.id]), db.listBonusPhotos([entry.id])]);
  const urls = await storage.signedUrls([...answers.map((a) => a.photo_storage_path), ...bonus.map((b) => b.photo_storage_path)]);

  const out = {};
  for (const a of answers) {
    out[a.question_id] = a.photo_storage_path
      ? { photoUrl: urls[a.photo_storage_path] || null, caption: a.photo_caption || '' }
      : { text: a.answer_text || '' };
  }

  // Questions that quote an earlier answer (e.g. the look-back in the last chapter).
  const echoes = {};
  for (const q of chapter.questions) {
    if (!q.echoFrom) continue;
    const source = schema.chapterOfQuestion(q.echoFrom.questionId);
    const sourceEntry = source && entries.find((e) => e.chapter_id === source.id && !e.person_name);
    const row = sourceEntry && (await db.getAnswer(sourceEntry.id, q.echoFrom.questionId));
    if (row?.answer_text?.trim()) echoes[q.id] = { label: q.echoFrom.label, text: row.answer_text };
  }

  res.json({
    chapterId: chapter.id,
    entryId: entry.id,
    person: chapter.repeatable ? { name: entry.person_name, relationship: entry.relationship } : null,
    skipped: (req.book.skipped_chapters || []).includes(chapter.id),
    answers: out,
    echoes,
    bonusPhotos: bonus.map((b) => ({ id: b.id, photoUrl: urls[b.photo_storage_path] || null, caption: b.caption || '' })),
  });
});

// "This chapter doesn't apply to me" - skipped chapters count as done and stay out of the PDF.
router.put('/chapter/:chapterId/skip', async (req, res) => {
  const chapter = schema.getChapter(req.params.chapterId);
  if (!chapter) throw notFound('That chapter does not exist.');
  if (typeof req.body?.skipped !== 'boolean') throw bad('Please say whether to skip this chapter.');
  const set = new Set(req.book.skipped_chapters || []);
  if (req.body.skipped) set.add(chapter.id); else set.delete(chapter.id);
  await touch(req.book.id, { skipped_chapters: [...set] });
  const { book, overview } = await overviewFor(req.book.id);
  res.json({ book: bookPayload(book), overview });
});

// A plain-text copy of everything written - handy as a backup, or to paste into Word.
router.get('/book/export', async (req, res) => {
  const { book, overview, state } = await overviewFor(req.book.id);
  const byEntry = {};
  for (const a of state.answers) (byEntry[a.entry_id] ||= {})[a.question_id] = a;
  const lines = [`${book.title}`, `by ${req.user.profile.display_name}`, ''];
  const block = (chapter, entryId, heading) => {
    const mine = byEntry[entryId] || {};
    const rows = chapter.questions.filter((q) => q.type !== 'photo' && mine[q.id]?.answer_text?.trim());
    if (!rows.length) return;
    if (heading) lines.push(heading, '');
    for (const q of rows) lines.push(q.prompt, mine[q.id].answer_text.trim(), '');
  };
  for (const c of overview.chapters) {
    if (c.skipped) continue;
    const def = schema.getChapter(c.chapterId);
    const start = lines.length;
    lines.push('='.repeat(60), `${def.title}`.toUpperCase(), '='.repeat(60), '');
    if (def.repeatable) for (const p of c.people) block(def, p.entryId, `--- ${p.name} (${p.relationship}) ---`);
    else block(def, c.entryId);
    if (lines.length === start + 4) lines.length = start; // nothing written in this chapter
  }
  const name = `${book.title}`.replace(/[^\w\- ]+/g, '').trim() || 'My Story';
  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name} - text copy.txt"`,
  });
  res.send(lines.join('\r\n'));
});

module.exports = router;
