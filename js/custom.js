// Custom home background and playmats. Images live in their own IndexedDB store (they can be
// several MB, too big for localStorage); dim/rotate settings live in localStorage (xc.custom).
// They're applied as CSS variables on <html>, so every view picks them up without re-rendering.
import { esc, modal, closeModal, pickFile, toast } from './util.js';

export const SLOTS = {
  home: { label: 'Home background', hint: 'Shown behind the home page.' },
  table: { label: 'Playmat — whole table', hint: 'One image across the entire board.' },
  me: { label: 'Playmat — your side', hint: 'Bottom half of the board (your field).' },
  opp: { label: "Playmat — opponent's side", hint: 'Top half of the board.' },
};
const DEFAULTS = { home: { dim: 45 }, table: { dim: 45 }, me: { dim: 40 }, opp: { dim: 40, rotate: true } };
const MAX_BYTES = 25 * 1024 * 1024;

let settings = {};
try { settings = JSON.parse(localStorage.getItem('xc.custom') || '{}'); } catch { settings = {}; }
const cfg = (k) => ({ ...DEFAULTS[k], ...(settings[k] || {}) });
const saveSettings = () => { try { localStorage.setItem('xc.custom', JSON.stringify(settings)); } catch { /* ignore */ } };

const urls = {}; // slot -> object URL

// ---------- storage ----------
let dbp = null;
function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('xplay-custom', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

// ---------- apply ----------
function apply() {
  const root = document.documentElement;
  for (const k of Object.keys(SLOTS)) {
    const c = cfg(k);
    if (urls[k]) {
      root.style.setProperty(`--bg-${k}`, `url("${urls[k]}")`);
      root.style.setProperty(`--bg-${k}-dim`, String(c.dim / 100));
      root.classList.add(`has-bg-${k}`);
    } else {
      root.style.removeProperty(`--bg-${k}`);
      root.classList.remove(`has-bg-${k}`);
    }
  }
  root.classList.toggle('bg-opp-rotate', !!cfg('opp').rotate);
}

export async function initCustom() {
  try {
    for (const k of Object.keys(SLOTS)) {
      const blob = await idb('readonly', (s) => s.get(k));
      if (blob) urls[k] = URL.createObjectURL(blob);
    }
  } catch (e) { console.warn('custom backgrounds unavailable', e); }
  apply();
}

async function setImage(k, blob) {
  if (blob) await idb('readwrite', (s) => s.put(blob, k));
  else await idb('readwrite', (s) => s.delete(k));
  if (urls[k]) URL.revokeObjectURL(urls[k]);
  if (blob) urls[k] = URL.createObjectURL(blob); else delete urls[k];
  apply();
}

// ---------- UI ----------
export function openCustomize(only = null) {
  const keys = only || Object.keys(SLOTS);
  const row = (k) => {
    const c = cfg(k);
    return `<div class="cz-slot" data-k="${k}">
      <div class="cz-thumb ${k === 'opp' && c.rotate ? 'rot' : ''}" style="${urls[k] ? `background-image:url('${urls[k]}')` : ''}">${urls[k] ? `<div class="cz-dim" style="opacity:${c.dim / 100}"></div>` : '<span>No image</span>'}</div>
      <div class="cz-info">
        <b>${esc(SLOTS[k].label)}</b><span class="muted small">${esc(SLOTS[k].hint)}</span>
        <div class="row wrap">
          <button class="btn sm primary" data-a="pick">${urls[k] ? 'Change…' : 'Choose image…'}</button>
          ${urls[k] ? '<button class="btn sm danger" data-a="clear">Remove</button>' : ''}
        </div>
        ${urls[k] ? `<label class="cz-range small">Darken <input type="range" min="0" max="85" value="${c.dim}" data-a="dim"><span>${c.dim}%</span></label>` : ''}
        ${k === 'opp' && urls[k] ? `<label class="chk small"><input type="checkbox" data-a="rotate" ${c.rotate ? 'checked' : ''}> Turn it to face the opponent (180°)</label>` : ''}
      </div>
    </div>`;
  };
  const html = () => `<h3>Backgrounds &amp; playmats</h3>
    <p class="muted small">Pick any image from your computer (PNG, JPG, WebP or GIF). Wide images around 1600×900 look best. They're saved on this computer only — your opponent sees their own playmat.</p>
    <div class="cz-list">${keys.map(row).join('')}</div>
    <div class="row end"><button class="btn" data-a="close">Done</button></div>`;
  const m = modal(html(), { wide: true });
  const redraw = () => { m.el.innerHTML = html(); };
  m.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const k = b.closest('[data-k]')?.dataset.k;
    if (b.dataset.a === 'close') return closeModal(m);
    if (b.dataset.a === 'pick') {
      const [f] = await pickFile('image/*');
      if (!f) return;
      if (!f.type.startsWith('image/')) return toast("That file isn't an image");
      if (f.size > MAX_BYTES) return toast('That image is over 25 MB — try a smaller one');
      try { await setImage(k, f); } catch (err) { return toast(`Couldn't save the image: ${err.message}`, 4000); }
      redraw();
    }
    if (b.dataset.a === 'clear') { await setImage(k, null); redraw(); }
  });
  m.el.addEventListener('input', (e) => {
    const t = e.target, k = t.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (t.dataset.a === 'dim') {
      settings[k] = { ...cfg(k), dim: +t.value };
      t.nextElementSibling.textContent = `${t.value}%`;
      const d = t.closest('.cz-slot').querySelector('.cz-dim');
      if (d) d.style.opacity = t.value / 100;
    }
    if (t.dataset.a === 'rotate') {
      settings[k] = { ...cfg(k), rotate: t.checked };
      t.closest('.cz-slot').querySelector('.cz-thumb').classList.toggle('rot', t.checked);
    }
    saveSettings();
    apply();
  });
  return m;
}
