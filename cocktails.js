// Cocktails & Mischgetränke: Übersicht, Rezeptseite, druckbare Getränkekarte,
// Übernahme in die Getränkevergabe. Rechte: „cocktails“ (ansehen), „cocktails_bearbeiten“.
//
// cocktail {name, alcoholic, price, glass, colors [oben, unten], garnish,
//           ingredients [{amount, item}], steps (eine Zeile = ein Schritt), note, photo (Data-URL), order}

const CT_GLASSES = { highball: 'Longdrinkglas', hurricane: 'Hurricane-Glas', cocktail: 'Cocktailschale', tumbler: 'Tumbler' };
const CT_GARNISH = { lime: 'Limette', orange: 'Orange', pineapple: 'Ananas', mint: 'Minze', cherry: 'Kirsche', none: 'keine' };
const ctState = { filter: 'all', query: '' };
const canEditCt = () => Auth.can('cocktails_bearbeiten');

// 6 bekannte Testcocktails (feste IDs, damit mehrere Geräte keine Doppel anlegen)
const CT_SAMPLES = [
  { id: 'ct-mojito', name: 'Mojito', alcoholic: true, price: 5, glass: 'highball', colors: ['#eaf7e3', '#bfe3a8'], garnish: 'mint',
    ingredients: [['4 cl', 'weißer Rum'], ['½', 'Limette (geviertelt)'], ['2 TL', 'brauner Rohrzucker'], ['8–10', 'Minzblätter'], ['', 'Sodawasser zum Auffüllen'], ['', 'Crushed Ice']],
    steps: 'Limettenviertel mit dem Zucker im Glas andrücken.\nMinzblätter dazugeben und nur leicht andrücken.\nGlas mit Crushed Ice füllen und den Rum darübergießen.\nMit Sodawasser auffüllen und kurz umrühren.\nMit einem Minzzweig garnieren.' },
  { id: 'ct-pina-colada', name: 'Piña Colada', alcoholic: true, price: 5.5, glass: 'hurricane', colors: ['#fff8e6', '#f6e3b0'], garnish: 'pineapple',
    ingredients: [['4 cl', 'weißer Rum'], ['8 cl', 'Ananassaft'], ['4 cl', 'Kokoscreme (Cream of Coconut)'], ['2 cl', 'Sahne'], ['', 'Eiswürfel']],
    steps: 'Alle Zutaten mit Eis in einen Shaker geben.\nKräftig etwa 15 Sekunden schütteln.\nAuf frisches Eis ins Glas abseihen.\nMit einem Ananasstück garnieren.' },
  { id: 'ct-tequila-sunrise', name: 'Tequila Sunrise', alcoholic: true, price: 5, glass: 'highball', colors: ['#ffb547', '#e2403a'], garnish: 'orange',
    ingredients: [['4 cl', 'Tequila'], ['12 cl', 'Orangensaft'], ['2 cl', 'Grenadinesirup'], ['', 'Eiswürfel']],
    steps: 'Glas mit Eiswürfeln füllen.\nTequila und Orangensaft hineingeben und umrühren.\nGrenadine langsam am Glasrand einlaufen lassen – sie sinkt nach unten und ergibt den „Sonnenaufgang“.\nMit einer Orangenscheibe garnieren.' },
  { id: 'ct-ipanema', name: 'Ipanema', alcoholic: false, price: 3.5, glass: 'tumbler', colors: ['#f7f3d0', '#d9d98a'], garnish: 'lime',
    ingredients: [['½', 'Limette (geviertelt)'], ['2 TL', 'brauner Rohrzucker'], ['4 cl', 'Maracujasaft'], ['', 'Ginger Ale zum Auffüllen'], ['', 'Crushed Ice']],
    steps: 'Limettenviertel mit dem Zucker im Glas andrücken.\nGlas mit Crushed Ice füllen.\nMaracujasaft dazugeben.\nMit Ginger Ale auffüllen und umrühren.' },
  { id: 'ct-virgin-colada', name: 'Virgin Colada', alcoholic: false, price: 3.5, glass: 'hurricane', colors: ['#fffdf3', '#f3e6bd'], garnish: 'cherry',
    ingredients: [['12 cl', 'Ananassaft'], ['4 cl', 'Kokoscreme (Cream of Coconut)'], ['2 cl', 'Sahne'], ['', 'Eiswürfel']],
    steps: 'Alle Zutaten mit Eis in einen Shaker geben.\nKräftig schütteln.\nAuf frisches Eis ins Glas abseihen.\nMit einer Cocktailkirsche garnieren.' },
  { id: 'ct-florida', name: 'Florida', alcoholic: false, price: 3, glass: 'highball', colors: ['#ffd27a', '#ff9e4a'], garnish: 'orange',
    ingredients: [['6 cl', 'Orangensaft'], ['4 cl', 'Grapefruitsaft'], ['2 cl', 'Zitronensaft'], ['1 cl', 'Zuckersirup'], ['', 'Sodawasser zum Auffüllen'], ['', 'Eiswürfel']],
    steps: 'Säfte und Zuckersirup mit Eis im Shaker kurz schütteln.\nIn ein Glas mit Eis abseihen.\nMit Sodawasser auffüllen.\nMit einer Orangenscheibe garnieren.' },
];

