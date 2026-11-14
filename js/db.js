// Card database: card records + imported images, persisted in IndexedDB.
import { esc } from './util.js';
import { nameOf, nameHTML, textOf, textHTML, colorCls, lang, translateName, COLOR_LABEL } from './i18n.js';

const DB_NAME = 'xross-connect';
const DB_VER = 1;
let dbp = null;

function idb() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function req(store, mode, fn) {
  return idb().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  }));
}

// ---------- in-memory index ----------
export const Cards = new Map(); // id -> card
const imgURLs = new Map(); // key (id or id#back) -> object URL

export const TYPES = ['leader', 'attack', 'memoria', 'tactics'];
export const TYPE_LABEL = { leader: 'Leader', attack: 'Attack', memoria: 'Memoria', tactics: 'Tactics' };
/** Options for type filters: the card types plus ACE cards (any type). */
export const typeOptions = (sel) => `<option value="">All types</option>${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('')}<option value="ace" ${sel === 'ace' ? 'selected' : ''}>★ ACE cards</option>`;

// The second player's PP Ticket: a real card with several printings; each deck can pick its favourite.
export const TICKET_NAME = 'PPチケット';
export const DEFAULT_TICKET = 'BP01-097';
export const isTicket = (c) => c?.name === TICKET_NAME;
export const ticketCards = () => allCards().filter(isTicket);
export const deckTicket = (deck) => (isTicket(getCard(deck?.ticket)) ? deck.ticket : getCard(DEFAULT_TICKET) ? DEFAULT_TICKET : ticketCards()[0]?.id || null);

const num = (v, d = 0) => (v === '' || v == null || isNaN(+v) ? d : +v);
const bool = (v) => v === true || v === 1 || /^(true|1|yes|y)$/i.test(String(v ?? '').trim());

// Japanese labels used on the official card list (xross-stars.com/card).
const JP_TYPE = { 'リーダー': 'leader', 'アタック': 'attack', 'メモリア': 'memoria', 'タクティクス': 'tactics', 'PP': 'pp' };
const JP_COLOR = { '赤': 'Red', '青': 'Blue', '緑': 'Green', '黄': 'Yellow', '紫': 'Purple', '白': 'White', '黒': 'Black', '無': 'Neutral' };
function mapType(v) {
  const s = String(v || 'attack').trim();
  for (const [jp, t] of Object.entries(JP_TYPE)) if (s.startsWith(jp)) return t;
  return s.toLowerCase().replace(/\s*card$/, '').replace('memory', 'memoria');
}
function mapColor(v) {
  const s = String(v || '').trim();
  if (!s) return 'Neutral';
  return s.split(/[\/・,、]+/).map((x) => JP_COLOR[x.trim()] || x.trim()).join('/');
}

export function normalize(c) {
  const type = mapType(c.type || c.card_type || c.kind);
  return {
    id: String(c.id && !/^\d+$/.test(String(c.id)) ? c.id : c.card_number || c.number || c.no || c.id || '').trim(),
    name: String(c.name || '').trim(),
    type: TYPES.includes(type) ? type : type === 'pp' ? 'pp' : 'attack',
    color: mapColor(c.color),
    cost: num(c.cost),
    damage: num(c.damage),
    boost: num(c.boost),
    atk: num(c.atk),
    hp: num(c.hp),
    atkAwake: num(c.atkAwake, num(c.atk)),
    hpAwake: num(c.hpAwake, num(c.hp)),
    text: String(c.text || ''),
    textAwake: String(c.textAwake || ''),
    tacticsKind: String(c.tacticsKind || 'consumable').toLowerCase() === 'equipment' ? 'equipment' : 'consumable',
    ace: bool(c.ace),
    limit: c.limit === '' || c.limit == null ? 4 : num(c.limit, 4),
    buildRule: String(c.buildRule || ''),
    set: String(c.set || ''),
    rarity: String(c.rarity || ''),
    parallel: bool(c.parallel),
    officialId: c.officialId ?? null,
    family: c.family ?? null,
    illustrator: String(c.illustrator || ''),
    image: String(c.image || c.image_url || ''),
    imageBack: String(c.imageBack || ''),
  };
}

export async function initDB() {
  let list = await req('cards', 'readonly', (s) => s.getAll());
  if (!list || !list.length) {
    await upsertCards(await loadBundled());
    list = await req('cards', 'readonly', (s) => s.getAll());
  }
  Cards.clear();
  list.forEach((c) => Cards.set(c.id, c));
  const keys = (await req('images', 'readonly', (s) => s.getAllKeys())) || [];
  const blobs = (await req('images', 'readonly', (s) => s.getAll())) || [];
  imgURLs.forEach((u) => URL.revokeObjectURL(u));
  imgURLs.clear();
  keys.forEach((k, i) => imgURLs.set(k, URL.createObjectURL(blobs[i])));
}

