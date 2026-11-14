// Small DOM / data helpers shared across the app.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function pickFile(accept, { multiple = false, directory = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    inp.multiple = multiple;
    if (directory) inp.webkitdirectory = true;
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}

// ---------- modal ----------
let modalStack = [];
export function modal(html, { wide = false, onClose, dismissable = true } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
  document.body.appendChild(back);
  const m = { el: back.firstElementChild, back, onClose };
  modalStack.push(m);
  if (dismissable) {
    back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(m); });
  }
  const focus = back.querySelector('[autofocus]');
  if (focus) setTimeout(() => focus.focus(), 0);
  return m;
}
export function closeModal(m = modalStack[modalStack.length - 1]) {
  if (!m) return;
  modalStack = modalStack.filter((x) => x !== m);
  m.back.remove();
  m.onClose && m.onClose();
}
export const modalOpen = () => modalStack.length > 0;

export function confirmBox(msg, { ok = 'OK', cancel = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const m = modal(`<p>${msg}</p><div class="row end"><button class="btn" data-x="0">${cancel}</button><button class="btn primary" data-x="1" autofocus>${ok}</button></div>`,
      { onClose: () => resolve(false) });
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      m.onClose = null;
      closeModal(m);
      resolve(b.dataset.x === '1');
    });
  });
}

export function promptNumber(msg, value = 0) {
  return new Promise((resolve) => {
    const m = modal(`<form><p>${msg}</p><input type="number" class="inp" name="n" value="${value}" autofocus>
      <div class="row end"><button type="button" class="btn" data-x="0">Cancel</button><button class="btn primary">OK</button></div></form>`,
      { onClose: () => resolve(null) });
    const f = m.el.querySelector('form');
    f.querySelector('input').select?.();
    f.onsubmit = (e) => { e.preventDefault(); m.onClose = null; closeModal(m); resolve(Number(f.n.value) || 0); };
    m.el.querySelector('[data-x="0"]').onclick = () => closeModal(m);
  });
}

// ---------- toast ----------
export function toast(msg, ms = 2200) {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- context menu ----------
export function contextMenu(x, y, items) {
  closeContextMenu();
  const el = document.createElement('div');
  el.className = 'ctx';
  el.innerHTML = items
    .map((it, i) => (it === '-' ? '<hr>' : it.header ? `<div class="ctx-h">${esc(it.header)}</div>` :
      `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`))
    .join('');
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 8)) + 'px';
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeContextMenu();
    items[+b.dataset.i].action();
  });
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  function outside(e) { if (!el.contains(e.target)) closeContextMenu(); }
  el._outside = outside;
}
export function closeContextMenu() {
  const el = $('.ctx');
  if (el) { document.removeEventListener('mousedown', el._outside); el.remove(); }
}

// ---------- pagination ----------
export const PAGE_SIZE = 25;
export const pageCount = (total, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));

/** Page bar: ‹ 1 … 4 [5] 6 … 31 ›  plus "101–125 of 757". Buttons carry data-page. */
export function pagerHTML(page, total, size = PAGE_SIZE) {
  if (!total) return '';
  const pages = pageCount(total, size);
  const from = (page - 1) * size + 1, to = Math.min(total, page * size);
  if (pages === 1) return `<div class="pager"><span class="muted small pg-info">${total} card${total === 1 ? '' : 's'}</span></div>`;
  const btn = (p, label, title, on = false) =>
    `<button type="button" class="pg ${on ? 'on' : ''}" data-page="${p}" ${p < 1 || p > pages || on ? 'disabled' : ''} title="${title}">${label}</button>`;
  const nums = [...new Set([1, pages, page - 1, page, page + 1])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  let last = 0, mid = '';
  for (const p of nums) {
    if (p - last > 1) mid += '<span class="pg-gap">…</span>';
    mid += btn(p, p, `Page ${p}`, p === page);
    last = p;
  }
  return `<div class="pager">${btn(page - 1, '‹', 'Previous page (←)')}${mid}${btn(page + 1, '›', 'Next page (→)')}
    <span class="muted small pg-info">${from}–${to} of ${total}</span></div>`;
}

/** Run fn only after calls stop for `ms` — used for search-as-you-type. */
export function debounce(fn, ms = 180) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- CSV ----------
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim());
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
