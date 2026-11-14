// Playmat UI: hot-seat or online, with animated card movement and combat effects.
import { $, $$, esc, modal, closeModal, contextMenu, toast, promptNumber, confirmBox, modalOpen } from './util.js';
import { cardHTML, cardDetailHTML, getCard } from './db.js';
import { nameOf, nameHTML, logHTML } from './i18n.js';
import { net, onNet, sendChat, leave as netLeave } from './net.js';
import * as X from './game.js';
import { openCustomize } from './custom.js';
import { sfx, getVolume, setVolume, isMuted, setMuted } from './sfx.js';

const ui = { attack: null, shownFor: null, root: null, onExit: null, pick: null, modalFor: null, lastFx: null, firstDraw: true };

// ---------- animation settings ----------
const SPEEDS = { normal: 1, slow: 1.6, fast: 0.6, off: 0 };
let animPref = 'normal';
try { animPref = localStorage.getItem('xc.anim') || 'normal'; } catch { /* ignore */ }
if (matchMedia('(prefers-reduced-motion: reduce)').matches && !localStorage.getItem('xc.anim')) animPref = 'off';
const T = (ms) => ms * (SPEEDS[animPref] ?? 1);
const animOn = () => T(1) > 0 && !document.hidden;
const EASE = 'cubic-bezier(.22,.9,.25,1)';
/** Remove an effect element when its animation ends — or after a timeout, since background tabs may never finish it. */
function autoRemove(el, anim, ms) {
  const done = () => el.remove();
  anim.onfinish = done;
  setTimeout(done, ms + 200);
}

export function renderGame(root, onExit) {
  Object.assign(ui, { root, onExit, attack: null, shownFor: null, pick: null, modalFor: null, lastFx: null, firstDraw: true });
  root.innerHTML = `
  <div class="game">
    <div class="stage" id="stage">
      <div class="table" id="table"></div>
      <aside class="gside">
        <div class="det gprev" id="gprev"><div class="muted"><span class="no-touch">Hover a card to preview it.</span><span class="on-touch">Tap a card to preview it · long-press for full art</span></div></div>
        <div id="gctl"></div>
        <div id="gchat"></div>
        <div class="glog" id="glog"></div>
      </aside>
    </div>
    <div id="goverlay"></div>
    <div id="fxlayer"></div>
  </div>`;
  fitStage();
  window.addEventListener('resize', fitStage);
  X.onChange(draw);
  let lastStatus = net.status;
  let chatLen = net.chat.length;
  const offNet = onNet(() => {
    if (net.chat.length > chatLen && !net.chat[net.chat.length - 1].mine) sfx('chat');
    chatLen = net.chat.length;
    if (net.status !== lastStatus) { lastStatus = net.status; draw(); } // shows/hides the connection banner
    else { drawControls(); drawChat(); drawOverlay(); }
  });
  bindEvents(root);
  draw();
  return () => { X.offChange(draw); offNet(); window.removeEventListener('resize', fitStage); };
}

// ---------- fixed-size stage ----------
// The table is laid out once at 1600×900 and scaled uniformly to the window, like a game canvas,
// so resizing never reflows it.
export const STAGE_W = 1600, STAGE_H = 900;
let scale = 1;
export const stageScale = () => scale;
function fitStage() {
  const st = $('#stage');
  if (!st) return;
  const w = innerWidth, h = innerHeight;
  scale = Math.min(w / STAGE_W, h / STAGE_H);
  st.style.transform = `translate(${Math.round((w - STAGE_W * scale) / 2)}px, ${Math.round((h - STAGE_H * scale) / 2)}px) scale(${scale})`;
}

// ---------- seats & visibility ----------
const online = () => !!X.G?.online;
const V = () => (online() ? net.seat : X.G.viewer);
const mySeatCanAct = (p) => !online() || p === net.seat;
function canSee(u, zone, owner) {
  const G = X.G;
  const open = G.openHands && !online();
  if (zone === 'play' || zone === 'equip') return true;
  // Trash is face-down for everyone (players must remember it); only tactics go face-up.
  if (zone === 'trash') return X.card(u)?.type === 'tactics';
  if (zone === 'hand' || zone === 'tacticsDeck') return owner === V() || open;
  if (zone === 'tacticsArea') return G.cards[u].revealed || owner === V() || open;
  return false;
}
const cardEl = (u, zone, owner, extra = {}) => {
  const vis = canSee(u, zone, owner);
  const c = X.card(u);
  const hiddenToOpp = zone === 'tacticsArea' && !X.G.cards[u].revealed;
  return cardHTML(c, {
    back: !vis, cls: `${zone} ${hiddenToOpp && vis ? 'facedown' : ''} ${extra.cls || ''}`,
    attrs: `data-u="${u}" data-zone="${zone}" data-p="${owner}" draggable="true" ${vis ? 'data-vis="1"' : ''}`,
    badge: extra.badge,
  });
};

// ---------- drawing ----------
function draw() {
  const G = X.G;
  if (!G) return;
  if (!online()) {
    if (G.phase === 'select' && G.selectQueue.length) G.viewer = G.selectQueue[0].p;
    if (G.discard) G.viewer = G.discard.p;
  }
  const before = snapshot();
  const me = V(), opp = 1 - me;
  $('#table').innerHTML = `
    <div class="side top">${side(opp, true)}</div>
    <div class="midbar">${midbar()}</div>
    <div class="side bottom">${side(me, false)}</div>
    ${ui.attack ? `<div class="banner">${ui.attack.step === 'attacker' ? 'Choose the ATTACKING leader' : 'Choose the TARGET leader'} — Esc to cancel</div>` : ''}
    ${online() && net.status !== 'connected' ? `<div class="netbar ${net.status}">${esc(net.statusText || net.status)}</div>` : ''}`;
  drawControls();
  drawChat();
  drawLog();
  drawOverlay();
  if (ui.firstDraw) { ui.firstDraw = false; ui.lastFx = G.fxId || 0; handLimitCheck(); return; }
  moveSounds(before);
  if (animOn()) flip(before);
  handLimitCheck();
  playFx(before);
}

function midbar() {
  const G = X.G;
  const mine = online() && G.turnPlayer === net.seat;
  return `<span>Round <b>${G.round}</b>${G.mode === 'quick' ? ' (Quick)' : ''}</span>
    <span class="score">${esc(X.pname(0))} <b>${G.wins[0]}</b> – <b>${G.wins[1]}</b> ${esc(X.pname(1))}</span>
    <span>Turn ${G.turnNo}: <b class="tp">${online() ? (mine ? 'Your turn' : esc(X.pname(G.turnPlayer)) + "'s turn") : esc(X.pname(G.turnPlayer))}</b>${G.tacticsUsedTurn ? ' · tactics used' : ''}</span>`;
}

function pile(p, zone, label) {
  const arr = X.P(p)[zone];
  const top = zone === 'trash' ? arr[arr.length - 1] : arr[0];
  const depth = Math.min(4, Math.ceil(arr.length / 12));
  const inner = top ? (zone === 'deck' || zone === 'tacticsDeck' ? cardHTML(null, { back: true }) : cardEl(top, zone, p))
    : '<div class="card empty"></div>';
  return `<div class="pile d${depth}" data-pile="${zone}" data-p="${p}" data-drop="${zone}" data-key="pile:${p}:${zone}">${inner}<div class="pile-l">${label} <b>${arr.length}</b></div></div>`;
}

