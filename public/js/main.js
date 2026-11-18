import { api, get, post, put, patch, del, setSession, hasSession, setOnSignedOut, ApiError } from './api.js';
import { esc, $, $$, icon, toast, confirmBox, when, shrink } from './ui.js';
import { queue, flush, getDraft, status, setOnSaved, busy } from './autosave.js';

const S = { cfg: null, schema: null, data: null, recovery: null };
const app = $('#app');

// ---------- text size ----------
const sizes = ['m', 'l', 'xl'];
let size = 'm'; try { size = localStorage.getItem('mystory.size') || 'm'; } catch { /* */ }
const applySize = () => { document.documentElement.dataset.size = size; };
applySize();

// ---------- helpers ----------
const chapterById = (id) => S.schema.chapters.find((c) => c.id === id);
const ovChap = (id) => S.data.overview.chapters.find((c) => c.chapterId === id);
async function loadBook() { S.data = await get('/api/book'); return S.data; }
setOnSaved((res) => {
  if (res?.overview && S.data) S.data.overview = res.overview;
  if (res?.title !== undefined && S.data) S.data.book.title = res.title;
});
setOnSignedOut(() => { S.data = null; location.hash = '#/'; render(); });
const pct = (c) => Math.round((c.fraction || 0) * 100);

function shell(inner, { title, back } = {}) {
  const me = S.data?.me;
  app.innerHTML = `
  <header class="bar"><div class="wrap">
    <a class="brand" href="#/">${icon('book')}<span>${esc(S.data?.book?.title || S.cfg.productName)}</span></a>
    <span id="savechip" class="chip" hidden></span>
    <button class="tool" id="sz" title="Make the text bigger or smaller" aria-label="Change text size">${icon('text')}<span class="lbl">Text size</span></button>
    ${me?.role === 'admin' ? `<a class="tool" href="#/admin">${icon('shield')}<span class="lbl">Admin</span></a>` : ''}
    <button class="tool" id="out">${icon('out')}<span class="lbl">Sign out</span></button>
  </div></header>
  <main id="main"><div class="wrap">${inner}</div></main>`;
  document.title = (title ? title + ' · ' : '') + S.cfg.productName;
  $('#sz').onclick = () => { size = sizes[(sizes.indexOf(size) + 1) % 3]; applySize(); try { localStorage.setItem('mystory.size', size); } catch { /* */ } toast(['Normal', 'Large', 'Extra large'][sizes.indexOf(size)] + ' text'); };
  $('#out').onclick = signOut;
  window.scrollTo(0, 0);
}
async function signOut() {
  await flush().catch(() => {});
  if (busy() && !(await confirmBox({ title: 'Some changes are not saved yet', body: 'Sign out anyway?', ok: 'Sign out', danger: true }))) return;
  try { await post('/api/auth/logout'); } catch { /* */ }
  setSession(null); S.data = null; location.hash = '#/'; render();
}