async function loadCocktails() {
  let list = await DB.all('cocktail');
  if (!list.length && canEditCt() && !(await DB.all('cocktail', { includeDeleted: true })).length) {
    for (const [i, s] of CT_SAMPLES.entries()) {
      await DB.save('cocktail', { ...s, ingredients: s.ingredients.map(([amount, item]) => ({ amount, item })), note: '', photo: '', order: i });
    }
    list = await DB.all('cocktail');
  }
  return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'de'));
}

// ---------- Illustration (eigenes SVG, keine fremden Bilder) ----------
function cocktailSvg(c) {
  const [top, bottom] = c.colors && c.colors.length === 2 ? c.colors : ['#ffd27a', '#ff9e4a'];
  const id = 'ct' + Math.random().toString(36).slice(2, 9);
  const shapes = {
    highball: { glass: 'M60 38 L140 38 L133 178 L67 178 Z', liquid: 'M63 66 L137 66 L131 174 L69 174 Z', ice: [[72, 80], [100, 94], [80, 116]], straw: true },
    tumbler: { glass: 'M54 82 L146 82 L140 176 L60 176 Z', liquid: 'M57 100 L143 100 L138 172 L62 172 Z', ice: [[68, 108], [100, 116]], straw: true },
    hurricane: { glass: 'M64 34 C50 70 72 96 84 118 C92 134 84 150 90 160 L110 160 C116 150 108 134 116 118 C128 96 150 70 136 34 Z',
      liquid: 'M64 58 C58 82 76 102 86 118 C93 132 87 148 92 156 L108 156 C113 148 107 132 114 118 C124 102 142 82 136 58 Z', base: true, straw: true },
    cocktail: { glass: 'M36 46 L164 46 L106 112 L106 160 L94 160 L94 112 Z', liquid: 'M50 58 L150 58 L100 106 Z', base: true },
  };
  const s = shapes[c.glass] || shapes.highball;
  const garnish = {
    lime: '<circle cx="138" cy="40" r="16" fill="#9ccc4a" stroke="#6f9a2a" stroke-width="3"/><path d="M138 26 V54 M124 40 H152 M128 30 L148 50 M148 30 L128 50" stroke="#e8f5c8" stroke-width="2"/>',
    orange: '<circle cx="138" cy="40" r="16" fill="#ffb13b" stroke="#e8871e" stroke-width="3"/><path d="M138 26 V54 M124 40 H152 M128 30 L148 50 M148 30 L128 50" stroke="#ffe0a3" stroke-width="2"/>',
    pineapple: '<path d="M124 46 L154 46 L139 24 Z" fill="#ffd54f" stroke="#e0a800" stroke-width="2"/><path d="M134 24 L130 10 M139 24 L139 8 M144 24 L148 10" stroke="#5c9e3a" stroke-width="4" stroke-linecap="round"/>',
    mint: '<ellipse cx="128" cy="30" rx="9" ry="15" transform="rotate(-25 128 30)" fill="#5cb85c"/><ellipse cx="146" cy="30" rx="9" ry="15" transform="rotate(25 146 30)" fill="#4cae4c"/><path d="M137 46 V22" stroke="#3d8b3d" stroke-width="3"/>',
    cherry: '<path d="M140 40 C142 26 150 18 158 14" stroke="#6b3e26" stroke-width="3" fill="none"/><circle cx="138" cy="44" r="10" fill="#d32f2f"/><circle cx="135" cy="41" r="3" fill="#ff8a80"/>',
    none: '',
  }[c.garnish || 'none'] || '';
  return `<svg viewBox="0 0 200 200" class="ct-svg" role="img" aria-label="${esc(c.name)}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
    <circle cx="100" cy="104" r="92" fill="${bottom}" opacity=".18"/>
    ${s.straw ? '<path d="M112 176 L128 12" stroke="#e8505b" stroke-width="6" stroke-linecap="round"/>' : ''}
    <path d="${s.liquid}" fill="url(#${id})"/>
    ${(s.ice || []).map(([x, y]) => `<rect x="${x}" y="${y}" width="22" height="20" rx="5" fill="#fff" opacity=".45" transform="rotate(12 ${x + 11} ${y + 10})"/>`).join('')}
    <path d="${s.glass}" fill="#ffffff" fill-opacity=".18" stroke="#9fb3c4" stroke-width="3" stroke-linejoin="round"/>
    ${s.base ? '<ellipse cx="100" cy="164" rx="36" ry="7" fill="#ffffff" fill-opacity=".3" stroke="#9fb3c4" stroke-width="3"/>' : ''}
    ${garnish}
  </svg>`;
}