function leaderEl(p, li) {
  const L = X.leader(p, li);
  const st = X.leaderStats(p, li);
  const a = ui.attack;
  const pickable = a && ((a.step === 'attacker' && p === a.p) || (a.step === 'target' && p !== a.p)) && !L.downed;
  const pct = L.downed ? 0 : Math.max(0, 1 - L.dmg / st.hp);
  const badge = `<div class="dmg ${L.dmg ? 'has' : ''}" data-dmgv="${L.dmg}">${L.downed ? 'DOWN' : `<span class="dv">${L.dmg}</span><small>/${st.hp}</small>`}</div>
    <div class="hpbar"><i style="width:${pct * 100}%" class="${pct < 0.34 ? 'low' : pct < 0.67 ? 'mid' : ''}"></i></div>
    <div class="lstat">ATK ${st.atk}${L.awakened ? ' ★' : ''}</div>`;
  return `<div class="leader ${L.downed ? 'downed' : ''} ${L.awakened ? 'awakened' : ''} ${pickable ? 'pick' : ''} ${a?.attacker === li && a.p === p ? 'attacker' : ''}"
      data-leader="${li}" data-p="${p}" data-drop="equip" data-key="L:${p}:${li}" title="${esc(nameOf(st.c))} — ${Math.max(0, st.hp - L.dmg)} HP left">
    ${cardHTML(st.c, { awakened: L.awakened, cls: 'lcard', attrs: `data-lu="${L.u}" data-p="${p}" data-li="${li}" data-vis="1" ${L.awakened ? 'data-aw="1"' : ''}`, badge })}
    <div class="lname">${nameHTML(st.c)}</div>
    <div class="equips">${L.equips.map((u) => cardEl(u, 'equip', p, { cls: 'mini' })).join('')}</div>
  </div>`;
}

function side(p, top) {
  const G = X.G, pl = X.P(p);
  const active = G.turnPlayer === p;
  const pp = pl.pp.map((used, i) => `<button class="pp ${used ? 'used' : ''}" data-pp="${i}" data-p="${p}" title="PP — click to toggle"><span>PP</span></button>`).join('');
  const ticket = pl.ticket === 'ready' ? `<button class="ticket" data-ticket="${p}" title="PP Ticket: restore 1 PP (once)">PP Ticket</button>` : pl.ticket === 'used' ? '<span class="ticket used">Ticket used</span>' : '';
  const hand = pl.hand.map((u, i) => cardEl(u, 'hand', p, { cls: '', badge: '' }).replace('class="card', `style="--i:${i};--n:${pl.hand.length}" class="card`)).join('');
  const you = online() && p === net.seat;
  return `
    <div class="zone play" data-drop="play" data-p="${p}" data-key="zone:${p}:play"><span class="zl">Play area</span>${pl.play.map((u) => cardEl(u, 'play', p)).join('')}</div>
    <div class="field">
      <div class="piles">${pile(p, 'deck', 'Deck')}${pile(p, 'trash', 'Trash')}</div>
      <div class="leaders">${pl.leaders.map((_, li) => leaderEl(p, li)).join('')}</div>
      <div class="piles">${pile(p, 'tacticsDeck', 'Tactics')}
        <div class="zone tarea" data-drop="tacticsArea" data-p="${p}" data-key="zone:${p}:tarea"><span class="zl">Tactics</span>${pl.tacticsArea.map((u) => cardEl(u, 'tacticsArea', p)).join('')}</div>
      </div>
    </div>
    <div class="ppbar ${active ? 'active' : ''}">
      <span class="pname">${esc(pl.name)}${you ? ' <span class="tag you">YOU</span>' : ''}${active ? ' <span class="tag turn">TURN</span>' : ''}</span>
      <span class="pps">${pp}</span><span class="muted">${X.untappedPP(p)}/${pl.pp.length} PP</span>${ticket}
      <button class="boost ${pl.boost ? 'on' : ''}" data-boost="${p}" title="Attack boost for the next attack">Boost +${pl.boost}</button>
      <span class="muted small">Hand ${pl.hand.length}</span>
      ${pl.hand.length > 1 && mySeatCanAct(p) && (p === V() || (G.openHands && !online())) ? `<button class="boost" data-hshuf="${p}" title="Shuffle the order of your hand">⤨ Shuffle hand</button>` : ''}
    </div>
    <div class="zone hand ${top ? 'opp' : ''}" data-drop="hand" data-p="${p}" data-key="zone:${p}:hand">${hand || '<span class="zl">Hand</span>'}</div>`;
}

