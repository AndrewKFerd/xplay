// Deck storage + Xross Stars deck-building validation.
import { getCard, Cards, buildRuleHTML } from './db.js';
import { uid } from './util.js';
import { nameOf, translateName } from './i18n.js';

const ruleText = (r) => { const t = document.createElement('div'); t.innerHTML = buildRuleHTML(r); return t.textContent.replace(/^Deck rule: /, ''); };

const KEY = 'xc.decks';

export const RULES = { leaders: 4, main: 50, tactics: 5, maxCopies: 4, maxAce: 8, neutral: ['neutral', 'colorless'] };

export function loadDecks() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function storeDecks(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

export function newDeck(name = 'New Deck') {
  return { id: uid(), name, leaders: [], main: {}, tactics: [], updated: Date.now() };
}

export function saveDeck(deck) {
  const all = loadDecks();
  deck.updated = Date.now();
  const i = all.findIndex((d) => d.id === deck.id);
  if (i >= 0) all[i] = deck; else all.push(deck);
  storeDecks(all);
}
export function deleteDeck(id) { storeDecks(loadDecks().filter((d) => d.id !== id)); }
export const getDeck = (id) => loadDecks().find((d) => d.id === id);

export const mainCount = (deck) => Object.values(deck.main).reduce((a, b) => a + b, 0);

const colorsOf = (c) => String(c?.color || '').toLowerCase().split(/[\/,&]+/).map((s) => s.trim()).filter(Boolean);

const JP_COLOR = { '赤': 'red', '青': 'blue', '緑': 'green', '黄': 'yellow', '紫': 'purple' };
/** true = met, false = not met, null = rule text not understood (shown as a warning). */
export function checkBuildRule(rule, leaders) {
  let m = rule.match(/^リーダー[：:]\s*(.+)$/);
  if (m) return leaders.some((l) => l.name === m[1].trim());
  m = rule.match(/^(.)のリーダー(\d+)体以上$/);
  if (m && JP_COLOR[m[1]]) return leaders.filter((l) => colorsOf(l).includes(JP_COLOR[m[1]])).length >= +m[2];
  return null;
}

export function validate(deck) {
  const errors = [], warnings = [];
  const leaders = deck.leaders.map(getCard);
  const tactics = deck.tactics.map(getCard);
  const missing = [...deck.leaders, ...deck.tactics, ...Object.keys(deck.main)].filter((id) => !Cards.has(id));
  if (missing.length) errors.push(`${missing.length} card(s) not in database: ${[...new Set(missing)].slice(0, 5).join(', ')}`);

  if (deck.leaders.length !== RULES.leaders) errors.push(`Leaders: ${deck.leaders.length}/${RULES.leaders}`);
  const lNames = leaders.filter(Boolean).map((c) => c.name);
  if (new Set(lNames).size !== lNames.length) errors.push('Leaders must all have different names');

  const n = mainCount(deck);
  if (n !== RULES.main) errors.push(`Main deck: ${n}/${RULES.main}`);

  const leaderColors = new Set(leaders.filter(Boolean).flatMap(colorsOf));
  const byName = {};
  let ace = 0;
  for (const [id, cnt] of Object.entries(deck.main)) {
    const c = getCard(id);
    if (!c) continue;
    byName[c.name] = (byName[c.name] || 0) + cnt;
    if (c.ace) ace += cnt;
    const cc = colorsOf(c);
    const neutral = cc.some((x) => RULES.neutral.includes(x));
    if (!neutral && leaderColors.size && !cc.some((x) => leaderColors.has(x)))
      errors.push(`${nameOf(c)}: color ${c.color} doesn't match any leader`);
    if (c.limit === 0) errors.push(`${nameOf(c)} is banned`);
    if (c.buildRule) {
      const ok = checkBuildRule(c.buildRule, leaders.filter(Boolean));
      if (ok === false) errors.push(`${nameOf(c)}: build rule not met (${ruleText(c.buildRule)})`);
      else if (ok == null) warnings.push(`${nameOf(c)} build rule: ${c.buildRule}`);
    }
  }
  for (const [name, cnt] of Object.entries(byName)) {
    const lim = Math.min(RULES.maxCopies, ...[...Cards.values()].filter((c) => c.name === name).map((c) => c.limit));
    if (cnt > lim) errors.push(`${translateName(name)}: ${cnt} copies (max ${lim})`);
  }
  if (ace > RULES.maxAce) errors.push(`ACE cards: ${ace}/${RULES.maxAce}`);

  if (deck.tactics.length !== RULES.tactics) errors.push(`Tactics: ${deck.tactics.length}/${RULES.tactics}`);
  const tNames = tactics.filter(Boolean).map((c) => c.name);
  if (new Set(tNames).size !== tNames.length) errors.push('Tactics must all have different names');

  return { ok: errors.length === 0, errors, warnings, ace, main: n };
}

// Plain-text list like "4x XS01-010 Name"
export function deckToText(deck) {
  const line = (id, n) => `${n}x ${id} ${getCard(id)?.name || ''}`.trim();
  return [
    `# ${deck.name}`,
    '## Leaders', ...deck.leaders.map((id) => line(id, 1)),
    '## Main', ...Object.entries(deck.main).map(([id, n]) => line(id, n)),
    '## Tactics', ...deck.tactics.map((id) => line(id, 1)),
  ].join('\n');
}

export function deckFromText(text) {
  const deck = newDeck();
  let sec = 'main';
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('# ')) { deck.name = l.slice(2).trim(); continue; }
    const h = l.match(/^#+\s*(leader|main|tactic)/i);
    if (h) { sec = h[1].toLowerCase().startsWith('leader') ? 'leaders' : h[1].toLowerCase().startsWith('tactic') ? 'tactics' : 'main'; continue; }
    const m = l.match(/^(\d+)\s*x?\s+(\S+)/i);
    if (!m) continue;
    let [, n, id] = m;
    n = +n;
    // allow lookup by name if id unknown
    if (!Cards.has(id)) {
      const nm = l.replace(/^\d+\s*x?\s+/i, '').trim();
      const found = [...Cards.values()].find((c) => c.name.toLowerCase() === nm.toLowerCase());
      if (found) id = found.id;
    }
    if (sec === 'main') deck.main[id] = (deck.main[id] || 0) + n;
    else for (let i = 0; i < n; i++) deck[sec].push(id);
  }
  return deck;
}
