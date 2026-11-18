// The book's questions live in server/content/book-schema.json - the single source of truth.
// The website fetches it from /api/schema, so there is no second copy to keep in step.
const bookSchema = require('../content/book-schema.json');

const chapters = bookSchema.chapters;
const chapterById = Object.fromEntries(chapters.map((c) => [c.id, c]));
const questionIndex = {};
for (const c of chapters) for (const q of c.questions) questionIndex[q.id] = { chapter: c, question: q };

const getChapter = (id) => chapterById[id] || null;
const getQuestion = (id) => questionIndex[id]?.question || null;
const chapterOfQuestion = (id) => questionIndex[id]?.chapter || null;
const coreQuestions = (chapter) => chapter.questions.filter((q) => q.core);
const findByRole = (role) => {
  for (const c of chapters) for (const q of c.questions) if (q.role === role) return { chapter: c, question: q };
  return null;
};
const repeatableChapter = () => chapters.find((c) => c.repeatable) || null;

module.exports = {
  bookSchema, chapters, getChapter, getQuestion, chapterOfQuestion,
  coreQuestions, findByRole, repeatableChapter,
};