function drawControls() {
  const G = X.G;
  if (!G || !$('#gctl')) return;
  const tp = G.turnPlayer;
  const myTurn = mySeatCanAct(tp);
  const speed = `<label class="small muted">Animations <select class="inp sm" data-c="anim">${Object.keys(SPEEDS).map((k) => `<option ${k === animPref ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`;
  $('#gctl').innerHTML = `
    ${online() ? `<div class="netinfo ${net.status}"><span class="dot"></span>${net.status === 'connected' ? `Online vs <b>${esc(net.opponent || X.pname(1 - net.seat))}</b>` : esc(net.statusText || net.status)} <span class="muted small">· room ${esc(net.room || '')}</span></div>` : ''}
    <div class="row wrap">
      <button class="btn primary grow" data-c="end" ${G.phase !== 'main' || G.winner != null || !myTurn ? 'disabled' : ''}>${online() ? (myTurn ? 'End your turn' : `${esc(X.pname(tp))}'s turn…`) : `End ${esc(X.pname(tp))}'s turn`}</button>
    </div>
    <div class="row wrap">
      <button class="btn sm" data-c="undo" ${X.canUndo() ? '' : 'disabled'} title="Ctrl+Z">Undo</button>
      ${online() ? '' : `<button class="btn sm" data-c="view">View as ${esc(X.pname(1 - V()))}</button>
      <label class="chk small"><input type="checkbox" data-c="open" ${G.openHands ? 'checked' : ''}> Open hands</label>`}
      ${speed}
    </div>
    <div class="row soundrow">
      <button class="btn sm" data-c="mute" title="Sound on/off">${isMuted() ? '🔇' : '🔊'}</button>
      <input type="range" min="0" max="100" value="${Math.round(getVolume() * 100)}" data-c="vol" class="vol" ${isMuted() ? 'disabled' : ''} title="Volume">
    </div>
    <div class="row wrap">
      <button class="btn sm" data-c="help">How to play</button>
      <button class="btn sm" data-c="mat" title="Custom playmats">🎨 Playmat</button>
      <button class="btn sm danger" data-c="concede">Concede</button>
      <button class="btn sm" data-c="exit">Leave table</button>
    </div>`;
}

function drawChat() {
  const el = $('#gchat');
  if (!el) return;
  if (!online()) { el.innerHTML = ''; return; }
  const had = el.querySelector('input')?.value || '';
  const focused = document.activeElement?.id === 'chatin';
  el.innerHTML = `<div class="chat"><div class="chatlog">${net.chat.slice(-40).map((m) => `<div class="cm ${m.mine ? 'mine' : ''}"><b>${esc(m.from)}</b> ${esc(m.text)}</div>`).join('') || '<div class="muted small">Say hi 👋</div>'}</div>
    <form class="chatform"><input id="chatin" class="inp" maxlength="300" placeholder="Message…" autocomplete="off"><button class="btn sm">Send</button></form></div>`;
  const inp = el.querySelector('input');
  inp.value = had;
  if (focused) inp.focus();
  const log = el.querySelector('.chatlog');
  log.scrollTop = log.scrollHeight;
  el.querySelector('form').onsubmit = (e) => { e.preventDefault(); sendChat(inp.value); inp.value = ''; };
}

function drawLog() {
  const G = X.G;
  const el = $('#glog');
  el.innerHTML = G.log.slice(-250).map((l) => `<div class="ll ${l.p != null ? 'p' + l.p : ''}"><span class="muted">R${l.r}T${l.t}</span> ${logHTML(l.msg, getCard)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

// ---------- FLIP card movement ----------
function snapshot() {
  const tbl = $('#table');
  const m = { cards: new Map(), keys: new Map(), dmg: new Map(), table: tbl?.getBoundingClientRect() };
  if (!tbl) return m;
  tbl.querySelectorAll('[data-u]').forEach((el) => {
    m.cards.set(el.dataset.u, { rect: el.getBoundingClientRect(), html: el.outerHTML, back: el.classList.contains('back') });
  });
  tbl.querySelectorAll('[data-key]').forEach((el) => m.keys.set(el.dataset.key, el.getBoundingClientRect()));
  tbl.querySelectorAll('[data-leader]').forEach((el) => m.dmg.set(`${el.dataset.p}:${el.dataset.leader}`, +(el.querySelector('[data-dmgv]')?.dataset.dmgv || 0)));
  return m;
}

function pileRect(before, p, zone) {
  return before.keys.get(`pile:${p}:${zone}`) || $(`[data-key="pile:${p}:${zone}"]`)?.getBoundingClientRect();
}

// ---------- hand limit reminder ----------
// Official rule: the 7-card limit is enforced in the End Phase (handled by endTurn). Mid-turn we only
// remind: after a draw pushes your hand past 7, offer to discard now or wait for the end of the turn.
const HAND_LIMIT = 7;
const handSeen = {}, handWarned = {};
function handLimitCheck() {
  const G = X.G;
  const p = online() ? net.seat : G.viewer;
  if (p == null) return;
  const n = X.P(p).hand.length;
  const prev = handSeen[p];
  handSeen[p] = n;
  if (n <= HAND_LIMIT) { handWarned[p] = false; return; }
  let off = false;
  try { off = localStorage.getItem('xc.handWarn') === 'off'; } catch { /* ignore */ }
  const busy = G.phase !== 'main' || G.discard || G.roundWinner != null || G.winner != null
    || (!online() && !G.openHands && ui.shownFor !== G.viewer) || modalOpen();
  if (off || busy || handWarned[p] || prev == null || n <= prev) return;
  handWarned[p] = true;
  setTimeout(() => handLimitModal(p), animOn() ? T(700) : 0); // let the draw animation land first
}

function handLimitModal(p) {
  const G = X.G;
  if (!G || modalOpen()) return;
  const n = X.P(p).hand.length, over = n - HAND_LIMIT;
  if (over <= 0) return;
  const mine = G.turnPlayer === p;
  sfx('error');
  const m = modal(`<h3>Hand limit: <span class="hl-dmg">${n}</span> / ${HAND_LIMIT}</h3>
    <p>You're holding <b>${over}</b> card${over > 1 ? 's' : ''} over the limit. In Xross Stars the hand limit is checked in the
      <b>End Phase</b>: ${mine ? 'when you end this turn' : 'at the end of your next turn'} you'll discard down to ${HAND_LIMIT} (after your unused-PP draws).</p>
    <p class="muted small">You can keep the extra cards for now if you plan to play them this turn.</p>
    <label class="chk small"><input type="checkbox" data-noremind> Don't remind me again</label>
    <div class="row end"><button class="btn" data-later>Later</button><button class="btn primary" data-now autofocus>Discard ${over} now</button></div>`);
  const done = () => { if (m.el.querySelector('[data-noremind]').checked) { try { localStorage.setItem('xc.handWarn', 'off'); } catch { /* ignore */ } } closeModal(m); };
  m.el.querySelector('[data-later]').onclick = done;
  m.el.querySelector('[data-now]').onclick = () => {
    done();
    pickCardsModal({
      title: `Discard ${over} card${over > 1 ? 's' : ''}`, text: 'Discarded cards go to the trash face-down and are not revealed.',
      us: X.P(p).hand.slice(), zone: 'hand', owner: p, n: over, okLabel: 'Discard', dismissable: true,
      onOk: (us) => X.discardCards(p, us),
    });
  };
}

/** Card-movement sounds, derived from what changed on the table (works for both players online). */
function moveSounds(before) {
  const tbl = $('#table');
  let draws = 0, played = false, moved = false;
  const seen = new Set();
  tbl.querySelectorAll('[data-u]').forEach((el) => {
    const u = el.dataset.u;
    seen.add(u);
    const prev = before.cards.get(u);
    const zone = el.dataset.zone;
    if (!prev) { if (zone === 'hand' || zone === 'tacticsArea') draws++; else moved = true; return; }
    const r = el.getBoundingClientRect();
    if (Math.abs(prev.rect.left - r.left) + Math.abs(prev.rect.top - r.top) > 2) {
      if (zone === 'play' && !prev.html.includes('data-zone="play"')) played = true; else moved = true;
    }
  });
  for (const u of before.cards.keys()) if (!seen.has(u)) moved = true;
  const step = animOn() ? T(120) : 70;
  for (let i = 0; i < Math.min(draws, 7); i++) sfx('draw', i * step + (animOn() ? T(80) : 0));
  if (played) sfx('play');
  else if (moved && !draws) sfx('slide');
}

function flip(before) {
  const tbl = $('#table');
  const seen = new Set();
  let drawIdx = 0;
  const sc = stageScale(); // rects are in screen pixels; translations happen inside the scaled stage
  tbl.querySelectorAll('[data-u]').forEach((el) => {
    const u = el.dataset.u;
    seen.add(u);
    const now = el.getBoundingClientRect();
    const prev = before.cards.get(u);
    if (prev) {
      const dx = (prev.rect.left - now.left) / sc, dy = (prev.rect.top - now.top) / sc;
      const ratio = prev.rect.width / (now.width || 1);
      if (Math.abs(dx) + Math.abs(dy) > 2 || Math.abs(ratio - 1) > 0.02) {
        el.animate([{ transform: `translate(${dx}px,${dy}px) scale(${ratio})`, zIndex: 20 }, { transform: 'none', zIndex: 20 }],
          { duration: T(460), easing: EASE });
      }
      return;
    }
    // New card: drawn cards fly in from their owner's deck, one after another.
    const p = +el.dataset.p, zone = el.dataset.zone;
    const from = zone === 'hand' ? pileRect(before, p, 'deck') : zone === 'tacticsArea' ? pileRect(before, p, 'tacticsDeck') : null;
    if (from) {
      const dx = (from.left - now.left) / sc, dy = (from.top - now.top) / sc;
      const delay = T(120) * drawIdx++;
      el.animate([
        { transform: `translate(${dx}px,${dy}px) scale(${from.width / (now.width || 1)}) rotateY(180deg)`, opacity: 0.4 },
        { transform: `translate(${dx * 0.4}px,${dy * 0.4 - 30}px) scale(1.05) rotateY(90deg)`, opacity: 1, offset: 0.45 },
        { transform: 'none', opacity: 1 },
      ], { duration: T(560), delay, easing: EASE, fill: 'backwards' });
    } else {
      el.animate([{ transform: 'scale(.6) translateY(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: T(360), easing: EASE });
    }
  });
  // Cards that left the visible table glide to where they went (trash / deck) and fade.
  const layer = $('#fxlayer');
  for (const [u, prev] of before.cards) {
    if (seen.has(u)) continue;
    const f = X.findCard(u);
    if (!f) continue;
    const target = f.zone === 'trash' || f.zone === 'deck' || f.zone === 'tacticsDeck'
      ? $(`[data-key="pile:${f.p}:${f.zone}"]`)?.getBoundingClientRect()
      : f.zone === 'hand' ? $(`[data-key="zone:${f.p}:hand"]`)?.getBoundingClientRect() : null;
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.innerHTML = prev.html;
    Object.assign(ghost.style, { left: prev.rect.left + 'px', top: prev.rect.top + 'px', width: prev.rect.width + 'px' });
    layer.appendChild(ghost);
    const dx = target ? target.left + target.width / 2 - (prev.rect.left + prev.rect.width / 2) : 0;
    const dy = target ? target.top + target.height / 2 - (prev.rect.top + prev.rect.height / 2) : 20;
    ghost.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.7) rotate(${target ? 8 : 0}deg)`, opacity: target ? 0.9 : 0 }],
      { duration: T(480), easing: EASE, fill: 'forwards' });
    autoRemove(ghost, ghost.getAnimations()[0], T(480));
  }
}

// ---------- combat / turn effects ----------
const lcardOf = (p, li) => $(`[data-key="L:${p}:${li}"] .lcard`);
const leaderBox = (p, li) => $(`[data-key="L:${p}:${li}"]`);

function floatText(el, text, cls, delay = 0) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = `floatnum ${cls}`;
  f.textContent = text;
  Object.assign(f.style, { left: r.left + r.width / 2 + 'px', top: r.top + r.height * 0.35 + 'px' });
  $('#fxlayer').appendChild(f);
  f.animate([
    { transform: 'translate(-50%,0) scale(.4)', opacity: 0 },
    { transform: 'translate(-50%,-14px) scale(1.25)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-60px) scale(1)', opacity: 0 },
  ], { duration: T(1100), delay, easing: 'ease-out', fill: 'backwards' });
  autoRemove(f, f.getAnimations()[0], delay + T(1100));
}

function countUp(p, li, from, delay) {
  const el = $(`[data-key="L:${p}:${li}"] .dv`);
  if (!el) return;
  const to = +el.textContent;
  if (from === to) return;
  el.textContent = from;
  const dur = T(420);
  setTimeout(() => {
    const t0 = performance.now();
    const step = (t) => {
      if (!el.isConnected) return;
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, delay);
  // rAF doesn't run in background tabs — always land on the real value.
  setTimeout(() => { if (el.isConnected) el.textContent = to; }, delay + dur + 60);
}

// Each effect owns a different element so transforms never fight:
//   leader box (.leader)     -> attack lunge, hit shake
//   card (.lcard)            -> down rotation (matches the CSS "downed" state)
//   artwork (.lcard > img)   -> awaken flip
// Effects start on a timer (no held keyframes), so nothing can be left stuck mid-pose.
const at = (ms, fn) => (ms > 0 ? setTimeout(fn, ms) : fn());
const artOf = (p, li) => lcardOf(p, li)?.firstElementChild;

function hitEffect(p, li, n, delay, before) {
  const box = leaderBox(p, li), card = lcardOf(p, li);
  if (!card) return;
  at(delay, () => {
    box?.animate([
      { transform: 'none' }, { transform: 'translateX(-7px) rotate(-1.5deg)' }, { transform: 'translateX(6px) rotate(1deg)' },
      { transform: 'translateX(-3px)' }, { transform: 'none' },
    ], { duration: T(380), easing: 'ease-out' });
    card.animate([{ boxShadow: '0 0 0 3px #ff4d6a, 0 0 40px #ff3355' }, { boxShadow: '0 0 0 0 transparent' }], { duration: T(700), easing: 'ease-out' });
  });
  floatText(box, `-${n}`, 'dmgnum', delay);
  countUp(p, li, before.dmg.get(`${p}:${li}`) ?? 0, delay);
}

const DOWN_POSE = { transform: 'rotate(90deg) scale(.72)', filter: 'grayscale(.85) brightness(.6)' };
function downEffect(p, li, delay) {
  const box = leaderBox(p, li), card = lcardOf(p, li);
  if (!card || !box?.classList.contains('downed')) return; // stood back up in the meantime
  // Keep it upright until the hit lands, then tip over into exactly the CSS downed pose.
  card.style.transition = 'none'; // no CSS transition into/out of the hold — the animation does the motion
  card.style.transform = 'none';
  card.style.filter = 'none';
  at(delay, () => {
    card.style.transform = '';
    card.style.filter = '';
    setTimeout(() => { card.style.transition = ''; }, T(700) + 50);
    card.animate([
      { transform: 'none', filter: 'none' },
      { transform: 'rotate(100deg) scale(.7)', filter: DOWN_POSE.filter, offset: 0.7 },
      DOWN_POSE,
    ], { duration: T(700), easing: EASE });
  });
  floatText(box, 'DOWN', 'downtxt', delay + T(200));
}

function awakenEffect(p, li, delay) {
  const box = leaderBox(p, li), art = artOf(p, li);
  if (!box) return;
  at(delay, () => {
    art?.animate([
      { transform: 'rotateY(0)', filter: 'brightness(1)' },
      { transform: 'rotateY(90deg) scale(1.06)', filter: 'brightness(2.2)', offset: 0.45 },
      { transform: 'rotateY(0) scale(1.06)', filter: 'brightness(1.4)', offset: 0.7 },
      { transform: 'none', filter: 'none' },
    ], { duration: T(1000), easing: 'ease-in-out' });
    // Burst ring lives in the fixed fx layer, so it never affects layout.
    const r = box.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'ring';
    Object.assign(ring.style, { left: r.left + r.width / 2 + 'px', top: r.top + r.height * 0.45 + 'px', width: r.width * 1.2 + 'px' });
    $('#fxlayer').appendChild(ring);
    const a = ring.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(2.4)', opacity: 0 }],
      { duration: T(900), delay: T(350), easing: 'ease-out', fill: 'both' });
    autoRemove(ring, a, T(1250));
  });
  floatText(box, 'AWAKEN!', 'awktxt', delay + T(400));
}

function banner(text, cls = '', delay = 0, hold = 900) {
  const b = document.createElement('div');
  b.className = `sweep ${cls}`;
  b.innerHTML = `<span>${text}</span>`;
  $('#fxlayer').appendChild(b);
  b.animate([
    { opacity: 0, transform: 'translate(-50%,-50%) scaleX(.2)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scaleX(1)', offset: 0.18 },
    { opacity: 1, transform: 'translate(-50%,-50%) scaleX(1)', offset: 0.8 },
    { opacity: 0, transform: 'translate(-50%,-50%) scaleX(1.1)' },
  ], { duration: T(hold + 500), delay, easing: 'ease-in-out', fill: 'both' });
  autoRemove(b, b.getAnimations()[0], delay + T(hold + 500));
}

/** Sounds for game events, on the same timeline as the animations (compressed when animations are off). */
function fxSounds(events) {
  const D = animOn() ? T : (ms) => ms * 0.4;
  let t = 0;
  for (const e of events) {
    switch (e.type) {
      case 'attack': sfx('attack', t); sfx('hit', t + D(340)); t += D(760); break;
      case 'dmg': sfx('hit', t); t += D(420); break;
      case 'heal': sfx('heal', t); t += D(300); break;
      case 'down': sfx('down', t + D(120)); t += D(650); break;
      case 'awaken': sfx('awaken', t); t += D(900); break;
      case 'turn': case 'start': sfx('turn', t); break;
      case 'shuffle': case 'handshuffle': sfx('shuffle', t); break;
      case 'round': case 'match': sfx('round', t); break;
      default:
    }
  }
}

function playFx(before) {
  const G = X.G;
  if (ui.lastFx == null || (G.fxId || 0) < ui.lastFx) ui.lastFx = G.fxId || 0; // undo moved backwards
  const events = (G.fx || []).filter((e) => e.id > ui.lastFx);
  ui.lastFx = G.fxId || 0;
  if (events.length) fxSounds(events);
  if (!animOn() || !events.length) return;
  let t = 0; // timeline (ms) so chained events (attack → down → awaken) play in order
  for (const e of events) {
    switch (e.type) {
      case 'attack': {
        const [ap, ali] = e.a, [tp, tli] = e.t;
        const A = leaderBox(ap, ali), Tg = lcardOf(tp, tli);
        if (A && Tg) {
          const ra = A.getBoundingClientRect(), rt = Tg.getBoundingClientRect();
          const dx = ((rt.left - ra.left) * 0.62) / stageScale(), dy = ((rt.top - ra.top) * 0.62) / stageScale();
          at(t, () => A.animate([
            { transform: 'none', zIndex: 30 },
            { transform: 'translateY(8px) scale(.96)', zIndex: 30, offset: 0.2 },
            { transform: `translate(${dx}px,${dy}px) scale(1.12)`, zIndex: 30, offset: 0.55 },
            { transform: 'none', zIndex: 30 },
          ], { duration: T(620), easing: 'cubic-bezier(.5,0,.3,1)' }));
          hitEffect(tp, tli, e.n, t + T(340), before);
        }
        t += T(760);
        break;
      }
      case 'dmg':
        hitEffect(e.t[0], e.t[1], e.n, t, before);
        t += T(420);
        break;
      case 'heal': {
        const box = leaderBox(e.t[0], e.t[1]);
        floatText(box, `+${e.n}`, 'healnum', t);
        const hc = lcardOf(...e.t);
        at(t, () => hc?.animate([{ boxShadow: '0 0 0 3px #3ddc97, 0 0 36px #3ddc97' }, { boxShadow: '0 0 0 0 transparent' }], { duration: T(800) }));
        countUp(e.t[0], e.t[1], before.dmg.get(`${e.t[0]}:${e.t[1]}`) ?? 0, t);
        t += T(300);
        break;
      }
      case 'down':
        downEffect(e.t[0], e.t[1], t);
        t += T(650);
        break;
      case 'awaken':
        awakenEffect(e.t[0], e.t[1], t);
        t += T(900);
        break;
      case 'turn': {
        const mine = online() ? e.p === net.seat : null;
        banner(mine === true ? 'YOUR TURN' : `${esc(X.pname(e.p))}'s TURN`, mine === false ? 'opp' : '', t, 800);
        $('.ppbar.active')?.animate([{ boxShadow: '0 0 0 2px #f2c14e88' }, { boxShadow: '0 0 0 0 transparent' }], { duration: T(1200), delay: t });
        break;
      }
      case 'shuffle':
        $(`[data-key="pile:${e.p}:deck"] .card`)?.animate([
          { transform: 'none' }, { transform: 'translateX(-10px) rotate(-6deg)' }, { transform: 'translateX(10px) rotate(6deg)' },
          { transform: 'translateX(-6px) rotate(-3deg)' }, { transform: 'none' },
        ], { duration: T(600), delay: t });
        break;
      case 'round':
        banner(`${esc(X.pname(e.w))} wins the round!`, 'gold', t, 1100);
        break;
      case 'start':
        banner('MATCH START', '', t, 900);
        break;
      default:
    }
  }
}

// ---------- overlays: handoff, tactics select, discard, round/match over ----------
function drawOverlay() {
  const G = X.G;
  const ov = $('#goverlay');
  if (!G || !ov) return;
  const key = JSON.stringify([G.winner, G.roundWinner, G.phase, G.selectQueue[0], G.discard, V()]);
  if (G.winner != null) {
    closePick();
    const won = online() ? G.winner === net.seat : null;
    ov.innerHTML = `<div class="cover"><div class="panel pop"><h2>${won === true ? 'Victory!' : won === false ? 'Defeat' : esc(X.pname(G.winner)) + ' wins the match!'}</h2>
      <p>${esc(X.pname(G.winner))} wins ${G.wins[G.winner]}–${G.wins[1 - G.winner]}${G.wins[G.winner] < (G.mode === 'bo3' ? 2 : 1) ? ' (by concession / deck-out)' : ''}.</p>
      <div class="row center">${online() ? '' : '<button class="btn" data-o="undo">Undo</button>'}<button class="btn primary" data-o="exit">Back to menu</button></div></div></div>`;
    return;
  }
  if (G.roundWinner != null) {
    closePick();
    const canContinue = !online() || net.role === 'host';
    ov.innerHTML = `<div class="cover delayed"><div class="panel pop"><h2>${esc(X.pname(G.roundWinner))} wins round ${G.round}!</h2>
      <p>Resolve any remaining effects (e.g. [On Awaken]) before continuing. Next round: play areas and hands go to the trash, damage is cleared, downed leaders stand back up. Awakening, equipped tactics and the trash carry over.</p>
      <div class="row center">${online() ? '' : '<button class="btn" data-o="undo">Undo</button>'}${canContinue ? '<button class="btn primary" data-o="next">Continue</button>' : '<span class="muted">Waiting for the host to continue…</span>'}</div></div></div>`;
    return;
  }
  // Hot-seat privacy screen when the viewing player changes.
  if (!online() && !G.openHands && ui.shownFor !== G.viewer) {
    closePick();
    ov.innerHTML = `<div class="cover solid"><div class="panel pop"><h2>Pass to ${esc(X.pname(G.viewer))}</h2>
      <p class="muted">${G.phase === 'select' ? 'Choose your tactics card in secret.' : G.discard ? 'Discard down to 7.' : 'Your hand is hidden until you continue.'}</p>
      <button class="btn primary" data-o="reveal" autofocus>I'm ${esc(X.pname(G.viewer))} — show my side</button></div></div>`;
    return;
  }
  // Online: waiting on the other player
  const waitingOn = G.phase === 'select' && G.selectQueue.length ? G.selectQueue[0].p : G.discard ? G.discard.p : null;
  ov.innerHTML = online() && waitingOn != null && waitingOn !== net.seat
    ? `<div class="waitchip">Waiting for ${esc(X.pname(waitingOn))} to ${G.discard ? 'discard' : 'choose tactics'}…</div>` : '';
  const want = waitingOn != null && mySeatCanAct(waitingOn) ? (G.discard ? 'dis' : 'sel') + key : null;
  if (pickOpen() && ui.modalFor !== want) closePick();
  if (want && !pickOpen()) {
    ui.modalFor = want;
    ui.pick = want.startsWith('sel') ? selectTacticsModal() : discardModal();
  }
}
const pickOpen = () => !!ui.pick && document.body.contains(ui.pick.back);
function closePick() { if (pickOpen()) closeModal(ui.pick); ui.pick = null; }

function pickCardsModal({ title, text, us, zone, owner, n, okLabel, onOk, dismissable = false }) {
  const sel = new Set();
  const m = modal(`<h3>${title}</h3><p class="muted">${text}</p>
    <div class="pickgrid">${us.map((u) => cardEl(u, zone, owner, { cls: 'pickable' })).join('')}</div>
    <div class="row end"><span class="grow muted" data-cnt></span><button class="btn primary" data-ok disabled>${okLabel}</button></div>`, { wide: true, dismissable });
  const upd = () => {
    $$('.pickable', m.el).forEach((el) => el.classList.toggle('sel', sel.has(el.dataset.u)));
    m.el.querySelector('[data-cnt]').textContent = `${sel.size}/${n} selected`;
    m.el.querySelector('[data-ok]').disabled = sel.size !== n;
  };
  m.el.addEventListener('click', (e) => {
    const el = e.target.closest('.pickable');
    if (el) {
      const u = el.dataset.u;
      if (sel.has(u)) sel.delete(u); else { if (n === 1) sel.clear(); if (sel.size < n) sel.add(u); }
      upd();
    }
    if (e.target.closest('[data-ok]')) { closeModal(m); onOk([...sel]); }
  });
  m.el.addEventListener('mouseover', hoverPreview);
  upd();
  return m;
}

function selectTacticsModal() {
  const { p, n } = X.G.selectQueue[0];
  return pickCardsModal({
    title: `${esc(X.pname(p))}: choose ${n} tactics card${n > 1 ? 's' : ''} for round ${X.G.round}`,
    text: 'It is placed face-down in your tactics area. Each tactics card can be used once per match.',
    us: X.P(p).tacticsDeck, zone: 'tacticsDeck', owner: p, n, okLabel: 'Set face-down',
    onOk: (us) => X.chooseTactics(p, us),
  });
}
function discardModal() {
  const { p, n } = X.G.discard;
  return pickCardsModal({
    title: `${esc(X.pname(p))}: discard ${n} card${n > 1 ? 's' : ''}`, text: 'Hand limit is 7 at the end of your turn.',
    us: X.P(p).hand, zone: 'hand', owner: p, n, okLabel: 'Discard', onOk: (us) => X.discardTo7(us),
  });
}

// ---------- events ----------
let prevKey = '';
function hoverPreview(e) {
  const el = e.target.closest('[data-vis]');
  if (!el) return;
  const u = el.dataset.u || el.dataset.lu;
  const c = X.card(u);
  if (!c) return;
  const aw = el.dataset.aw === '1';
  const k = c.id + aw;
  if (k === prevKey) return;
  prevKey = k;
  const box = $('#gprev');
  box.innerHTML = cardHTML(c, { cls: 'big', awakened: aw }) + cardDetailHTML(c, aw)
    + '<div class="scrollhint"><span class="no-touch">🖱 Scroll while hovering a card to read more</span><span class="on-touch">Swipe here to read more</span></div>';
  box.scrollTop = 0;
  box.classList.toggle('more', box.scrollHeight > box.clientHeight + 4);
  if (animOn()) box.animate([{ opacity: 0.4, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: T(180), easing: 'ease-out' });
}

function bindEvents(root) {
  root.addEventListener('mouseover', hoverPreview);
  // Mouse wheel over a face-up card on the table scrolls that card's details in the preview panel.
  root.addEventListener('wheel', (e) => {
    if (!e.target.closest('#table [data-vis]')) return;
    const g = $('#gprev');
    if (!g || g.scrollHeight <= g.clientHeight) return;
    e.preventDefault();
    g.scrollTop += e.deltaY * (e.deltaMode === 1 ? 32 : 1);
    g.classList.toggle('more', g.scrollTop + g.clientHeight < g.scrollHeight - 4);
  }, { passive: false });
  root.addEventListener('click', onClick);
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-c="vol"]')) { setVolume(e.target.value / 100); sfx('click'); }
    if (e.target.matches('[data-c="anim"]')) {
      animPref = e.target.value;
      try { localStorage.setItem('xc.anim', animPref); } catch { /* ignore */ }
    }
  });
  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('[data-u],[data-leader],[data-pile]')) { e.preventDefault(); onClick(e); }
  });
  root.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-u]');
    if (!el) return;
    e.dataTransfer.setData('text/x-card', el.dataset.u);
    e.dataTransfer.effectAllowed = 'move';
    root.classList.add('dragging');
  });
  root.addEventListener('dragend', () => { root.classList.remove('dragging'); $$('.dropover').forEach((x) => x.classList.remove('dropover')); });
  root.addEventListener('dragover', (e) => {
    const t = e.target.closest('[data-drop]');
    if (!t) return;
    e.preventDefault();
    $$('.dropover').forEach((x) => x !== t && x.classList.remove('dropover'));
    t.classList.add('dropover');
  });
  root.addEventListener('drop', (e) => {
    const t = e.target.closest('[data-drop]');
    const u = e.dataTransfer.getData('text/x-card');
    if (!t || !u) return;
    e.preventDefault();
    handleDrop(u, t.dataset.drop, +t.dataset.p, t.dataset.leader != null ? +t.dataset.leader : null, e.shiftKey);
  });
  // finger drag (js/touch.js) — fired on the drop target
  root.addEventListener('xc-drop', (e) => {
    const t = e.target.closest('[data-drop]');
    if (t) handleDrop(e.detail.u, t.dataset.drop, +t.dataset.p, t.dataset.leader != null ? +t.dataset.leader : null, false);
  });
  const key = (e) => {
    if (!document.body.contains(root)) return document.removeEventListener('keydown', key);
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'Escape' && ui.attack) { ui.attack = null; draw(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !modalOpen()) { e.preventDefault(); X.undo(); }
  };
  document.addEventListener('keydown', key);
}

