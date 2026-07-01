const bookSchema = require('./book-schema.json');

const chaptersById = Object.fromEntries(bookSchema.chapters.map((c) => [c.id, c]));

function getChapter(chapterId) {
  return chaptersById[chapterId] || null;
}

function getAllChapters() {
  return bookSchema.chapters;
}

function getNonRepeatableChapterIds() {
  return bookSchema.chapters.filter((c) => !c.repeatable).map((c) => c.id);
}

function getCoreQuestionIds(chapterId) {
  const chapter = getChapter(chapterId);
  if (!chapter) return [];
  return chapter.questions.filter((q) => q.core).map((q) => q.id);
}

function getAllQuestionIds(chapterId) {
  const chapter = getChapter(chapterId);
  if (!chapter) return [];
  return chapter.questions.map((q) => q.id);
}

function isPhotoQuestion(chapterId, questionId) {
  const chapter = getChapter(chapterId);
  if (!chapter) return false;
  const q = chapter.questions.find((q) => q.id === questionId);
  return q?.type === 'photo';
}

module.exports = {
  bookSchema,
  getChapter,
  getAllChapters,
  getNonRepeatableChapterIds,
  getCoreQuestionIds,
  getAllQuestionIds,
  isPhotoQuestion,
};
