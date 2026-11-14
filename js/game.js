// Game state + actions. The table is "manual" like Cardfight Area: helpers automate the
// bookkeeping from the Playing Manual, but players can always move cards freely and undo.
import { shuffle, uid } from './util.js';
import { getCard, allCards } from './db.js';

export let G = null;
const SAVE_KEY = 'xc.game';
let undoStack = [];
const listeners = new Set();
export const onChange = (f) => listeners.add(f);
export const offChange = (f) => listeners.delete(f);

// Local changes are pushed to the network layer (net.js) through this hook.
let localHook = null;
export const onLocalChange = (f) => { localHook = f; };

function emit(local = true) {
  // Online games aren't written to the hot-seat save slot.
  if (!G?.online) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch { /* quota */ } }
  if (local && localHook && G?.online) localHook(G);
  listeners.forEach((f) => f());
}
export function hasSavedGame() { return !!localStorage.getItem(SAVE_KEY); }
export function loadSavedGame() {
  try { G = JSON.parse(localStorage.getItem(SAVE_KEY)); undoStack = []; return !!G; } catch { return false; }
}
export function clearSavedGame() { localStorage.removeItem(SAVE_KEY); if (!G?.online) G = null; }

/** Run a mutating action with undo + log. */
export function act(msg, fn, p) {
  if (!G) return;
  undoStack.push(JSON.stringify(G));
  if (undoStack.length > 300) undoStack.shift();
  G.seq = (G.seq || 0) + 1;
  if (msg) log(msg, p);
  const r = fn ? fn() : undefined;
  emit();
  return r;
}
export function undo() {
  if (!undoStack.length) return false;
  const seq = G.seq || 0;
  G = JSON.parse(undoStack.pop());
  G.seq = seq + 1; // newer than anything the opponent has, so the undo propagates online
  log('↶ Last action undone.');
  emit();
  return true;
}
export const canUndo = () => undoStack.length > 0;

/** Replace the whole state with one received from the other player. */
export function applyRemote(state) {
  G = state;
  undoStack = []; // undo only ever covers your own most recent actions
  emit(false);
}
/** Forget the current game (used when leaving an online table). */
export function dropGame() { G = null; undoStack = []; }
/** Start an online game from a state built by the host. */
export function startOnline(state) {
  G = state;
  undoStack = [];
  emit(false);
}

// ---------- visual events (played by the board on every client) ----------
export function fx(type, data = {}) {
  G.fxId = (G.fxId || 0) + 1;
  G.fx = [...(G.fx || []), { id: G.fxId, type, ...data }].slice(-12);
}

export function log(msg, p = null) {
  G.log.push({ r: G.round, t: G.turnNo, p, msg });
  if (G.log.length > 600) G.log.shift();
}

// ---------- helpers ----------
export const card = (u) => getCard(G.cards[u]?.id);
/** Log token for a card; rendered (translated + coloured) by i18n.logHTML. */
export const N = (u) => (G.cards[u] ? `⟦${G.cards[u].id}⟧` : 'a card');
export const P = (p) => G.players[p];
export const pname = (p) => G.players[p].name;
export const ZONES = ['deck', 'hand', 'play', 'trash', 'tacticsDeck', 'tacticsArea'];
export const ppMax = (round) => Math.min(5, 2 + round);

// The second player's PP Ticket is a real card (several printings share the name); any copy works.
const TICKET_NAME = 'PPチケット';
const isTicket = (c) => c?.name === TICKET_NAME;
function ticketId() {
  if (getCard('BP01-097')) return 'BP01-097';
  return allCards().find(isTicket)?.id || null;
}

function make(id, owner) {
  const u = uid();
  G.cards[u] = { id, owner, revealed: false };
  return u;
}

export function findCard(u) {
  for (let p = 0; p < 2; p++) {
    const pl = G.players[p];
    for (const z of ZONES) { const i = pl[z].indexOf(u); if (i >= 0) return { p, zone: z, i }; }
    for (let li = 0; li < 4; li++) { const i = pl.leaders[li].equips.indexOf(u); if (i >= 0) return { p, zone: 'equip', li, i }; }
  }
  return null;
}

