// Converts an official deck (api.xross-stars.com/v1/decks/{code}) into an XPLAY deck.
// No imports, so tools/fetch-decks.mjs can use it from Node too.

/** Accepts a bare code or a xross-stars.com/deck/... URL. Returns the code or null. */
export function parseDeckCode(input) {
  const s = String(input || '').trim();
  const m = s.match(/xross-stars\.com\/deck\/([A-Za-z0-9-]+)/) || s.match(/^([A-Za-z0-9-]{4,64})$/);
  return m ? m[1] : null;
}

/**
 * @param json   API response: { id, leader: Card[4], deck: Card[50], tactics: Card[5] }
 * @param cards  iterable of XPLAY cards (must carry officialId)
 * @returns { deck, missing } where missing lists official cards not found locally
 */
export function convertOfficialDeck(json, cards, name) {
  const byOfficial = new Map();
  for (const c of cards) if (c.officialId != null) byOfficial.set(Number(c.officialId), c.id);
  const missing = [];
  const idOf = (oc) => {
    const id = byOfficial.get(Number(oc.id));
    if (!id) missing.push(`${oc.display_card_number || oc.card_number} ${oc.name}`);
    return id;
  };
  const leaders = (json.leader || []).map(idOf).filter(Boolean);
  const tactics = (json.tactics || []).map(idOf).filter(Boolean);
  const main = {};
  for (const oc of json.deck || []) {
    const id = idOf(oc);
    if (id) main[id] = (main[id] || 0) + 1;
  }
  const leaderNames = (json.leader || []).map((l) => l.name).join(' / ');
  return {
    deck: {
      id: 'xs-' + json.id, name: name || leaderNames || 'Imported deck', leaders, main, tactics,
      source: `https://xross-stars.com/deck/${json.id}`, updated: Date.now(),
    },
    missing,
  };
}