// ---------- routing ----------
async function render() {
  try {
    if (!S.cfg) { S.cfg = await fetch('/api/config').then((r) => r.json()); S.schema = await fetch('/api/schema').then((r) => r.json()); }
    if (!S.cfg.setupComplete) return setupView();
    if (S.recovery) return passwordView();
    if (!hasSession()) return authView();
    if (!S.data) await loadBook();
    const [, route = '', a] = location.hash.replace(/^#\/?/, '#/').split('/');
    if (route === 'chapter') return a === 'ch08' ? peopleView() : chapterView(a);
    if (route === 'person') return chapterView('ch08', a);
    if (route === 'finish') return finishView();
    if (route === 'admin' && S.data.me.role === 'admin') return adminView();
    return homeView();
  } catch (e) {
    if (e.status === 401) return;
    app.innerHTML = `<div class="wrap narrow" style="padding-top:12vh"><div class="card"><h2>Sorry, something went wrong</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
  }
}
addEventListener('hashchange', render);

// recovery link from the "forgot password" email: #access_token=...&refresh_token=...&type=recovery
(function () {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('type') === 'recovery' && h.get('access_token')) {
    S.recovery = { accessToken: h.get('access_token'), refreshToken: h.get('refresh_token') };
    history.replaceState(null, '', location.pathname);
  }
})();

// ---------- set-up not finished ----------
function setupView() {
  app.innerHTML = `<div class="wrap narrow" style="padding-top:10vh"><div class="card stack"><h2>Almost there</h2>
  <p>The website is running, but it hasn't been connected to its database yet. Follow <b>step 4</b> of the setup guide (adding the Supabase keys), then refresh this page.</p>
  <button class="btn" onclick="location.reload()">Refresh</button></div></div>`;
}

// ---------- sign in / create account ----------
function authView(mode = 'in') {
  const invite = S.cfg.inviteRequired;
  app.innerHTML = `<div class="auth">
  <section class="side"><svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#E3C77F" opacity=".18"/><path d="M18 16h20a8 8 0 0 1 8 8v24H26a8 8 0 0 1-8-8z" fill="none" stroke="#E3C77F" stroke-width="3"/><path d="M26 28h14M26 35h10" stroke="#E3C77F" stroke-width="3" stroke-linecap="round"/></svg>
    <h1>${esc(S.cfg.productName)}</h1><p>Your life, in your own words. Answer a few questions at a time, add your favourite photos, and we'll turn it all into a beautiful book to keep and share.</p></section>
  <section class="form"><div class="box" id="authbox"></div></section></div>`;
  const box = $('#authbox');
  const draw = (m) => {
    if (m === 'forgot') {
      box.innerHTML = `<h2>Forgotten your password?</h2><div id="msg"></div><form id="f"><div class="field"><label for="em">Your email address</label><input id="em" type="email" autocomplete="email" required></div>
      <button class="btn big" style="width:100%">Send me a link</button></form><p style="margin-top:14px"><button class="link" id="back">← Back to sign in</button></p>`;
      $('#back').onclick = () => draw('in');
      $('#f').onsubmit = async (e) => { e.preventDefault(); const r = await post('/api/auth/forgot', { email: $('#em').value }).catch((x) => ({ err: x })); 
        $('#msg').innerHTML = r.err ? `<div class="err">${esc(r.err.message)}</div>` : r.emailEnabled ? `<div class="note">If there's an account with that address, a link is on its way. Check your inbox (and junk folder).</div>` : `<div class="note">Emails aren't switched on for this site. Please ask the person who invited you to reset your password.</div>`; };
      return;
    }
    const up = m === 'up';
    box.innerHTML = `<div class="tabs" role="tablist"><button role="tab" aria-selected="${!up}" data-m="in">Sign in</button><button role="tab" aria-selected="${up}" data-m="up">Create account</button></div>
    <div id="msg"></div>
    <form id="f" novalidate>
      ${up ? `<div class="field"><label for="nm">Your name</label><input id="nm" type="text" autocomplete="name" required></div>` : ''}
      <div class="field"><label for="em">Email address</label><input id="em" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Password${up ? ' <span class="muted small">(at least 8 characters)</span>' : ''}</label><input id="pw" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" required>
        <button type="button" class="link small" id="show">Show password</button></div>
      ${up && invite ? `<div class="field"><label for="ic">Invite code</label><input id="ic" type="text" autocomplete="off"><div class="hint">You'll have been given this by the person who invited you.</div></div>` : ''}
      <button class="btn big" style="width:100%" id="go">${up ? 'Create my account' : 'Sign in'}</button>
    </form>
    ${up ? '' : '<p style="margin-top:14px"><button class="link" id="fg">I\'ve forgotten my password</button></p>'}`;
    $$('.tabs button').forEach((b) => (b.onclick = () => draw(b.dataset.m)));
    $('#show').onclick = (e) => { const p = $('#pw'); p.type = p.type === 'password' ? 'text' : 'password'; e.target.textContent = p.type === 'password' ? 'Show password' : 'Hide password'; };
    if (!up) $('#fg').onclick = () => draw('forgot');
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const go = $('#go'); go.disabled = true; go.textContent = 'One moment…'; $('#msg').innerHTML = '';
      try {
        const body = { email: $('#em').value.trim(), password: $('#pw').value };
        if (up) { body.name = $('#nm').value; if (invite) body.inviteCode = $('#ic').value; }
        const r = await post(up ? '/api/auth/signup' : '/api/auth/login', body);
        setSession(r.session); location.hash = '#/'; S.data = null; await render();
      } catch (x) { $('#msg').innerHTML = `<div class="err" role="alert">${esc(x.message)}</div>`; go.disabled = false; go.textContent = up ? 'Create my account' : 'Sign in'; }
    };
  };
  draw(mode);
}

function passwordView() {
  app.innerHTML = `<div class="wrap narrow" style="padding-top:10vh"><div class="card"><h2>Choose a new password</h2><div id="msg"></div>
  <form id="f"><div class="field"><label for="pw">New password <span class="muted small">(at least 8 characters)</span></label><input id="pw" type="password" autocomplete="new-password" required></div>
  <button class="btn big">Save password</button></form></div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/auth/set-password', { password: $('#pw').value }, { token: S.recovery.accessToken });
      setSession({ accessToken: S.recovery.accessToken, refreshToken: S.recovery.refreshToken }); S.recovery = null; S.data = null;
      toast('Password changed'); await render();
    } catch (x) { $('#msg').innerHTML = `<div class="err">${esc(x.message)}</div>`; }
  };
}

