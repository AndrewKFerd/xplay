import './lockdown.js';
import './artview.js';
import './touch.js';
import { initPWA, installButton } from './pwa.js';
import { $, esc, toast, confirmBox, closeContextMenu } from './util.js';
import { initDB, allCards, hasOfficialCards, loadBundled, clearCards, upsertCards, Cards, detectImageProxy } from './db.js';
import { initI18n, lang, setLang } from './i18n.js';
import { initCustom, openCustomize } from './custom.js';
import { net, onNet, host as netHost, join as netJoin, leave as netLeave, makeRoomCode } from './net.js';
import { loadDecks, saveDeck, deleteDeck, validate, getDeck } from './decks.js';
import { renderBuilder, builderDirty } from './builder.js';
import { renderCards } from './cardsview.js';
import { renderGame } from './board.js';
import { runUpdateScreen } from './updater.js';
import * as X from './game.js';

let cleanup = null;
let current = 'home';
let serverMode = false; // started by the desktop app (tools/serve.py) rather than as a web app

async function boot() {
  // Check for a new card set first (loading screen); the card list below then picks up any update.
  await runUpdateScreen().catch((e) => console.warn('update check failed', e));
  await initDB();
  // Keep the stored cards in sync with data/xross-cards.json (re-fetched by tools/fetch-cards.mjs).
  const official = await loadBundled('official').catch(() => null);
  if (official) {
    const sig = `${official.length}:${official.reduce((a, c) => a + (c.officialId || 0) * 7 + (c.limit ?? 4) + (c.family || 0), 0)}`;
    if (!hasOfficialCards()) {
      // first switch away from the placeholder set
      await clearCards();
      await upsertCards(official);
      loadDecks().filter((d) => d.id.startsWith('sample-')).forEach((d) => deleteDeck(d.id));
      X.clearSavedGame(); // a saved game would reference the removed placeholder cards
      localStorage.setItem('xc.seeded', '1');
    } else if (localStorage.getItem('xc.cardsSig') !== sig) {
      await upsertCards(official); // updates official cards, keeps any custom ones
    }
    localStorage.setItem('xc.cardsSig', sig);
    if (!localStorage.getItem('xc.officialDecks')) {
      const decks = await fetch('data/official-decks.json').then((r) => r.json()).catch(() => []);
      const have = new Set(loadDecks().map((d) => d.id));
      decks.filter((d) => !have.has(d.id)).forEach((d) => saveDeck(d));
      localStorage.setItem('xc.officialDecks', '1');
    }
  }
  const [, hasServer] = await Promise.all([initI18n(Cards), detectImageProxy(), initCustom()]);
  serverMode = hasServer;
  initPWA(hasServer);
  // Keep tools/serve.py alive while a window is open (it exits a few minutes after the last one closes).
  if (hasServer) setInterval(() => fetch('api/ping', { cache: 'no-store' }).catch(() => {}), 60_000);
  const ls = document.getElementById('lang');
  if (ls) {
    ls.value = lang();
    ls.onchange = () => { setLang(ls.value); go(current, true); };
  }
  if (!localStorage.getItem('xc.seeded') && !hasOfficialCards()) {
    const decks = await fetch('data/sample-decks.json').then((r) => r.json()).catch(() => []);
    decks.forEach((d) => saveDeck(d));
    localStorage.setItem('xc.seeded', '1');
  }
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]');
    if (n) { e.preventDefault(); go(n.dataset.nav); }
  });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1) || 'home'; if (v !== current) go(v); });
  window.addEventListener('beforeunload', (e) => { if (current === 'builder' && builderDirty()) e.preventDefault(); });
  go(location.hash.slice(1) || 'home');
}

async function go(view, force = false) {
  if (!force && current === 'builder' && view !== 'builder' && builderDirty() && !(await confirmBox('Leave the deck builder without saving?', { ok: 'Leave' }))) return;
  cleanup && cleanup();
  cleanup = null;
  closeContextMenu(); // a card menu left open must not outlive its page
  current = view;
  history.replaceState(null, '', view === 'home' ? location.pathname : '#' + view);
  document.body.dataset.view = view;
  $$nav();
  // fresh container per view so listeners never pile up
  const host = $('#app');
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'view';
  host.appendChild(root);
  if (view === 'builder') renderBuilder(root);
  else if (view === 'cards') renderCards(root);
  else if (view === 'setup') renderSetup(root);
  else if (view === 'online') renderOnline(root);
  else if (view === 'game') {
    if (!X.G && !X.loadSavedGame()) return go('home');
    cleanup = renderGame(root, () => go('home'));
  } else renderHome(root);
}

