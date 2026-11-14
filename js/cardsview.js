// Card database screen: browse, import JSON/CSV, import images, edit cards.
import { $, esc, download, pickFile, toast, confirmBox, modal, closeModal, parseCSV, PAGE_SIZE, pageCount, pagerHTML, debounce } from './util.js';
import { typeOptions, allCards, getCard, cardHTML, cardDetailHTML, upsertCards, deleteCard, clearCards, clearImages, importImages, imageCount, TYPE_LABEL, normalize, loadBundled } from './db.js';
import { searchText, nameOf, matchesType } from './i18n.js';

const FIELDS = ['id', 'name', 'type', 'color', 'cost', 'damage', 'boost', 'atk', 'hp', 'atkAwake', 'hpAwake', 'text', 'textAwake', 'tacticsKind', 'ace', 'limit', 'buildRule', 'set', 'rarity', 'image', 'imageBack'];

export function renderCards(root) {
  let q = '';
  root.innerHTML = `
  <div class="cardsview">
    <section>
      <div class="row wrap">
        <input class="inp grow" id="cq" placeholder="Search…">
        <select class="inp" id="ctype">${typeOptions('')}</select>
        <button class="btn primary" id="cimp">Import cards (.json / .csv)</button>
        <button class="btn" id="cimg">Import image folder</button>
        <button class="btn" id="cadd">New card</button>
        <button class="btn" id="cexp">Export database</button>
        <button class="btn" id="ctpl">CSV template</button>
        <button class="btn danger" id="creset">Reset…</button>
      </div>
      <div class="row wrap pool-head"><span class="muted small grow" id="cstat"></span><div id="cpager"></div></div>
      <div class="b-grid" id="cgrid"></div>
      <div id="cpager2" class="pool-foot"></div>
    </section>
    <aside class="b-preview"><div id="cprev" class="det"><div class="muted"><span class="no-touch">Hover a card to preview. Click to edit.</span><span class="on-touch">Tap a card to edit · long-press for full art</span></div></div></aside>
  </div>`;
  let page = 1, list = [], type = '';
  // Filter once per search; only the current page of PAGE_SIZE cards is rendered.
  const draw = (keepPage = true) => {
    const ql = q.toLowerCase().trim();
    list = allCards().filter((c) => matchesType(c, type) && (!ql || (ql === 'ace' || ql === '★' ? c.ace
      : (searchText(c) + ' ' + c.color.toLowerCase() + ' ' + c.set.toLowerCase()).includes(ql))));
    page = keepPage ? Math.min(page, pageCount(list.length)) : 1;
    drawPage();
  };
  const drawPage = () => {
    $('#cstat').textContent = `${allCards().length} cards in database · ${imageCount()} images imported · ${list.length} match`;
    const grid = $('#cgrid');
    grid.innerHTML = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => cardHTML(c, { cls: 'pool', attrs: `data-id="${esc(c.id)}"` })).join('')
      || '<div class="muted">No cards match.</div>';
    grid.scrollTop = 0;
    const bar = pagerHTML(page, list.length);
    $('#cpager').innerHTML = bar;
    $('#cpager2').innerHTML = list.length > PAGE_SIZE ? bar : '';
  };
  const goPage = (p) => { if (p >= 1 && p <= pageCount(list.length) && p !== page) { page = p; drawPage(); } };
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) goPage(+b.dataset.page); });
  const onKey = (e) => {
    if (!document.body.contains(root)) return document.removeEventListener('keydown', onKey);
    if (e.target.matches?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal')) return;
    if (e.key === 'ArrowRight') goPage(page + 1);
    if (e.key === 'ArrowLeft') goPage(page - 1);
  };
  document.addEventListener('keydown', onKey);
  const search = debounce(() => draw(false));
  $('#cq').oninput = (e) => { q = e.target.value; search(); };
  $('#ctype').onchange = (e) => { type = e.target.value; draw(false); };
  let previewId = null;
  $('#cgrid').addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-id]');
    if (!el || el.dataset.id === previewId) return;
    previewId = el.dataset.id;
    const c = getCard(previewId);
    $('#cprev').innerHTML = cardHTML(c, { cls: 'big' }) + cardDetailHTML(c);
  });
  $('#cgrid').addEventListener('click', (e) => { const el = e.target.closest('[data-id]'); if (el) editCard(getCard(el.dataset.id), draw); });
  $('#cadd').onclick = () => editCard(null, draw);
  $('#cimp').onclick = async () => {
    const files = await pickFile('.json,.csv', { multiple: true });
    let n = 0;
    for (const f of files) {
      try {
        const text = await f.text();
        const rows = f.name.toLowerCase().endsWith('.csv') ? parseCSV(text) : JSON.parse(text);
        n += await upsertCards(Array.isArray(rows) ? rows : rows.cards || []);
      } catch (err) { toast(`${f.name}: ${err.message}`, 4000); }
    }
    if (files.length) { toast(`Imported ${n} cards`); draw(); }
  };
  $('#cimg').onclick = async () => {
    const files = await pickFile('image/*', { multiple: true, directory: true });
    if (!files.length) return;
    toast('Importing images…');
    const n = await importImages(files);
    toast(`Imported ${n} images`); draw();
  };
  $('#cexp').onclick = () => download('xross-cards.json', JSON.stringify(allCards(), null, 1));
  $('#ctpl').onclick = () => download('xross-cards-template.csv',
    FIELDS.join(',') + '\nXS01-001,Example Leader,leader,Red,0,0,0,1,7,2,9,"[On attack] ...","[On awaken] ...",,false,4,,XS01,R,,\n', 'text/csv');
  $('#creset').onclick = () => {
    const m = modal(`<h3>Reset database</h3>
      <div class="col"><button class="btn primary" data-r="official">Delete all cards &amp; load the official card list</button>
      <button class="btn" data-r="sample">Delete all cards &amp; load the placeholder sample set</button>
      <button class="btn" data-r="empty">Delete all cards (empty database)</button>
      <button class="btn" data-r="img">Delete all imported images</button>
      <button class="btn" data-r="x">Cancel</button></div>`);
    m.el.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (!r) return;
      closeModal(m);
      if (r === 'official' || r === 'sample') {
        let list;
        try { list = await loadBundled(r); } catch (err) { return toast(err.message, 5000); }
        await clearCards(); await upsertCards(list);
      }
      if (r === 'empty') await clearCards();
      if (r === 'img') await clearImages();
      if (r !== 'x') { toast('Done'); draw(); }
    });
  };
  draw();
}