function handleDrop(u, zone, p, li, shift) {
  const f = X.findCard(u);
  if (!f) return;
  if (f.p !== p) return toast("You can only move cards to their owner's zones");
  if (online() && f.p !== net.seat && ['hand', 'deck', 'tacticsDeck', 'tacticsArea'].includes(f.zone)) return toast("That's your opponent's card");
  if (zone === f.zone && zone !== 'deck') return;
  if (zone === 'equip') {
    if (X.card(u)?.type !== 'tactics') return toast('Only tactics (equipment) can be attached to leaders');
    return X.useTactics(u, li);
  }
  if (zone === 'play' && f.zone === 'hand') return playFromHand(u, true);
  if (zone === 'play' && f.zone === 'tacticsArea') return X.useTactics(u);
  X.moveCard(u, p, zone, { bottom: shift });
}

function playFromHand(u, pay) {
  const r = X.playCard(u, { pay });
  if (!r.ok) {
    if (r.reason) {
      toast(r.reason);
      confirmBox(`${esc(r.reason)}. Play it anyway without paying?`, { ok: 'Play free' }).then((y) => y && playFromHand(u, false));
    }
    return;
  }
  if (r.card.type === 'attack') setTimeout(() => startAttack(r.p, u), T(300));
}

function startAttack(p, u) {
  const alive = X.P(p).leaders.map((L, i) => (!L.downed ? i : -1)).filter((i) => i >= 0);
  if (!alive.length) return toast('No leader can attack');
  ui.attack = { p, u, step: 'attacker', attacker: null };
  if (alive.length === 1) { ui.attack.attacker = alive[0]; ui.attack.step = 'target'; }
  draw();
}