const ctImage = c => c.photo ? `<img src="${c.photo}" alt="${esc(c.name)}" class="ct-photo">` : cocktailSvg(c);
const ctBadge = c => c.alcoholic ? '<span class="tag warn">mit Alkohol · ab 18</span>' : '<span class="tag ok">alkoholfrei</span>';

// ---------- Übersicht ----------
async function renderCocktails() {
  setTitle('Cocktails', '#/');
  const list = await loadCocktails();
  const edit = canEditCt();
  view.innerHTML = `
    <div class="card">
      <div class="action-row">
        ${edit ? '<button class="btn primary" id="ctNew">＋ Cocktail</button>' : ''}
        <button class="btn" id="ctMenu">🖨 Getränkekarte</button>
        ${Auth.can('einrichtung') ? '<button class="btn" id="ctToDrinks">🥤 In Getränkevergabe übernehmen</button>' : ''}
      </div>
      <input type="search" id="ctSearch" placeholder="🔍 Cocktail oder Zutat suchen …" autocomplete="off" value="${esc(ctState.query)}" style="margin-top:12px">
      <div class="chips" id="ctFilter">
        ${[['all', 'Alle'], ['free', 'Alkoholfrei'], ['alc', 'Mit Alkohol']].map(([k, l]) =>
          `<button class="chip ${ctState.filter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="ct-grid" id="ctGrid"></div>
    ${canEditCt() || Auth.can('einrichtung') ? '<p class="ct-footer-link"><a href="#/einkauf">🛒 Einkaufsliste für die Party berechnen</a></p>' : ''}`;

  const draw = () => {
    const q = norm(ctState.query);
    const shown = list.filter(c => (ctState.filter === 'all' || (ctState.filter === 'alc') === !!c.alcoholic)
      && (!q || norm(c.name + ' ' + (c.ingredients || []).map(i => i.item).join(' ')).includes(q)));
    document.getElementById('ctGrid').innerHTML = shown.length ? shown.map(c => `
      <button class="ct-card" data-id="${c.id}">
        <span class="ct-thumb">${ctImage(c)}</span>
        <strong>${esc(c.name)}</strong>
        <span class="ct-meta">${ctBadge(c)}${c.price ? `<span class="ct-price">${euro(c.price)}</span>` : ''}</span>
      </button>`).join('') : `<p class="muted">${list.length ? 'Kein Cocktail gefunden.' : 'Noch keine Cocktails angelegt.'}</p>`;
    document.querySelectorAll('.ct-card').forEach(b => b.addEventListener('click', () => { location.hash = '#/cocktails/' + b.dataset.id; }));
  };
  draw();
  document.getElementById('ctSearch').addEventListener('input', ev => { ctState.query = ev.target.value; draw(); });
  document.getElementById('ctFilter').addEventListener('click', ev => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    ctState.filter = chip.dataset.f;
    document.querySelectorAll('#ctFilter .chip').forEach(c => c.classList.toggle('active', c === chip));
    draw();
  });
  document.getElementById('ctNew')?.addEventListener('click', () => openCocktailForm(null));
  document.getElementById('ctMenu').addEventListener('click', () => openCocktailMenu(list));
  document.getElementById('ctToDrinks')?.addEventListener('click', () => openCocktailsToDrinks(list, null));
}

// ---------- Rezeptseite ----------
async function renderCocktailDetail(id) {
  setTitle('Cocktails', '#/cocktails');
  const list = await loadCocktails();
  const c = list.find(x => x.id === id);
  if (!c) {
    view.innerHTML = '<div class="card"><p>Dieser Cocktail existiert nicht mehr.</p><a class="btn" href="#/cocktails">Zur Übersicht</a></div>';
    return;
  }
  const steps = String(c.steps || '').split('\n').map(s => s.trim()).filter(Boolean);
  view.innerHTML = `
    <a class="btn small" href="#/cocktails" style="margin-bottom:12px">← Alle Cocktails</a>
    <div class="card ct-detail">
      <div class="ct-hero">
        <div class="ct-hero-img">${ctImage(c)}</div>
        <div class="ct-hero-text">
          <h2>${esc(c.name)}</h2>
          <div class="ct-meta">${ctBadge(c)}<span class="tag">${CT_GLASSES[c.glass] || 'Glas'}</span></div>
          ${c.price ? `<p class="ct-hero-price">${euro(c.price)}</p>` : ''}
          ${c.note ? `<p class="muted">${esc(c.note)}</p>` : ''}
        </div>
      </div>
      <div class="ct-recipe">
        <div>
          <h3 class="sub-title">Zutaten</h3>
          <ul class="list ct-ingredients">${(c.ingredients || []).map(i => `
            <li><span class="ct-amount">${esc(i.amount || '')}</span><span class="grow">${esc(i.item)}</span></li>`).join('')}</ul>
        </div>
        <div>
          <h3 class="sub-title">Zubereitung</h3>
          <ol class="ct-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
          ${c.garnish && c.garnish !== 'none' ? `<p class="muted">Deko: ${CT_GARNISH[c.garnish]}</p>` : ''}
        </div>
      </div>
      <div class="action-row" style="margin-top:16px">
        ${canEditCt() ? '<button class="btn primary" id="ctEdit">✎ Bearbeiten</button>' : ''}
        ${Auth.can('einrichtung') ? '<button class="btn" id="ctOne">🥤 In Getränkevergabe übernehmen</button>' : ''}
        ${canEditCt() ? '<span class="grow"></span><button class="btn danger" id="ctDel">Löschen</button>' : ''}
      </div>
    </div>`;
  document.getElementById('ctEdit')?.addEventListener('click', () => openCocktailForm(c));
  document.getElementById('ctOne')?.addEventListener('click', () => openCocktailsToDrinks(list, c.id));
  document.getElementById('ctDel')?.addEventListener('click', async () => {
    if (!confirm(`„${c.name}“ löschen?`)) return;
    await DB.remove(c);
    toast(`${c.name} gelöscht`);
    location.hash = '#/cocktails';
  });
}

// ---------- Anlegen / Bearbeiten ----------
function openCocktailForm(c) {
  const isNew = !c;
  const d = c || { name: '', alcoholic: false, price: 0, glass: 'highball', colors: ['#ffd27a', '#ff9e4a'], garnish: 'orange',
    ingredients: [{ amount: '', item: '' }], steps: '', note: '', photo: '' };
  let photo = d.photo || '';
  const ingRow = (i = {}) => `<div class="ing-row">
    <input class="ing-amount" placeholder="Menge" maxlength="20" value="${esc(i.amount || '')}">
    <input class="ing-item" placeholder="Zutat" maxlength="60" value="${esc(i.item || '')}">
    <button type="button" class="btn small danger" data-rm aria-label="Zutat entfernen">✕</button></div>`;
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>${isNew ? 'Neuer Cocktail' : 'Cocktail bearbeiten'}</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <form id="ctForm" class="ev-form">
      <div class="ct-form-top">
        <div class="ct-form-img" id="ctPreview"></div>
        <div class="grow">
          <label for="cName">Name</label><input id="cName" required maxlength="60" value="${esc(d.name)}">
          <div class="row">
            <div class="shrink" style="width:130px"><label for="cPrice">Preis in €</label><input id="cPrice" inputmode="decimal" value="${d.price ? priceInput(d.price) : ''}"></div>
            <div><label class="check" style="margin-top:26px"><input type="checkbox" id="cAlc" ${d.alcoholic ? 'checked' : ''}> enthält Alkohol</label></div>
          </div>
        </div>
      </div>
      <div class="row">
        <div><label for="cGlass">Glas</label><select id="cGlass">${Object.entries(CT_GLASSES).map(([k, l]) => `<option value="${k}" ${k === d.glass ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label for="cGarnish">Deko</label><select id="cGarnish">${Object.entries(CT_GARNISH).map(([k, l]) => `<option value="${k}" ${k === d.garnish ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="shrink"><label>Farbe oben / unten</label>
          <div class="row" style="gap:6px;flex-wrap:nowrap"><input type="color" id="cTop" value="${d.colors?.[0] || '#ffd27a'}"><input type="color" id="cBottom" value="${d.colors?.[1] || '#ff9e4a'}"></div></div>
      </div>
      <div class="action-row" style="margin-top:10px">
        <label class="btn small" style="margin:0">📷 Foto wählen<input type="file" id="cPhoto" accept="image/*" hidden></label>
        <button type="button" class="btn small" id="cNoPhoto" ${photo ? '' : 'hidden'}>Foto entfernen (Illustration zeigen)</button>
      </div>
      <h3 class="sub-title">Zutaten</h3>
      <div id="ingList">${(d.ingredients && d.ingredients.length ? d.ingredients : [{}]).map(ingRow).join('')}</div>
      <button type="button" class="btn small" id="ingAdd" style="margin-top:6px">＋ Zutat</button>
      <label for="cSteps">Zubereitung (jede Zeile ein Schritt)</label>
      <textarea id="cSteps" rows="5" maxlength="2000">${esc(d.steps || '')}</textarea>
      <label for="cNote">Hinweis (optional)</label>
      <input id="cNote" maxlength="120" value="${esc(d.note || '')}" placeholder="z. B. Unser Klassiker am Lagerfeuer">
      <p class="form-error" hidden></p>
      <div class="modal-actions"><span class="grow"></span>
        <button class="btn" type="button" data-close>Abbrechen</button>
        <button class="btn primary" type="submit">${isNew ? 'Anlegen' : 'Speichern'}</button></div>
    </form>`);
  modal.classList.add('wide');
  const $ = id => modal.querySelector('#' + id);
  const current = () => ({ name: $('cName').value || 'Cocktail', glass: $('cGlass').value, garnish: $('cGarnish').value,
    colors: [$('cTop').value, $('cBottom').value], photo });
  const preview = () => { $('ctPreview').innerHTML = ctImage(current()); $('cNoPhoto').hidden = !photo; };
  preview();
  ['cGlass', 'cGarnish', 'cTop', 'cBottom'].forEach(i => $(i).addEventListener('input', preview));
  $('cName').addEventListener('input', preview);
  $('ingAdd').addEventListener('click', () => { $('ingList').insertAdjacentHTML('beforeend', ingRow()); $('ingList').lastElementChild.querySelector('input').focus(); });
  $('ingList').addEventListener('click', ev => { if (ev.target.closest('[data-rm]')) ev.target.closest('.ing-row').remove(); });
  $('cNoPhoto').addEventListener('click', () => { photo = ''; preview(); });
  $('cPhoto').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try { photo = await shrinkImage(file, 520); preview(); }
    catch { alert('Das Bild konnte nicht gelesen werden.'); }
  });
  if (isNew) $('cName').focus();

  $('ctForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const name = $('cName').value.trim();
    const ingredients = [...modal.querySelectorAll('.ing-row')].map(r => ({
      amount: r.querySelector('.ing-amount').value.trim(), item: r.querySelector('.ing-item').value.trim() })).filter(i => i.item);
    const err = msg => { const e = modal.querySelector('.form-error'); e.textContent = msg; e.hidden = !msg; };
    if (!name) return err('Bitte einen Namen eingeben.');
    if (!ingredients.length) return err('Bitte mindestens eine Zutat eintragen.');
    const all = await DB.all('cocktail');
    const rec = await DB.save('cocktail', { ...(c || {}), name, alcoholic: $('cAlc').checked, price: parsePrice($('cPrice').value),
      glass: $('cGlass').value, garnish: $('cGarnish').value, colors: [$('cTop').value, $('cBottom').value],
      ingredients, steps: $('cSteps').value.trim(), note: $('cNote').value.trim(), photo,
      order: c ? c.order : all.reduce((m, x) => Math.max(m, x.order ?? 0), 0) + 1 });
    closeModal();
    toast(isNew ? `${name} angelegt` : 'Gespeichert');
    if (location.hash === '#/cocktails/' + rec.id) renderCocktailDetail(rec.id); else location.hash = '#/cocktails/' + rec.id;
  });
}