/** Official list (data/xross-cards.json from tools/fetch-cards.mjs) if present, else the placeholder sample set. */
export async function loadBundled(which = 'auto') {
  if (which !== 'sample') {
    const r = await fetch('data/xross-cards.json').catch(() => null);
    if (r && r.ok) return r.json();
    if (which === 'official') throw new Error('data/xross-cards.json not found — run tools/fetch-cards.mjs');
  }
  return fetch('data/sample-cards.json').then((r) => r.json());
}
export const hasOfficialCards = () => [...Cards.values()].some((c) => !c.id.startsWith('SMP-'));

/** True for an alternate-art card whose name also exists as a regular print. */
let regularKeys = null, regularKeysSize = -1;
export function isRedundantParallel(c) {
  if (!c.parallel) return false;
  if (regularKeysSize !== Cards.size) {
    regularKeys = new Set([...Cards.values()].filter((o) => !o.parallel).map((o) => o.type + '|' + o.name));
    regularKeysSize = Cards.size;
  }
  return regularKeys.has(c.type + '|' + c.name);
}

export const getCard = (id) => Cards.get(id);
export const allCards = () => [...Cards.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

export async function upsertCards(arr) {
  // PP cards are table tokens, not deck cards, so they're skipped.
  const norm = arr.map(normalize).filter((c) => c.id && c.name && c.type !== 'pp');
  await req('cards', 'readwrite', (s) => { norm.forEach((c) => s.put(c)); });
  norm.forEach((c) => Cards.set(c.id, c));
  return norm.length;
}

export async function deleteCard(id) {
  await req('cards', 'readwrite', (s) => s.delete(id));
  Cards.delete(id);
}

export async function clearCards() {
  await req('cards', 'readwrite', (s) => s.clear());
  Cards.clear();
}

export async function clearImages() {
  await req('images', 'readwrite', (s) => s.clear());
  imgURLs.forEach((u) => URL.revokeObjectURL(u));
  imgURLs.clear();
}

// File "XS01-001.jpg" -> front of XS01-001. "XS01-001_back.png" / "XS01-001_b.png" -> awakened side.
export async function importImages(files) {
  const imgs = files.filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name));
  const entries = imgs.map((f) => {
    let key = f.name.replace(/\.[^.]+$/, '');
    const m = key.match(/^(.*?)[_-](back|b|awake|awakened)$/i);
    if (m) key = m[1] + '#back';
    return [key, f];
  });
  await req('images', 'readwrite', (s) => { entries.forEach(([k, f]) => s.put(f, k)); });
  entries.forEach(([k, f]) => {
    if (imgURLs.has(k)) URL.revokeObjectURL(imgURLs.get(k));
    imgURLs.set(k, URL.createObjectURL(f));
  });
  return entries.length;
}

