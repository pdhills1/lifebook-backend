// Small helpers shared by the signed-in routes.
const db = require('./db');
const { buildOverview } = require('./progress');
const { notFound } = require('./errors');

/** Loads (or creates) the signed-in person's book and makes sure its chapters exist. */
async function withBook(req, _res, next) {
  req.book = await db.createBookIfMissing(req.user.id);
  next();
}

/** Returns an entry only if it belongs to the signed-in person's book. */
async function ownEntry(req, entryId) {
  const entry = typeof entryId === 'string' && entryId ? await db.getEntry(entryId) : null;
  if (!entry || entry.book_id !== req.book.id) throw notFound('That page could not be found.');
  return entry;
}

function bookPayload(book) {
  return {
    id: book.id,
    title: book.title,
    status: book.status,
    finishedAt: book.finished_at,
    skippedChapters: book.skipped_chapters || [],
    pdf: pdfPayload(book),
  };
}

const BUILD_TIMEOUT_MS = 5 * 60 * 1000;
function pdfPayload(book) {
  let status = book.pdf_status || 'none';
  let error = book.pdf_error || null;
  if (status === 'building' && Date.now() - new Date(book.pdf_requested_at || 0).getTime() > BUILD_TIMEOUT_MS) {
    status = 'failed';
    error = 'Building the book took too long. Please try again.';
  }
  return { status, error, builtAt: book.pdf_built_at, isFinal: !!book.pdf_is_final, emailedAt: book.pdf_emailed_at || null };
}

/** Fresh overview (re-reads the book too, since skipping a chapter changes it). */
async function overviewFor(bookId) {
  const book = await db.getBook(bookId);
  const state = await db.loadBookState(book);
  return { book, overview: buildOverview(state), state };
}

const touch = (bookId, patch = {}) => {
  const now = new Date().toISOString();
  return db.updateBook(bookId, { last_active_at: now, updated_at: now, ...patch });
};

module.exports = { withBook, ownEntry, bookPayload, pdfPayload, overviewFor, touch, BUILD_TIMEOUT_MS };
