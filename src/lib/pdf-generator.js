const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { supabaseAdmin } = require('./supabase');
const { getAllChapters } = require('./schema');

const PRINT_CSS = fs.readFileSync(path.join(__dirname, 'pdf-templates/print.css'), 'utf8');

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fetches everything needed to render a book: profile, all entries, answers, bonus photos. */
async function loadBookData(bookId) {
  const { data: book, error: bookError } = await supabaseAdmin
    .from('books')
    .select('*, profiles!books_owner_id_fkey(display_name)')
    .eq('id', bookId)
    .single();
  if (bookError || !book) {
    throw new Error(`Book ${bookId} not found: ${bookError?.message}`);
  }

  const { data: entries, error: entriesError } = await supabaseAdmin
    .from('entries')
    .select('*')
    .eq('book_id', bookId)
    .order('sort_order', { ascending: true });
  if (entriesError) throw new Error(`Failed to load entries: ${entriesError.message}`);

  const entryIds = entries.map((e) => e.id);

  const { data: answers, error: answersError } = entryIds.length
    ? await supabaseAdmin.from('answers').select('*').in('entry_id', entryIds)
    : { data: [], error: null };
  if (answersError) throw new Error(`Failed to load answers: ${answersError.message}`);

  const { data: bonusPhotos, error: bonusError } = entryIds.length
    ? await supabaseAdmin
        .from('bonus_photos')
        .select('*')
        .in('entry_id', entryIds)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };
  if (bonusError) throw new Error(`Failed to load bonus photos: ${bonusError.message}`);

  return { book, entries, answers: answers || [], bonusPhotos: bonusPhotos || [] };
}

/** Converts a Storage path into a signed URL Puppeteer can load directly. */
async function signedUrl(storagePath) {
  if (!storagePath) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(process.env.PHOTOS_BUCKET)
    .createSignedUrl(storagePath, 60 * 30); // 30 min — only needs to live as long as the render
  if (error) return null;
  return data.signedUrl;
}

/** Builds the full HTML document for the book, ready to hand to Puppeteer. */
async function buildBookHtml({ book, entries, answers, bonusPhotos }) {
  const answersByEntry = {};
  for (const a of answers) {
    if (!answersByEntry[a.entry_id]) answersByEntry[a.entry_id] = {};
    answersByEntry[a.entry_id][a.question_id] = a;
  }
  const bonusByEntry = {};
  for (const p of bonusPhotos) {
    if (!bonusByEntry[p.entry_id]) bonusByEntry[p.entry_id] = [];
    bonusByEntry[p.entry_id].push(p);
  }

  const authorName = book.profiles?.display_name || 'Author';

  // Cover page — pulls Chapter 1's title/dedication/photo question answers directly.
  const ch01Entry = entries.find((e) => e.chapter_id === 'ch01');
  const ch01Answers = ch01Entry ? answersByEntry[ch01Entry.id] || {} : {};
  const coverPhotoPath = ch01Answers['ch01_q5']?.photo_storage_path;
  const coverPhotoUrl = await signedUrl(coverPhotoPath);
  const dedication = ch01Answers['ch01_q3']?.answer_text;

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
    <style>${PRINT_CSS}</style></head><body>`;

  html += `<section class="cover">
    <h1 class="cover-title">${escapeHtml(book.title)}</h1>
    <p class="cover-subtitle">The story of ${escapeHtml(authorName)}</p>
    ${coverPhotoUrl ? `<img class="cover-photo" src="${coverPhotoUrl}" />` : ''}
    ${dedication ? `<p class="cover-dedication">${escapeHtml(dedication)}</p>` : ''}
  </section>`;

  // Each chapter, in schema order — not DB order — so the book always reads
  // in the intended narrative sequence regardless of how entries were created.
  for (const chapterDef of getAllChapters()) {
    const chapterEntries = entries.filter((e) => e.chapter_id === chapterDef.id);
    if (chapterEntries.length === 0) continue;

    html += `<section class="chapter">
      <h2 class="chapter-title">${escapeHtml(chapterDef.title)}</h2>
      <p class="chapter-subtitle">${escapeHtml(chapterDef.subtitle)}</p>`;

    for (const entry of chapterEntries) {
      if (chapterDef.repeatable) {
        html += `<h3 class="person-heading">${escapeHtml(entry.person_name)} — ${escapeHtml(entry.relationship)}</h3>`;
      }

      const entryAnswers = answersByEntry[entry.id] || {};

      for (const q of chapterDef.questions) {
        const answer = entryAnswers[q.id];

        if (q.type === 'photo') {
          if (!answer?.photo_storage_path) continue; // skip unanswered photo prompts entirely
          const url = await signedUrl(answer.photo_storage_path);
          html += `<div class="qa-block">
            <p class="qa-prompt">${escapeHtml(q.prompt)}</p>
            <img class="qa-photo" src="${url}" />
            ${answer.photo_caption ? `<p class="qa-photo-caption">${escapeHtml(answer.photo_caption)}</p>` : ''}
          </div>`;
        } else {
          const text = answer?.answer_text?.trim();
          if (!text) continue; // skip unanswered text questions entirely — no empty/italic placeholders in the final book
          html += `<div class="qa-block">
            <p class="qa-prompt">${escapeHtml(q.prompt)}</p>
            <p class="qa-answer">${escapeHtml(text)}</p>
          </div>`;
        }
      }

      const bonus = bonusByEntry[entry.id] || [];
      if (bonus.length > 0) {
        html += `<div class="bonus-gallery">`;
        for (const photo of bonus) {
          const url = await signedUrl(photo.photo_storage_path);
          html += `<div class="bonus-photo-item">
            <img src="${url}" />
            ${photo.caption ? `<p class="caption">${escapeHtml(photo.caption)}</p>` : ''}
          </div>`;
        }
        html += `</div>`;
      }
    }

    html += `</section>`;
  }

  html += `</body></html>`;
  return html;
}

/**
 * Generates the finished PDF for a book and uploads it to the PDFs bucket.
 * Returns the storage path of the resulting file.
 */
async function generateBookPdf(bookId) {
  const bookData = await loadBookData(bookId);
  const html = await buildBookHtml(bookData);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // required in most container hosting environments
  });

  let pdfBuffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' }); // wait for fonts/images to finish loading
    pdfBuffer = await page.pdf({
      format: 'A5',
      printBackground: true,
      margin: { top: '22mm', bottom: '22mm', left: '18mm', right: '18mm' },
    });
  } finally {
    await browser.close();
  }

  const storagePath = `${bookData.book.owner_id}/book.pdf`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(process.env.PDFS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload generated PDF: ${uploadError.message}`);
  }

  return storagePath;
}

module.exports = { generateBookPdf, buildBookHtml, loadBookData };
