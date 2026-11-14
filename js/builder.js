// Deck builder screen.
import { $, esc, download, pickFile, toast, confirmBox, modal, closeModal, PAGE_SIZE, pageCount, pagerHTML, debounce } from './util.js';
import { parseDeckCode, convertOfficialDeck } from './officialdeck.js';
import { nameOf, nameHTML, matchesQuery, matchesType } from './i18n.js';
import { allCards, getCard, cardHTML, cardDetailHTML, typeOptions, colorHex, isRedundantParallel, isTicket, ticketCards, deckTicket } from './db.js';
import { loadDecks, saveDeck, deleteDeck, newDeck, validate, mainCount, deckToText, deckFromText, RULES } from './decks.js';

let deck = null;
let dirty = false;
let filt = { q: '', type: '', color: '', set: '', hidePar: true };
let poolPage = 1; // remembered while you switch decks

export function renderBuilder(root, deckId) {
  const decks = loadDecks();
  if (deckId) deck = structuredClone(decks.find((d) => d.id === deckId) || newDeck());
  if (!deck) deck = decks[0] ? structuredClone(decks[0]) : newDeck();
  root.innerHTML = `
  <div class="builder">
    <section class="b-pool">
      <div class="row wrap b-filters">
        <input class="inp grow" id="bq" placeholder="Search name / text / id…" value="${esc(filt.q)}">
        <select class="inp" id="btype">${typeOptions(filt.type)}</select>
        <select class="inp" id="bcolor"><option value="">All colors</option>${[...new Set(allCards().map((c) => c.color))].sort().map((c) => `<option ${filt.color === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select class="inp" id="bset"><option value="">All sets</option>${[...new Set(allCards().map((c) => c.set).filter(Boolean))].sort().map((s) => `<option ${filt.set === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <label class="chk small"><input type="checkbox" id="bpar" ${filt.hidePar ? 'checked' : ''}> Hide alt arts</label>
      </div>
      <div class="row wrap pool-head"><span class="muted small grow"><span class="no-touch">Click to add · right-click to remove · ← → change page</span><span class="on-touch">Tap to add · long-press for full art · remove with − in the deck list</span></span><div id="bpager"></div></div>
      <div class="b-grid" id="bgrid"></div>
      <div id="bpager2" class="pool-foot"></div>
    </section>
    <section class="b-deck">
      <div class="row">
        <select class="inp grow" id="bdeck">${decks.map((d) => `<option value="${d.id}" ${d.id === deck.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}${decks.some((d) => d.id === deck.id) ? '' : `<option selected value="${deck.id}">${esc(deck.name)} (unsaved)</option>`}</select>
        <button class="btn" id="bnew">New</button>
      </div>
      <div class="row"><input class="inp grow" id="bname" value="${esc(deck.name)}"><button class="btn primary" id="bsave">Save</button></div>
      <div class="row wrap">
        <button class="btn sm" id="bexp">Export .json</button><button class="btn sm" id="bexpt">Export .txt</button>
        <button class="btn sm primary" id="bcode">Deck code</button><button class="btn sm" id="bimp">Import file</button><button class="btn sm" id="bdup">Duplicate</button><button class="btn sm danger" id="bdel">Delete</button>
      </div>
      ${deck.recipeSource || deck.source ? `<div class="small muted">Source: ${[deck.recipeSource, deck.source].filter(Boolean).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, '').slice(0, 40))}</a>`).join(' · ')}</div>` : ''}
      <div id="bval"></div>
      <div id="blist"></div>
    </section>
    <aside class="b-preview"><div id="bprev" class="det"></div></aside>
  </div>`;
  const grid = $('#bgrid');
  let matches = [];
  // Filter once per filter change; drawing only renders the current page of PAGE_SIZE cards.
  const refilter = (keepPage = false) => {
    const q = filt.q.toLowerCase().trim();
    matches = allCards().filter((c) => matchesType(c, filt.type) && (!filt.color || c.color === filt.color) &&
      (!filt.set || c.set === filt.set) && (!filt.hidePar || !isRedundantParallel(c)) && matchesQuery(c, q));
    if (!keepPage) poolPage = 1;
    poolPage = Math.min(poolPage, pageCount(matches.length));
    drawPool();
  };
  const drawPool = () => {
    const slice = matches.slice((poolPage - 1) * PAGE_SIZE, poolPage * PAGE_SIZE);
    grid.innerHTML = slice.map((c) => cardHTML(c, { cls: 'pool', attrs: `data-id="${esc(c.id)}"`, badge: countBadge(c.id) })).join('') ||
      '<div class="muted">No cards match.</div>';
    grid.scrollTop = 0;
    const bar = pagerHTML(poolPage, matches.length);
    $('#bpager').innerHTML = bar;
    $('#bpager2').innerHTML = matches.length > PAGE_SIZE ? bar : '';
  };
  const goPage = (p) => {
    const n = pageCount(matches.length);
    if (p < 1 || p > n || p === poolPage) return;
    poolPage = p;
    drawPool();
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) goPage(+b.dataset.page); });
  const onKey = (e) => {
    if (!document.body.contains(root)) return document.removeEventListener('keydown', onKey);
    if (e.target.matches?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight') goPage(poolPage + 1);
    if (e.key === 'ArrowLeft') goPage(poolPage - 1);
  };
  document.addEventListener('keydown', onKey);
  const countOf = (id) => (deck.main[id] || 0) + deck.leaders.filter((x) => x === id).length + deck.tactics.filter((x) => x === id).length
    + (deck.ticket === id ? 1 : 0);
  const countBadge = (id) => { const n = countOf(id); return n ? `<span class="cnt">${n}</span>` : ''; };
  // After adding/removing, only refresh the little count badges — no need to rebuild the images.
  const refreshBadges = () => {
    grid.querySelectorAll('[data-id]').forEach((el) => {
      const n = countOf(el.dataset.id);
      let b = el.querySelector('.cnt');
      if (!n) { b?.remove(); return; }
      if (!b) { b = document.createElement('span'); b.className = 'cnt'; el.appendChild(b); }
      b.textContent = n;
    });
  };
  const drawDeck = () => {
    const v = validate(deck);
    $('#bval').innerHTML = `<div class="val ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✔ Deck is legal' : '✖ ' + v.errors.length + ' issue(s)'}</div>
      ${v.errors.map((e) => `<div class="err">• ${esc(e)}</div>`).join('')}${v.warnings.map((e) => `<div class="warn">• ${esc(e)}</div>`).join('')}`;
    const row = (id, n, sec) => {
      const c = getCard(id);
      return `<div class="dl-row" data-id="${esc(id)}" data-sec="${sec}">
        <span class="dl-sw" style="background:${colorHex(c?.color)}"></span>
        <span class="dl-n">${n}×</span><span class="dl-name">${c ? nameHTML(c) : esc(id)}</span>
        <span class="muted small">${c ? (c.type === 'leader' ? `${c.atk}/${c.hp}` : 'C' + c.cost) : '?'}${c?.ace ? ' ★' : ''}</span>
        <button class="mini" data-act="add">+</button><button class="mini" data-act="rem">−</button></div>`;
    };
    const mainSorted = Object.entries(deck.main).sort(([a], [b]) => {
      const A = getCard(a), B = getCard(b);
      return (A?.type || '').localeCompare(B?.type || '') || (A?.cost ?? 0) - (B?.cost ?? 0) || nameOf(A).localeCompare(nameOf(B));
    });
    $('#blist').innerHTML = `
      <h4>Leaders <span class="muted">${deck.leaders.length}/${RULES.leaders}</span></h4>${deck.leaders.map((id) => row(id, 1, 'leaders')).join('')}
      <h4>Main deck <span class="muted">${mainCount(deck)}/${RULES.main} · ACE ${v.ace}/${RULES.maxAce}</span></h4>${mainSorted.map(([id, n]) => row(id, n, 'main')).join('')}
      <h4>Tactics <span class="muted">${deck.tactics.length}/${RULES.tactics}</span></h4>${deck.tactics.map((id) => row(id, 1, 'tactics')).join('')}
      ${ticketRow()}`;
  };
  // PP Ticket: not part of the deck, but each deck picks which printing it puts down when going second.
  const ticketRow = () => {
    const id = deckTicket(deck), c = getCard(id);
    if (!c) return '';
    return `<h4>PP Ticket <span class="muted">placed when you go second</span></h4>
      <div class="dl-row ticket-row" data-id="${esc(id)}">
        <span class="dl-sw" style="background:${colorHex(c.color)}"></span>
        <span class="dl-name">${nameHTML(c)} <span class="muted small">${esc(id)}${deck.ticket ? '' : ' · default'}</span></span>
        <button class="btn sm" data-ticket-pick>Change art…</button></div>`;
  };
  const setTicket = (id) => { deck.ticket = id; dirty = true; redraw(); toast(`PP Ticket art set to ${id} — press Save to keep it`); };
  const pickTicket = () => {
    const cur = deckTicket(deck);
    const m = modal(`<h3>Choose this deck's PP Ticket</h3>
      <p class="muted small">The player going second places a PP Ticket in their tactics area. Pick the printing you like.</p>
      <div class="pickgrid ticket-grid">${ticketCards().map((c) => cardHTML(c, { cls: `pickable ${c.id === cur ? 'sel' : ''}`, attrs: `data-tid="${esc(c.id)}"`, badge: `<span class="cnt tid">${esc(c.id)}</span>` })).join('')}</div>
      <div class="row end"><button class="btn" data-x>Cancel</button></div>`, { wide: true });
    m.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tid]');
      if (t) { closeModal(m); if (t.dataset.tid !== deck.ticket) setTicket(t.dataset.tid); }
      else if (e.target.closest('[data-x]')) closeModal(m);
    });
  };
  const redraw = () => { drawDeck(); refreshBadges(); };

  function add(id) {
    const c = getCard(id);
    if (!c) return;
    if (isTicket(c)) return setTicket(id); // can't go in a deck — clicking one picks it as this deck's ticket
    if (c.type === 'leader') {
      if (deck.leaders.length >= RULES.leaders) return toast('Already 4 leaders');
      deck.leaders.push(id);
    } else if (c.type === 'tactics') {
      if (deck.tactics.length >= RULES.tactics) return toast('Already 5 tactics');
      deck.tactics.push(id);
    } else {
      deck.main[id] = (deck.main[id] || 0) + 1;
    }
    dirty = true; redraw();
  }
  function rem(id) {
    const c = getCard(id);
    if (isTicket(c)) { if (deck.ticket === id) { delete deck.ticket; dirty = true; redraw(); } return; }
    const sec = c?.type === 'leader' ? 'leaders' : c?.type === 'tactics' ? 'tactics' : 'main';
    if (sec === 'main' || !c) {
      if (deck.main[id]) { deck.main[id]--; if (!deck.main[id]) delete deck.main[id]; }
      else { const i = deck.leaders.indexOf(id); if (i >= 0) deck.leaders.splice(i, 1); const j = deck.tactics.indexOf(id); if (j >= 0) deck.tactics.splice(j, 1); }
    } else {
      const i = deck[sec].lastIndexOf(id);
      if (i >= 0) deck[sec].splice(i, 1);
    }
    dirty = true; redraw();
  }

  grid.addEventListener('click', (e) => { const el = e.target.closest('[data-id]'); if (el) add(el.dataset.id); });
  grid.addEventListener('contextmenu', (e) => { const el = e.target.closest('[data-id]'); if (el) { e.preventDefault(); rem(el.dataset.id); } });
  let previewId = null;
  root.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-id]');
    if (!el || el.dataset.id === previewId) return; // mouseover fires for every child — only redraw on a new card
    previewId = el.dataset.id;
    $('#bprev').innerHTML = cardHTML(getCard(previewId), { cls: 'big' }) + cardDetailHTML(getCard(previewId));
  });
  $('#blist').addEventListener('click', (e) => {
    if (e.target.closest('[data-ticket-pick]')) return pickTicket();
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    b.dataset.act === 'add' ? add(id) : rem(id);
  });
  const search = debounce(() => refilter());
  $('#bq').oninput = (e) => { filt.q = e.target.value; search(); };
  $('#btype').onchange = (e) => { filt.type = e.target.value; refilter(); };
  $('#bcolor').onchange = (e) => { filt.color = e.target.value; refilter(); };
  $('#bset').onchange = (e) => { filt.set = e.target.value; refilter(); };
  $('#bpar').onchange = (e) => { filt.hidePar = e.target.checked; refilter(); };
  $('#bname').oninput = (e) => { deck.name = e.target.value; dirty = true; };
  $('#bsave').onclick = () => { saveDeck(deck); dirty = false; toast('Saved'); renderBuilder(root, deck.id); };
  $('#bnew').onclick = async () => { if (dirty && !(await confirmBox('Discard unsaved changes?'))) return; deck = newDeck(); dirty = false; renderBuilder(root); };
  $('#bdeck').onchange = async (e) => {
    if (dirty && !(await confirmBox('Discard unsaved changes?'))) { e.target.value = deck.id; return; }
    dirty = false; deck = null; renderBuilder(root, e.target.value);
  };
  $('#bdup').onclick = () => { deck = { ...structuredClone(deck), id: newDeck().id, name: deck.name + ' (copy)' }; dirty = true; renderBuilder(root); };
  $('#bdel').onclick = async () => {
    if (!(await confirmBox(`Delete deck "${esc(deck.name)}"?`, { ok: 'Delete' }))) return;
    deleteDeck(deck.id); deck = null; dirty = false; renderBuilder(root);
  };
  $('#bexp').onclick = () => download(deck.name.replace(/[^\w\- ]+/g, '_') + '.json', JSON.stringify(deck, null, 1));
  $('#bexpt').onclick = () => download(deck.name.replace(/[^\w\- ]+/g, '_') + '.txt', deckToText(deck), 'text/plain');
  $('#bcode').onclick = () => {
    const m = modal(`<form><h3>Import an official deck</h3>
      <p class="muted small">Paste a deck code or a link from the official deck builder (xross-stars.com/deck/…).</p>
      <input class="inp" name="c" style="width:100%" placeholder="https://xross-stars.com/deck/…" autofocus>
      <div class="row end"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Import</button></div></form>`);
    const form = m.el.querySelector('form');
    m.el.querySelector('[data-x]').onclick = () => closeModal(m);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const code = parseDeckCode(form.c.value);
      if (!code) return toast('That doesn\'t look like a deck code');
      const btn = form.querySelector('.primary');
      btn.disabled = true; btn.textContent = 'Loading…';
      try {
        const r = await fetch(`api/deck/${encodeURIComponent(code)}`);
        if (r.status === 404) throw new Error('Deck not found');
        if (!r.ok) throw new Error(`Server returned ${r.status}${r.status === 501 || r.status === 405 ? ' — start the app with start.bat' : ''}`);
        const { deck: d, missing } = convertOfficialDeck(await r.json(), allCards());
        closeModal(m);
        deck = d; dirty = true; renderBuilder(root);
        toast(missing.length ? `Imported, but ${missing.length} card(s) are missing — refresh the card list` : 'Imported — press Save to keep it', 4000);
      } catch (err) {
        toast(err.message, 4000);
        btn.disabled = false; btn.textContent = 'Import';
      }
    };
  };
  $('#bimp').onclick = async () => {
    const [f] = await pickFile('.json,.txt');
    if (!f) return;
    const text = await f.text();
    let d;
    try { d = f.name.endsWith('.json') ? { ...newDeck(), ...JSON.parse(text), id: newDeck().id } : deckFromText(text); }
    catch (err) { return toast('Could not read deck: ' + err.message); }
    deck = d; dirty = true; renderBuilder(root); toast('Imported — press Save to keep it');
  };
  drawDeck();
  refilter(true);
}

export const builderDirty = () => dirty;
