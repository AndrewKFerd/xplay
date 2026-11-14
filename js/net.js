// Online play. Two interchangeable transports:
//   'p2p'   – WebRTC via PeerJS (works over the internet with just a room code, no server setup)
//   'relay' – tools/serve.py message relay (same PC, LAN, or a VPN such as Tailscale)
// Model: full-state sync. Whoever acts sends the whole state with an increasing seq number.
// The host is authoritative: on a tie (both acted at once) the host's state wins.
import * as X from './game.js';
import { Cards, getCard } from './db.js';
import { uid } from './util.js';
import { DECIDE_KINDS, openDecide, closeDecide, decideMsg, isDeciding } from './decide.js';

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PEER_PREFIX = 'xross-connect-';

export const net = {
  online: false, role: null, seat: null, room: null, transport: null,
  status: 'idle', // idle | waiting | connecting | connected | disconnected | error
  statusText: '', opponent: '', chat: [],
};
const listeners = new Set();
export const onNet = (f) => { listeners.add(f); return () => listeners.delete(f); };
const notify = () => listeners.forEach((f) => f());
function setStatus(status, text = '') { net.status = status; net.statusText = text; notify(); }

let link = null;          // { send(obj), close() }
let lobby = null;         // host: { name, deck, mode }; guest: { name, deck }
let onStart = null;       // called once the game state exists

export const makeRoomCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

// ---------- card definitions travel with the game so custom cards work on both sides ----------
function defsFor(deck) {
  const ids = new Set([...deck.leaders, ...deck.tactics, ...Object.keys(deck.main), ...(deck.ticket ? [deck.ticket] : [])]);
  return [...ids].map(getCard).filter(Boolean);
}
function registerDefs(defs = []) {
  for (const c of defs) if (c && c.id && !Cards.has(c.id)) Cards.set(c.id, c); // memory only
}

// ---------- transports ----------
function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL;
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load PeerJS (offline?) — try "Local server" mode'));
    document.head.appendChild(s);
  });
}

// WebRTC data channels drop large messages, so P2P traffic is split into small chunks.
const CHUNK = 12000;
function chunkedSend(conn, obj) {
  if (!conn?.open) return;
  const s = JSON.stringify(obj);
  if (s.length <= CHUNK) return conn.send(s);
  const id = uid(), n = Math.ceil(s.length / CHUNK);
  for (let i = 0; i < n; i++) conn.send(JSON.stringify({ t: '~', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
}
function chunkedReceiver(onMsg) {
  const parts = new Map();
  return (raw) => {
    let m;
    try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    if (m?.t !== '~') return onMsg(m);
    const p = parts.get(m.id) || { got: 0, d: [] };
    if (p.d[m.i] == null) { p.d[m.i] = m.d; p.got++; }
    parts.set(m.id, p);
    if (p.got === m.n) {
      parts.delete(m.id);
      try { onMsg(JSON.parse(p.d.join(''))); } catch { /* corrupt */ }
    }
  };
}

async function p2pHost(room, onMsg) {
  await loadPeerJS();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(PEER_PREFIX + room);
    let conn = null;
    peer.on('open', () => resolve({
      send: (o) => chunkedSend(conn, o),
      close: () => { try { conn?.close(); peer.destroy(); } catch { /* ignore */ } },
    }));
    peer.on('connection', (c) => {
      conn?.close();
      conn = c;
      c.on('data', chunkedReceiver(onMsg));
      c.on('close', () => setStatus('disconnected', 'Opponent disconnected — they can rejoin with the same code.'));
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') reject(new Error('That room code is taken — try again'));
      else if (!conn) reject(e); else setStatus('error', e.message);
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* ignore */ } });
  });
}

async function p2pJoin(room, onMsg) {
  await loadPeerJS();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer();
    peer.on('error', (e) => reject(e.type === 'peer-unavailable' ? new Error(`No game found with code ${room}`) : e));
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + room, { reliable: true, serialization: 'raw' });
      const t = setTimeout(() => reject(new Error('Timed out connecting — try "Local server" mode')), 15000);
      conn.on('open', () => {
        clearTimeout(t);
        resolve({ send: (o) => chunkedSend(conn, o), close: () => { try { conn.close(); peer.destroy(); } catch { /* ignore */ } } });
      });
      conn.on('data', chunkedReceiver(onMsg));
      conn.on('close', () => setStatus('disconnected', 'Connection to host lost.'));
    });
  });
}

