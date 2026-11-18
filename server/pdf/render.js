// Turns prepared book content into a finished PDF (A5 pages, like a small hardback).
// Pure JavaScript (PDFKit): no browser needed, so it runs comfortably on a free host.
//
// `content` looks like:
//   { title, authorName, dedication, coverPhoto: Buffer|null, finishedAt: Date,
//     chapters: [{ title, subtitle, sections: [{ person: {name, relationship}|null,
//        items: [ {type:'qa', prompt, text} | {type:'photo', image, caption}
//               | {type:'gallery', photos:[{image, caption}]} | {type:'favourites', title, rows:[{label,text}]} ] }] }] }
const path = require('path');
const PDFDocument = require('pdfkit');
const fontkit = require('fontkit');

const FONT_DIR = path.join(__dirname, 'fonts');
const FONT_FILES = {
  Display: 'Fraunces-Regular.ttf',
  DisplayItalic: 'Fraunces-Italic.ttf',
  DisplayBold: 'Fraunces-SemiBold.ttf',
  Body: 'Literata-Regular.ttf',
  BodyItalic: 'Literata-Italic.ttf',
  BodyBold: 'Literata-SemiBold.ttf',
};

const C = { forest: '#2E5E4E', brass: '#9A6F2B', ink: '#2A2520', muted: '#6D6356', line: '#D9CDB6' };

// A5 in points, with generous margins so the text block feels like a book page.
const W = 419.53;
const H = 595.28;
const M = { top: 60, bottom: 68, left: 52, right: 52 };
const CW = W - M.left - M.right;

const NUMBER_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

