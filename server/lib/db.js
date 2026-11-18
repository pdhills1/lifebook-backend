// All database access lives here. Queries are kept deliberately simple (no embedded joins)
// and every list query is paginated, because Supabase silently caps a query at 1,000 rows.
const { getAdmin } = require('./supabase');

const PAGE = 1000;
const IN_CHUNK = 100;

function fail(error, what) {
  const e = new Error(`Database error while ${what}: ${error.message || error}`);
  e.code = error.code;
  e.cause = error;
  return e;
}
function must({ data, error }, what) {
  if (error) throw fail(error, what);
  return data;
}
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Runs make(from,to) page by page until everything has been fetched. */
async function selectAll(make, what) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const data = must(await make(from, from + PAGE - 1), what);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const t = (name) => getAdmin().from(name);

// ---------- profiles ----------
const getProfile = async (id) =>
  must(await t('profiles').select('*').eq('id', id).maybeSingle(), 'loading a profile');

async function createProfile({ id, displayName, email, role }) {
  const res = await t('profiles')
    .insert({ id, display_name: displayName, email, role })
    .select()
    .single();
  if (res.error?.code === '23505') return getProfile(id); // created a moment ago by another request
  return must(res, 'creating a profile');
}
async function updateProfile(id, patch) {
  return must(await t('profiles').update(patch).eq('id', id).select().single(), 'updating a profile');
}
const listProfiles = () =>
  selectAll((a, b) => t('profiles').select('*').order('created_at', { ascending: true }).range(a, b), 'listing profiles');

// ---------- books ----------
const getBookByOwner = async (ownerId) =>
  must(await t('books').select('*').eq('owner_id', ownerId).maybeSingle(), 'loading a book');
const getBook = async (id) =>
  must(await t('books').select('*').eq('id', id).maybeSingle(), 'loading a book');

async function createBookIfMissing(ownerId) {
  const existing = await getBookByOwner(ownerId);
  if (existing) return existing;
  const res = await t('books').insert({ owner_id: ownerId }).select().single();
  if (res.error?.code === '23505') return getBookByOwner(ownerId); // lost a race; use the winner
  return must(res, 'creating a book');
}
async function updateBook(id, patch) {
  return must(await t('books').update(patch).eq('id', id).select().single(), 'updating a book');
}
const listBooks = () =>
  selectAll((a, b) => t('books').select('*').order('created_at', { ascending: true }).range(a, b), 'listing books');

// ---------- entries (one per chapter, or one per person in the repeatable chapter) ----------
const listEntries = (bookId) =>
  selectAll(
    (a, b) => t('entries').select('*').eq('book_id', bookId).order('sort_order', { ascending: true }).range(a, b),
    'listing entries'
  );
const getEntry = async (id) =>
  must(await t('entries').select('*').eq('id', id).maybeSingle(), 'loading an entry');

/** Makes sure every non-repeatable chapter has its one entry. Safe to call repeatedly. */
async function ensureChapterEntries(bookId, chapterIds) {
  const entries = await listEntries(bookId);
  const have = new Set(entries.filter((e) => !e.person_name).map((e) => e.chapter_id));
  let created = false;
  for (const chapterId of chapterIds) {
    if (have.has(chapterId)) continue;
    const res = await t('entries').insert({ book_id: bookId, chapter_id: chapterId });
    if (res.error && res.error.code !== '23505') throw fail(res.error, 'creating a chapter');
    created = true;
  }
  return created ? listEntries(bookId) : entries;
}
const addPerson = async (bookId, chapterId, name, relationship, sortOrder) =>
  must(
    await t('entries')
      .insert({ book_id: bookId, chapter_id: chapterId, person_name: name, relationship, sort_order: sortOrder })
      .select()
      .single(),
    'adding a person'
  );
const updateEntry = async (id, patch) =>
  must(await t('entries').update(patch).eq('id', id).select().single(), 'updating an entry');
const deleteEntry = async (id) => must(await t('entries').delete().eq('id', id), 'deleting an entry');

// ---------- answers ----------
async function listAnswers(entryIds) {
  const rows = [];
  for (const ids of chunk(entryIds, IN_CHUNK)) {
    rows.push(
      ...(await selectAll((a, b) => t('answers').select('*').in('entry_id', ids).range(a, b), 'listing answers'))
    );
  }
  return rows;
}
const getAnswer = async (entryId, questionId) =>
  must(
    await t('answers').select('*').eq('entry_id', entryId).eq('question_id', questionId).maybeSingle(),
    'loading an answer'
  );
async function upsertAnswer(entryId, questionId, fields) {
  const row = { entry_id: entryId, question_id: questionId, updated_at: new Date().toISOString(), ...fields };
  return must(
    await t('answers').upsert(row, { onConflict: 'entry_id,question_id' }).select().single(),
    'saving an answer'
  );
}
const deleteAnswer = async (entryId, questionId) =>
  must(await t('answers').delete().eq('entry_id', entryId).eq('question_id', questionId), 'removing an answer');

// ---------- bonus photos ----------
async function listBonusPhotos(entryIds) {
  const rows = [];
  for (const ids of chunk(entryIds, IN_CHUNK)) {
    rows.push(
      ...(await selectAll(
        (a, b) => t('bonus_photos').select('*').in('entry_id', ids).order('sort_order', { ascending: true }).range(a, b),
        'listing photos'
      ))
    );
  }
  return rows;
}
const getBonusPhoto = async (id) =>
  must(await t('bonus_photos').select('*').eq('id', id).maybeSingle(), 'loading a photo');
const insertBonusPhoto = async (row) =>
  must(await t('bonus_photos').insert(row).select().single(), 'saving a photo');
const updateBonusPhoto = async (id, patch) =>
  must(await t('bonus_photos').update(patch).eq('id', id).select().single(), 'updating a photo');
const deleteBonusPhoto = async (id) => must(await t('bonus_photos').delete().eq('id', id), 'removing a photo');

/** Everything about one book in one go (used for progress, exports and the PDF). */
async function loadBookState(book) {
  const entries = await ensureChapterEntries(book.id, require('./schema').chapters.filter((c) => !c.repeatable).map((c) => c.id));
  const ids = entries.map((e) => e.id);
  const [answers, bonus] = await Promise.all([listAnswers(ids), listBonusPhotos(ids)]);
  return { book, entries, answers, bonus };
}

module.exports = {
  selectAll, must, chunk,
  getProfile, createProfile, updateProfile, listProfiles,
  getBookByOwner, getBook, createBookIfMissing, updateBook, listBooks,
  listEntries, getEntry, ensureChapterEntries, addPerson, updateEntry, deleteEntry,
  listAnswers, getAnswer, upsertAnswer, deleteAnswer,
  listBonusPhotos, getBonusPhoto, insertBonusPhoto, updateBonusPhoto, deleteBonusPhoto,
  loadBookState,
};