function confirmAttack(ti) {
  const { p, u, attacker } = ui.attack;
  ui.attack = null;
  const d = X.calcDamage(p, attacker, u);
  const tgt = X.leaderStats(1 - p, ti);
  const L = X.leader(1 - p, ti);
  const total = d.atk + d.dmg + d.boost;
  const m = modal(`<form><h3>Attack</h3>
    <p>${nameHTML(X.card(X.leader(p, attacker).u))} → ${nameHTML(tgt.c)} <span class="muted">(${L.dmg}/${tgt.hp} damage)</span></p>
    <p class="muted small">with ${nameHTML(X.card(u))}</p>
    <p class="calc">ATK <b>${d.atk}</b>${d.dmg ? ` + card <b>${d.dmg}</b>` : ''} + boost <b>${d.boost}</b> = </p>
    <input class="inp big" type="number" step="any" name="t" value="${total}" autofocus>
    <p class="muted small">Adjust for [Attack] effects (e.g. "+30 damage") before confirming. Resolve [After Attack] effects afterwards.</p>
    <div class="row end"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Deal damage</button></div></form>`,
  { onClose: draw });
  const form = m.el.querySelector('form');
  form.t.select();
  form.onsubmit = (e) => { e.preventDefault(); m.onClose = null; closeModal(m); X.attack(p, attacker, ti, u, Math.max(0, +form.t.value || 0)); };
  m.el.querySelector('[data-x]').onclick = () => closeModal(m);
}

