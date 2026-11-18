import { put } from './api.js';
import { $ } from './ui.js';

const pending = new Map();
let timer = null, running = false, retry = 0, onSaved = () => {};
export const setOnSaved = (fn) => { onSaved = fn; };
const draftKey = (e, q) => `mystory.draft.${e}.${q}`;
export const getDraft = (e, q) => { try { return localStorage.getItem(draftKey(e, q)); } catch { return null; } };
const setDraft = (e, q, v) => { try { v === null ? localStorage.removeItem(draftKey(e, q)) : localStorage.setItem(draftKey(e, q), v); } catch { /* ignore */ } };

export function status(kind, text) {
  const el = $('#savechip'); if (!el) return;
  el.className = 'chip ' + kind; el.textContent = text; el.hidden = !text;
}
export const busy = () => pending.size > 0 || running;

export function queue(entryId, questionId, text) {
  pending.set(`${entryId}|${questionId}`, { entryId, questionId, text });
  setDraft(entryId, questionId, text);
  status('saving', 'Saving…');
  clearTimeout(timer); timer = setTimeout(flush, 900);
}

export async function flush() {
  clearTimeout(timer);
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      const [key, item] = pending.entries().next().value;
      pending.delete(key);
      try {
        const res = await put('/api/answer', { entryId: item.entryId, questionId: item.questionId, text: item.text });
        if (!pending.has(key)) setDraft(item.entryId, item.questionId, null);
        retry = 0; onSaved(res);
      } catch (e) {
        if (e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 401) { status('error', 'Could not save'); setDraft(item.entryId, item.questionId, null); continue; }
        if (!pending.has(key)) pending.set(key, item);
        retry++; status('error', 'Not saved yet - retrying…');
        timer = setTimeout(flush, Math.min(30000, 2000 * 2 ** retry));
        return;
      }
    }
    status('saved', 'All changes saved');
  } finally { running = false; }
}

addEventListener('beforeunload', (e) => { if (busy()) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden && pending.size) flush(); });
addEventListener('online', () => { if (pending.size) flush(); });
