// Startup update screen: asks tools/serve.py to check the official card list, and entertains
// you with a rotating line from data/update-quips.json while it works.
import { esc, shuffle } from './util.js';

const MIN_SHOW_MS = 1800;   // long enough to read at least one line
const QUIP_MS = 3600;
const GIVE_UP_MS = 90000;
const FALLBACK = ['in the meantime, try scrolling through VSPO\'s cast.', 'maybe you should watch a few oreapo clips.'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shows the update screen (once per app session). Resolves with the final updater status. */
export async function runUpdateScreen() {
  try { if (sessionStorage.getItem('xc.updateChecked')) return null; } catch { /* storage blocked */ }
  const ping = await fetch('api/ping', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!ping?.updater) return null; // static hosting / old server: nothing to do

  const quips = await fetch('data/update-quips.json').then((r) => r.json()).then((j) => j.quips).catch(() => FALLBACK);
  shuffle(quips);
  const el = document.createElement('div');
  el.className = 'upd';
  el.innerHTML = `
    <div class="upd-box">
      <img class="upd-logo" src="assets/logo.png" alt="XPLAY">
      <h2 class="upd-title">Trying to update<span class="dots"><i>.</i><i>.</i><i>.</i></span></h2>
      <p class="upd-quip"></p>
      <div class="upd-bar"><i></i></div>
      <div class="upd-msg muted small">Checking the official card list…</div>
      <button class="btn sm upd-skip">Skip</button>
    </div>`;
  document.body.appendChild(el);
  const quipEl = el.querySelector('.upd-quip'), bar = el.querySelector('.upd-bar'), msg = el.querySelector('.upd-msg');
  let qi = 0;
  const showQuip = () => {
    quipEl.classList.remove('in');
    void quipEl.offsetWidth; // restart the fade-in
    quipEl.innerHTML = `…${esc(quips[qi++ % quips.length])}`;
    quipEl.classList.add('in');
  };
  showQuip();
  const rot = setInterval(showQuip, QUIP_MS);
  let skipped = false;
  el.querySelector('.upd-skip').onclick = () => { skipped = true; };

  const t0 = Date.now();
  let st = await fetch('api/update/start', { method: 'POST', headers: { 'X-XPLAY': 'update' } }).then((r) => r.json()).catch(() => ({ state: 'error' }));
  while (!skipped && (st.state === 'checking' || st.state === 'downloading') && Date.now() - t0 < GIVE_UP_MS) {
    if (st.state === 'downloading' && st.pages) {
      bar.classList.add('det');
      bar.firstElementChild.style.width = `${Math.round((st.page / st.pages) * 100)}%`;
    }
    if (st.message) msg.textContent = st.message;
    await sleep(350);
    st = await fetch('api/update/status', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ state: 'error' }));
  }
  const left = MIN_SHOW_MS - (Date.now() - t0);
  if (!skipped && left > 0) await sleep(left);

  clearInterval(rot);
  bar.classList.add('det');
  bar.firstElementChild.style.width = '100%';
  const title = el.querySelector('.upd-title');
  if (st.app?.updated || st.app?.installer) {
    await applyAppUpdate(el, title, msg, st.app);
    return st; // the page reloads into the new version (or stays put with instructions)
  }
  const tr = st.i18n?.updated ? st.i18n : null;
  const trText = tr ? `Translations updated${tr.newNames || tr.newLines ? ` (+${tr.newNames} names, +${tr.newLines} lines)` : ''}.` : '';
  if (st.state === 'done') {
    title.textContent = st.added ? `${st.added} new card${st.added === 1 ? '' : 's'}!` : tr ? 'Translations updated!' : 'Card list refreshed!';
    el.classList.add('good');
    msg.textContent = [st.added && !tr ? 'New cards show in Japanese until their translation is published.' : '', trText].filter(Boolean).join(' ');
  } else if (st.state === 'uptodate') {
    title.textContent = 'Up to date ✓';
    msg.textContent = st.app?.newer ? st.app.message : st.count ? `${st.count} cards ready.` : '';
  } else if (skipped) {
    title.textContent = 'Skipped';
    msg.textContent = 'The check keeps going in the background — new cards appear next launch.';
  } else {
    title.textContent = 'Playing offline';
    msg.textContent = st.message || "Couldn't reach the card server — using the cards you have.";
  }
  el.querySelector('.upd-skip').remove();
  await sleep(skipped ? 400 : st.state === 'done' ? 1600 : 900);
  el.classList.add('out');
  setTimeout(() => el.remove(), 500);
  try { sessionStorage.setItem('xc.updateChecked', '1'); } catch { /* ignore */ }
  return st;
}

/** New code was downloaded: restart the local server into it, wait until it answers, reload. */
async function applyAppUpdate(el, title, msg, app) {
  el.classList.add('good');
  el.querySelector('.upd-skip')?.remove();
  el.querySelector('.upd-bar')?.classList.add('det');
  const fill = el.querySelector('.upd-bar i');
  if (fill) fill.style.width = '100%';
  title.textContent = app.installer ? `Installing XPLAY ${app.version}…` : `Updated to XPLAY ${app.version}!`;
  msg.innerHTML = `${app.notes ? `<span class="upd-notes">${esc(app.notes)}</span><br>` : ''}Restarting…`;
  await sleep(app.notes ? 2600 : 1400);
  const ok = await fetch('api/restart', { method: 'POST', headers: { 'X-XPLAY': 'restart' } }).then((r) => r.ok).catch(() => false);
  const limit = Date.now() + (app.installer ? 180000 : 30000);
  while (ok && Date.now() < limit) {
    await sleep(800);
    const ping = await fetch('api/ping', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (ping?.version === app.version) {
      location.reload(); // the new version runs its own (quick) update check
      return;
    }
  }
  title.textContent = 'Almost done';
  msg.textContent = 'Close XPLAY and open it again to finish updating.';
}