// ---------- home ----------
function homeView() {
  const { overview: o, book, me } = S.data;
  const next = o.firstIncomplete ? o.chapters.find((c) => c.chapterId === (o.firstIncomplete.chapterId || o.firstIncomplete)) : null;
  const started = o.answeredTotal > 0;
  const first = (me.name || '').split(' ')[0];
  const link = (c) => `#/chapter/${c.chapterId}`;
  const label = (c) => c.skipped ? 'Left out of the book' : c.status === 'complete' ? 'Done' : c.status === 'in_progress' ? `${c.coreAnswered} of ${c.coreTotal} key questions` : 'Not started';
  shell(`
  <div class="stack">
  <section class="card hero">
    <div class="ring" style="--p:${o.percent}"><span>${o.percent}%</span></div>
    <div class="txt">
      <h1>${started ? `Welcome back, ${esc(first)}` : `Welcome, ${esc(first)}`}</h1>
      <p class="muted">${o.allDone ? 'Every chapter is done. You can read it through, then finish your book.' : started ? `${o.chaptersDone} of ${o.chaptersTotal} chapters complete. There's no hurry - everything you write is saved automatically.` : 'Take your time. Answer what you like, skip what you don\'t, and come back whenever you want - everything is saved as you go.'}</p>
      <div class="row" style="margin-top:10px">${o.allDone
        ? `<a class="btn brass big" href="#/finish">${icon('book')} Finish my book</a>`
        : next ? `<a class="btn big" href="${link(next)}">${started ? 'Carry on writing' : 'Start my story'} ${icon('next')}</a>` : ''}</div>
    </div>
  </section>
  <section><h2>Your chapters</h2>
    <div class="grid">${o.chapters.map((c) => `
      <a class="chap ${c.done ? 'done' : ''} ${c.skipped ? 'skipped' : ''}" href="${link(c)}">
        <span class="num">Chapter ${c.number}</span><span class="t">${esc(c.title)}</span>
        <span class="meter"><i style="width:${pct(c)}%"></i></span>
        <span class="st">${c.done && !c.skipped ? icon('check') : ''}${esc(label(c))}</span></a>`).join('')}
    </div></section>
  <section class="card"><h3>Ready to make your book?</h3>
    <p class="muted">You can see a draft of the book at any time. When every chapter is complete, you can finish it and it will be emailed to you.</p>
    <div class="row"><a class="btn secondary" href="#/finish">See my book${book.status === 'finished' ? ' / download' : ''}</a></div></section>
  </div>`, { title: 'My chapters' });
}

// ---------- chapter ----------
const photoBlock = (q, a) => a?.photoUrl
  ? `<div class="photo"><img src="${esc(a.photoUrl)}" alt=""><div class="meta"><label class="small muted" for="cap_${q.id}">Caption</label><input type="text" id="cap_${q.id}" class="write" value="${esc(a.caption)}" placeholder="Who or what is in this photo?" maxlength="300">
     <div class="row" style="margin-top:10px"><button class="btn secondary small" data-act="replace">Choose a different photo</button><button class="btn secondary small" data-act="remove">${icon('trash')} Remove</button></div></div></div>`
  : `<div class="dropzone" tabindex="0" role="button" data-act="pick"><b>${icon('camera')} Add a photo</b>Tap here to choose one, or drag it onto this box</div>`;

async function chapterView(id, entryId) {
  const chapter = chapterById(id);
  if (!chapter) { location.hash = '#/'; return; }
  shell('<p class="muted">Opening chapter…</p>');
  const data = await get(`/api/chapter/${id}${entryId ? `?entryId=${entryId}` : ''}`);
  const eid = data.entryId, ans = data.answers;
  const isPerson = chapter.repeatable;
  const idx = S.schema.chapters.findIndex((c) => c.id === id);
  const prev = S.schema.chapters[idx - 1], nxt = S.schema.chapters[idx + 1];
  const title = isPerson ? `${data.person.name}` : chapter.title;
  const sub = isPerson ? `${esc(data.person.relationship || '')}` : esc(chapter.subtitle || '');

  const qHtml = (q, labelOverride) => {
    const a = ans[q.id];
    const tag = q.core ? '<span class="tag">Key question</span>' : '<span class="tag opt">Optional</span>';
    const echo = data.echoes[q.id] ? `<div class="echo"><b>${esc(data.echoes[q.id].label)}</b>${esc(data.echoes[q.id].text)}</div>` : '';
    if (q.type === 'photo') return `<div class="q" data-q="${q.id}"><label class="p">${esc(q.prompt)}${tag}</label><div class="pbody">${photoBlock(q, a)}</div></div>`;
    const draft = getDraft(eid, q.id);
    const val = draft ?? a?.text ?? '';
    if (q.type === 'text_short') return `<div class="q" data-q="${q.id}"><label class="p" for="f_${q.id}">${esc(labelOverride || q.prompt)}${labelOverride ? '' : tag}</label>${echo}<input class="write" type="text" id="f_${q.id}" value="${esc(val)}" maxlength="300"></div>`;
    return `<div class="q" data-q="${q.id}"><label class="p" for="f_${q.id}">${esc(q.prompt)}${tag}</label>${echo}<textarea id="f_${q.id}" rows="6">${esc(val)}</textarea></div>`;
  };

  let body = '', done = new Set();
  for (const q of chapter.questions) {
    if (done.has(q.id)) continue;
    if (q.group) {
      const g = chapter.questions.filter((x) => x.group === q.group); g.forEach((x) => done.add(x.id));
      body += `<div class="q"><label class="p" style="margin-bottom:.9rem">${esc(chapter.groups?.[q.group] || 'A few favourites')}</label><div class="stack">${g.map((x) => `<div data-q="${x.id}"><label for="f_${x.id}" style="font-weight:600">${esc(x.label || x.prompt)}</label><input class="write" type="text" id="f_${x.id}" value="${esc(getDraft(eid, x.id) ?? ans[x.id]?.text ?? '')}" maxlength="300"></div>`).join('')}</div></div>`;
    } else body += qHtml(q);
  }

  shell(`
  <a class="crumb" href="${isPerson ? '#/chapter/ch08' : '#/'}">${icon('back')} ${isPerson ? 'Everyone in this chapter' : 'All chapters'}</a>
  <div class="chead"><div class="num">${isPerson ? esc(chapter.title) : `Chapter ${chapter.number}`}</div><h1>${esc(title)}</h1><p class="muted">${sub}</p>
    ${isPerson ? `<button class="link small" id="edp">Change name or relationship</button> · <button class="link small" id="dlp" style="color:var(--danger)">Remove this person</button>` : ''}</div>
  ${data.skipped ? `<div class="note">You've chosen to leave this chapter out of your book. <button class="link" id="unskip">Put it back</button></div>` : ''}
  <div class="stack" ${data.skipped ? 'style="opacity:.55"' : ''}>${body}
    <div class="q"><label class="p">Extra photos for this ${isPerson ? 'person' : 'chapter'}</label><p class="muted small">Add any other photos you'd like to include, each with a caption.</p>
      <div id="bonus" class="photos"></div><div class="dropzone" id="bdrop" tabindex="0" role="button" style="margin-top:14px"><b>${icon('plus')} Add photos</b>Choose one or several photos</div></div>
  </div>
  <div class="pager">${!isPerson && prev ? `<a class="btn secondary" href="#/chapter/${prev.id}">${icon('back')} ${esc(prev.title)}</a>` : '<span></span>'}
    ${isPerson ? `<a class="btn" href="#/chapter/ch08">${icon('check')} Done with ${esc(data.person.name)}</a>` : nxt ? `<a class="btn" href="#/chapter/${nxt.id}">${esc(nxt.title)} ${icon('next')}</a>` : `<a class="btn brass" href="#/finish">${icon('book')} Finish</a>`}</div>
  ${!isPerson && !data.skipped && chapter.skippable ? `<div class="skipbox"><span>Doesn't apply to you? You can leave this whole chapter out.</span><button class="btn secondary small" id="skip">Leave this chapter out</button></div>` : ''}`,
  { title });

  // text autosave
  $$('textarea,input.write[id^=f_]').forEach((el) => {
    const qid = el.id.slice(2);
    if (getDraft(eid, qid) !== null && getDraft(eid, qid) !== (ans[qid]?.text ?? '')) queue(eid, qid, el.value);
    el.addEventListener('input', () => queue(eid, qid, el.value));
    el.addEventListener('blur', () => flush());
  });

  // photo questions
  async function sendPhoto(qid, file) {
    const holder = $(`[data-q="${qid}"] .pbody`); holder.classList.add('uploading');
    try {
      const fd = new FormData(); fd.append('entryId', eid); fd.append('questionId', qid);
      fd.append('file', await shrink(file), file.name);
      const r = await api('POST', '/api/answer/photo', fd);
      if (r.overview) S.data.overview = r.overview;
      ans[qid] = { photoUrl: r.photoUrl, caption: r.caption }; holder.innerHTML = photoBlock({ id: qid }, ans[qid]); wirePhoto(qid);
    } catch (e) { toast(e.message, true); } finally { holder.classList.remove('uploading'); }
  }
  const picker = (multiple, cb) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = multiple; i.onchange = () => cb([...i.files]); i.click(); };
  const dropify = (el, cb, multiple) => {
    el.onclick = () => picker(multiple, cb);
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker(multiple, cb); } };
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); }; el.ondragleave = () => el.classList.remove('over');
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove('over'); cb([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name))); };
  };
  function wirePhoto(qid) {
    const root = $(`[data-q="${qid}"]`);
    const dz = $('.dropzone', root); if (dz) dropify(dz, (f) => f[0] && sendPhoto(qid, f[0]), false);
    $('[data-act=replace]', root)?.addEventListener('click', () => picker(false, (f) => f[0] && sendPhoto(qid, f[0])));
    $('[data-act=remove]', root)?.addEventListener('click', async () => {
      if (!(await confirmBox({ title: 'Remove this photo?', body: 'The photo will be deleted from your book.', ok: 'Remove', danger: true }))) return;
      const r = await del(`/api/answer/photo?entryId=${eid}&questionId=${qid}`).catch((e) => toast(e.message, true));
      if (r) { S.data.overview = r.overview; delete ans[qid]; $('.pbody', root).innerHTML = photoBlock({ id: qid }, null); wirePhoto(qid); }
    });
    const cap = $(`#cap_${qid}`); let t;
    cap?.addEventListener('input', () => { clearTimeout(t); status('saving', 'Saving…'); t = setTimeout(async () => { await put('/api/answer/caption', { entryId: eid, questionId: qid, caption: cap.value }).then(() => status('saved', 'All changes saved')).catch(() => status('error', 'Could not save')); }, 800); });
  }
  chapter.questions.filter((q) => q.type === 'photo').forEach((q) => wirePhoto(q.id));

  // bonus photos
  const bonus = data.bonusPhotos;
  const drawBonus = () => {
    $('#bonus').innerHTML = bonus.map((b) => `<div class="pcard" data-b="${b.id}"><img src="${esc(b.photoUrl)}" alt=""><input type="text" value="${esc(b.caption)}" placeholder="Add a caption" maxlength="300" aria-label="Caption"><button class="btn secondary small" data-del>${icon('trash')} Remove</button></div>`).join('');
    $$('.pcard').forEach((c) => {
      const id = c.dataset.b; let t;
      $('input', c).oninput = (e) => { clearTimeout(t); status('saving', 'Saving…'); t = setTimeout(() => put(`/api/bonus-photo/${id}`, { caption: e.target.value }).then(() => status('saved', 'All changes saved')).catch(() => status('error', 'Could not save')), 800); };
      $('[data-del]', c).onclick = async () => {
        if (!(await confirmBox({ title: 'Remove this photo?', body: 'The photo will be deleted from your book.', ok: 'Remove', danger: true }))) return;
        await del(`/api/bonus-photo/${id}`).then(() => { bonus.splice(bonus.findIndex((x) => x.id === id), 1); drawBonus(); }).catch((e) => toast(e.message, true));
      };
    });
  };
  drawBonus();
  dropify($('#bdrop'), async (files) => {
    const z = $('#bdrop'); z.classList.add('uploading');
    for (const [i, f] of files.entries()) {
      z.querySelector('b').textContent = `Adding photo ${i + 1} of ${files.length}…`;
      try { const fd = new FormData(); fd.append('entryId', eid); fd.append('file', await shrink(f), f.name);
        const r = await api('POST', '/api/bonus-photo', fd); bonus.push({ id: r.id, photoUrl: r.photoUrl, caption: '' }); drawBonus();
      } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
    z.classList.remove('uploading'); z.querySelector('b').innerHTML = `${icon('plus')} Add photos`;
  }, true);

  // chapter-level actions
  $('#skip')?.addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'Leave this chapter out?', body: 'It won\'t appear in your book. Anything you\'ve written is kept, and you can put it back whenever you like.', ok: 'Leave it out' }))) return;
    await put(`/api/chapter/${id}/skip`, { skipped: true }); await loadBook(); location.hash = '#/';
  });
  $('#unskip')?.addEventListener('click', async () => { await put(`/api/chapter/${id}/skip`, { skipped: false }); await loadBook(); render(); });
  $('#edp')?.addEventListener('click', () => personDialog({ entryId: eid, ...data.person }));
  $('#dlp')?.addEventListener('click', async () => {
    if (!(await confirmBox({ title: `Remove ${data.person.name}?`, body: 'Everything you wrote and every photo for this person will be deleted. This cannot be undone.', ok: 'Remove', danger: true }))) return;
    const r = await del(`/api/people/${eid}`); S.data.overview = r.overview; location.hash = '#/chapter/ch08';
  });
}

