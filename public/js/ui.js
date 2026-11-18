export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = {
  back: 'M15 18l-6-6 6-6', next: 'M9 18l6-6-6-6', check: 'M5 12l5 5L20 7', book: 'M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM5 16a4 4 0 0 1 4-4h10',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', text: 'M4 7V5h16v2M12 5v14M9 19h6', out: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', down: 'M12 4v12M6 11l6 6 6-6M5 20h14', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  key: 'M14 10a4 4 0 1 1-3 3L4 20v-3H1M14 10l7-7',
};
export const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;

export function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3200);
}

export function confirmBox({ title, body, ok = 'OK', danger = false, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h3>${esc(title)}</h3><p>${body}</p><div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn secondary" value="no">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : ''}" value="yes">${esc(ok)}</button></div>`;
    d.addEventListener('close', () => { resolve(d.returnValue === 'yes'); d.remove(); });
    d.addEventListener('click', (e) => { const v = e.target.closest('button')?.value; if (v) d.close(v); });
    document.body.append(d); d.showModal();
  });
}

export const when = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso), days = Math.floor((Date.now() - d) / 864e5);
  if (days < 1) return 'Today'; if (days === 1) return 'Yesterday'; if (days < 14) return `${days} days ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Shrinks big phone photos before upload (faster, and the server re-processes them anyway).
export async function shrink(file, max = 2000) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