function detach(u) {
  const f = findCard(u);
  if (!f) return null;
  if (f.zone === 'equip') G.players[f.p].leaders[f.li].equips.splice(f.i, 1);
  else G.players[f.p][f.zone].splice(f.i, 1);
  return f;
}

/** Move a card to a zone. where: {li} for equip, {bottom:true} for deck bottom. deck[0] is the top. */
export function moveRaw(u, p, zone, where = {}) {
  detach(u);
  const c = G.cards[u];
  if (zone !== 'tacticsArea') c.revealed = false;
  if (zone === 'equip') { G.players[p].leaders[where.li].equips.push(u); return; }
  const arr = G.players[p][zone];
  if (zone === 'deck') where.bottom ? arr.push(u) : arr.unshift(u);
  else arr.push(u);
}
export const ZONE_LABEL = { deck: 'deck', hand: 'hand', play: 'play area', trash: 'trash', tacticsDeck: 'tactics deck', tacticsArea: 'tactics area', equip: 'leader (equip)' };

// ---------- setup ----------
export function newGame({ decks, names, mode = 'bo3', first = 0, online = false }) {
  undoStack = [];
  G = {
    v: 1, mode, round: 1, wins: [0, 0], first, turnPlayer: first, turnNo: 1, cards: {},
    players: [], log: [], phase: 'select', selectQueue: [], viewer: first, winner: null, roundWinner: null,
    discard: null, tacticsUsedTurn: false, openHands: false, online, seq: 0, fx: [], fxId: 0,
  };
  for (let p = 0; p < 2; p++) {
    const d = decks[p];
    const pl = {
      name: names[p] || `Player ${p + 1}`, deckName: d.name, leaders: [], deck: [], hand: [], play: [], trash: [],
      tacticsDeck: [], tacticsArea: [], pp: Array(ppMax(1)).fill(false), ticket: null, boost: 0,
      ticketId: isTicket(getCard(d.ticket)) ? d.ticket : null, // this deck's chosen PP Ticket printing
    };
    G.players.push(pl);
    pl.leaders = d.leaders.map((id) => ({ u: make(id, p), awakened: false, downed: false, dmg: 0, equips: [] }));
    for (const [id, n] of Object.entries(d.main)) for (let i = 0; i < n; i++) pl.deck.push(make(id, p));
    shuffle(pl.deck);
    pl.tacticsDeck = d.tactics.map((id) => make(id, p));
  }
  fx('start');
  log(`Match start (${mode === 'bo3' ? 'best of 3' : 'quick match'}). ${pname(first)} goes first.`);
  startSelection();
  emit();
}

/** Each player picks tactics face-down (second player picks 2 in a Quick Match round 1). */
function startSelection() {
  G.phase = 'select';
  G.selectQueue = [];
  for (const p of [G.turnPlayer, 1 - G.turnPlayer]) {
    const need = G.mode === 'quick' && G.round === 1 && p !== G.turnPlayer ? 2 : 1;
    const n = Math.min(need, G.players[p].tacticsDeck.length);
    if (n > 0) G.selectQueue.push({ p, n });
  }
  if (!G.selectQueue.length) beginRound();
}

export function chooseTactics(p, us) {
  act(`${pname(p)} set ${us.length} tactics card(s) face-down.`, () => {
    us.forEach((u) => moveRaw(u, p, 'tacticsArea'));
    G.selectQueue.shift();
    if (!G.selectQueue.length) {
      placeTicket();
      beginRound();
    }
  }, p);
}

/** Best of 3, round 1: after tactics are chosen, the second player puts the PP Ticket face-up in their tactics area. */
function placeTicket() {
  if (G.mode !== 'bo3' || G.round !== 1) return;
  const second = 1 - G.first;
  const id = P(second).ticketId || ticketId();
  if (!id) { P(second).ticket = 'ready'; return; } // card list missing it: fall back to the old button
  const u = make(id, second);
  G.cards[u].revealed = true;
  P(second).tacticsArea.push(u);
  log(`${pname(second)} goes second and places ${N(u)} face-up in their tactics area.`, second);
}

function beginRound() {
  for (let p = 0; p < 2; p++) drawRaw(p, 4);
  log(`Round ${G.round} — both players draw 4. No mulligan.`);
  G.phase = 'main';
  beginTurn();
}

