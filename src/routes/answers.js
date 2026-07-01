const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const { supabaseAdmin } = require('../lib/supabase');
const { isPhotoQuestion } = require('../lib/schema');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB raw upload ceiling, before compression
});

/**
 * Confirms the given entryId actually belongs to the calling user's book.
 * Returns the entry's chapter_id if valid, otherwise null.
 */
async function verifyEntryOwnership(userId, entryId) {
  const { data, error } = await supabaseAdmin
    .from('entries')
    .select('id, chapter_id, books!inner(owner_id)')
    .eq('id', entryId)
    .eq('books.owner_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data.chapter_id;
}

async function compressImage(buffer) {
  // Resize to a sensible max dimension and compress — keeps Storage usage
  // and PDF generation time reasonable without visibly hurting quality.
  return sharp(buffer)
    .rotate() // auto-orient based on EXIF, then strip EXIF on output
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

// PUT /api/answer — upsert a text/select answer
router.put('/answer', async (req, res) => {
  const { entryId, questionId, text } = req.body || {};
  if (!entryId || !questionId) {
    return res.status(422).json({ error: 'entryId and questionId are required' });
  }

  const chapterId = await verifyEntryOwnership(req.user.id, entryId);
  if (!chapterId) {
    return res.status(403).json({ error: 'Not your entry to edit' });
  }

  if (isPhotoQuestion(chapterId, questionId)) {
    return res.status(422).json({ error: 'This question expects a photo upload, not text' });
  }

  const { error } = await supabaseAdmin.from('answers').upsert(
    {
      entry_id: entryId,
      question_id: questionId,
      answer_text: text ?? '',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entry_id,question_id' }
  );

  if (error) {
    return res.status(500).json({ error: 'Failed to save answer' });
  }

  res.json({ saved: true, updatedAt: new Date().toISOString() });
});

// POST /api/answer/photo — upload a photo for a specific photo-type question
router.post('/answer/photo', upload.single('file'), async (req, res) => {
  const { entryId, questionId, caption } = req.body || {};
  if (!entryId || !questionId || !req.file) {
    return res.status(422).json({ error: 'entryId, questionId and file are required' });
  }

  const chapterId = await verifyEntryOwnership(req.user.id, entryId);
  if (!chapterId) {
    return res.status(403).json({ error: 'Not your entry to edit' });
  }
  if (!isPhotoQuestion(chapterId, questionId)) {
    return res.status(422).json({ error: 'This question does not accept a photo' });
  }
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(422).json({ error: 'Uploaded file must be an image' });
  }

  let compressed;
  try {
    compressed = await compressImage(req.file.buffer);
  } catch (err) {
    return res.status(422).json({ error: 'Could not process image file' });
  }

  const storagePath = `${req.user.id}/${entryId}/${questionId}.jpg`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(process.env.PHOTOS_BUCKET)
    .upload(storagePath, compressed, { contentType: 'image/jpeg', upsert: true });

  if (uploadError) {
    return res.status(500).json({ error: 'Failed to upload photo' });
  }

  const { error: dbError } = await supabaseAdmin.from('answers').upsert(
    {
      entry_id: entryId,
      question_id: questionId,
      photo_storage_path: storagePath,
      photo_caption: caption || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entry_id,question_id' }
  );

  if (dbError) {
    return res.status(500).json({ error: 'Failed to save photo reference' });
  }

  const { data: signed } = await supabaseAdmin.storage
    .from(process.env.PHOTOS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);

  res.json({ saved: true, photoUrl: signed?.signedUrl || null });
});

// POST /api/bonus-photo — add an open-ended bonus photo to a chapter entry
router.post('/bonus-photo', upload.single('file'), async (req, res) => {
  const { entryId, caption } = req.body || {};
  if (!entryId || !req.file) {
    return res.status(422).json({ error: 'entryId and file are required' });
  }

  const chapterId = await verifyEntryOwnership(req.user.id, entryId);
  if (!chapterId) {
    return res.status(403).json({ error: 'Not your entry to edit' });
  }
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(422).json({ error: 'Uploaded file must be an image' });
  }

  let compressed;
  try {
    compressed = await compressImage(req.file.buffer);
  } catch (err) {
    return res.status(422).json({ error: 'Could not process image file' });
  }

  const photoId = crypto.randomUUID();
  const storagePath = `${req.user.id}/${entryId}/bonus-${photoId}.jpg`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(process.env.PHOTOS_BUCKET)
    .upload(storagePath, compressed, { contentType: 'image/jpeg' });
  if (uploadError) {
    return res.status(500).json({ error: 'Failed to upload photo' });
  }

  const { data: inserted, error: dbError } = await supabaseAdmin
    .from('bonus_photos')
    .insert({ id: photoId, entry_id: entryId, photo_storage_path: storagePath, caption: caption || null })
    .select()
    .single();
  if (dbError) {
    return res.status(500).json({ error: 'Failed to save bonus photo reference' });
  }

  const { data: signed } = await supabaseAdmin.storage
    .from(process.env.PHOTOS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);

  res.json({ id: inserted.id, photoUrl: signed?.signedUrl || null });
});

// DELETE /api/bonus-photo/:id
router.delete('/bonus-photo/:id', async (req, res) => {
  const { id } = req.params;

  const { data: photo, error } = await supabaseAdmin
    .from('bonus_photos')
    .select('id, photo_storage_path, entries!inner(id, books!inner(owner_id))')
    .eq('id', id)
    .eq('entries.books.owner_id', req.user.id)
    .maybeSingle();

  if (error || !photo) {
    return res.status(403).json({ error: 'Not your photo to delete' });
  }

  await supabaseAdmin.storage.from(process.env.PHOTOS_BUCKET).remove([photo.photo_storage_path]);
  const { error: deleteError } = await supabaseAdmin.from('bonus_photos').delete().eq('id', id);
  if (deleteError) {
    return res.status(500).json({ error: 'Failed to delete photo record' });
  }

  res.json({ deleted: true });
});

module.exports = router;