function onClick(e) {
  const G = X.G;
  const t = e.target;
  const o = t.closest('[data-o]');
  if (o) {
    const a = o.dataset.o;
    if (a === 'reveal') { ui.shownFor = G.viewer; ui.modalFor = null; draw(); }
    if (a === 'next') X.nextRound();
    if (a === 'undo') X.undo();
    if (a === 'exit') { exitTable(); }
    return;
  }
  const c = t.closest('[data-c]');
  if (c && c.tagName !== 'SELECT') return control(c.dataset.c, c);
  if (t.closest('#gchat')) return;
  const x = e.clientX, y = e.clientY;

  const ppb = t.closest('[data-pp]');
  if (ppb) { sfx('pp'); return X.togglePP(+ppb.dataset.p, +ppb.dataset.pp); }
  const hs = t.closest('[data-hshuf]');
  if (hs) return X.shuffleHand(+hs.dataset.hshuf);
  const tk = t.closest('[data-ticket]');
  if (tk) { sfx('pp'); return X.useTicket(+tk.dataset.ticket); }
  const bo = t.closest('[data-boost]');
  if (bo) { const p = +bo.dataset.boost; return promptNumber('Attack boost for the next attack', X.P(p).boost).then((n) => n != null && X.setBoost(p, n)); }

  const le = t.closest('[data-leader]');
  if (le && !t.closest('.equips')) {
    const p = +le.dataset.p, li = +le.dataset.leader;
    if (ui.attack) {
      const L = X.leader(p, li);
      if (L.downed) return toast('Downed leaders can\'t attack or be targeted');
      if (ui.attack.step === 'attacker' && p === ui.attack.p) { ui.attack.attacker = li; ui.attack.step = 'target'; return draw(); }
      if (ui.attack.step === 'target' && p !== ui.attack.p) return confirmAttack(li);
      return;
    }
    return leaderMenu(p, li, x, y);
  }
  const pl = t.closest('[data-pile]');
  if (pl) return pileMenu(+pl.dataset.p, pl.dataset.pile, x, y);
  const ce = t.closest('[data-u]');
  if (ce) return cardMenu(ce.dataset.u, x, y);
}