async function relayLink(room, onMsg) {
  const ping = await fetch('api/ping').then((r) => r.ok).catch(() => false);
  if (!ping) throw new Error('Local server mode needs the app started with start.bat (tools/serve.py)');
  const me = uid();
  const es = new EventSource(`net/${encodeURIComponent(room)}/events?client=${me}&after=0`);
  es.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch { /* ignore */ } };
  es.onerror = () => { if (net.status === 'connected') setStatus('connecting', 'Reconnecting…'); };
  es.onopen = () => { if (net.status === 'connecting') setStatus('connected'); };
  const send = (o) => fetch(`net/${encodeURIComponent(room)}/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: me, msg: o }),
  }).catch(() => setStatus('connecting', 'Reconnecting…'));
  return { send, close: () => es.close() };
}

// ---------- protocol ----------
function send(o) { link?.send(o); }

function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'hello': // guest -> host
      if (net.role !== 'host') return;
      net.opponent = m.name;
      registerDefs(m.defs);
      if (!X.G || !X.G.online) {
        lobby.guest = { name: m.name, deck: m.deck };
        if (DECIDE_KINDS[lobby.first]) {
          // play a mini-game to decide who goes first, then deal
          const begin = { kind: lobby.first, names: [lobby.name, m.name] };
          if (!isDeciding()) openDecide({ ...begin, seat: 0, send, onDone: (first) => startGame(first) });
          send({ t: 'dc', begin });
          setStatus('connected', 'Deciding who goes first…');
          break;
        }
        X.newGame({ decks: [lobby.deck, m.deck], names: [lobby.name, m.name], mode: lobby.mode, first: pickFirst(), online: true });
        onStart && onStart();
      }
      // (re)send the full game; X.newGame already broadcast once via the local hook, this covers rejoins
      send({ t: 'start', state: X.G, defs: defsFor(lobby.deck), seat: 1 });
      setStatus('connected');
      break;
    case 'dc': // who-goes-first mini-game
      if (m.begin && net.role === 'guest') {
        if (X.G?.online) return;
        net.opponent = m.begin.names[0];
        openDecide({ kind: m.begin.kind, names: m.begin.names, seat: 1, send });
        setStatus('connected', 'Deciding who goes first…');
      } else decideMsg(m);
      break;
    case 'start': // host -> guest
      if (net.role !== 'guest') return;
      registerDefs(m.defs);
      net.seat = m.seat;
      net.opponent = m.state.players[0].name;
      closeDecide();
      X.startOnline(m.state);
      setStatus('connected');
      onStart && onStart();
      onStart = null;
      break;
    case 'state':
      receiveState(m.state);
      break;
    case 'chat':
      net.chat.push({ from: m.name, text: String(m.text).slice(0, 300), mine: false, at: Date.now() });
      net.chat = net.chat.slice(-100);
      notify();
      break;
    case 'bye':
      closeDecide();
      setStatus('disconnected', `${net.opponent || 'Opponent'} left the table.`);
      break;
    default:
  }
}

const pickFirst = () => (lobby.first === '0' || lobby.first === '1' ? +lobby.first : Math.random() < 0.5 ? 0 : 1);

function startGame(first) {
  if (!net.online || net.role !== 'host' || !lobby?.guest) return;
  X.newGame({ decks: [lobby.deck, lobby.guest.deck], names: [lobby.name, lobby.guest.name], mode: lobby.mode, first, online: true });
  onStart && onStart();
  send({ t: 'start', state: X.G, defs: defsFor(lobby.deck), seat: 1 });
  setStatus('connected');
}

function receiveState(state) {
  if (!state) return;
  const mine = X.G?.seq ?? -1;
  if (state.seq > mine) X.applyRemote(state);
  else if (state.seq === mine && JSON.stringify(state) !== JSON.stringify(X.G)) {
    // Both acted at once. Host wins: host re-broadcasts, guest adopts the host's copy.
    if (net.role === 'guest') X.applyRemote(state);
    else send({ t: 'state', state: X.G });
  } else if (state.seq < mine && net.role === 'host') {
    send({ t: 'state', state: X.G }); // guest is behind — bring them up to date
  }
}

X.onLocalChange((G) => { if (net.online && link) send({ t: 'state', state: G }); });

// ---------- public API ----------
/** Host a room. opts: { transport, room, name, deck, mode, first }. Resolves when the room is open. */
export async function host(opts, started) {
  leave(false);
  Object.assign(net, { online: true, role: 'host', seat: 0, room: opts.room, transport: opts.transport, opponent: '', chat: [] });
  lobby = { name: opts.name, deck: opts.deck, mode: opts.mode, first: opts.first };
  onStart = started;
  setStatus('connecting', 'Opening room…');
  try {
    link = opts.transport === 'relay' ? await relayLink(opts.room, onMessage) : await p2pHost(opts.room, onMessage);
  } catch (e) { leave(false); setStatus('error', e.message); throw e; }
  setStatus('waiting', 'Waiting for your opponent to join…');
}

/** Join a room. opts: { transport, room, name, deck }. */
export async function join(opts, started) {
  leave(false);
  Object.assign(net, { online: true, role: 'guest', seat: 1, room: opts.room, transport: opts.transport, opponent: '', chat: [] });
  lobby = { name: opts.name, deck: opts.deck };
  onStart = started;
  setStatus('connecting', 'Connecting…');
  try {
    link = opts.transport === 'relay' ? await relayLink(opts.room, onMessage) : await p2pJoin(opts.room, onMessage);
  } catch (e) { leave(false); setStatus('error', e.message); throw e; }
  setStatus('connecting', 'Joined — waiting for the host to deal…');
  const hello = () => send({ t: 'hello', name: opts.name, deck: opts.deck, defs: defsFor(opts.deck) });
  hello();
  // relay messages can race the host's subscription; repeat hello until the game arrives
  const retry = setInterval(() => { if (!net.online || net.status === 'connected') clearInterval(retry); else hello(); }, 2500);
}

export function sendChat(text) {
  const t = String(text || '').trim().slice(0, 300);
  if (!t || !net.online) return;
  const name = X.G?.players?.[net.seat]?.name || lobby?.name || 'Me';
  net.chat.push({ from: name, text: t, mine: true, at: Date.now() });
  send({ t: 'chat', name, text: t });
  notify();
}

export function leave(sayBye = true) {
  if (sayBye && link) send({ t: 'bye' });
  try { link?.close(); } catch { /* ignore */ }
  link = null;
  closeDecide();
  const wasOnline = net.online;
  Object.assign(net, { online: false, role: null, seat: null, room: null, status: 'idle', statusText: '', opponent: '' });
  if (wasOnline && X.G?.online) X.dropGame();
  notify();
}