function beginTurn() {
  const pl = P(G.turnPlayer);
  pl.pp = pl.pp.map(() => false);
  pl.boost = 0;
  G.tacticsUsedTurn = false;
  G.viewer = G.turnPlayer;
  fx('turn', { p: G.turnPlayer });
  log(`— ${pname(G.turnPlayer)}'s turn ${G.turnNo}: PP refreshed, draw 1.`, G.turnPlayer);
  drawRaw(G.turnPlayer, 1);
}

// ---------- drawing / deck-out ----------
function drawRaw(p, n) {
  const pl = P(p);
  for (let i = 0; i < n; i++) {
    if (!pl.deck.length && !deckOut(p)) return false;
    moveRaw(pl.deck[0], p, 'hand');
  }
  return true;
}
/** Deck empty: trash a random tactics-deck card, then shuffle trash back in. No tactics left = lose. */
function deckOut(p) {
  const pl = P(p);
  if (G.winner != null) return false;
  if (!pl.tacticsDeck.length) {
    G.winner = 1 - p;
    log(`${pname(p)} must refresh an empty deck with no tactics deck left — ${pname(1 - p)} wins the match!`);
    return false;
  }
  const t = pl.tacticsDeck[Math.floor(Math.random() * pl.tacticsDeck.length)];
  moveRaw(t, p, 'trash');
  const back = pl.trash.filter((u) => card(u)?.type !== 'tactics');
  back.forEach((u) => moveRaw(u, p, 'deck'));
  shuffle(pl.deck);
  fx('shuffle', { p });
  log(`${pname(p)}'s deck ran out: ${N(t)} (tactics) trashed as a cost, ${back.length} trash cards shuffled back into the deck.`, p);
  return pl.deck.length > 0;
}

export const draw = (p, n = 1) => act(`${pname(p)} draws ${n}.`, () => drawRaw(p, n), p);
export const shuffleDeck = (p) => act(`${pname(p)} shuffles their deck.`, () => { shuffle(P(p).deck); fx('shuffle', { p }); }, p);
/** Discard chosen cards from hand (face-down, not revealed — per the official FAQ). */
export function discardCards(p, us) {
  if (!us.length) return;
  act(`${pname(p)} discards ${us.length} card${us.length > 1 ? 's' : ''}.`, () => us.forEach((u) => moveRaw(u, p, 'trash')), p);
}
export function shuffleHand(p) {
  act(`${pname(p)} shuffles their hand.`, () => { shuffle(P(p).hand); fx('handshuffle', { p }); }, p);
}
export function mill(p, n = 1) {
  act(`${pname(p)} puts the top ${n} card(s) of their deck into the trash.`, () => {
    for (let i = 0; i < n && P(p).deck.length; i++) moveRaw(P(p).deck[0], p, 'trash');
  }, p);
}

// ---------- PP ----------
export const untappedPP = (p) => P(p).pp.filter((x) => !x).length;
export function togglePP(p, i) {
  act(null, () => { P(p).pp[i] = !P(p).pp[i]; });
}
export function payPP(p, n) {
  const pl = P(p);
  let left = n;
  for (let i = 0; i < pl.pp.length && left > 0; i++) if (!pl.pp[i]) { pl.pp[i] = true; left--; }
}
export function restorePP(p, n = 1) {
  act(`${pname(p)} restores ${n} PP.`, () => {
    const pl = P(p);
    let left = n;
    for (let i = pl.pp.length - 1; i >= 0 && left > 0; i--) if (pl.pp[i]) { pl.pp[i] = false; left--; }
  }, p);
}
export function addPP(p, d) {
  act(`${pname(p)} ${d > 0 ? 'adds' : 'removes'} a PP card.`, () => { if (d > 0) P(p).pp.push(false); else P(p).pp.pop(); }, p);
}
export function useTicket(p) {
  act(`${pname(p)} uses the PP Ticket (restore 1 PP).`, () => {
    const pl = P(p);
    const i = pl.pp.lastIndexOf(true);
    if (i >= 0) pl.pp[i] = false;
    pl.ticket = 'used';
  }, p);
}