async function exitTable() {
  if (online()) netLeave(true); else X.clearSavedGame();
  ui.onExit();
}

async function control(k, el) {
  const G = X.G;
  if (k !== 'vol' && k !== 'mute') sfx('click');
  if (k === 'end') { ui.attack = null; X.endTurn(); }
  if (k === 'undo') X.undo();
  if (k === 'view') X.setViewer(1 - G.viewer);
  if (k === 'open') X.setOpenHands(el.checked);
  if (k === 'concede') { if (await confirmBox(`${esc(X.pname(V()))} concedes the match?`, { ok: 'Concede' })) X.concede(V()); }
  if (k === 'exit') {
    const msg = online() ? 'Leave this online match? Your opponent will be told you left.' : 'Leave the table? The game stays saved and can be resumed from the menu.';
    if (await confirmBox(msg, { ok: 'Leave' })) { if (online()) netLeave(true); ui.onExit(); }
  }
  if (k === 'help') helpModal();
  if (k === 'mat') openCustomize(['table', 'me', 'opp']);
  if (k === 'mute') { setMuted(!isMuted()); if (!isMuted()) sfx('click'); drawControls(); }
}

// ---------- menus ----------
function cardMenu(u, x, y) {
  const f = X.findCard(u);
  if (!f) return;
  const c = X.card(u);
  const own = f.p;
  const vis = canSee(u, f.zone, own);
  const mv = (zone, label, where) => ({ label, action: () => X.moveCard(u, own, zone, where) });
  const items = [{ header: vis ? nameOf(c) : 'Face-down card' }];
  if (f.zone === 'hand') {
    if (!vis) return toast(`That's ${X.pname(own)}'s hand`);
    if (c.type !== 'tactics') items.push({ label: `Play (pay ${c.cost} PP)`, action: () => playFromHand(u, true) }, { label: 'Play without paying', action: () => playFromHand(u, false) });
    items.push('-', mv('trash', 'Discard to trash'), mv('deck', 'Put on top of deck'), mv('deck', 'Put on bottom of deck', { bottom: true }),
      { label: 'Reveal to opponent (log)', action: () => X.act(`${X.pname(own)} reveals ${X.N(u)} from hand.`, null, own) });
  } else if (f.zone === 'play') {
    if (c.type === 'attack') items.push({ label: 'Attack with this card', action: () => startAttack(own, u) }, '-');
    items.push(mv('trash', 'To trash'), mv('hand', 'Return to hand'), mv('deck', 'Put on top of deck'), mv('deck', 'Put on bottom of deck', { bottom: true }));
  } else if (f.zone === 'tacticsArea') {
    if (!vis) return toast('Face-down tactics card');
    items.push({ label: X.G.cards[u].revealed ? 'Revealed' : 'Reveal', disabled: X.G.cards[u].revealed, action: () => X.revealTactics(u) });
    items.push({ label: 'Use (to play area)', action: () => X.useTactics(u) });
    X.P(own).leaders.forEach((L, li) => items.push({ label: `Equip to ${nameOf(X.card(L.u))}`, action: () => X.useTactics(u, li) }));
    items.push('-', mv('tacticsDeck', 'Return to tactics deck'), mv('trash', 'To trash'));
  } else if (f.zone === 'equip') {
    items.push(mv('trash', 'Unequip → trash'), mv('tacticsArea', 'Unequip → tactics area'));
  } else if (f.zone === 'trash') {
    items.push(mv('hand', 'To hand'), mv('play', 'To play area'), mv('deck', 'Put on top of deck'), mv('deck', 'Put on bottom of deck', { bottom: true }));
  }
  contextMenu(x, y, items);
}

