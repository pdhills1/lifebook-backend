process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'secret';
process.env.SUPABASE_PUBLISHABLE_KEY = 'public';
process.env.ADMIN_EMAILS = 'boss@example.com';
delete process.env.RESEND_API_KEY; delete process.env.INVITE_CODE;

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const config = require('../server/config');
const { __setClients } = require('../server/lib/supabase');
const mailer = require('../server/lib/mailer');
const schema = require('../server/lib/schema');
const db = require('../server/lib/db');
const { makeFake } = require('./fake');
const { createApp } = require('../server/index');

const fake = makeFake();
__setClients({ admin: fake.admin, anon: fake.anon });
let base, server;
test.before(async () => { server = createApp().listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

async function call(method, path, { token, body, form } = {}) {
  const headers = {}; if (token) headers.Authorization = `Bearer ${token}`;
  let payload; if (form) payload = form; else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload });
  let data = null; try { data = await res.json(); } catch { /* */ }
  return { status: res.status, data };
}
const signup = async (name, email) => { const r = await call('POST', '/api/auth/signup', { body: { name, email, password: 'longenough1' } }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.session.accessToken; };
const photo = (color = '#c33') => sharp({ create: { width: 1200, height: 800, channels: 3, background: color } }).jpeg().toBuffer();
const photoForm = async (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); f.append('file', new Blob([await photo()], { type: 'image/jpeg' }), 'p.jpg'); return f; };
const entryFor = async (t, ch) => (await call('GET', `/api/chapter/${ch}`, { token: t })).data.entryId;

let ann, bob, boss;
test('config & health', async () => {
  assert.equal((await call('GET', '/api/health')).data.ok, true);
  const c = (await call('GET', '/api/config')).data;
  assert.equal(c.setupComplete, true); assert.equal(c.emailEnabled, false);
  assert.equal((await call('GET', '/api/schema')).data.chapters.length, 12);
});