// ---------- people (chapter 8) ----------
function personDialog(existing) {
  const chapter = chapterById('ch08');
  const rels = chapter.entryFields.find((f) => f.id === 'relationship').options;
  const d = document.createElement('dialog');
  const isOther = existing && !rels.slice(0, -1).includes(existing.relationship) && existing.relationship;
  d.innerHTML = `<h3>${existing ? 'Edit details' : 'Add a person'}</h3><form method="dialog" id="pf">
   <div class="field"><label for="pn">Their name</label><input id="pn" type="text" required maxlength="80" value="${esc(existing?.name || '')}"></div>
   <div class="field"><label for="pr">Who are they to you?</label><select id="pr">${rels.map((r) => `<option ${(isOther ? r === 'Other' : r === existing?.relationship) ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
   <div class="field" id="oth" ${isOther ? '' : 'hidden'}><label for="po">Please say how</label><input id="po" type="text" maxlength="40" value="${esc(isOther ? existing.relationship : '')}"></div>
   <div class="row" style="justify-content:flex-end"><button class="btn secondary" type="button" id="no">Cancel</button><button class="btn">${existing ? 'Save' : 'Add and start writing'}</button></div></form>`;
  document.body.append(d); d.showModal();
  $('#pr', d).onchange = (e) => { $('#oth', d).hidden = e.target.value !== 'Other'; };
  $('#no', d).onclick = () => { d.close(); d.remove(); };
  $('#pf', d).onsubmit = async (e) => {
    e.preventDefault();
    const rel = $('#pr', d).value === 'Other' ? ($('#po', d).value.trim() || 'Other') : $('#pr', d).value;
    const body = { name: $('#pn', d).value.trim(), relationship: rel };
    if (!body.name) return;
    try {
      const r = existing ? await patch(`/api/people/${existing.entryId}`, body) : await post('/api/people', body);
      S.data.overview = r.overview; d.close(); d.remove();
      if (existing) render(); else location.hash = `#/person/${r.entryId || r.person?.entryId || r.id}`;
    } catch (x) { toast(x.message, true); }
  };
}