// ---------- playing cards ----------
/** Play from hand. Returns {ok, reason}. */
export function playCard(u, { pay = true } = {}) {
  const f = findCard(u);
  const c = card(u);
  if (!f || !c) return { ok: false };
  const cost = c.cost || 0;
  if (pay && untappedPP(f.p) < cost) return { ok: false, reason: `Not enough PP (${untappedPP(f.p)}/${cost})` };
  act(`${pname(f.p)} plays ${N(u)}${pay && cost ? ` (pay ${cost} PP)` : ''}.`, () => {
    if (pay) payPP(f.p, cost);
    moveRaw(u, f.p, 'play');
    if (c.type === 'memoria' && c.boost) P(f.p).boost += c.boost;
  }, f.p);
  return { ok: true, card: c, p: f.p };
}

export function moveCard(u, p, zone, where = {}) {
  const c = card(u);
  const from = findCard(u)?.zone;
  const wasPublic = from === 'play' || from === 'equip' || (from === 'tacticsArea' && G.cards[u].revealed) || c?.type === 'tactics' && from === 'trash';
  const hidden = (['deck', 'hand', 'tacticsDeck', 'tacticsArea'].includes(zone) && !G.cards[u].revealed)
    // trash is face-down: a card going there stays anonymous unless it was already public
    || (zone === 'trash' && c?.type !== 'tactics' && !wasPublic);
  act(`${pname(p)} moves ${hidden ? 'a card' : N(u)} to ${zone === 'deck' ? (where.bottom ? 'the bottom of the deck' : 'the top of the deck') : 'the ' + ZONE_LABEL[zone]}.`,
    () => moveRaw(u, p, zone, where), p);
}

export function revealTactics(u) {
  const f = findCard(u);
  act(`${pname(f.p)} reveals tactics: ${N(u)}.`, () => { G.cards[u].revealed = true; }, f.p);
}
export function useTactics(u, li = null) {
  const f = findCard(u);
  const c = card(u);
  const note = f.p === G.turnPlayer && G.turnNo === 1 && G.turnPlayer === G.first && G.round === 1 ? ' (note: first player can\'t use tactics on turn 1)' : '';
  act(`${pname(f.p)} uses tactics ${N(u)}${li != null ? ` equipped to ${N(P(f.p).leaders[li].u)}` : ''}.${G.tacticsUsedTurn ? ' (already used one this turn!)' : ''}${note}`, () => {
    if (li != null) moveRaw(u, f.p, 'equip', { li });
    else moveRaw(u, f.p, 'play');
    G.tacticsUsedTurn = true;
    if (isTicket(c)) { // 【プレイ時】PPを1回復する
      const pl = P(f.p);
      const i = pl.pp.lastIndexOf(true);
      if (i >= 0) pl.pp[i] = false;
      log(`${N(u)}: ${pname(f.p)} restores 1 PP.`, f.p);
    }
  }, f.p);
}

// ---------- leaders / combat ----------
export const leader = (p, li) => P(p).leaders[li];
export function leaderStats(p, li) {
  const L = leader(p, li);
  const c = card(L.u);
  return { atk: L.awakened ? c.atkAwake : c.atk, hp: L.awakened ? c.hpAwake : c.hp, c };
}
export function calcDamage(p, li, u) {
  return { atk: leaderStats(p, li).atk, dmg: card(u)?.damage || 0, boost: P(p).boost };
}

function downCheck(p, li) {
  const L = leader(p, li);
  if (!L.downed && L.dmg >= leaderStats(p, li).hp) {
    L.downed = true; L.dmg = 0;
    fx('down', { t: [p, li] });
    log(`${N(L.u)} (${pname(p)}) is DOWNED.`, p);
    return true;
  }
  return false;
}
function roundCheck() {
  for (let p = 0; p < 2; p++) {
    if (G.roundWinner == null && P(p).leaders.every((L) => L.downed)) {
      G.roundWinner = 1 - p;
      fx('round', { w: 1 - p });
      log(`All of ${pname(p)}'s leaders are down. ${pname(1 - p)} wins round ${G.round}!`);
    }
  }
}

export function attack(p, ali, ti, u, total) {
  const op = 1 - p;
  const A = leader(p, ali), T = leader(op, ti);
  act(`${N(A.u)} attacks ${N(T.u)} with ${N(u)} for ${total} damage.`, () => {
    fx('attack', { a: [p, ali], t: [op, ti], n: total });
    T.dmg += total;
    P(p).boost = 0;
    if (downCheck(op, ti) && !A.awakened) {
      A.awakened = true;
      fx('awaken', { t: [p, ali] });
      log(`${N(A.u)} AWAKENS! Resolve its [On awaken] effect.`, p);
    }
    roundCheck();
  }, p);
}

