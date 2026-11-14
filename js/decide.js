// Online "who goes first" mini-games: dice (Odd/Even, Higher/Lower) and Rock Paper Scissors.
// The host is authoritative: guests send their inputs, the host rolls/resolves and broadcasts
// events that both sides animate the same way. The winner then picks first or second.
import { esc } from './util.js';
import { sfx } from './sfx.js';

export const DECIDE_KINDS = {
  oddeven: 'Dice: Odd or Even',
  highlow: 'Dice: Higher roll',
  rps: 'Rock Paper Scissors',
};
const RPS = { rock: '✊', paper: '✋', scissors: '✌️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

let D = null; // { kind, seat, names, send, onDone, el, host: {...}, busy }

const rand6 = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % 6) + 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const me = () => D.seat;
const them = () => 1 - D.seat;
const nm = (s) => (s === me() ? 'You' : esc(D.names[s] || 'Opponent'));

export const isDeciding = () => !!D;

/** Open the overlay. opts: { kind, seat (0 host / 1 guest), names:[host, guest], send(obj), onDone(firstSeat) (host only) } */
export function openDecide(opts) {
  if (D && D.kind === opts.kind) return;
  closeDecide();
  D = { ...opts, host: { ready: [false, false], picks: [null, null], call: null }, busy: false };
  const el = document.createElement('div');
  el.className = 'decide';
  el.innerHTML = `<div class="dc-box">
      <div class="dc-kicker">Deciding who goes first</div>
      <h2 class="dc-title">${DECIDE_KINDS[D.kind]}</h2>
      <div class="dc-arena"></div>
      <div class="dc-msg"></div>
      <div class="dc-actions"></div>
    </div>`;
  document.body.appendChild(el);
  D.el = el;
  el.addEventListener('click', onClick);
  setup();
}

export function closeDecide() {
  if (!D) return;
  const el = D.el;
  D = null;
  el.classList.add('out');
  setTimeout(() => el.remove(), 350);
}

/** Incoming network message { t:'dc', in } (to host) or { t:'dc', ev } (to guest). */
export function decideMsg(m) {
  if (!D) return;
  if (m.in && D.seat === 0) hostInput({ ...m.in, seat: 1 });
  if (m.ev && D.seat === 1) applyEvent(m.ev);
}

// ---------- rendering ----------
const $ = (s) => D.el.querySelector(s);
const msg = (h) => { $('.dc-msg').innerHTML = h; };
const actions = (h) => { $('.dc-actions').innerHTML = h; };

const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const face = (n) => `<div class="face f${n}">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n].includes(i + 1) ? 'pip' : ''}"></i>`).join('')}</div>`;
const dieHTML = (label, cls = '') => `<div class="dc-side ${cls}"><div class="die3d"><div class="cube" data-x="-20" data-y="25">${[1, 2, 3, 4, 5, 6].map(face).join('')}</div><div class="dshadow"></div></div><div class="dc-label">${label}</div><div class="dc-val"></div></div>`;
const handHTML = (label, cls = '') => `<div class="dc-side ${cls}"><div class="rps-hand"><span>✊</span></div><div class="dc-label">${label}</div><div class="dc-val"></div></div>`;

function setup() {
  D.busy = false;
  const a = $('.dc-arena');
  if (D.kind === 'oddeven') {
    a.innerHTML = dieHTML('');
    const caller = 1; // the guest calls; the host chose the game
    if (me() === caller) {
      msg('Call it — will the die land <b>odd</b> or <b>even</b>?');
      actions('<button class="btn primary" data-call="odd">Odd (1 · 3 · 5)</button><button class="btn primary" data-call="even">Even (2 · 4 · 6)</button>');
    } else {
      msg(`${nm(caller)} is calling odd or even… If they're right, they win.`);
      actions('');
    }
  } else if (D.kind === 'highlow') {
    a.innerHTML = dieHTML(nm(me()), 'mine') + '<div class="dc-vs">VS</div>' + dieHTML(nm(them()), 'theirs');
    msg('Both players roll. Higher number wins.');
    actions('<button class="btn primary" data-roll>Roll the die</button>');
  } else {
    a.innerHTML = handHTML(nm(me()), 'mine') + '<div class="dc-vs">VS</div>' + handHTML(nm(them()), 'theirs');
    msg('Pick your hand. Rock beats scissors, scissors beats paper, paper beats rock.');
    actions(Object.entries(RPS).map(([k, e]) => `<button class="btn rps-btn" data-rps="${k}"><span>${e}</span>${k[0].toUpperCase() + k.slice(1)}</button>`).join(''));
  }
  idleDice();
}

function idleDice() {
  D.el.querySelectorAll('.die3d').forEach((d) => d.classList.add('idle'));
}