function peopleView() {
  const chapter = chapterById('ch08'), c = ovChap('ch08'), p = c.people;
  shell(`<a class="crumb" href="#/">${icon('back')} All chapters</a>
  <div class="chead"><div class="num">Chapter ${chapter.number}</div><h1>${esc(chapter.title)}</h1><p class="muted">${esc(chapter.subtitle)}</p></div>
  ${c.skipped ? `<div class="note">This chapter is left out of your book. <button class="link" id="unskip">Put it back</button></div>` : ''}
  <div class="stack">
  ${p.length ? p.map((x) => `<a class="person" href="#/person/${x.entryId}"><span class="avatar">${esc((x.name || '?')[0].toUpperCase())}</span><span style="flex:1"><span class="n">${esc(x.name)}</span><br><span class="muted small">${esc(x.relationship || '')} · ${x.complete ? 'Done' : `${x.coreAnswered} of ${x.coreTotal} key questions`}</span></span>${x.complete ? icon('check') : icon('next')}</a>`).join('')
    : '<div class="card"><p>Add each of your children and grandchildren in turn - everyone gets their own page in your book.</p></div>'}
  <button class="btn big" id="add">${icon('plus')} Add a person</button></div>
  <div class="pager"><a class="btn secondary" href="#/chapter/ch07">${icon('back')} Previous chapter</a><a class="btn" href="#/chapter/ch09">Next chapter ${icon('next')}</a></div>
  ${!c.skipped ? `<div class="skipbox"><span>No children or grandchildren to write about? You can leave this chapter out.</span><button class="btn secondary small" id="skip">Leave this chapter out</button></div>` : ''}`, { title: chapter.title });
  $('#add').onclick = () => personDialog(null);
  $('#skip')?.addEventListener('click', async () => { if (await confirmBox({ title: 'Leave this chapter out?', body: 'It won\'t appear in your book. You can put it back whenever you like.', ok: 'Leave it out' })) { await put('/api/chapter/ch08/skip', { skipped: true }); await loadBook(); location.hash = '#/'; } });
  $('#unskip')?.addEventListener('click', async () => { await put('/api/chapter/ch08/skip', { skipped: false }); await loadBook(); render(); });
}