export function addDamage(p, li, n) {
  act(`${N(leader(p, li).u)} ${n >= 0 ? 'takes' : 'heals'} ${Math.abs(n)} damage.`, () => {
    const L = leader(p, li);
    fx(n >= 0 ? 'dmg' : 'heal', { t: [p, li], n: Math.abs(n) });
    L.dmg = Math.max(0, L.dmg + n);
    downCheck(p, li);
    roundCheck();
  }, p);
}
export function setDamage(p, li, n) {
  act(`${N(leader(p, li).u)} damage set to ${n}.`, () => { leader(p, li).dmg = Math.max(0, n); downCheck(p, li); roundCheck(); }, p);
}
export function toggleDown(p, li) {
  const L = leader(p, li);
  act(`${N(L.u)} ${L.downed ? 'is restored' : 'is downed'}.`, () => { L.downed = !L.downed; L.dmg = 0; if (L.downed) fx('down', { t: [p, li] }); roundCheck(); }, p);
}
export function toggleAwaken(p, li) {
  const L = leader(p, li);
  act(`${N(L.u)} ${L.awakened ? 'reverts to unawakened' : 'AWAKENS'}.`, () => { L.awakened = !L.awakened; if (L.awakened) fx('awaken', { t: [p, li] }); }, p);
}
export function setBoost(p, n) { act(`${pname(p)} attack boost set to +${n}.`, () => { P(p).boost = Math.max(0, n); }, p); }

// ---------- turn / round flow ----------
export function endTurn() {
  const p = G.turnPlayer;
  const pl = P(p);
  act(null, () => {
    pl.play.slice().forEach((u) => moveRaw(u, p, 'trash'));
    const n = untappedPP(p);
    log(`${pname(p)} ends the turn: play area to trash, ${n} unused PP → draw ${n}.`, p);
    drawRaw(p, n);
    pl.boost = 0;
    if (pl.hand.length > 7) G.discard = { p, n: pl.hand.length - 7 };
    else passTurn();
  });
}
export function discardTo7(us) {
  const p = G.discard.p;
  act(`${pname(p)} discards ${us.length} card(s) down to 7.`, () => {
    us.forEach((u) => moveRaw(u, p, 'trash'));
    G.discard = null;
    passTurn();
  }, p);
}
function passTurn() {
  if (G.winner != null) return;
  G.turnPlayer = 1 - G.turnPlayer;
  G.turnNo++;
  beginTurn();
}

/** Called after the round-over dialog. */
export function nextRound() {
  act(null, () => {
    const w = G.roundWinner, l = 1 - w;
    G.wins[w]++;
    G.roundWinner = null;
    const need = G.mode === 'bo3' ? 2 : 1;
    if (G.wins[w] >= need) {
      G.winner = w;
      fx('match', { w });
      log(`${pname(w)} wins the match ${G.wins[w]}–${G.wins[l]}!`);
      return;
    }
    const nr = G.round + 1;
    for (let p = 0; p < 2; p++) {
      const pl = P(p);
      pl.play.slice().forEach((u) => moveRaw(u, p, 'trash'));
      pl.hand.slice().forEach((u) => moveRaw(u, p, 'trash'));
      pl.leaders.forEach((L) => { L.dmg = 0; L.downed = false; }); // awakening + equips carry over
      pl.pp = Array(ppMax(nr)).fill(false);
      pl.ticket = null;
      pl.boost = 0;
    }
    G.round = nr;
    G.turnPlayer = l;
    G.first = l;
    G.turnNo = 1;
    log(`=== Round ${G.round} — ${pname(l)} lost the last round and goes first. PP is now ${ppMax(G.round)}. Hands went to the trash; awakening and trash carry over.`);
    startSelection();
  });
}

export function concede(p) {
  act(`${pname(p)} concedes.`, () => { G.winner = 1 - p; fx('match', { w: 1 - p }); }, p);
}
export function setViewer(p) { G.viewer = p; emit(); }
export function setOpenHands(v) { G.openHands = v; emit(); }
