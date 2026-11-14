// Translation + color-coded rendering of card names and effect text.
// Data: data/i18n/glossary.json (every name/term, translated once) and data/i18n/effects.en.json
// (effect lines, which keep 【tag】 and 「name」 tokens so names always come from the glossary).
import { esc } from './util.js';

let G = { tags: {}, keywords: {}, groups: {}, colors: {}, talents: {}, cards: {}, variants: {} };
let FX = {};
let LANG = 'en';
let byJpName = null; // JP card name -> card (for colouring 「references」)
let cardsRef = null;

try { LANG = localStorage.getItem('xc.lang') || 'en'; } catch { /* storage blocked */ }

export async function initI18n(cardsMap) {
  cardsRef = cardsMap;
  const [g, fx] = await Promise.all([
    fetch('data/i18n/glossary.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('data/i18n/effects.en.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (g) G = { ...G, ...g };
  if (fx) FX = fx;
  byJpName = null;
  searchCache = new WeakMap();
}
export const lang = () => LANG;
export function setLang(l) {
  LANG = l;
  searchCache = new WeakMap();
  try { localStorage.setItem('xc.lang', l); } catch { /* ignore */ }
}

const COLOR_CLS = { red: 'c-red', blue: 'c-blue', green: 'c-green', yellow: 'c-yellow', purple: 'c-purple', neutral: 'c-neutral', colorless: 'c-neutral' };
export const colorCls = (color) => COLOR_CLS[String(color || '').toLowerCase().split(/[\/,]/)[0]] || 'c-neutral';

function jpIndex() {
  if (!byJpName && cardsRef) {
    byJpName = new Map();
    for (const c of cardsRef.values()) if (!byJpName.has(c.name) || !c.parallel) byJpName.set(c.name, c);
  }
  return byJpName || new Map();
}

// ---------- names ----------
function splitVariant(name) {
  const m = String(name).match(/^(.*?)\s*(\([^)]+\))$/);
  return m ? [m[1], m[2]] : [name, ''];
}
/** English (or original) name of a JP name string, using the glossary. */
export function translateName(jp, type) {
  if (LANG === 'ja' || !jp) return jp || '';
  if (type !== 'leader' && G.cards[jp]) return G.cards[jp];
  const [base, variant] = splitVariant(jp);
  if (G.talents[base]) return G.talents[base] + (variant ? ' ' + (G.variants[variant] || variant) : '');
  if (G.cards[jp]) return G.cards[jp];
  if (G.groups[jp]) return G.groups[jp];
  return jp;
}
export const nameOf = (card) => (card ? translateName(card.name, card.type) : '');
export const nameHTML = (card) => (card ? `<span class="nm ${colorCls(card.color)}">${esc(nameOf(card))}</span>` : '');
/** A deck rule in both languages: "リーダー：紡木こかげ" -> "leader kokage tsumugi", so a talent's
 *  support cards turn up when you search for the talent. */
function ruleSearchText(rule) {
  if (!rule) return '';
  const m = rule.match(/^リーダー[：:]\s*(.+)$/);
  if (m) { const jp = m[1].trim(); return `${rule} leader ${jp} ${translateName(jp, 'leader')} ${translateName(splitVariant(jp)[0], 'leader')}`; }
  const c = rule.match(/^(.)のリーダー(\d+)体以上$/);
  if (c && G.colors[c[1]]) return `${rule} ${c[2]}+ ${G.colors[c[1]]} leaders`;
  return rule;
}

/** Search box match. "ace" (or ★) means ACE cards — as plain text it would also hit "place", "space"… */
export function matchesQuery(card, q) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return true;
  if (q === 'ace' || q === '★') return !!card.ace;
  return searchText(card).includes(q);
}
/** Type filter value: a card type, or "ace" for ACE cards of any type. */
export const matchesType = (card, t) => !t || (t === 'ace' ? !!card.ace : card.type === t);

/** Both languages, for search: name, ID, effect text, and deck rule. Cached per card object —
 *  translating 750+ cards on every keystroke was slow. */
let searchCache = new WeakMap();
export function searchText(card) {
  let s = searchCache.get(card);
  if (s === undefined) {
    s = `${card.name} ${translateName(card.name, card.type)} ${card.id} ${card.text} ${textOf(card)} ${ruleSearchText(card.buildRule)}`.toLowerCase();
    searchCache.set(card, s);
  }
  return s;
}

// ---------- effect text ----------
function translateLine(line) {
  if (LANG === 'ja') return line;
  return FX[line.trim()] ?? line;
}
/** Plain translated text (tokens resolved, no HTML). */
export function textOf(card, awakened = false) {
  if (!card) return '';
  const raw = awakened && card.textAwake && !card.text.includes(card.textAwake) ? card.textAwake : card.text;
  return String(raw || '').split('\n').map(translateLine).join('\n')
    .replace(/【[^】]+】\s*/g, (t) => (LANG === 'ja' ? t : `[${G.tags[t.trim()]?.en || t.trim().slice(1, -1)}] `))
    .replace(/「([^」]+)」/g, (m, n) => (LANG === 'ja' ? m : `"${translateName(n)}"`));
}

// One pass over the text: tokens get coloured spans, everything else is escaped and number-highlighted.
const TOKEN = /【[^】]+】|「[^」]+」|(?:Overkill|オーバーキル)\s*\d+|\bEcho\b|エコー/g;

function highlightPlain(s) {
  let h = esc(s);
  if (LANG === 'ja') {
    return h
      .replace(/(ダメージ[+＋-]\d+|\d+ダメージ)/g, '<b class="hl-dmg">$1</b>')
      .replace(/(\d+回復)/g, '<b class="hl-heal">$1</b>')
      .replace(/(PPを\d+)/g, '<b class="hl-pp">$1</b>')
      .replace(/(カードを\d+枚引)/g, '<b class="hl-draw">$1</b>')
      .replace(/(攻撃力[+＋]\d+|体力[+＋]\d+)/g, '<b class="hl-stat">$1</b>')
      .replace(/(赤|青|緑|黄)(?=の|なら)/g, (m) => `<b class="${colorCls(G.colors[m])}">${m}</b>`);
  }
  return h
    .replace(/([+-]\d+ damage|\b\d+ damage)/g, '<b class="hl-dmg">$1</b>')
    .replace(/\b(heal (?:1 of your leaders |your leaders )?(?:by )?(?:a total of )?\d+)/gi, '<b class="hl-heal">$1</b>')
    .replace(/\b(restore \d+ PP)/gi, '<b class="hl-pp">$1</b>')
    .replace(/\b(draw (?:\d+ cards?|cards equal))/gi, '<b class="hl-draw">$1</b>')
    .replace(/([+-]\d+ (?:ATK|HP))/g, '<b class="hl-stat">$1</b>')
    .replace(/\b(Red|Blue|Green|Yellow)\b/g, (m) => `<b class="${colorCls(m)}">${m}</b>`);
}

export function decorate(text) {
  let out = '', last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += highlightPlain(text.slice(last, m.index));
    last = m.index + m[0].length;
    const t = m[0];
    if (t.startsWith('【')) {
      const tag = G.tags[t];
      out += `<span class="kw kw-${tag?.cls || 'misc'}">${esc(LANG === 'ja' ? t.slice(1, -1) : tag?.en || t.slice(1, -1))}</span>`;
    } else if (t.startsWith('「')) {
      const n = t.slice(1, -1);
      if (G.groups[n]) out += `<span class="grp">${esc(G.groups[n])}</span>`;
      else {
        const ref = jpIndex().get(n);
        const label = translateName(n, ref?.type);
        out += `<span class="ref ${colorCls(ref?.color)}">${LANG === 'ja' ? '「' + esc(label) + '」' : '“' + esc(label) + '”'}</span>`;
      }
    } else if (/^(Overkill|オーバーキル)/.test(t)) {
      out += `<span class="kw kw-overkill">${esc(LANG === 'ja' ? t : t.replace('オーバーキル', 'Overkill'))}</span>`;
    } else {
      out += `<span class="kw kw-echo">${esc(LANG === 'ja' ? 'エコー' : G.keywords['エコー'] || 'Echo')}</span>`;
    }
  }
  out += highlightPlain(text.slice(last));
  return out.replace(/\n/g, '<br>');
}

export function textHTML(card, awakened = false) {
  if (!card) return '';
  const raw = awakened && card.textAwake && !card.text.includes(card.textAwake) ? card.textAwake : card.text;
  return decorate(String(raw || '').split('\n').map(translateLine).join('\n'));
}

// ---------- log messages ----------
// game.js writes card names as ⟦cardId⟧ so the log re-renders in the current language, coloured.
export function logHTML(msg, getCard) {
  return String(msg).split(/(⟦[^⟧]+⟧)/).map((part) => {
    const m = part.match(/^⟦([^⟧]+)⟧$/);
    if (!m) return esc(part);
    const c = getCard(m[1]);
    return c ? nameHTML(c) : esc(m[1]);
  }).join('');
}
export function logText(msg, getCard) {
  return String(msg).replace(/⟦([^⟧]+)⟧/g, (_, id) => nameOf(getCard(id)) || id);
}

export const COLOR_LABEL = () => (LANG === 'ja' ? { Red: '赤', Blue: '青', Green: '緑', Yellow: '黄', Neutral: '無' } : { Red: 'Red', Blue: 'Blue', Green: 'Green', Yellow: 'Yellow', Neutral: 'Colorless' });