/** Tumble a 3D die and land on value. */
function rollDie(side, value, delay = 0) {
  const die = side.querySelector('.die3d'), cube = side.querySelector('.cube');
  const fin = { 1: [0, 0], 2: [90, 0], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 6: [0, 180] }[value];
  // always spin forward from where it is: add several full turns to the target orientation
  const px = +cube.dataset.x, py = +cube.dataset.y;
  const turns = (cur, target, k) => { const base = Math.ceil((cur + 1) / 360) * 360; return base + 360 * k + target; };
  const x = turns(px, fin[0], 2 + Math.floor(Math.random() * 2));
  const y = turns(py, fin[1], 2 + Math.floor(Math.random() * 2));
  const z = Math.round(Math.random() * 30 - 15);
  return new Promise((res) => setTimeout(() => {
    die.classList.remove('idle', 'toss');
    void die.offsetWidth;
    die.classList.add('toss');
    cube.style.transform = `rotateZ(${z}deg) rotateX(${x}deg) rotateY(${y}deg)`;
    cube.dataset.x = x; cube.dataset.y = y;
    sfx('dice');
    setTimeout(() => { sfx('land'); side.classList.add('landed'); side.querySelector('.dc-val').textContent = value; res(); }, 1550);
  }, delay));
}

async function shakeHands(picks) {
  const sides = [D.el.querySelector('.dc-side.mine'), D.el.querySelector('.dc-side.theirs')];
  sides.forEach((s) => { s.classList.remove('landed', 'win', 'lose'); s.querySelector('.rps-hand span').textContent = '✊'; s.querySelector('.dc-val').textContent = ''; s.querySelector('.rps-hand').classList.remove('shake'); });
  void sides[0].offsetWidth;
  sides.forEach((s) => s.querySelector('.rps-hand').classList.add('shake'));
  for (let i = 0; i < 3; i++) setTimeout(() => sfx('slide'), i * 330 + 160);
  await wait(1000);
  const mine = picks[me()], theirs = picks[them()];
  sides[0].querySelector('.rps-hand span').textContent = RPS[mine];
  sides[1].querySelector('.rps-hand span').textContent = RPS[theirs];
  sides[0].querySelector('.dc-val').textContent = mine;
  sides[1].querySelector('.dc-val').textContent = theirs;
  sides.forEach((s) => s.classList.add('landed'));
  sfx('play');
  await wait(450);
}

function markWinner(winner) {
  const sides = D.el.querySelectorAll('.dc-side');
  if (sides.length < 2) return;
  const [mine, theirs] = [D.el.querySelector('.dc-side.mine'), D.el.querySelector('.dc-side.theirs')];
  if (winner == null) return;
  (winner === me() ? mine : theirs).classList.add('win');
  (winner === me() ? theirs : mine).classList.add('lose');
}

function showChoice(winner) {
  sfx(winner === me() ? 'round' : 'turn');
  if (winner === me()) {
    msg(`<b class="dc-won">You win!</b> Do you want to go first or second?`);
    actions('<button class="btn primary" data-first="1">Go first</button><button class="btn" data-first="0">Go second</button>');
  } else {
    msg(`<b class="dc-lost">${nm(winner)} wins.</b> They're choosing whether to go first…`);
    actions('');
  }
}

// ---------- events (both sides) ----------
async function applyEvent(ev) {
  if (!D) return;
  if (ev.e === 'locked') {
    if (ev.seat !== me()) {
      const v = D.el.querySelector('.dc-side.theirs .dc-label');
      if (v && !v.querySelector('.ok')) v.insertAdjacentHTML('beforeend', ` <span class="ok">✔ ${D.kind === 'rps' ? 'locked in' : 'ready'}</span>`);
    }
    return;
  }
  if (ev.e === 'done') {
    msg(`${ev.first === me() ? '<b>You</b> go' : `<b>${nm(ev.first)}</b> goes`} first. Dealing…`);
    actions('');
    return;
  }
  D.busy = true;
  actions('');
  D.el.querySelectorAll('.dc-label .ok').forEach((v) => v.remove());
  if (ev.e === 'oddeven') {
    msg(`${nm(1)} called <b>${ev.call}</b>. Rolling…`);
    await rollDie(D.el.querySelector('.dc-side'), ev.die);
    if (!D) return;
    const parity = ev.die % 2 ? 'odd' : 'even';
    msg(`It's a <b>${ev.die}</b> — <b>${parity}</b>!`);
    await wait(900);
  } else if (ev.e === 'highlow') {
    msg('Rolling…');
    await Promise.all([
      rollDie(D.el.querySelector('.dc-side.mine'), ev.vals[me()]),
      rollDie(D.el.querySelector('.dc-side.theirs'), ev.vals[them()], 120),
    ]);
    if (!D) return;
    markWinner(ev.winner);
    await wait(700);
  } else if (ev.e === 'rps') {
    msg('Rock… paper… scissors…');
    await shakeHands(ev.picks);
    if (!D) return;
    markWinner(ev.winner);
    await wait(500);
  }
  if (!D) return;
  if (ev.winner == null) {
    msg('<b>Tie!</b> Go again.');
    await wait(1200);
    if (!D) return;
    D.el.querySelectorAll('.dc-side').forEach((s) => s.classList.remove('win', 'lose', 'landed'));
    D.el.querySelectorAll('.dc-val').forEach((v) => { v.textContent = ''; });
    D.el.querySelectorAll('.dc-label .ok').forEach((v) => v.remove());
    const keep = D.el.querySelectorAll('.cube');
    setup();
    // keep die orientation so the next roll spins on from where it landed
    D.el.querySelectorAll('.cube').forEach((c, i) => { if (keep[i]) { c.dataset.x = keep[i].dataset.x; c.dataset.y = keep[i].dataset.y; c.style.transform = keep[i].style.transform; } });
    return;
  }
  D.winner = ev.winner;
  showChoice(ev.winner);
}

