// Touch screens (phones, tablets). A tap is still a click, so card menus and "add to deck" work as is.
// On top of that:
//   long-press a face-up card  -> full art (js/artview.js)
//   drag a table card          -> same as mouse drag-and-drop (board.js listens for "xc-drop")
// The browser's own long-press menu / drag is suppressed so it can't fire the mouse right-click actions.
import { openArt } from './artview.js';

const LONG_MS = 450;
const SLOP = 10; // px a finger may wobble before a press counts as a drag
const coarse = matchMedia('(pointer: coarse)');
const mark = () => document.documentElement.classList.toggle('touch', coarse.matches);
mark();
coarse.addEventListener?.('change', mark);

let press = null;        // the finger currently down
let swallowUntil = 0;    // ignore the click that follows a long-press or a drag

const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';

document.addEventListener('pointerdown', (e) => {
  if (!isTouch(e) || !e.isPrimary) return;
  document.documentElement.classList.add('touch'); // a hybrid laptop's touchscreen counts too
  const art = e.target.closest('[data-cid]');
  const drag = e.target.closest('.game [data-u][draggable="true"]');
  press = { x: e.clientX, y: e.clientY, art, drag, dragging: false, ghost: null, over: null };
  if (art) press.timer = setTimeout(() => longPress(art), LONG_MS);
}, true);

function longPress(el) {
  if (!press || press.dragging) return;
  clearTimeout(press.timer);
  swallowUntil = Date.now() + 700;
  navigator.vibrate?.(12);
  openArt(el.dataset.cid, el.dataset.caw === '1');
}

document.addEventListener('pointermove', (e) => {
  if (!press || !isTouch(e)) return;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.dragging) {
    if (Math.hypot(dx, dy) < SLOP) return;
    clearTimeout(press.timer);
    if (!press.drag) { press = null; return; } // a scroll, not a drag
    startDrag();
  }
  e.preventDefault();
  press.ghost.style.transform = `translate(${e.clientX - press.gx}px, ${e.clientY - press.gy}px) scale(1.08)`;
  const t = dropTarget(e);
  if (t !== press.over) {
    press.over?.classList.remove('dropover');
    t?.classList.add('dropover');
    press.over = t;
  }
}, { passive: false, capture: true });

function startDrag() {
  const src = press.drag;
  const r = src.getBoundingClientRect();
  const g = src.cloneNode(true);
  g.classList.add('touch-ghost');
  Object.assign(g.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px', '--cw': r.width + 'px' });
  document.body.appendChild(g);
  press.ghost = g;
  press.gx = press.x; press.gy = press.y; // the ghost sits on the card; it moves by the finger's offset
  press.dragging = true;
  src.classList.add('touch-src');
  src.closest('.game')?.classList.add('dragging');
}

function dropTarget(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  return el?.closest('[data-drop]') || null;
}

function endPress(e, cancelled) {
  if (!press || !isTouch(e)) return;
  clearTimeout(press.timer);
  const p = press;
  press = null;
  if (!p.dragging) return;
  swallowUntil = Date.now() + 500;
  p.ghost.remove();
  p.over?.classList.remove('dropover');
  p.drag.classList.remove('touch-src');
  p.drag.closest('.game')?.classList.remove('dragging');
  const t = !cancelled && dropTarget(e);
  if (t) t.dispatchEvent(new CustomEvent('xc-drop', { bubbles: true, detail: { u: p.drag.dataset.u } }));
}
document.addEventListener('pointerup', (e) => endPress(e, false), true);
document.addEventListener('pointercancel', (e) => endPress(e, true), true);

// The click a finger produces after a long-press or a drag must not also open a menu / close the art.
document.addEventListener('click', (e) => {
  if (Date.now() < swallowUntil) { e.preventDefault(); e.stopImmediatePropagation(); swallowUntil = 0; }
}, true);

// Android sends "contextmenu" on a long-press and starts a native drag; both belong to the mouse.
window.addEventListener('contextmenu', (e) => {
  if (press || e.pointerType === 'touch' || Date.now() < swallowUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
window.addEventListener('dragstart', (e) => { if (press) e.preventDefault(); }, true);
