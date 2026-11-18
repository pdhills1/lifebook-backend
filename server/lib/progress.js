// Works out how far through the book someone is. One implementation, used everywhere
// (the author's own screens, the admin page, and the "can I finish?" check).
const { chapters } = require('./schema');

const hasText = (row) => !!(row && typeof row.answer_text === 'string' && row.answer_text.trim());
const hasPhoto = (row) => !!(row && row.photo_storage_path);
const isAnswered = (question, row) => (question.type === 'photo' ? hasPhoto(row) : hasText(row));

function scoreEntry(chapter, answersByQuestion) {
  const core = chapter.questions.filter((q) => q.core);
  const coreAnswered = core.filter((q) => isAnswered(q, answersByQuestion[q.id])).length;
  const answered = chapter.questions.filter((q) => isAnswered(q, answersByQuestion[q.id])).length;
  const coreTotal = core.length;
  const complete = coreTotal > 0 ? coreAnswered === coreTotal : answered > 0;
  const fraction = coreTotal > 0 ? coreAnswered / coreTotal : answered > 0 ? 1 : 0;
  return { coreAnswered, coreTotal, answered, total: chapter.questions.length, complete, fraction };
}

/**
 * @param state  { book, entries, answers }  (see db.loadBookState)
 * @returns an overview of every chapter plus overall totals.
 */
function buildOverview(state) {
  const { book, entries, answers } = state;
  const byEntry = {};
  for (const a of answers) (byEntry[a.entry_id] ||= {})[a.question_id] = a;
  const skipped = new Set(book.skipped_chapters || []);

  const out = chapters.map((chapter) => {
    const base = {
      chapterId: chapter.id,
      number: chapter.number,
      title: chapter.title,
      subtitle: chapter.subtitle,
      repeatable: !!chapter.repeatable,
      skipped: skipped.has(chapter.id),
    };
    const mine = entries.filter((e) => e.chapter_id === chapter.id);

    if (!chapter.repeatable) {
      const entry = mine[0];
      const s = scoreEntry(chapter, entry ? byEntry[entry.id] || {} : {});
      return { ...base, entryId: entry?.id || null, ...s, people: [], done: base.skipped || s.complete,
        status: base.skipped ? 'skipped' : s.complete ? 'complete' : s.answered > 0 ? 'in_progress' : 'not_started',
        fraction: base.skipped ? 1 : s.fraction };
    }

    const people = mine
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((e) => ({ entryId: e.id, name: e.person_name, relationship: e.relationship, ...scoreEntry(chapter, byEntry[e.id] || {}) }));
    const allComplete = people.length > 0 && people.every((p) => p.complete);
    const anything = people.length > 0;
    const fraction = people.length ? people.reduce((n, p) => n + p.fraction, 0) / people.length : 0;
    return {
      ...base, entryId: null, people,
      coreAnswered: people.reduce((n, p) => n + p.coreAnswered, 0),
      coreTotal: people.reduce((n, p) => n + p.coreTotal, 0),
      answered: people.reduce((n, p) => n + p.answered, 0),
      total: people.reduce((n, p) => n + p.total, 0),
      complete: allComplete, done: base.skipped || allComplete,
      status: base.skipped ? 'skipped' : allComplete ? 'complete' : anything ? 'in_progress' : 'not_started',
      fraction: base.skipped ? 1 : fraction,
    };
  });

  const done = out.filter((c) => c.done).length;
  const percent = Math.round((100 * out.reduce((n, c) => n + c.fraction, 0)) / out.length);
  return {
    chapters: out,
    chaptersDone: done,
    chaptersTotal: out.length,
    percent,
    answeredTotal: out.reduce((n, c) => n + c.answered, 0),
    allDone: done === out.length,
    firstIncomplete: out.find((c) => !c.done)?.chapterId || null,
  };
}

module.exports = { buildOverview, isAnswered, hasText, hasPhoto };
