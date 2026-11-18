// Gathers everything a book needs (text, photos, people) from the database and storage,
// in the order and shape the renderer wants.
const db = require('../lib/db');
const storage = require('../lib/storage');
const schema = require('../lib/schema');

/** Runs async work over a list with a small concurrency limit. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    })
  );
  return results;
}

async function assembleBookContent(book, profile) {
  const state = await db.loadBookState(book);
  const skipped = new Set(book.skipped_chapters || []);
  const byEntry = {};
  for (const a of state.answers) (byEntry[a.entry_id] ||= {})[a.question_id] = a;
  const bonusByEntry = {};
  for (const p of state.bonus) (bonusByEntry[p.entry_id] ||= []).push(p);

  const warnings = [];
  const cache = new Map();
  // Photos are downloaded up front, a few at a time, then looked up by path.
  const wanted = new Set([
    ...state.answers.map((a) => a.photo_storage_path),
    ...state.bonus.map((b) => b.photo_storage_path),
  ]);
  wanted.delete(null);
  wanted.delete(undefined);
  await pool([...wanted], 4, async (path) => {
    try {
      cache.set(path, await storage.download(storage.photos(), path));
    } catch (err) {
      warnings.push('One or more photos could not be loaded and were left out.');
    }
  });

  const dedicationRole = schema.findByRole('dedication');
  const coverRole = schema.findByRole('coverPhoto');
  const titleRole = schema.findByRole('bookTitle');
  const roleIds = new Set([dedicationRole?.question.id, coverRole?.question.id, titleRole?.question.id]);

  const chapters = [];
  for (const chapter of schema.chapters) {
    if (skipped.has(chapter.id)) continue;
    const entries = state.entries.filter((e) => e.chapter_id === chapter.id).sort((a, b) => a.sort_order - b.sort_order);
    const sections = [];

    for (const entry of entries) {
      const mine = byEntry[entry.id] || {};
      const items = [];
      const groups = {};

      for (const q of chapter.questions) {
        if (roleIds.has(q.id)) continue; // title, dedication and cover photo are used on their own pages
        const row = mine[q.id];
        if (q.type === 'photo') {
          const image = row?.photo_storage_path && cache.get(row.photo_storage_path);
          if (image) items.push({ type: 'photo', image, caption: row.photo_caption || '' });
        } else if (row?.answer_text?.trim()) {
          if (q.group) {
            if (!groups[q.group]) {
              groups[q.group] = { type: 'favourites', title: chapter.groups?.[q.group] || 'A few favourites', rows: [] };
              items.push(groups[q.group]);
            }
            groups[q.group].rows.push({ label: q.label || q.prompt, text: row.answer_text });
          } else {
            items.push({ type: 'qa', prompt: q.prompt, text: row.answer_text });
          }
        }
      }

      const extra = (bonusByEntry[entry.id] || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((b) => ({ image: cache.get(b.photo_storage_path), caption: b.caption || '' }))
        .filter((p) => p.image);
      if (extra.length) items.push({ type: 'gallery', photos: extra });

      if (items.length) {
        sections.push({
          person: chapter.repeatable ? { name: entry.person_name, relationship: entry.relationship } : null,
          items,
        });
      }
    }
    if (sections.length) chapters.push({ id: chapter.id, title: chapter.title, subtitle: chapter.subtitle, sections });
  }

  const find = (role) => {
    const entry = role && state.entries.find((e) => e.chapter_id === role.chapter.id && !e.person_name);
    return entry ? byEntry[entry.id]?.[role.question.id] : null;
  };

  return {
    content: {
      title: book.title || 'My Story',
      authorName: profile.display_name,
      dedication: find(dedicationRole)?.answer_text || '',
      coverPhoto: (find(coverRole)?.photo_storage_path && cache.get(find(coverRole).photo_storage_path)) || null,
      finishedAt: new Date(),
      chapters,
    },
    warnings: [...new Set(warnings)],
  };
}

module.exports = { assembleBookContent };