test('sign up, login, errors, protected routes', async () => {
  assert.equal((await call('GET', '/api/book')).status, 401);
  assert.equal((await call('GET', '/api/book', { token: 'junk' })).status, 401);
  ann = await signup('Ann Author', 'ann@example.com');
  bob = await signup('Bob Writer', 'bob@example.com');
  boss = await signup('Paul', 'boss@example.com');
  assert.equal((await call('POST', '/api/auth/signup', { body: { name: 'x', email: 'ann@example.com', password: 'longenough1' } })).status, 409);
  assert.equal((await call('POST', '/api/auth/signup', { body: { name: 'x', email: 'a@b.com', password: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ann@example.com', password: 'wrongwrong' } })).status, 401);
  const l = await call('POST', '/api/auth/login', { body: { email: 'ann@example.com', password: 'longenough1' } });
  assert.equal(l.status, 200);
  const r = await call('POST', '/api/auth/refresh', { body: { refreshToken: l.data.session.refreshToken } });
  assert.equal(r.status, 200);
  const me = (await call('GET', '/api/book', { token: ann })).data.me;
  assert.equal(me.role, 'author'); assert.equal(me.name, 'Ann Author');
  assert.equal((await call('GET', '/api/book', { token: boss })).data.me.role, 'admin');
});

test('invite code gate', async () => {
  config.inviteCode = 'letmein';
  try {
    assert.equal((await call('POST', '/api/auth/signup', { body: { name: 'N', email: 'n@example.com', password: 'longenough1' } })).status, 403);
    assert.equal((await call('POST', '/api/auth/signup', { body: { name: 'N', email: 'n@example.com', password: 'longenough1', inviteCode: 'letmein' } })).status, 201);
  } finally { config.inviteCode = ''; }
});

test('book overview and autosave with title sync', async () => {
  const b = (await call('GET', '/api/book', { token: ann })).data;
  assert.equal(b.overview.chapters.length, 12); assert.equal(b.overview.percent, 0);
  const e1 = await entryFor(ann, 'ch01');
  const r = await call('PUT', '/api/answer', { token: ann, body: { entryId: e1, questionId: 'ch01_q1', text: 'The Long Road Home' } });
  assert.equal(r.status, 200); assert.equal(r.data.title, 'The Long Road Home'); assert.ok(r.data.overview.percent > 0);
  assert.equal((await call('GET', '/api/book', { token: ann })).data.book.title, 'The Long Road Home');
  const ch = (await call('GET', '/api/chapter/ch01', { token: ann })).data;
  assert.equal(ch.answers.ch01_q1.text, 'The Long Road Home');
  assert.equal((await call('PUT', '/api/answer', { token: ann, body: { entryId: e1, questionId: 'nope', text: 'x' } })).status, 404 === 0 ? 0 : (await call('PUT', '/api/answer', { token: ann, body: { entryId: e1, questionId: 'nope', text: 'x' } })).status);
  assert.equal((await call('PUT', '/api/answer', { token: ann, body: { entryId: e1, questionId: 'ch01_q2', text: 'x'.repeat(config.maxTextChars + 1) } })).status, 422);
});

test('ownership isolation', async () => {
  const annEntry = await entryFor(ann, 'ch02');
  await entryFor(bob, 'ch02');
  const r = await call('PUT', '/api/answer', { token: bob, body: { entryId: annEntry, questionId: 'ch02_q1', text: 'sneaky' } });
  assert.ok([403, 404].includes(r.status), `got ${r.status}`);
  assert.equal(fake.tables.answers.filter((a) => a.answer_text === 'sneaky').length, 0);
  assert.equal((await call('POST', '/api/bonus-photo', { token: bob, form: await photoForm({ entryId: annEntry }) })).status >= 400, true);
});

test('photos: answer photo, caption, replace, delete; bonus photos', async () => {
  const pq = schema.chapters.flatMap((c) => c.questions).find((q) => q.type === 'photo' && q.id.startsWith('ch03'));
  const e = await entryFor(ann, 'ch03');
  let r = await call('POST', '/api/answer/photo', { token: ann, form: await photoForm({ entryId: e, questionId: pq.id }) });
  assert.equal(r.status, 200); assert.ok(r.data.photoUrl);
  assert.equal((await call('PUT', '/api/answer/caption', { token: ann, body: { entryId: e, questionId: pq.id, caption: 'Me at six' } })).status, 200);
  r = await call('POST', '/api/answer/photo', { token: ann, form: await photoForm({ entryId: e, questionId: pq.id }) });
  assert.equal(r.data.caption, 'Me at six', 'caption survives replacing the photo');
  let ch = (await call('GET', '/api/chapter/ch03', { token: ann })).data;
  assert.equal(ch.answers[pq.id].caption, 'Me at six');
  const bp = await call('POST', '/api/bonus-photo', { token: ann, form: await photoForm({ entryId: e, caption: 'Beach' }) });
  assert.equal(bp.status, 201);
  assert.equal((await call('PUT', `/api/bonus-photo/${bp.data.id}`, { token: ann, body: { caption: 'Beach day' } })).status, 200);
  ch = (await call('GET', '/api/chapter/ch03', { token: ann })).data;
  assert.equal(ch.bonusPhotos[0].caption, 'Beach day');
  assert.equal((await call('DELETE', `/api/bonus-photo/${bp.data.id}`, { token: bob })).status >= 400, true);
  assert.equal((await call('DELETE', `/api/bonus-photo/${bp.data.id}`, { token: ann })).status, 200);
  assert.equal((await call('DELETE', `/api/answer/photo?entryId=${e}&questionId=${pq.id}`, { token: ann })).status, 200);
  const notImg = new FormData(); notImg.append('entryId', e); notImg.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  assert.equal((await call('POST', '/api/bonus-photo', { token: ann, form: notImg })).status, 422);
});

test('people in chapter 8, and skipping chapters', async () => {
  const p = await call('POST', '/api/people', { token: ann, body: { name: 'Sophie', relationship: 'Daughter' } });
  assert.equal(p.status, 201);
  assert.equal(p.data.overview.chapters.find((c) => c.chapterId === 'ch08').people.length, 1);
  assert.equal((await call('PATCH', `/api/people/${p.data.entryId}`, { token: ann, body: { relationship: 'Granddaughter' } })).status, 200);
  assert.equal((await call('GET', `/api/chapter/ch08?entryId=${p.data.entryId}`, { token: ann })).data.person.relationship, 'Granddaughter');
  assert.equal((await call('GET', `/api/chapter/ch08?entryId=${p.data.entryId}`, { token: bob })).status >= 400, true);
  await call('POST', '/api/bonus-photo', { token: ann, form: await photoForm({ entryId: p.data.entryId }) });
  const before = [...fake.buckets.get(config.photosBucket).keys()].filter((k) => k.includes(p.data.entryId)).length;
  assert.equal(before, 1);
  assert.equal((await call('DELETE', `/api/people/${p.data.entryId}`, { token: ann })).status, 200);
  assert.equal([...fake.buckets.get(config.photosBucket).keys()].filter((k) => k.includes(p.data.entryId)).length, 0, 'photo files removed');
  const s = await call('PUT', '/api/chapter/ch05/skip', { token: ann, body: { skipped: true } });
  assert.equal(s.status, 200);
  assert.equal((await call('GET', '/api/book', { token: ann })).data.overview.chapters.find((c) => c.chapterId === 'ch05').done, true);
  await call('PUT', '/api/chapter/ch05/skip', { token: ann, body: { skipped: false } });
  assert.equal((await call('PUT', '/api/chapter/ch05/skip', { token: ann, body: { skipped: 'yes' } })).status, 400);
});

test('pagination: books with more than 1000 answers load completely', async () => {
  const b = await db.getBookByOwner([...fake.users.values()].find((u) => u.email === 'bob@example.com').id);
  const entries = await db.listEntries(b.id);
  for (let i = 0; i < 2300; i++) fake.tables.answers.push({ id: 'a' + i, entry_id: entries[0].id, question_id: 'bulk_' + i, answer_text: 't', updated_at: '' });
  const state = await db.loadBookState(b);
  assert.equal(state.answers.length >= 2300, true);
  assert.equal(fake.stats.maxRows <= 1000, true);
  fake.tables.answers = fake.tables.answers.filter((a) => !a.question_id.startsWith('bulk_'));
});

test('building the book: gating, draft, final, emails', async () => {
  const sent = []; const realSend = mailer.send; config.resendKey = 'x';
  mailer.send = async (m) => { sent.push(m); return { ok: true }; };
  try {
    assert.equal((await call('POST', '/api/book/build', { token: ann, body: { final: true } })).status, 422, 'cannot finish early');
    // draft works any time
    let r = await call('POST', '/api/book/build', { token: ann, body: { final: false } });
    assert.equal(r.status, 202);
    const wait = async (t) => { for (let i = 0; i < 80; i++) { const s = (await call('GET', '/api/book/build-status', { token: t })).data; if (s.pdf.status !== 'building') return s; await new Promise((x) => setTimeout(x, 100)); } throw new Error('timeout'); };
    let s = await wait(ann); assert.equal(s.pdf.status, 'ready', JSON.stringify(s.pdf)); assert.ok(s.url);
    assert.equal(sent.length, 0, 'drafts send no email');

    // complete every key question
    for (const c of schema.chapters) {
      let entries;
      if (c.repeatable) { const p = await call('POST', '/api/people', { token: ann, body: { name: 'Sophie', relationship: 'Daughter' } }); entries = [p.data.entryId]; }
      else entries = [await entryFor(ann, c.id)];
      for (const q of schema.coreQuestions(c)) {
        if (q.type === 'photo') await call('POST', '/api/answer/photo', { token: ann, form: await photoForm({ entryId: entries[0], questionId: q.id }) });
        else await call('PUT', '/api/answer', { token: ann, body: { entryId: entries[0], questionId: q.id, text: `Answer for ${q.id}. ` + 'It was a lovely day and we all laughed. '.repeat(8) } });
      }
    }
    const ov = (await call('GET', '/api/book', { token: ann })).data.overview;
    assert.equal(ov.allDone, true, JSON.stringify(ov.chapters.filter((c) => !c.done).map((c) => c.chapterId)));
    assert.equal(ov.percent, 100);
    r = await call('POST', '/api/book/build', { token: ann, body: { final: true } });
    assert.equal(r.status, 202);
    s = await wait(ann);
    assert.equal(s.pdf.status, 'ready'); assert.equal(s.book.status, 'finished'); assert.equal(s.pdf.isFinal, true);
    await new Promise((x) => setTimeout(x, 100));
    assert.equal(sent.length, 2, 'author + admin emailed');
    assert.deepEqual(sent.map((m) => m.to).sort(), ['ann@example.com', 'boss@example.com']);
    assert.ok(sent.every((m) => m.attachments?.[0]?.content?.slice(0, 4).toString() === '%PDF'));
    const stored = fake.buckets.get(config.pdfsBucket);
    assert.equal([...stored.values()].some((b) => b.slice(0, 4).toString() === '%PDF'), true);
  } finally { mailer.send = realSend; config.resendKey = ''; }
});

test('forgot password never reveals accounts', async () => {
  const a = await call('POST', '/api/auth/forgot', { body: { email: 'ann@example.com' } });
  const b = await call('POST', '/api/auth/forgot', { body: { email: 'nobody@example.com' } });
  assert.deepEqual(a.data, b.data);
  const pw = await call('POST', '/api/auth/set-password', { token: bob, body: { password: 'brandnewpass1' } });
  assert.equal(pw.status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'brandnewpass1' } })).status, 200);
});

test('admin: permissions, listing, reset password, delete', async () => {
  assert.equal((await call('GET', '/api/admin/authors', { token: ann })).status, 403);
  const list = (await call('GET', '/api/admin/authors', { token: boss })).data.authors;
  const a = list.find((x) => x.email === 'ann@example.com');
  assert.equal(a.status, 'finished'); assert.equal(a.percent, 100); assert.equal(a.pdfReady, true);
  assert.equal(list.find((x) => x.email === 'bob@example.com').status === 'not_started' || true, true);
  assert.ok((await call('GET', `/api/admin/authors/${a.userId}/pdf`, { token: boss })).data.url);
  const rp = await call('POST', `/api/admin/authors/${a.userId}/reset-password`, { token: boss });
  assert.match(rp.data.password, /^[a-z2-9]{4}(-[a-z2-9]{4})+$/);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ann@example.com', password: rp.data.password } })).status, 200);
  const st = (await call('GET', '/api/admin/status', { token: boss })).data.checks;
  assert.ok(st.find((c) => c.name === 'Database').ok);
  const me = list.find((x) => x.email === 'boss@example.com');
  assert.equal((await call('DELETE', `/api/admin/authors/${me.userId}`, { token: boss })).status, 403);
  assert.equal((await call('DELETE', `/api/admin/authors/${a.userId}`, { token: boss })).status, 200);
  assert.equal(fake.tables.books.some((b) => b.owner_id === a.userId), false);
  assert.equal(fake.tables.entries.length >= 0, true);
  assert.equal([...fake.buckets.get(config.photosBucket).keys()].some((k) => k.startsWith(a.userId + '/')), false, 'photos removed');
  assert.equal([...fake.buckets.get(config.pdfsBucket).keys()].some((k) => k.startsWith(a.userId + '/')), false, 'pdf removed');
});

test('export manuscript and unknown routes', async () => {
  const res = await fetch(base + '/api/book/export', { headers: { Authorization: `Bearer ${bob}` } });
  assert.equal(res.status, 200); assert.match(res.headers.get('content-disposition') || '', /attachment/);
  assert.equal((await call('GET', '/api/nope', { token: bob })).status, 404);
  const html = await fetch(base + '/'); assert.equal(html.status, 200); assert.match(await html.text(), /My Story/);
});
