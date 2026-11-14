// Full-art viewer. Triple-click the big preview card (deck builder, card database, game side panel)
// to see the card art as large as the window allows. A triple-click can't happen by accident, and the
// preview card has no other click action, so nothing else fires first.
// Leaders with an awakened side get a toggle (← → keys work too). Esc / click outside closes it.
import { getCard, imageFor, cardHTML } from './db.js';
import { nameOf } from './i18n.js';
import { esc } from './util.js';

let open = null;

export function openArt(id, awakened = false) {
  const card = getCard(id);
  if (!card) return;
  closeArt();
  const sides = [{ label: card.type === 'leader' ? 'Normal' : '', aw: false }];
  if (card.imageBack) sides.push({ label: 'Awakened', aw: true });
  let side = awakened && sides.length > 1 ? 1 : 0;
  const el = document.createElement('div');
  el.className = 'artview';
  document.body.appendChild(el);
  const draw = () => {
    const s = sides[side];
    const img = imageFor(card, s.aw);
    el.innerHTML = `
      <div class="av-stage">${img ? `<img class="av-img" src="${esc(img)}" alt="${esc(nameOf(card))}" draggable="false">`
        : `<div class="av-gen">${cardHTML(card, { awakened: s.aw })}</div>`}</div>
      <div class="av-bar">
        <b>${esc(nameOf(card))}</b><span class="muted small">${esc(card.id)}</span>
        ${sides.length > 1 ? `<span class="av-tabs">${sides.map((x, i) => `<button class="btn sm ${i === side ? 'primary' : ''}" data-side="${i}">${x.label}</button>`).join('')}</span>` : ''}
        <button class="btn sm" data-close>Close <span class="muted">Esc</span></button>
      </div>`;
  };
  draw();
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeArt(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sides.length > 1) { e.stopPropagation(); e.preventDefault(); side = 1 - side; draw(); }
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-side]');
    if (b) { side = +b.dataset.side; draw(); return; }
    if (e.target.closest('[data-close]') || !e.target.closest('.av-img, .av-gen, .av-bar')) closeArt();
  });
  window.addEventListener('keydown', onKey, true); // capture: arrows/Esc mustn't also page the grid or cancel an attack
  open = { el, onKey };
}

export function closeArt() {
  if (!open) return;
  window.removeEventListener('keydown', open.onKey, true);
  const { el } = open;
  open = null;
  el.classList.add('out');
  setTimeout(() => el.remove(), 200);
}

// e.detail counts rapid clicks on the same spot: 3 = triple-click.
document.addEventListener('click', (e) => {
  if (e.detail !== 3) return;
  const c = e.target.closest?.('[data-art]');
  if (c) openArt(c.dataset.art, c.dataset.artAw === '1');
});