function broadcast(ev) {
  D.send({ t: 'dc', ev });
  applyEvent(ev);
}

// ---------- host resolution ----------
function hostInput(x) {
  const H = D.host;
  if (x.a === 'call' && D.kind === 'oddeven' && !H.call && x.seat === 1) {
    H.call = x.v === 'even' ? 'even' : 'odd';
    const die = rand6();
    const winner = (die % 2 === 0) === (H.call === 'even') ? 1 : 0;
    H.call = null;
    H.winner = winner;
    broadcast({ e: 'oddeven', call: x.v === 'even' ? 'even' : 'odd', die, winner });
  } else if (x.a === 'ready' && D.kind === 'highlow' && !H.ready[x.seat]) {
    H.ready[x.seat] = true;
    broadcast({ e: 'locked', seat: x.seat });
    if (H.ready[0] && H.ready[1]) {
      H.ready = [false, false];
      const vals = [rand6(), rand6()];
      H.winner = vals[0] === vals[1] ? null : vals[0] > vals[1] ? 0 : 1;
      broadcast({ e: 'highlow', vals, winner: H.winner });
    }
  } else if (x.a === 'pick' && D.kind === 'rps' && !H.picks[x.seat] && RPS[x.v]) {
    H.picks[x.seat] = x.v;
    broadcast({ e: 'locked', seat: x.seat });
    if (H.picks[0] && H.picks[1]) {
      const p = H.picks;
      H.picks = [null, null];
      H.winner = p[0] === p[1] ? null : BEATS[p[0]] === p[1] ? 0 : 1;
      broadcast({ e: 'rps', picks: p, winner: H.winner });
    }
  } else if (x.a === 'choose' && H.winner != null && H.winner === x.seat && !H.chosen) {
    H.chosen = true;
    const first = x.goFirst ? x.seat : 1 - x.seat;
    broadcast({ e: 'done', first });
    const done = D.onDone;
    setTimeout(() => { if (D) { closeDecide(); done?.(first); } }, 1100);
  }
}

function input(x) {
  if (D.seat === 0) hostInput({ ...x, seat: 0 });
  else D.send({ t: 'dc', in: x });
}

function onClick(e) {
  if (!D) return;
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  sfx('click');
  if (b.dataset.call) { actions(''); msg(`You called <b>${b.dataset.call}</b>…`); input({ a: 'call', v: b.dataset.call }); }
  if (b.hasAttribute('data-roll')) {
    actions('<button class="btn" disabled>Waiting for opponent…</button>');
    const l = D.el.querySelector('.dc-side.mine .dc-label');
    if (!l.querySelector('.ok')) l.insertAdjacentHTML('beforeend', ' <span class="ok">✔ ready</span>');
    input({ a: 'ready' });
  }
  if (b.dataset.rps) {
    D.el.querySelectorAll('[data-rps]').forEach((x) => { x.disabled = true; x.classList.toggle('on', x === b); });
    const l = D.el.querySelector('.dc-side.mine .dc-label');
    if (!l.querySelector('.ok')) l.insertAdjacentHTML('beforeend', ' <span class="ok">✔ locked in</span>');
    msg(`You picked ${RPS[b.dataset.rps]}. Waiting for ${nm(them())}…`);
    input({ a: 'pick', v: b.dataset.rps });
  }
  if (b.dataset.first) { actions(''); msg('Dealing…'); input({ a: 'choose', goFirst: b.dataset.first === '1' }); }
}