// ---------- finish ----------
async function finishView() {
  await flush();
  await loadBook();
  const { overview: o, book } = S.data;
  const draw = (pdf, url) => {
    const building = pdf.status === 'building', ready = pdf.status === 'ready' && url;
    shell(`<a class="crumb" href="#/">${icon('back')} My chapters</a>
    <div class="stack narrow" style="max-width:720px">
    <h1>${book.status === 'finished' ? 'Your finished book' : 'Your book'}</h1>
    <section class="card"><h3>Chapters</h3><ul class="checklist">${o.chapters.map((c) => `<li><span class="dot ${c.done ? 'ok' : ''}">${c.done ? '✓' : ''}</span><a href="#/chapter/${c.chapterId}" style="flex:1">${esc(c.title)}</a><span class="muted small">${c.skipped ? 'Left out' : c.done ? 'Done' : `${c.coreAnswered}/${c.coreTotal} key questions`}</span></li>`).join('')}</ul></section>
    ${building ? `<section class="card"><p><span class="spin"></span>&nbsp; Putting your book together… this usually takes under a minute.</p></section>` : ''}
    ${pdf.status === 'failed' ? `<div class="err">${esc(pdf.error || 'Something went wrong.')}</div>` : ''}
    ${ready ? `<section class="card"><h3>${pdf.isFinal ? 'Your book is ready' : 'Your draft is ready'}</h3><p class="muted">${pdf.isFinal ? (pdf.emailedAt ? 'A copy has been emailed to you.' : 'You can download it below.') : 'This is a draft so you can see how it looks.'}</p><a class="btn brass big" href="${esc(url)}">${icon('down')} Download the PDF</a></section>` : ''}
    <section class="card stack"><div><h3>Make the book</h3>
      <p class="muted">${o.allDone ? 'Everything is complete. When you finish, your book is made and emailed to you (and to the person who set this up). You can still make changes and finish again afterwards.' : 'Some key questions are still to be answered before you can finish - but you can make a draft any time.'}</p></div>
      <div class="row"><button class="btn secondary" id="draft" ${building ? 'disabled' : ''}>See a draft</button>
      <button class="btn brass" id="fin" ${building || !o.allDone ? 'disabled' : ''}>${book.status === 'finished' ? 'Make the book again' : 'Finish my book'}</button></div></section></div>`, { title: 'Your book' });
    $('#draft').onclick = () => start(false); $('#fin').onclick = () => start(true);
  };
  const start = async (final) => {
    if (final && !(await confirmBox({ title: 'Finish your book?', body: 'Your book will be made and emailed to you. You can keep editing afterwards.', ok: 'Yes, finish it' }))) return;
    try { const r = await post('/api/book/build', { final }); draw(r.pdf); poll(); } catch (e) { toast(e.message, true); }
  };
  let timer; const poll = () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (!location.hash.startsWith('#/finish')) return;
    try { const r = await get('/api/book/build-status'); S.data.book = r.book; Object.assign(book, r.book); draw(r.pdf, r.url); if (r.pdf.status === 'building') poll(); } catch { poll(); } }, 2500); };
  const first = await get('/api/book/build-status'); Object.assign(book, first.book);
  draw(first.pdf, first.url); if (first.pdf.status === 'building') poll();
}

