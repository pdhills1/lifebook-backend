// The repeatable chapter ("Watching You Grow"): one set of questions per child / grandchild.
const express = require('express');
const db = require('../lib/db');
const storage = require('../lib/storage');
const schema = require('../lib/schema');
const { withBook, ownEntry, overviewFor, touch } = require('../lib/context');
const { invalid } = require('../lib/errors');

const router = express.Router();
router.use(withBook);

const MAX_PEOPLE = 30;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

router.post('/people', async (req, res) => {
  const chapter = schema.repeatableChapter();
  const name = text(req.body?.name, 80);
  const relationship = text(req.body?.relationship, 40);
  if (!name) throw invalid('Please enter their name.');
  if (!relationship) throw invalid('Please say how they are related to you.');

  const existing = (await db.listEntries(req.book.id)).filter((e) => e.chapter_id === chapter.id);
  if (existing.length >= MAX_PEOPLE) throw invalid(`That's the most people we can hold (${MAX_PEOPLE}).`);
  const next = existing.length ? Math.max(...existing.map((e) => e.sort_order)) + 1 : 0;
  const entry = await db.addPerson(req.book.id, chapter.id, name, relationship, next);
  await touch(req.book.id);
  const { overview } = await overviewFor(req.book.id);
  res.status(201).json({ entryId: entry.id, overview });
});

router.patch('/people/:entryId', async (req, res) => {
  const entry = await ownEntry(req, req.params.entryId);
  const patch = {};
  if (req.body?.name !== undefined) patch.person_name = text(req.body.name, 80);
  if (req.body?.relationship !== undefined) patch.relationship = text(req.body.relationship, 40);
  if (patch.person_name === '' || patch.relationship === '') throw invalid('Name and relationship can\'t be empty.');
  if (Object.keys(patch).length) await db.updateEntry(entry.id, patch);
  await touch(req.book.id);
  const { overview } = await overviewFor(req.book.id);
  res.json({ updated: true, overview });
});

router.delete('/people/:entryId', async (req, res) => {
  const entry = await ownEntry(req, req.params.entryId);
  // Database rows cascade, but stored photo files don't - remove them explicitly.
  const [answers, bonus] = await Promise.all([db.listAnswers([entry.id]), db.listBonusPhotos([entry.id])]);
  await storage.remove(storage.photos(), [...answers.map((a) => a.photo_storage_path), ...bonus.map((b) => b.photo_storage_path)]);
  await db.deleteEntry(entry.id);
  await touch(req.book.id);
  const { overview } = await overviewFor(req.book.id);
  res.json({ deleted: true, overview });
});

module.exports = router;