// When served by tools/serve.py, official art goes through its disk cache (/img?u=…) so each image
// is downloaded from the official server once, ever.
let imgProxy = false;
export async function detectImageProxy() {
  try { imgProxy = (await fetch('api/ping', { cache: 'no-store' })).ok; } catch { imgProxy = false; }
  return imgProxy;
}
const viaCache = (url) => (imgProxy && /^https:\/\/assets\.xross-stars\.com\//.test(url) ? `img?u=${encodeURIComponent(url)}` : url);

export function imageFor(card, back = false) {
  if (!card) return '';
  if (back) return imgURLs.get(card.id + '#back') || viaCache(card.imageBack || '');
  return imgURLs.get(card.id) || viaCache(card.image || '');
}
export const imageCount = () => imgURLs.size;

// ---------- rendering ----------
// Images that already loaded once skip the fade-in, so re-renders never flicker.
const LOADED = (window.__xcLoaded = window.__xcLoaded || new Set());
const COLOR_HEX = {
  red: '#d9434b', blue: '#3a7bd5', green: '#3aa45b', yellow: '#e0b43a', purple: '#8e5bd1',
  white: '#c9ccd6', black: '#4a4a55', pink: '#e070a8', orange: '#e8853a', neutral: '#8b93a3',
};
export function colorHex(color) {
  const parts = String(color || '').toLowerCase().split(/[\/,& ]+/).filter(Boolean);
  const k = parts[0] || 'neutral';
  if (COLOR_HEX[k]) return COLOR_HEX[k];
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 50%)`;
}

export function statLine(c, awakened = false) {
  if (!c) return '';
  if (c.type === 'leader') return `ATK ${awakened ? c.atkAwake : c.atk} · HP ${awakened ? c.hpAwake : c.hp}`;
  if (c.type === 'attack') return c.damage ? `DMG +${c.damage}` : 'Attack';
  if (c.type === 'memoria') return c.boost ? `Boost +${c.boost}` : 'Memoria';
  if (c.type === 'tactics') return c.tacticsKind === 'equipment' ? 'Equipment' : 'Consumable';
  return '';
}

/**
 * Card markup. opts: back (face-down), awakened, cls, attrs (raw attribute string), badge (html overlay)
 */
export function cardHTML(card, opts = {}) {
  const cls = `card ${opts.cls || ''}`;
  const attrs = opts.attrs || '';
  if (opts.back || !card) {
    return `<div class="${cls} back" ${attrs}><div class="back-art"><span>✦</span><b>XROSS</b></div>${opts.badge || ''}</div>`;
  }
  const awakened = !!opts.awakened;
  const img = imageFor(card, awakened);
  const inner = img
    ? `<img src="${esc(img)}" alt="${esc(nameOf(card))}" draggable="false" loading="lazy" decoding="async" ${LOADED.has(img) ? 'class="ld"' : `onload="this.classList.add('ld');window.__xcLoaded.add(this.getAttribute('src'))"`}>`
    : `<div class="gen ${awakened ? 'awk' : ''}" style="--cc:${colorHex(card.color)}">
        <div class="g-top">${card.type === 'leader' ? '' : `<span class="g-cost">${card.cost}</span>`}<span class="g-type">${awakened ? 'AWAKENED' : esc(TYPE_LABEL[card.type])}</span>${card.ace ? '<span class="g-ace">ACE</span>' : ''}</div>
        <div class="g-name">${esc(nameOf(card))}</div>
        <div class="g-text">${esc(textOf(card, awakened))}</div>
        <div class="g-stats">${esc(statLine(card, awakened))}</div>
      </div>`;
  // the big preview card opens the full-art viewer on triple-click (js/artview.js)
  // data-cid: on touch screens a long-press on any face-up card opens its full art (js/touch.js)
  const art = /\bbig\b/.test(opts.cls || '') ? ` data-art="${esc(card.id)}" data-art-aw="${awakened ? 1 : 0}" title="Triple-click for full art"` : '';
  const hint = art ? '<div class="art-hint"><span class="no-touch">Triple-click the card for full art</span><span class="on-touch">Long-press any card for full art</span></div>' : '';
  return `<div class="${cls}" ${attrs} data-cid="${esc(card.id)}"${awakened ? ' data-caw="1"' : ''}${art}>${inner}${opts.badge || ''}</div>${hint}`;
}

export function cardDetailHTML(card, awakened = false) {
  if (!card) return '<div class="muted">Hover a card to preview it.</div>';
  const meta = [
    `<span class="tag ${colorCls(card.color)}">${esc(COLOR_LABEL()[card.color] || card.color)}</span>`,
    `<span class="tag">${esc(TYPE_LABEL[card.type])}</span>`,
    card.type !== 'leader' ? `<span class="tag hl-pp">Cost ${card.cost}</span>` : '',
    statLine(card, awakened) ? `<span class="tag">${esc(statLine(card, awakened))}</span>` : '',
    card.ace ? '<span class="tag ace">ACE</span>' : '',
    card.limit === 0 ? '<span class="tag banned">BANNED</span>' : card.limit < 4 ? `<span class="tag banned">Limited ${card.limit}</span>` : '',
  ].join('');
  const showJp = lang() !== 'ja' && nameOf(card) !== card.name;
  return `<div class="det-name">${nameHTML(card)}${awakened ? ' <span class="tag awk">Awakened</span>' : ''}</div>
    ${showJp ? `<div class="det-jp">${esc(card.name)}</div>` : ''}
    <div class="det-meta">${meta}</div>
    <div class="det-id muted">${esc(card.id)}${card.rarity ? ' · ' + esc(card.rarity) : ''}${card.parallel ? ' · alt art' : ''}${card.illustrator ? ' · illus. ' + esc(card.illustrator) : ''}</div>
    ${card.buildRule ? `<div class="det-rule">${buildRuleHTML(card.buildRule)}</div>` : ''}
    <div class="det-text">${textHTML(card, awakened) || '<span class="muted">No text.</span>'}</div>
    ${card.type === 'leader' && !awakened ? `<div class="det-text"><span class="kw kw-awaken">${lang() === 'ja' ? '覚醒後' : 'Awakened'}</span> <b class="hl-stat">ATK ${card.atkAwake} · HP ${card.hpAwake}</b></div>` : ''}`;
}

/** "リーダー：うるか (AN1)" / "赤のリーダー3体以上" -> readable, coloured English. */
export function buildRuleHTML(rule) {
  if (lang() === 'ja') return `構築条件：${esc(rule)}`;
  let m = rule.match(/^リーダー[：:]\s*(.+)$/);
  if (m) {
    const leader = [...Cards.values()].find((c) => c.type === 'leader' && c.name === m[1].trim());
    return `Deck rule: requires leader ${leader ? nameHTML(leader) : esc(translateName(m[1].trim(), 'leader'))}`;
  }
  m = rule.match(/^(.)のリーダー(\d+)体以上$/);
  const COL = { '赤': 'Red', '青': 'Blue', '緑': 'Green', '黄': 'Yellow' };
  if (m && COL[m[1]]) return `Deck rule: ${m[2]}+ <b class="${colorCls(COL[m[1]])}">${COL[m[1]]}</b> leaders`;
  return `Deck rule: ${esc(rule)}`;
}