// ---------- admin ----------
async function adminView() {
  shell(`<a class="crumb" href="#/">${icon('back')} My book</a><h1>People &amp; progress</h1><div id="adm"><p class="muted">Loading…</p></div>`, { title: 'Admin' });
  const [{ authors }, { checks }] = await Promise.all([get('/api/admin/authors'), get('/api/admin/status')]);
  const pill = (s) => `<span class="pill ${s === 'finished' ? 'fin' : s === 'in_progress' ? 'prog' : ''}">${{ finished: 'Finished', in_progress: 'Writing', not_started: 'Not started' }[s]}</span>`;
  $('#adm').innerHTML = `<div class="stack">
  <section class="card tablewrap"><table><thead><tr><th>Name</th><th>Status</th><th>Progress</th><th>Last active</th><th></th></tr></thead><tbody>
  ${authors.map((a) => `<tr><td><b>${esc(a.name)}</b>${a.role === 'admin' ? ' <span class="pill">admin</span>' : ''}<br><span class="muted small">${esc(a.email || '')}</span></td><td>${pill(a.status)}</td>
    <td style="min-width:130px"><div class="meter"><i style="width:${a.percent}%"></i></div><span class="small muted">${a.percent}% · ${a.chaptersDone}/${a.chaptersTotal} chapters</span></td><td>${when(a.lastActive)}</td>
    <td style="white-space:nowrap">${a.pdfReady ? `<button class="btn small" data-dl="${a.userId}">${icon('down')} PDF</button> ` : ''}<button class="btn secondary small" data-pw="${a.userId}" title="Make a temporary password">${icon('key')}</button> ${a.userId !== S.data.me.id ? `<button class="btn secondary small" data-rm="${a.userId}" data-n="${esc(a.name)}" title="Remove">${icon('trash')}</button>` : ''}</td></tr>`).join('')}
  </tbody></table>${authors.length < 2 ? '<p class="muted small" style="margin-top:12px">Share the web address with the people you want to invite. They create their own account and appear here.</p>' : ''}</section>
  <section class="card"><h3>Is everything set up?</h3>${checks.map((c) => `<div class="chk"><span class="dot ${c.ok ? 'ok' : ''}" style="${c.ok ? '' : 'background:var(--danger)'}">${c.ok ? '✓' : '!'}</span><div><b>${esc(c.name)}</b><br><span class="muted small">${esc(c.detail)}</span></div></div>`).join('')}</section></div>`;
  $$('[data-dl]').forEach((b) => (b.onclick = async () => { const r = await get(`/api/admin/authors/${b.dataset.dl}/pdf`).catch((e) => toast(e.message, true)); if (r) location.href = r.url; }));
  $$('[data-pw]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox({ title: 'Make a temporary password?', body: 'Their current password stops working. You\'ll be shown the new one once, to pass on to them.', ok: 'Make password' }))) return;
    const r = await post(`/api/admin/authors/${b.dataset.pw}/reset-password`).catch((e) => toast(e.message, true));
    if (r) confirmBox({ title: 'Temporary password', body: `<code style="font-size:1.3rem;user-select:all">${esc(r.password)}</code><br><span class="muted small">Write it down now - it won't be shown again.</span>`, ok: 'Done', cancel: 'Close' });
  }));
  $$('[data-rm]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox({ title: `Remove ${b.dataset.n}?`, body: 'Their account, writing, photos and book are permanently deleted.', ok: 'Delete everything', danger: true }))) return;
    await del(`/api/admin/authors/${b.dataset.rm}`).then(() => { toast('Removed'); adminView(); }).catch((e) => toast(e.message, true));
  }));
}

render();