function editCard(card, after) {
  const c = card ? { ...card } : normalize({ id: '', name: '' });
  const f = (k, label, type = 'text') => `<label>${label}<input class="inp" name="${k}" type="${type}" value="${esc(c[k])}"></label>`;
  const m = modal(`<form class="cform"><h3>${card ? 'Edit card' : 'New card'}</h3>
    <div class="grid2">
      ${f('id', 'Card ID (also image file name)')}${f('name', 'Name')}
      <label>Type<select class="inp" name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${f('color', 'Color (e.g. Red, or Red/Blue)')}
      ${f('cost', 'Cost (PP)', 'number')}${f('damage', 'Damage (attack cards)', 'number')}
      ${f('boost', 'Attack boost (memoria)', 'number')}${f('limit', 'Max copies (4 normal, 2 limited, 0 banned)', 'number')}
      ${f('atk', 'Leader ATK', 'number')}${f('hp', 'Leader HP', 'number')}
      ${f('atkAwake', 'Awakened ATK', 'number')}${f('hpAwake', 'Awakened HP', 'number')}
      <label>Tactics kind<select class="inp" name="tacticsKind"><option ${c.tacticsKind === 'consumable' ? 'selected' : ''}>consumable</option><option ${c.tacticsKind === 'equipment' ? 'selected' : ''}>equipment</option></select></label>
      <label class="chk"><input type="checkbox" name="ace" ${c.ace ? 'checked' : ''}> ACE card</label>
      ${f('set', 'Set')}${f('rarity', 'Rarity')}
      ${f('image', 'Image URL / path (optional)')}${f('imageBack', 'Awakened image URL (optional)')}
    </div>
    <label>Text<textarea class="inp" name="text" rows="4">${esc(c.text)}</textarea></label>
    <label>Awakened text<textarea class="inp" name="textAwake" rows="3">${esc(c.textAwake)}</textarea></label>
    ${f('buildRule', 'Build rule (shown as a warning)')}
    <div class="row end">${card ? '<button type="button" class="btn danger" data-x="del">Delete</button>' : ''}<span class="grow"></span>
      <button type="button" class="btn" data-x="cancel">Cancel</button><button class="btn primary">Save</button></div>
  </form>`, { wide: true });
  const form = m.el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.ace = form.ace.checked;
    if (!data.id || !data.name) return toast('ID and name are required');
    if (card && card.id !== data.id) await deleteCard(card.id);
    await upsertCards([data]);
    closeModal(m); after();
  };
  m.el.querySelector('[data-x="cancel"]').onclick = () => closeModal(m);
  const del = m.el.querySelector('[data-x="del"]');
  if (del) del.onclick = async () => { if (await confirmBox(`Delete ${esc(nameOf(card))}?`, { ok: 'Delete' })) { await deleteCard(card.id); closeModal(m); after(); } };
}