function $$nav() {
  document.querySelectorAll('.topnav [data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === current));
}

function renderHome(root) {
  const saved = X.hasSavedGame();
  root.innerHTML = `
  <div class="home">
    <div class="hero">
      <h1 class="hero-logo"><img src="assets/logo.png" alt="XPLAY"></h1>
      <p class="muted">A tabletop simulator for the Xross Stars TCG</p>
    </div>
    <div class="tiles">
      ${saved ? '<button class="tile hi" data-nav="game"><b>Resume game</b><span>Continue the saved match</span></button>' : ''}
      ${X.G?.online ? '<button class="tile hi" data-nav="game"><b>Return to online match</b><span>Your match is still running</span></button>' : ''}
      <button class="tile ${saved ? '' : 'hi'}" data-nav="online"><b>Play online</b><span>Host or join with a room code</span></button>
      <button class="tile" data-nav="setup"><b>Local game</b><span>Hot-seat 2 players on one device</span></button>
      <button class="tile" data-nav="builder"><b>Deck builder</b><span>${loadDecks().length} decks saved</span></button>
      <button class="tile" data-nav="cards"><b>Card database</b><span>${allCards().length} cards · import JSON / CSV / images</span></button>
    </div>
    <div class="row center home-extra"><button class="btn sm" id="h-custom">🎨 Backgrounds &amp; playmats</button><span id="h-install"></span></div>
    <p class="muted small center">Fan-made tool, not affiliated with Brave group / Crazy Raccoon. Card data and images are loaded from files you provide.<span id="h-ver"></span></p>
  </div>`;
  root.querySelector('#h-custom').onclick = () => openCustomize();
  installButton(root.querySelector('#h-install'));
  fetch(serverMode ? 'api/ping' : 'package.json', { cache: 'no-store' }).then((r) => r.json()).then((p) => {
    const v = root.querySelector('#h-ver');
    if (v && p.version) v.textContent = ` · XPLAY v${p.version}`;
  }).catch(() => {});
}

function renderSetup(root) {
  const decks = loadDecks();
  if (!decks.length) {
    root.innerHTML = `<div class="setup"><p>You have no decks yet.</p><button class="btn primary" data-nav="builder">Open deck builder</button></div>`;
    return;
  }
  const last = JSON.parse(localStorage.getItem('xc.lastSetup') || '{}');
  const opts = (sel) => decks.map((d) => `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  root.innerHTML = `
  <form class="setup">
    <h2>New local game</h2>
    <div class="players">
      ${[0, 1].map((p) => `<div class="pcard">
        <h3>Player ${p + 1}</h3>
        <label>Name<input class="inp" name="n${p}" value="${esc(last['n' + p] || 'Player ' + (p + 1))}"></label>
        <label>Deck<select class="inp" name="d${p}">${opts(last['d' + p] || decks[Math.min(p, decks.length - 1)].id)}</select></label>
        <div class="dval" data-val="${p}"></div>
      </div>`).join('')}
    </div>
    <div class="row wrap">
      <label>Format<select class="inp" name="mode">
        <option value="bo3" ${last.mode !== 'quick' ? 'selected' : ''}>Normal match (best of 3, PP 3→4→5)</option>
        <option value="quick" ${last.mode === 'quick' ? 'selected' : ''}>Quick match (1 round)</option></select></label>
      <label>First player<select class="inp" name="first">
        <option value="r">Random (rock-paper-scissors)</option><option value="0">Player 1</option><option value="1">Player 2</option></select></label>
    </div>
    <label class="chk"><input type="checkbox" name="loose" ${last.loose ? 'checked' : ''}> Allow illegal decks (testing)</label>
    <div class="row end"><button type="button" class="btn" data-nav="home">Back</button><button class="btn primary big">Start match</button></div>
  </form>`;
  const form = root.querySelector('form');
  const showVal = () => [0, 1].forEach((p) => {
    const v = validate(getDeck(form['d' + p].value));
    root.querySelector(`[data-val="${p}"]`).innerHTML = v.ok ? '<span class="ok">✔ Legal deck</span>'
      : `<span class="bad">✖ ${v.errors.map(esc).slice(0, 4).join('<br>')}</span>`;
  });
  form.addEventListener('change', showVal);
  showVal();
  form.onsubmit = (e) => {
    e.preventDefault();
    const d = [getDeck(form.d0.value), getDeck(form.d1.value)];
    const bad = d.map(validate).filter((v) => !v.ok);
    if (bad.length && !form.loose.checked) return toast('A deck is not legal — fix it or tick "Allow illegal decks"');
    if (d.some((x) => x.leaders.length !== 4)) return toast('Each deck needs exactly 4 leaders to play');
    const first = form.first.value === 'r' ? (Math.random() < 0.5 ? 0 : 1) : +form.first.value;
    localStorage.setItem('xc.lastSetup', JSON.stringify({ n0: form.n0.value, n1: form.n1.value, d0: form.d0.value, d1: form.d1.value, mode: form.mode.value, loose: form.loose.checked }));
    X.newGame({ decks: d, names: [form.n0.value, form.n1.value], mode: form.mode.value, first });
    go('game');
  };
}

function renderOnline(root) {
  const decks = loadDecks();
  if (!decks.length) {
    root.innerHTML = `<div class="setup"><p>You need a deck first.</p><button class="btn primary" data-nav="builder">Open deck builder</button></div>`;
    return;
  }
  if (X.G?.online && net.online) { go('game'); return; }
  const last = JSON.parse(localStorage.getItem('xc.online') || '{}');
  const opts = decks.map((d) => `<option value="${d.id}" ${d.id === last.deck ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  root.innerHTML = `
  <div class="setup online">
    <h2>Play online</h2>
    <div class="players">
      <div class="pcard">
        <h3>You</h3>
        <label>Name<input class="inp" id="on-name" maxlength="24" value="${esc(last.name || 'Player')}"></label>
        <label>Deck<select class="inp" id="on-deck">${opts}</select></label>
        <div class="dval" id="on-val"></div>
      </div>
      <div class="pcard">
        <h3>Connection</h3>
        <label class="chk"><input type="radio" name="tr" value="p2p" ${last.tr !== 'relay' || !serverMode ? 'checked' : ''}> <span><b>Internet (peer-to-peer)</b><br><span class="muted small">Share a room code with a friend anywhere. Both of you run XPLAY.</span></span></label>
        <label class="chk" ${serverMode ? '' : 'hidden'}><input type="radio" name="tr" value="relay" ${last.tr === 'relay' && serverMode ? 'checked' : ''}> <span><b>Local server</b><br><span class="muted small">Same PC, same Wi-Fi or a VPN like Tailscale. Your friend opens your address; start with <code>start-lan.bat</code>.</span></span></label>
      </div>
    </div>
    <div class="players">
      <div class="pcard">
        <h3>Host a game</h3>
        <div class="row wrap">
          <label>Format<select class="inp" id="on-mode"><option value="bo3">Best of 3</option><option value="quick" ${last.mode === 'quick' ? 'selected' : ''}>Quick match</option></select></label>
          <label>Who goes first<select class="inp" id="on-first">${[['r', 'Random'], ['oddeven', '🎲 Dice: Odd or Even'], ['highlow', '🎲 Dice: Higher roll'], ['rps', '✊ Rock Paper Scissors'], ['0', 'Me'], ['1', 'Opponent']].map(([v, l]) => `<option value="${v}" ${(last.first || 'r') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <button class="btn primary" id="on-host">Create room</button>
        <div id="on-room"></div>
      </div>
      <div class="pcard">
        <h3>Join a game</h3>
        <label>Room code<input class="inp code" id="on-code" maxlength="6" placeholder="ABC123" autocomplete="off"></label>
        <button class="btn primary" id="on-join">Join</button>
      </div>
    </div>
    <div class="netstatus" id="on-status"></div>
    <div class="row end"><button class="btn" data-nav="home" id="on-back">Back</button></div>
  </div>`;
  const $id = (i) => root.querySelector('#' + i);
  const showVal = () => {
    const v = validate(getDeck($id('on-deck').value));
    $id('on-val').innerHTML = v.ok ? '<span class="ok">✔ Legal deck</span>' : `<span class="bad">✖ ${v.errors.map(esc).slice(0, 3).join('<br>')}</span>`;
  };
  $id('on-deck').onchange = showVal;
  showVal();
  const params = () => {
    const p = {
      name: $id('on-name').value.trim() || 'Player', deck: getDeck($id('on-deck').value),
      transport: root.querySelector('input[name="tr"]:checked').value,
      mode: $id('on-mode').value, first: $id('on-first').value,
    };
    localStorage.setItem('xc.online', JSON.stringify({ name: p.name, deck: p.deck.id, tr: p.transport, mode: p.mode, first: p.first }));
    return p;
  };
  const off = onNet(() => {
    const el = $id('on-status');
    if (!el) return off();
    el.className = `netstatus ${net.status}`;
    el.textContent = net.statusText;
  });
  const started = () => { off(); go('game'); };
  const busy = (b) => { $id('on-host').disabled = b; $id('on-join').disabled = b; };
  $id('on-host').onclick = async () => {
    const p = params();
    if (!validate(p.deck).ok) return toast('Your deck isn\'t legal — fix it in the deck builder first');
    const room = makeRoomCode();
    busy(true);
    try {
      await netHost({ ...p, room }, started);
      $id('on-room').innerHTML = `<div class="roomcode"><span>Room code</span><b>${room}</b><button class="btn sm" id="on-copy">Copy</button><button class="btn sm danger" id="on-cancel">Cancel</button></div>`;
      $id('on-copy').onclick = () => navigator.clipboard?.writeText(room).then(() => toast('Copied'));
      $id('on-cancel').onclick = () => { netLeave(false); busy(false); $id('on-room').innerHTML = ''; };
    } catch (e) { busy(false); toast(e.message, 5000); }
  };
  $id('on-join').onclick = async () => {
    const p = params();
    const room = $id('on-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(room)) return toast('Enter the 6-character room code');
    if (!validate(p.deck).ok) return toast('Your deck isn\'t legal — fix it in the deck builder first');
    busy(true);
    try { await netJoin({ ...p, room }, started); } catch (e) { busy(false); toast(e.message, 5000); }
  };
  $id('on-back').onclick = () => { if (net.online && !X.G?.online) netLeave(false); };
}

boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">${esc(e.stack || e)}</pre>`); });