// Foto verkleinern (JPEG), damit es klein genug für den Abgleich bleibt
function shrinkImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild')); };
    img.src = url;
  });
}

// ---------- In die Getränkevergabe übernehmen ----------
async function openCocktailsToDrinks(list, onlyId) {
  const events = (await DB.all('drinkEvent')).filter(e => !e.archived).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>In Getränkevergabe übernehmen</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    ${events.length ? `
      <label for="tdEvent">Getränke-Event</label>
      <select id="tdEvent">${events.map(e => `<option value="${e.id}" ${e.id === currentEventId() ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      <h3 class="sub-title">Cocktails</h3>
      <div class="perm-grid">${list.map(c => `<label class="check"><input type="checkbox" name="ct" value="${c.id}" ${!onlyId || onlyId === c.id ? 'checked' : ''}>
        ${esc(c.name)} <span class="muted">${c.price ? euro(c.price) : 'ohne Preis'}</span></label>`).join('')}</div>
      <p class="muted" style="font-size:14px">Gibt es das Getränk im Event schon, wird nur der Preis aktualisiert.</p>
      <div class="modal-actions"><span class="grow"></span>
        <button class="btn" data-close>Abbrechen</button><button class="btn primary" id="tdGo">Übernehmen</button></div>`
      : `<p>Es gibt noch kein Getränke-Event. Lege zuerst in der Getränkevergabe ein Event an.</p>
         <div class="modal-actions"><span class="grow"></span><a class="btn primary" href="#/getraenke">Zur Getränkevergabe</a></div>`}`);
  modal.querySelector('#tdGo')?.addEventListener('click', async ev => {
    const evId = modal.querySelector('#tdEvent').value;
    const chosen = [...modal.querySelectorAll('[name=ct]:checked')].map(x => list.find(c => c.id === x.value));
    if (!chosen.length) return alert('Bitte mindestens einen Cocktail auswählen.');
    ev.currentTarget.disabled = true;
    const drinks = (await DB.all('drink')).filter(d => d.eventId === evId);
    let order = drinks.reduce((m, d) => Math.max(m, d.order ?? 0), 0);
    let added = 0, updated = 0;
    for (const c of chosen) {
      const same = drinks.find(d => norm(d.name) === norm(c.name));
      if (same) { if (same.price !== (c.price || 0)) { await DB.save('drink', { ...same, price: c.price || 0 }); updated++; } }
      else { await DB.save('drink', { name: c.name, price: c.price || 0, order: ++order, eventId: evId, cocktailId: c.id }); added++; }
    }
    closeModal();
    toast(`${added} Getränk(e) übernommen${updated ? `, ${updated} Preis(e) aktualisiert` : ''}`);
  });
}

// ---------- Druckbare Getränkekarte ----------
const menuPrefs = () => { try { return { title: 'Cocktailkarte', subtitle: '', prices: true, ...JSON.parse(localStorage.getItem('ctMenu') || '{}') }; } catch { return { title: 'Cocktailkarte', subtitle: '', prices: true }; } };

function menuHtml(list, prefs) {
  const item = c => `
    <div class="menu-item">
      <div class="menu-thumb">${ctImage(c)}</div>
      <div class="menu-text">
        <div class="menu-line"><span class="menu-name">${esc(c.name)}</span>${prefs.prices && c.price ? `<span class="menu-dots"></span><span class="menu-price">${euro(c.price)}</span>` : ''}</div>
        <div class="menu-ing">${esc((c.ingredients || []).map(i => i.item.replace(/\s*\(.*?\)/g, '').replace(/ zum Auffüllen/i, '')).filter(x => !/eiswürfel|crushed ice/i.test(x)).join(' · '))}</div>
      </div>
    </div>`;
  const free = list.filter(c => !c.alcoholic), alc = list.filter(c => c.alcoholic);
  return `
    <div class="menu-sheet">
      <div class="menu-head">
        <div class="menu-orn">✦ ✦ ✦</div>
        <h1>${esc(prefs.title || 'Cocktailkarte')}</h1>
        ${prefs.subtitle ? `<p class="menu-sub">${esc(prefs.subtitle)}</p>` : ''}
      </div>
      ${free.length ? `<h2 class="menu-section">Alkoholfrei</h2><div class="menu-items">${free.map(item).join('')}</div>` : ''}
      ${alc.length ? `<h2 class="menu-section">Mit Alkohol</h2><div class="menu-items">${alc.map(item).join('')}</div>` : ''}
      ${alc.length ? '<p class="menu-foot">Alkoholische Getränke geben wir nur an Personen ab 18 Jahren aus.</p>' : ''}
      <div class="menu-orn">✦</div>
    </div>`;
}

function openCocktailMenu(list) {
  const prefs = menuPrefs();
  const chosen = new Set(prefs.ids && prefs.ids.length ? prefs.ids.filter(id => list.some(c => c.id === id)) : list.map(c => c.id));
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>🖨 Getränkekarte</h2></div>
      <button class="btn primary small" id="mPrint">Drucken</button>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <div class="menu-layout">
      <div class="menu-opts">
        <label for="mTitle">Titel</label><input id="mTitle" maxlength="40" value="${esc(prefs.title)}">
        <label for="mSub">Untertitel (optional)</label><input id="mSub" maxlength="60" value="${esc(prefs.subtitle)}" placeholder="z. B. BayAirn 2026 · Bar am Lagerfeuer">
        <label class="check"><input type="checkbox" id="mPrices" ${prefs.prices ? 'checked' : ''}> Preise anzeigen</label>
        <h3 class="sub-title">Auf der Karte</h3>
        ${list.map(c => `<label class="check"><input type="checkbox" name="mc" value="${c.id}" ${chosen.has(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}
        <p class="muted" style="font-size:13px;margin-top:12px">Tipp: Im Druckdialog „Hintergrundgrafiken“ aktivieren, dann erscheinen auch die Farben.</p>
      </div>
      <div class="menu-preview" id="mPreview"></div>
    </div>`);
  modal.classList.add('wide', 'fullscreen');
  const $ = id => modal.querySelector('#' + id);
  const read = () => ({ title: $('mTitle').value.trim(), subtitle: $('mSub').value.trim(), prices: $('mPrices').checked,
    ids: [...modal.querySelectorAll('[name=mc]:checked')].map(x => x.value) });
  const draw = () => {
    const p = read();
    localStorage.setItem('ctMenu', JSON.stringify(p));
    $('mPreview').innerHTML = menuHtml(list.filter(c => p.ids.includes(c.id)), p);
  };
  draw();
  modal.addEventListener('input', draw);
  modal.addEventListener('change', draw);
  $('mPrint').addEventListener('click', () => {
    const p = read();
    let area = document.getElementById('printArea');
    if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
    area.innerHTML = menuHtml(list.filter(c => p.ids.includes(c.id)), p);
    document.body.classList.add('printing-menu');
    const done = () => { document.body.classList.remove('printing-menu'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  });
}
