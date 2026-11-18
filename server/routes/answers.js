const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const db = require('../lib/db');
const storage = require('../lib/storage');
const schema = require('../lib/schema');
const { normalisePhoto } = require('../lib/images');
const { withBook, ownEntry, overviewFor, touch } = require('../lib/context');
const { invalid, notFound } = require('../lib/errors');

const router = express.Router();
router.use(withBook);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPhotoBytes, files: 1 } });
const MAX_BONUS_PER_ENTRY = 60;
const MAX_CAPTION = 300;

const caption = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_CAPTION) : '');

/** Finds the question and checks it really belongs on that entry's chapter. */
async function resolve(req, entryId, questionId, wantPhoto) {
  const entry = await ownEntry(req, entryId);
  const question = schema.getQuestion(questionId);
  const chapter = question && schema.chapterOfQuestion(questionId);
  if (!question || chapter.id !== entry.chapter_id) throw invalid('That question isn\'t on this page.');
  if (wantPhoto !== (question.type === 'photo')) {
    throw invalid(wantPhoto ? 'That question takes writing, not a photo.' : 'That question takes a photo, not writing.');
  }
  return { entry, question };
}

// Autosave: called a moment after the person stops typing.
router.put('/answer', async (req, res) => {
  const { entryId, questionId, text } = req.body || {};
  if (typeof text !== 'string') throw invalid('Nothing to save.');
  if (text.length > config.maxTextChars) throw invalid('That answer is longer than we can save in one go. Please split it across a couple of answers.');
  const { entry, question } = await resolve(req, entryId, questionId, false);

  await db.upsertAnswer(entry.id, question.id, { answer_text: text });
  const patch = {};
  if (question.role === 'bookTitle') patch.title = text.trim().slice(0, 120) || 'My Story';
  await touch(req.book.id, patch);

  const { overview } = await overviewFor(req.book.id);
  res.json({ saved: true, savedAt: new Date().toISOString(), overview, ...(patch.title ? { title: patch.title } : {}) });
});

router.post('/answer/photo', upload.single('file'), async (req, res) => {
  const { entryId, questionId } = req.body || {};
  if (!req.file) throw invalid('Please choose a photo.');
  const { entry, question } = await resolve(req, entryId, questionId, true);
  const photo = await normalisePhoto(req.file.buffer, req.file.originalname);

  const path = `${req.user.id}/${entry.id}/${question.id}.jpg`;
  await storage.upload(storage.photos(), path, photo.buffer, 'image/jpeg');
  const existing = await db.getAnswer(entry.id, question.id);
  const cap = typeof req.body.caption === 'string' ? caption(req.body.caption) : existing?.photo_caption || '';
  await db.upsertAnswer(entry.id, question.id, { photo_storage_path: path, photo_caption: cap, answer_text: null });
  await touch(req.book.id);

  const urls = await storage.signedUrls([path]);
  const { overview } = await overviewFor(req.book.id);
  res.json({ saved: true, photoUrl: urls[path] || null, caption: cap, overview });
});

router.put('/answer/caption', async (req, res) => {
  const { entryId, questionId } = req.body || {};
  const { entry, question } = await resolve(req, entryId, questionId, true);
  const existing = await db.getAnswer(entry.id, question.id);
  if (!existing?.photo_storage_path) throw notFound('There\'s no photo to caption yet.');
  await db.upsertAnswer(entry.id, question.id, { photo_caption: caption(req.body.caption) });
  await touch(req.book.id);
  res.json({ saved: true, savedAt: new Date().toISOString() });
});

router.delete('/answer/photo', async (req, res) => {
  const { entryId, questionId } = req.query;
  const { entry, question } = await resolve(req, entryId, questionId, true);
  const existing = await db.getAnswer(entry.id, question.id);
  if (existing?.photo_storage_path) await storage.remove(storage.photos(), [existing.photo_storage_path]);
  await db.deleteAnswer(entry.id, question.id);
  await touch(req.book.id);
  const { overview } = await overviewFor(req.book.id);
  res.json({ deleted: true, overview });
});

// ---------- extra photos, any chapter ----------
router.post('/bonus-photo', upload.single('file'), async (req, res) => {
  if (!req.file) throw invalid('Please choose a photo.');
  const entry = await ownEntry(req, req.body?.entryId);
  const existing = await db.listBonusPhotos([entry.id]);
  if (existing.length >= MAX_BONUS_PER_ENTRY) throw invalid(`That's the most extra photos we can hold on one page (${MAX_BONUS_PER_ENTRY}).`);

  const photo = await normalisePhoto(req.file.buffer, req.file.originalname);
  const id = crypto.randomUUID();
  const path = `${req.user.id}/${entry.id}/bonus-${id}.jpg`;
  await storage.upload(storage.photos(), path, photo.buffer, 'image/jpeg');
  const row = await db.insertBonusPhoto({
    id, entry_id: entry.id, photo_storage_path: path, caption: caption(req.body.caption),
    sort_order: existing.length ? Math.max(...existing.map((p) => p.sort_order)) + 1 : 0,
  });
  await touch(req.book.id);
  const urls = await storage.signedUrls([path]);
  res.status(201).json({ id: row.id, photoUrl: urls[path] || null, caption: row.caption || '' });
});

async function ownBonus(req) {
  const row = await db.getBonusPhoto(req.params.id);
  if (!row) throw notFound('That photo could not be found.');
  await ownEntry(req, row.entry_id);
  return row;
}

router.put('/bonus-photo/:id', async (req, res) => {
  const row = await ownBonus(req);
  await db.updateBonusPhoto(row.id, { caption: caption(req.body?.caption) });
  await touch(req.book.id);
  res.json({ saved: true, savedAt: new Date().toISOString() });
});

router.delete('/bonus-photo/:id', async (req, res) => {
  const row = await ownBonus(req);
  await storage.remove(storage.photos(), [row.photo_storage_path]);
  await db.deleteBonusPhoto(row.id);
  await touch(req.book.id);
  res.json({ deleted: true });
});

module.exports = router;
