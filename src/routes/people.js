const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();
const CHAPTER_8_ID = 'ch08';

async function getBookId(userId) {
  const { data } = await supabaseAdmin.from('books').select('id').eq('owner_id', userId).maybeSingle();
  return data?.id || null;
}

// POST /api/people — add a new Chapter 8 person entry
router.post('/people', async (req, res) => {
  const { name, relationship } = req.body || {};
  if (!name || !relationship) {
    return res.status(422).json({ error: 'name and relationship are required' });
  }

  const bookId = await getBookId(req.user.id);
  if (!bookId) {
    return res.status(404).json({ error: 'Book not found. Call /api/bootstrap first.' });
  }

  const { count } = await supabaseAdmin
    .from('entries')
    .select('id', { count: 'exact', head: true })
    .eq('book_id', bookId)
    .eq('chapter_id', CHAPTER_8_ID);

  const { data: created, error } = await supabaseAdmin
    .from('entries')
    .insert({
      book_id: bookId,
      chapter_id: CHAPTER_8_ID,
      person_name: name,
      relationship,
      sort_order: count || 0,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to add person' });
  }

  res.json({ entryId: created.id, name: created.person_name, relationship: created.relationship });
});

// PATCH /api/people/:entryId — edit a person's name/relationship
router.patch('/people/:entryId', async (req, res) => {
  const { entryId } = req.params;
  const { name, relationship } = req.body || {};

  const bookId = await getBookId(req.user.id);
  const { data: existing } = await supabaseAdmin
    .from('entries')
    .select('id')
    .eq('id', entryId)
    .eq('book_id', bookId)
    .eq('chapter_id', CHAPTER_8_ID)
    .maybeSingle();

  if (!existing) {
    return res.status(403).json({ error: 'Not your entry to edit' });
  }

  const updates = {};
  if (name) updates.person_name = name;
  if (relationship) updates.relationship = relationship;

  const { error } = await supabaseAdmin.from('entries').update(updates).eq('id', entryId);
  if (error) {
    return res.status(500).json({ error: 'Failed to update person' });
  }

  res.json({ updated: true });
});

// DELETE /api/people/:entryId — remove a person and their answers/photos
router.delete('/people/:entryId', async (req, res) => {
  const { entryId } = req.params;

  const bookId = await getBookId(req.user.id);
  const { data: existing } = await supabaseAdmin
    .from('entries')
    .select('id')
    .eq('id', entryId)
    .eq('book_id', bookId)
    .eq('chapter_id', CHAPTER_8_ID)
    .maybeSingle();

  if (!existing) {
    return res.status(403).json({ error: 'Not your entry to delete' });
  }

  // Clean up any uploaded photos in Storage before deleting the rows
  // (answers/bonus_photos rows cascade-delete via FK, but Storage objects
  // do not, so they must be removed explicitly here.)
  const { data: photoAnswers } = await supabaseAdmin
    .from('answers')
    .select('photo_storage_path')
    .eq('entry_id', entryId)
    .not('photo_storage_path', 'is', null);
  const { data: bonusPhotos } = await supabaseAdmin
    .from('bonus_photos')
    .select('photo_storage_path')
    .eq('entry_id', entryId);

  const pathsToRemove = [
    ...(photoAnswers || []).map((a) => a.photo_storage_path),
    ...(bonusPhotos || []).map((p) => p.photo_storage_path),
  ].filter(Boolean);

  if (pathsToRemove.length > 0) {
    await supabaseAdmin.storage.from(process.env.PHOTOS_BUCKET).remove(pathsToRemove);
  }

  const { error } = await supabaseAdmin.from('entries').delete().eq('id', entryId);
  if (error) {
    return res.status(500).json({ error: 'Failed to delete person' });
  }

  res.json({ deleted: true });
});

module.exports = router;