function leaderMenu(p, li, x, y) {
  const L = X.leader(p, li);
  const st = X.leaderStats(p, li);
  const big = st.hp >= 50;
  contextMenu(x, y, [
    { header: `${nameOf(st.c)} — ${L.dmg}/${st.hp}` },
    ...((big ? [10, 20, 30, 50] : [1, 2, 3]).map((n) => ({ label: `+${n} damage`, action: () => X.addDamage(p, li, n) }))),
    { label: `Heal ${big ? 10 : 1}`, action: () => X.addDamage(p, li, -(big ? 10 : 1)), disabled: !L.dmg },
    { label: `Heal ${big ? 30 : 3}`, action: () => X.addDamage(p, li, -(big ? 30 : 3)), disabled: !L.dmg },
    { label: 'Set damage…', action: () => promptNumber('Damage counters', L.dmg).then((n) => n != null && X.setDamage(p, li, n)) },
    '-',
    { label: L.downed ? 'Restore (stand up)' : 'Down', action: () => X.toggleDown(p, li) },
    { label: L.awakened ? 'Revert to unawakened' : 'Awaken', action: () => X.toggleAwaken(p, li) },
  ]);
}

function pileMenu(p, zone, x, y) {
  const pl = X.P(p);
  const own = p === V() || (X.G.openHands && !online());
  if (zone === 'deck') {
    contextMenu(x, y, [
      { header: `${X.pname(p)}'s deck (${pl.deck.length})` },
      { label: 'Draw 1', disabled: !mySeatCanAct(p), action: () => X.draw(p, 1) },
      { label: 'Draw X…', disabled: !mySeatCanAct(p), action: () => promptNumber('Draw how many?', 1).then((n) => n && X.draw(p, n)) },
      { label: 'Shuffle', action: () => X.shuffleDeck(p) },
      { label: 'Top card → trash', action: () => X.mill(p, 1) },
      { label: 'Look at top X…', disabled: !own, action: () => promptNumber('Look at how many?', 3).then((n) => n && browse(p, 'deck', pl.deck.slice(0, n), `Top ${n} of deck`)) },
      { label: 'Search deck…', disabled: !own, action: () => { X.act(`${X.pname(p)} searches their deck.`, null, p); browse(p, 'deck', pl.deck.slice(), 'Deck (top first)', true); } },
    ]);
  } else if (zone === 'trash') {
    browse(p, 'trash', pl.trash.slice().reverse(), `${X.pname(p)}'s trash (newest first)`);
  } else if (zone === 'tacticsDeck') {
    if (!own) return toast(`${X.pname(p)}'s tactics deck: ${pl.tacticsDeck.length} cards`);
    browse(p, 'tacticsDeck', pl.tacticsDeck.slice(), 'Tactics deck');
  }
}

/** Modal listing cards in a zone; click a card for move options. */
function browse(p, zone, us, title, forceVisible = false) {
  const own = p === V() || (X.G.openHands && !online());
  const vis = (u) => ((forceVisible || zone === 'deck') ? own : canSee(u, zone, p));
  const html = () => `<h3>${esc(title)}</h3>
    <div class="pickgrid">${us.map((u) => cardHTML(X.card(u), { back: !vis(u), attrs: `data-bu="${u}" ${vis(u) ? `data-vis="1" data-u="${u}"` : ''}` })).join('') || '<span class="muted">Empty</span>'}</div>
    <div class="row end">${zone === 'deck' ? '<button class="btn" data-shuf>Shuffle &amp; close</button>' : ''}<button class="btn primary" data-close>Close</button></div>`;
  const m = modal(html(), { wide: true });
  m.el.addEventListener('mouseover', hoverPreview);
  m.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeModal(m);
    if (e.target.closest('[data-shuf]')) { closeModal(m); return X.shuffleDeck(p); }
    const el = e.target.closest('[data-bu]');
    if (!el) return;
    const u = el.dataset.bu;
    // Face-down trash cards can still be moved by their owner (e.g. "add face-down trash cards to your deck").
    if (!vis(u) && !(zone === 'trash' && own)) return toast('Hidden card');
    if (!mySeatCanAct(p)) return toast("That's your opponent's card");
    const go = (z, where) => () => { X.moveCard(u, p, z, where); us = us.filter((x) => x !== u); m.el.innerHTML = html(); };
    const items = [{ header: vis(u) ? nameOf(X.card(u)) : 'Face-down card' }];
    if (zone !== 'hand') items.push({ label: 'To hand', action: go('hand') });
    if (zone === 'tacticsDeck') items.push({ label: 'Set face-down in tactics area', action: go('tacticsArea') });
    items.push({ label: 'To play area', action: go('play') });
    if (zone !== 'trash') items.push({ label: 'To trash', action: go('trash') });
    if (zone !== 'tacticsDeck') items.push({ label: 'Top of deck', action: go('deck') }, { label: 'Bottom of deck', action: go('deck', { bottom: true }) });
    contextMenu(e.clientX, e.clientY, items);
  });
}

function helpModal() {
  const m = modal(`<h3>How to play (quick reference)</h3>
  <ul class="help">
    <li><b>Goal:</b> down all 4 opposing leaders to win a round. Best of 3 rounds (Quick Match: 1 round).</li>
    <li><b>Your turn starts</b> automatically: PP refresh and you draw 1.</li>
    <li><b>Main phase:</b> click a hand card → Play. The cost is paid by tapping PP. Memoria <span class="kw kw-boost">Attack Boost</span> values are added to <i>Boost</i> and apply to your next attack.</li>
    <li><b>Attack:</b> playing an Attack card asks for an attacking leader, then a target. Damage = leader ATK + boost (editable for <span class="kw kw-attack">Attack</span> effects). If the target's damage ≥ HP it is downed and the attacker awakens.</li>
    <li><b>Tactics:</b> click your face-down tactics card → Use / Equip. One per turn; the first player can't use one on turn 1.</li>
    <li><b>End turn:</b> play area → trash, then draw 1 card per unused PP; discard down to 7.</li>
    <li><b>Deck out:</b> a random tactics-deck card goes to trash and the trash is shuffled back in. No tactics left = you lose.</li>
    <li><b>Manual control:</b> drag any card between zones (Shift-drop on the deck = bottom). Click leaders for damage / heal / down / awaken. Click PP to toggle. <b>Ctrl+Z</b> undoes your last actions.</li>
    <li><b>Colours in card text:</b> <b class="hl-dmg">damage</b>, <b class="hl-heal">healing</b>, <b class="hl-draw">card draw</b>, <b class="hl-pp">PP</b>, <b class="hl-stat">stats</b>; card and talent names use their card colour.</li>
  </ul><div class="row end"><button class="btn primary" data-close>Got it</button></div>`, { wide: true });
  m.el.querySelector('[data-close]').onclick = () => closeModal(m);
}