// ---------- text safety: never print "missing glyph" boxes ----------
const coverage = {};
function fontFor(key) {
  return (coverage[key] ||= fontkit.openSync(path.join(FONT_DIR, FONT_FILES[key])));
}
/** Removes characters the fonts can't draw (emoji etc.) and tidies line endings. Reports how many were dropped. */
function makeCleaner(stats) {
  return function clean(text, fontKey = 'Body') {
    const font = fontFor(fontKey);
    const out = [];
    for (const ch of String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
      const cp = ch.codePointAt(0);
      if (ch === '\n') { out.push(ch); continue; }
      if (cp < 32 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f || cp === 0xfeff) continue;
      if (font.hasGlyphForCodePoint(cp)) out.push(ch);
      else stats.dropped += 1;
    }
    return out.join('');
  };
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

async function renderBookPdf(content) {
  const stats = { dropped: 0 };
  const clean = makeCleaner(stats);
  const warnings = [];

  const doc = new PDFDocument({
    size: [W, H],
    margins: { ...M },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: clean(content.title, 'Display'),
      Author: clean(content.authorName, 'Display'),
      Creator: 'My Story',
      Producer: 'My Story',
    },
  });
  for (const [name, file] of Object.entries(FONT_FILES)) doc.registerFont(name, path.join(FONT_DIR, file));

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Page bookkeeping, so we can add headers, numbers and the contents afterwards.
  let currentChapter = null;
  const pageInfo = []; // index -> { chapter, kind }
  doc.on('pageAdded', () => {
    pageInfo[doc.bufferedPageRange().count - 1] = { chapter: currentChapter, kind: currentChapter ? 'body' : 'front' };
  });
  const pageIndex = () => doc.bufferedPageRange().count - 1;
  const markKind = (kind) => { pageInfo[pageIndex()].kind = kind; };

  const newPage = () => {
    doc.addPage();
    doc.x = M.left;
    doc.y = M.top;
  };
  const ensure = (needed) => {
    if (doc.y + needed > H - M.bottom) newPage();
  };

  const ornament = (cx, y, color = C.brass) => {
    doc.save().lineWidth(0.7).strokeColor(color).fillColor(color);
    doc.moveTo(cx - 36, y).lineTo(cx - 9, y).stroke();
    doc.moveTo(cx + 9, y).lineTo(cx + 36, y).stroke();
    doc.moveTo(cx, y - 3.6).lineTo(cx + 3.6, y).lineTo(cx, y + 3.6).lineTo(cx - 3.6, y).closePath().fill();
    doc.restore();
  };

  const centred = (text, font, size, color, y, opts = {}) => {
    doc.font(font).fontSize(size).fillColor(color);
    doc.text(clean(text, font), opts.x ?? M.left, y, { width: opts.width ?? CW, align: 'center', lineGap: opts.lineGap ?? 2, characterSpacing: opts.spacing });
    return doc.y;
  };

  // ======================= cover =======================
  doc.addPage();
  doc.save().lineWidth(0.9).strokeColor(C.brass);
  doc.rect(26, 26, W - 52, H - 52).stroke();
  doc.lineWidth(0.4).rect(33, 33, W - 66, H - 66).stroke();
  doc.restore();

  let y = 92;
  if (content.coverPhoto) {
    const d = 176;
    const cx = W / 2;
    const cy = 104 + d / 2;
    try {
      doc.save();
      doc.circle(cx, cy, d / 2).clip();
      doc.image(content.coverPhoto, cx - d / 2, cy - d / 2, { cover: [d, d], align: 'center', valign: 'center' });
      doc.restore();
      doc.save().lineWidth(1).strokeColor(C.brass).circle(cx, cy, d / 2 + 5).stroke().restore();
      y = cy + d / 2 + 36;
    } catch (err) {
      warnings.push('The cover photo could not be placed.');
    }
  }
  const title = clean(content.title, 'DisplayBold') || 'My Story';
  const maxTitleH = content.coverPhoto ? 104 : 170;
  let size = 40;
  for (const s of [40, 36, 32, 28, 24, 20, 17]) {
    size = s;
    doc.font('DisplayBold').fontSize(s);
    if (doc.heightOfString(title, { width: W - 130, align: 'center', lineGap: 2 }) <= maxTitleH) break;
  }
  y = centred(title, 'DisplayBold', size, C.forest, content.coverPhoto ? y : 176, { x: 65, width: W - 130 }) + 16;
  ornament(W / 2, y);
  y += 26;
  y = centred('The story of', 'DisplayItalic', 12.5, C.muted, y);
  centred(content.authorName, 'Display', 20, C.ink, y + 2);

  // ======================= dedication =======================
  const dedication = clean(content.dedication || '', 'DisplayItalic').trim();
  if (dedication) {
    doc.addPage();
    ornament(W / 2, 190);
    doc.font('DisplayItalic').fontSize(13.5);
    const h = doc.heightOfString(dedication, { width: 250, align: 'center', lineGap: 5 });
    doc.fillColor(C.ink).text(dedication, (W - 250) / 2, 222, { width: 250, align: 'center', lineGap: 5 });
    ornament(W / 2, Math.min(222 + h + 30, H - 120));
    markKind('front');
  }

  // ======================= contents (filled in at the end) =======================
  doc.addPage();
  const contentsPage = pageIndex();

  // ======================= chapters =======================
  const toc = []; // { number, title, page, people: [{name, page}] }
  let chapterNumber = 0;

  const writeQA = (prompt, text) => {
    const paras = clean(text, 'Body').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!paras.length) return;
    const p = clean(prompt, 'DisplayItalic');
    doc.font('DisplayItalic').fontSize(11.5);
    const promptH = doc.heightOfString(p, { width: CW, lineGap: 1.5 });
    doc.font('Body').fontSize(10.6);
    const lineH = doc.currentLineHeight() + 3.2;
    const firstH = doc.heightOfString(paras[0], { width: CW, lineGap: 3.2 });
    ensure(promptH + 8 + Math.min(firstH, lineH * 3)); // keep the question with at least a few lines of answer
    doc.font('DisplayItalic').fontSize(11.5).fillColor(C.forest).text(p, M.left, doc.y, { width: CW, lineGap: 1.5 });
    doc.y += 5;
    for (const para of paras) {
      doc.font('Body').fontSize(10.6).fillColor(C.ink).text(para, M.left, doc.y, { width: CW, lineGap: 3.2, align: 'left' });
      doc.y += 6;
    }
    doc.y += 12;
  };

  const writePhoto = (image, caption) => {
    let img;
    try { img = doc.openImage(image); } catch { warnings.push('One photo could not be read and was left out.'); return; }
    const maxH = 262;
    let w = Math.min(CW, img.width);
    let h = img.height * (w / img.width);
    if (h > maxH) { h = maxH; w = img.width * (h / img.height); }
    const cap = clean(caption || '', 'BodyItalic').trim();
    const capW = Math.max(w, 210);
    doc.font('BodyItalic').fontSize(8.8);
    const capH = cap ? doc.heightOfString(cap, { width: capW, align: 'center' }) + 6 : 0;
    ensure(h + capH + 14);
    const x = M.left + (CW - w) / 2;
    const top = doc.y;
    doc.save().roundedRect(x, top, w, h, 3).clip();
    doc.image(img, x, top, { width: w, height: h });
    doc.restore();
    doc.save().lineWidth(0.5).strokeColor(C.line).roundedRect(x, top, w, h, 3).stroke().restore();
    doc.y = top + h + 6;
    if (cap) {
      doc.font('BodyItalic').fontSize(8.8).fillColor(C.muted).text(cap, M.left + (CW - capW) / 2, doc.y, { width: capW, align: 'center' });
    }
    doc.y += 18;
  };

  const writeGallery = (photos) => {
    const gap = 14;
    const cellW = (CW - gap) / 2;
    const maxH = 168;
    const opened = [];
    for (const p of photos) {
      try {
        const img = doc.openImage(p.image);
        let w = Math.min(cellW, img.width);
        let h = img.height * (w / img.width);
        if (h > maxH) { h = maxH; w = img.width * (h / img.height); }
        doc.font('BodyItalic').fontSize(8.3);
        const cap = clean(p.caption || '', 'BodyItalic').trim();
        opened.push({ img, w, h, cap, capH: cap ? doc.heightOfString(cap, { width: cellW, align: 'center' }) + 4 : 0 });
      } catch { warnings.push('One photo could not be read and was left out.'); }
    }
    for (let i = 0; i < opened.length; i += 2) {
      const row = opened.slice(i, i + 2);
      const rowH = Math.max(...row.map((r) => r.h + r.capH));
      ensure(rowH + 16);
      const top = doc.y;
      const startX = row.length === 1 ? M.left + (CW - cellW) / 2 : M.left;
      row.forEach((r, k) => {
        const cellX = startX + k * (cellW + gap);
        const x = cellX + (cellW - r.w) / 2;
        doc.save().roundedRect(x, top, r.w, r.h, 3).clip();
        doc.image(r.img, x, top, { width: r.w, height: r.h });
        doc.restore();
        doc.save().lineWidth(0.5).strokeColor(C.line).roundedRect(x, top, r.w, r.h, 3).stroke().restore();
        if (r.cap) doc.font('BodyItalic').fontSize(8.3).fillColor(C.muted).text(r.cap, cellX, top + r.h + 4, { width: cellW, align: 'center' });
      });
      doc.y = top + rowH + 14;
    }
  };

  const writeFavourites = (title, rows) => {
    const usable = rows.filter((r) => clean(r.text, 'Body').trim());
    if (!usable.length) return;
    ensure(40 + usable.length * 20);
    doc.font('DisplayItalic').fontSize(11.5).fillColor(C.forest).text(clean(title, 'DisplayItalic'), M.left, doc.y, { width: CW });
    doc.y += 6;
    doc.save().lineWidth(0.5).strokeColor(C.line).moveTo(M.left, doc.y).lineTo(M.left + CW, doc.y).stroke().restore();
    doc.y += 8;
    for (const r of usable) {
      const top = doc.y;
      doc.font('BodyBold').fontSize(8.8).fillColor(C.brass).text(clean(r.label, 'BodyBold').toUpperCase(), M.left, top + 1, { width: 104, characterSpacing: 0.6 });
      const labelBottom = doc.y;
      doc.font('Body').fontSize(10.4).fillColor(C.ink).text(clean(r.text, 'Body').replace(/\n+/g, ' ').trim(), M.left + 112, top, { width: CW - 112, lineGap: 2.4 });
      doc.y = Math.max(doc.y, labelBottom) + 7;
    }
    doc.y += 8;
  };

  for (const chapter of content.chapters) {
    chapterNumber += 1;
    currentChapter = clean(chapter.title, 'Display');
    newPage();
    markKind('opener');
    const entry = { number: chapterNumber, title: chapter.title, page: pageIndex(), people: [] };
    toc.push(entry);

    // opener
    let oy = 104;
    doc.font('BodyBold');
    oy = centred(`CHAPTER ${(NUMBER_WORDS[chapterNumber - 1] || String(chapterNumber)).toUpperCase()}`, 'BodyBold', 8.4, C.brass, oy, { spacing: 2.4 }) + 12;
    oy = centred(chapter.title, 'DisplayBold', 25, C.forest, oy, { lineGap: 3 }) + 14;
    ornament(W / 2, oy);
    oy += 20;
    if (chapter.subtitle) oy = centred(chapter.subtitle, 'DisplayItalic', 10.8, C.muted, oy, { x: 70, width: W - 140 });
    doc.y = oy + 34;
    doc.x = M.left;

    chapter.sections.forEach((section, sIdx) => {
      if (section.person) {
        if (sIdx > 0) newPage(); // each person starts on a fresh page
        else ensure(80);
        entry.people.push({ name: section.person.name, page: pageIndex() });
        doc.font('DisplayBold').fontSize(17).fillColor(C.forest).text(clean(section.person.name, 'DisplayBold'), M.left, doc.y, { width: CW, continued: false });
        doc.font('DisplayItalic').fontSize(10.5).fillColor(C.muted).text(clean(section.person.relationship, 'DisplayItalic'), M.left, doc.y + 1, { width: CW });
        doc.y += 7;
        doc.save().lineWidth(0.6).strokeColor(C.brass).moveTo(M.left, doc.y).lineTo(M.left + 40, doc.y).stroke().restore();
        doc.y += 16;
      }
      for (const item of section.items) {
        if (item.type === 'qa') writeQA(item.prompt, item.text);
        else if (item.type === 'photo') writePhoto(item.image, item.caption);
        else if (item.type === 'gallery') writeGallery(item.photos);
        else if (item.type === 'favourites') writeFavourites(item.title, item.rows);
      }
    });
  }
  currentChapter = null;

  // ======================= closing page =======================
  newPage();
  markKind('closing');
  ornament(W / 2, 232);
  let cy = centred(content.title, 'DisplayItalic', 17, C.forest, 252, { x: 70, width: W - 140, lineGap: 3 });
  cy = centred(`Written by ${content.authorName}`, 'Body', 10.5, C.ink, cy + 10);
  if (content.finishedAt) cy = centred(dateFmt.format(content.finishedAt), 'Body', 9.5, C.muted, cy + 4);
  ornament(W / 2, cy + 26);

  // ======================= contents page =======================
  const totalPeople = toc.reduce((n, c) => n + c.people.length, 0);
  const showPeople = toc.length + totalPeople <= 19;
  doc.switchToPage(contentsPage);
  const noLimit = doc.page.margins.bottom;
  doc.page.margins.bottom = 0; // stops PDFKit starting a new page while we fill this one
  centred('Contents', 'Display', 24, C.forest, 78);
  ornament(W / 2, 118);
  let ty = 148;
  const rowH = showPeople ? 22 : 25;
  const row = (label, page, { indent = 0, number = null, small = false } = {}) => {
    const size = small ? 9.6 : 11;
    const font = small ? 'BodyItalic' : 'Body';
    const labelX = M.left + indent + (number ? 26 : 0);
    if (number) doc.font('DisplayBold').fontSize(11).fillColor(C.brass).text(String(number), M.left + indent, ty, { width: 22, lineBreak: false });
    doc.font(font).fontSize(size).fillColor(small ? C.muted : C.ink);
    const text = clean(label, font);
    const maxW = CW - (labelX - M.left) - 28;
    let shown = text;
    while (doc.widthOfString(shown) > maxW && shown.length > 4) shown = shown.slice(0, -2);
    if (shown !== text) shown = `${shown.trimEnd()}…`;
    doc.text(shown, labelX, ty, { lineBreak: false });
    const textEnd = labelX + doc.widthOfString(shown) + 6;
    const pageStr = String(page + 1);
    doc.font('Body').fontSize(size).fillColor(C.muted);
    const pw = doc.widthOfString(pageStr);
    doc.text(pageStr, M.left + CW - pw, ty, { lineBreak: false });
    doc.save().dash(0.6, { space: 3 }).lineWidth(0.5).strokeColor(C.line)
      .moveTo(textEnd, ty + size * 0.85).lineTo(M.left + CW - pw - 6, ty + size * 0.85).stroke().undash().restore();
    ty += rowH;
  };
  for (const c of toc) {
    row(c.title, c.page, { number: c.number });
    if (showPeople) for (const p of c.people) row(`${p.name}`, p.page, { indent: 26, small: true });
  }
  doc.page.margins.bottom = noLimit;

  // ======================= headers and page numbers =======================
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const info = pageInfo[i] || { kind: 'front' };
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    if (i > 0 && info.kind !== 'closing') {
      doc.font('Body').fontSize(8.6).fillColor(C.muted);
      doc.text(String(i + 1), 0, H - 40, { width: W, align: 'center', lineBreak: false });
    }
    if (info.kind === 'body' && info.chapter) {
      const left = (i + 1) % 2 === 0;
      doc.font('DisplayItalic').fontSize(8.4).fillColor(C.muted);
      const label = clean(left ? content.title : info.chapter, 'DisplayItalic');
      doc.text(label, M.left, 32, { width: CW, align: left ? 'left' : 'right', lineBreak: false, ellipsis: true, height: 12 });
      doc.save().lineWidth(0.4).strokeColor(C.line).moveTo(M.left, 46).lineTo(M.left + CW, 46).stroke().restore();
    }
    doc.page.margins.bottom = saved;
  }

  if (stats.dropped > 0) {
    warnings.push(`${stats.dropped} character${stats.dropped === 1 ? '' : 's'} (such as emoji) can't be printed in the book and were left out.`);
  }
  const pageCount = range.count;
  doc.end();
  const buffer = await finished;
  return { buffer, pageCount, warnings: [...new Set(warnings)] };
}

module.exports = { renderBookPdf };
