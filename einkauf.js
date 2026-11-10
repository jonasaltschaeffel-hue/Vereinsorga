// Einkaufsrechner für die Cocktailbar: Aus Personenzahl und den ausgewählten Cocktails
// wird geschätzt, wie oft jeder Cocktail bestellt wird, und daraus die Zutatenmenge
// laut Rezept berechnet. Normale Getränke spielen hier keine Rolle.
// Kinder & Jugendliche (unter 18) zählen nur bei alkoholfreien Cocktails.
// Einstellungen werden auf diesem Gerät gespeichert. Erreichbar über einen dezenten Link
// auf der Cocktail-Seite – für alle, die Cocktails bearbeiten oder Getränke verwalten dürfen.

const POPULARITY = [[0.5, 'wenig'], [1, 'normal'], [2, 'sehr beliebt']];
// Flüssigkeit pro Glas (für „zum Auffüllen“), in Litern – Eis nimmt den Rest ein
const GLASS_FILL = { highball: 0.25, hurricane: 0.3, tumbler: 0.2, cocktail: 0.12 };
const ICE_PER_DRINK = 150; // Gramm Eis pro Cocktail

function partyConfig() {
  try {
    const c = JSON.parse(localStorage.getItem('partyShop') || 'null');
    if (c && typeof c === 'object') return { kids: 30, adults: 15, evenings: 1, perKid: 2, perAdult: 3, buffer: 10, cocktails: {}, packs: {}, ...c };
  } catch { /* Standardwerte */ }
  return { kids: 30, adults: 15, evenings: 1, perKid: 2, perAdult: 3, buffer: 10, cocktails: {}, packs: {} };
}
const savePartyConfig = c => localStorage.setItem('partyShop', JSON.stringify(c));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) || n < 0 ? 0 : n; };

// Mengenangabe aus dem Rezept lesen → { v, unit: 'l' | 'g' | 'Stk' }
function parseAmount(a) {
  const s = String(a || '').trim().replace(/½/g, '0.5').replace(/¼/g, '0.25').replace(/¾/g, '0.75').replace(',', '.');
  const m = s.match(/^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(.*)$/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2]) v = (v + parseFloat(m[2])) / 2; // „8–10“ → 9
  const u = m[3].toLowerCase().replace('.', '').trim();
  if (u === 'cl') return { v: v / 100, unit: 'l' };
  if (u === 'ml') return { v: v / 1000, unit: 'l' };
  if (u === 'l') return { v, unit: 'l' };
  if (u === 'tl') return { v: v * 4, unit: 'g' };   // 1 Teelöffel ≈ 4 g
  if (u === 'el') return { v: v * 12, unit: 'g' };  // 1 Esslöffel ≈ 12 g
  if (u === 'g') return { v, unit: 'g' };
  if (u === 'kg') return { v: v * 1000, unit: 'g' };
  if (u === 'spritzer' || u === 'dash') return { v: v * 0.001, unit: 'l' };
  return { v, unit: 'Stk' };
}

// Zutatenname vereinheitlichen: „Limette (geviertelt)“ → „Limette“, „Sodawasser zum Auffüllen“ → „Sodawasser“
const ingKey = item => String(item || '').replace(/\(.*?\)/g, '').replace(/\s*zum\s+auffüllen/i, '').replace(/\s+/g, ' ').trim();
const isIce = item => /eiswürfel|crushed ice|^eis$/i.test(ingKey(item));
const isFill = item => /auffüllen/i.test(item);

// Zutaten für EINEN Cocktail
function ingredientsPerDrink(c) {
  const out = [];
  let liquid = 0;
  const fills = [];
  for (const i of c.ingredients || []) {
    const key = ingKey(i.item);
    if (!key) continue;
    if (isIce(i.item)) { out.push({ key, v: ICE_PER_DRINK, unit: 'g' }); continue; }
    const a = parseAmount(i.amount);
    if (a) { out.push({ key, ...a }); if (a.unit === 'l') liquid += a.v; continue; }
    if (isFill(i.item)) fills.push(key);
  }
  // „zum Auffüllen“: Rest bis zur üblichen Füllmenge des Glases
  const rest = Math.max(0.04, (GLASS_FILL[c.glass] || 0.25) - liquid);
  fills.forEach(key => out.push({ key, v: rest / fills.length, unit: 'l' }));
  return out;
}

// Übliche Gebinde als Vorschlag (änderbar)
function defaultPack(key, unit) {
  const k = key.toLowerCase();
  if (unit === 'l') {
    if (/rum|tequila|wodka|vodka|gin\b|whisk|likör|cachaça|brandy|schnaps|cointreau|triple sec/.test(k)) return { label: 'Flasche 0,7 l', size: 0.7, price: 15 };
    if (/sirup|grenadine/.test(k)) return { label: 'Flasche 0,7 l', size: 0.7, price: 5 };
    if (/sahne/.test(k)) return { label: 'Becher 0,2 l', size: 0.2, price: 1.2 };
    if (/kokos/.test(k)) return { label: 'Dose 0,4 l', size: 0.4, price: 3 };
    if (/saft|nektar/.test(k)) return { label: 'Packung 1 l', size: 1, price: 1.8 };
    return { label: 'Flasche 1 l', size: 1, price: 1 };
  }
  if (unit === 'g') {
    if (/eis|ice/.test(k)) return { label: 'Beutel 2 kg', size: 2000, price: 2.5 };
    if (/zucker/.test(k)) return { label: 'Packung 1 kg', size: 1000, price: 2 };
    return { label: 'Packung 500 g', size: 500, price: 2 };
  }
  if (/minz/.test(k)) return { label: 'Bund (≈ 30 Blätter)', size: 30, price: 1.5 };
  if (/limette/.test(k)) return { label: 'Stück', size: 1, price: 0.4 };
  if (/zitrone|orange/.test(k)) return { label: 'Stück', size: 1, price: 0.5 };
  if (/kirsch/.test(k)) return { label: 'Glas (≈ 40 Stück)', size: 40, price: 3 };
  return { label: 'Stück', size: 1, price: 0 };
}

const fmtAmount = (v, unit) => unit === 'l' ? `${v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 2 : 1 })} l`
  : unit === 'g' ? (v >= 1000 ? `${(v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg` : `${Math.round(v)} g`)
  : `${Math.ceil(v - 1e-9)} Stück`;

// Wie oft wird jeder Cocktail bestellt? Und welche Zutaten braucht es insgesamt?
function partyCalc(c, cocktails) {
  const sel = cocktails.filter(x => c.cocktails[x.id]?.on !== false);
  const weight = x => num(c.cocktails[x.id]?.w ?? 1) || 1;
  const free = sel.filter(x => !x.alcoholic);
  const wAll = sel.reduce((s, x) => s + weight(x), 0);
  const wFree = free.reduce((s, x) => s + weight(x), 0);
  const kidDrinks = num(c.kids) * num(c.perKid) * num(c.evenings);
  const adultDrinks = num(c.adults) * num(c.perAdult) * num(c.evenings);
  const counts = new Map(sel.map(x => [x.id,
    (!x.alcoholic && wFree ? kidDrinks * weight(x) / wFree : 0) + (wAll ? adultDrinks * weight(x) / wAll : 0)]));
  const buffer = 1 + num(c.buffer) / 100;
  const need = new Map();
  for (const x of sel) {
    const n = counts.get(x.id) * buffer;
    for (const i of ingredientsPerDrink(x)) {
      const k = i.key + '|' + i.unit;
      const g = need.get(k) || { key: i.key, unit: i.unit, v: 0, used: new Set() };
      g.v += i.v * n;
      g.used.add(x.name);
      need.set(k, g);
    }
  }
  const rows = [...need.values()].filter(r => r.v > 0).map(r => {
    const pack = { ...defaultPack(r.key, r.unit), ...(c.packs[r.key + '|' + r.unit] || {}) };
    const packs = num(pack.size) > 0 ? Math.ceil(r.v / num(pack.size) - 1e-9) : 0;
    return { ...r, pack, packs };
  }).sort((a, b) => a.key.localeCompare(b.key, 'de'));
  return { sel, counts, rows,
    kidsWithoutFree: kidDrinks > 0 && !free.length, totalDrinks: [...counts.values()].reduce((s, n) => s + n, 0) };
}

async function renderEinkauf() {
  setTitle('Einkaufsliste Cocktails', '#/cocktails');
  const cocktails = await loadCocktails();
  const c = partyConfig();
  const bay = Auth.can('bayairn') ? await DB.all('bayParticipant') : [];
  view.innerHTML = `
    <div class="card">
      <h2>🍹 Wer kommt zur Party?</h2>
      <form id="partyForm" class="shop-inputs">
        <div><label for="pKids">Kinder &amp; Jugendliche (unter 18)</label><input id="pKids" name="kids" type="number" min="0" inputmode="numeric" value="${c.kids}"></div>
        <div><label for="pAdults">Erwachsene</label><input id="pAdults" name="adults" type="number" min="0" inputmode="numeric" value="${c.adults}"></div>
        <div><label for="pEvenings">Abende</label><input id="pEvenings" name="evenings" type="number" min="1" step="1" inputmode="numeric" value="${c.evenings}"></div>
        <div><label for="pPerKid">Cocktails pro Kind &amp; Abend</label><input id="pPerKid" name="perKid" type="number" min="0" step="0.5" inputmode="decimal" value="${c.perKid}"></div>
        <div><label for="pPerAdult">Cocktails pro Erwachsenem &amp; Abend</label><input id="pPerAdult" name="perAdult" type="number" min="0" step="0.5" inputmode="decimal" value="${c.perAdult}"></div>
        <div><label for="pBuffer">Puffer in %</label><input id="pBuffer" name="buffer" type="number" min="0" max="100" step="5" inputmode="numeric" value="${c.buffer}"></div>
      </form>
      ${bay.length ? `<button class="btn small" id="pFromBay" style="margin-top:12px">✈️ Aus BayAirn übernehmen (${bay.length} Teilnehmer)</button>` : ''}
      <p class="muted" style="font-size:13px;margin:10px 0 0">Kinder &amp; Jugendliche zählen nur bei alkoholfreien Cocktails.</p>
    </div>
    <div class="card">
      <h2>Welche Cocktails gibt es?</h2>
      ${cocktails.length ? `<ul class="list party-list" id="partyCocktails">${cocktails.map(x => {
        const s = c.cocktails[x.id] || {};
        return `<li data-id="${x.id}">
          <input type="checkbox" data-f="on" ${s.on !== false ? 'checked' : ''} aria-label="${esc(x.name)} auf der Party">
          <span class="party-thumb">${ctImage(x)}</span>
          <span class="grow"><strong>${esc(x.name)}</strong> ${x.alcoholic ? '<span class="tag warn">ab 18</span>' : '<span class="tag ok">alkoholfrei</span>'}
            <span class="muted party-count" data-count></span></span>
          <select data-f="w" aria-label="Beliebtheit">${POPULARITY.map(([v, l]) => `<option value="${v}" ${num(s.w ?? 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </li>`;
      }).join('')}</ul>` : '<p class="muted" style="margin:0">Noch keine Cocktails angelegt.</p>'}
    </div>
    <div class="card" id="partyResult"></div>
    <details class="card shop-settings">
      <summary>⚙️ Gebinde anpassen</summary>
      <p class="muted" style="font-size:14px">Wie wird eine Zutat gekauft? „Inhalt“ in Litern, Gramm oder Stück je Gebinde.
      Änderungen werden auf diesem Gerät gespeichert.</p>
      <div class="table-wrap"><table class="shop-table"><thead><tr><th>Zutat</th><th>Gebinde</th><th class="num">Inhalt</th><th></th></tr></thead>
        <tbody id="packRows"></tbody></table></div>
      <button class="btn small" id="pResetPacks" style="margin-top:10px">Gebinde zurücksetzen</button>
    </details>`;

  const draw = () => {
    const r = partyCalc(c, cocktails);
    view.querySelectorAll('#partyCocktails li').forEach(li => {
      const n = r.counts.get(li.dataset.id);
      li.querySelector('[data-count]').textContent = n ? `≈ ${Math.round(n)} Stück` : '';
    });
    const people = num(c.kids) + num(c.adults);
    document.getElementById('partyResult').innerHTML = `
      <div class="card-head">
        <h2>🛒 Einkaufsliste</h2>
        <button class="btn small" id="pPrint">🖨 Drucken</button>
        <button class="btn small" id="pCsv">⬇ Excel</button>
      </div>
      <p class="muted" style="margin:0 0 10px">${people} Personen · ${num(c.evenings)} ${num(c.evenings) === 1 ? 'Abend' : 'Abende'} ·
        ≈ ${Math.round(r.totalDrinks)} Cocktails · ${num(c.buffer)} % Puffer</p>
      ${r.kidsWithoutFree ? '<p class="form-error" style="margin:0 0 10px">Für Kinder &amp; Jugendliche ist kein alkoholfreier Cocktail ausgewählt – sie sind nicht eingerechnet.</p>' : ''}
      ${r.rows.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Zutat</th><th class="num">Menge</th><th>Einkaufen</th></tr></thead>
          <tbody>${r.rows.map(x => `<tr>
            <td>${esc(x.key)}<div class="muted" style="font-size:12px">${[...x.used].map(esc).join(', ')}</div></td>
            <td class="num">${fmtAmount(x.v, x.unit)}</td>
            <td><strong>${x.packs} ×</strong> ${esc(x.pack.label)}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="muted" style="font-size:13px;margin:10px 0 0">Schätzung aus den Rezepten: „zum Auffüllen“ wird mit der üblichen Füllmenge
        des Glases gerechnet, Eis mit ${ICE_PER_DRINK} g pro Cocktail. Gerundet auf ganze Gebinde.</p>`
      : '<p class="muted" style="margin:0">Bitte Personen eingeben und mindestens einen Cocktail auswählen.</p>'}`;
    document.getElementById('packRows').innerHTML = r.rows.map(x => `
      <tr data-k="${esc(x.key + '|' + x.unit)}">
        <td>${esc(x.key)}</td>
        <td><input data-f="label" value="${esc(x.pack.label)}" maxlength="40" aria-label="Gebinde"></td>
        <td><input data-f="size" class="numin" inputmode="decimal" value="${String(x.pack.size).replace('.', ',')}" aria-label="Inhalt"></td>
        <td class="muted">${x.unit === 'l' ? 'Liter' : x.unit === 'g' ? 'Gramm' : 'Stück'}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Noch keine Zutaten.</td></tr>';
    document.getElementById('pPrint')?.addEventListener('click', () => printPartyList(c, r));
    document.getElementById('pCsv')?.addEventListener('click', () => downloadCsv('einkaufsliste_cocktails.csv',
      ['Zutat', 'Menge', 'Anzahl', 'Gebinde', 'Für'],
      r.rows.map(x => [x.key, fmtAmount(x.v, x.unit), x.packs, x.pack.label, [...x.used].join(', ')])));
  };
  const update = () => { savePartyConfig(c); draw(); };

  document.getElementById('partyForm').addEventListener('input', ev => {
    if (!ev.target.name) return;
    c[ev.target.name] = num(ev.target.value);
    update();
  });
  document.getElementById('partyCocktails')?.addEventListener('change', ev => {
    const li = ev.target.closest('li');
    if (!li) return;
    const s = c.cocktails[li.dataset.id] = c.cocktails[li.dataset.id] || {};
    if (ev.target.dataset.f === 'on') s.on = ev.target.checked;
    if (ev.target.dataset.f === 'w') s.w = num(ev.target.value);
    update();
  });
  // Gebinde-Änderungen erst beim Verlassen des Feldes übernehmen, damit die Tabelle beim Tippen stehen bleibt
  document.getElementById('packRows').addEventListener('change', ev => {
    const tr = ev.target.closest('tr');
    if (!tr || !ev.target.dataset.f) return;
    const p = c.packs[tr.dataset.k] = c.packs[tr.dataset.k] || {};
    p[ev.target.dataset.f] = ev.target.dataset.f === 'label' ? ev.target.value : num(ev.target.value);
    update();
  });
  document.getElementById('pResetPacks').addEventListener('click', () => {
    if (!confirm('Alle Gebinde auf die Vorschläge zurücksetzen?')) return;
    c.packs = {};
    update();
  });
  document.getElementById('pFromBay')?.addEventListener('click', () => {
    const adults = bay.filter(p => p.age !== '' && p.age != null && Number(p.age) >= 18).length;
    const noAge = bay.filter(p => p.age === '' || p.age == null).length;
    c.kids = bay.length - adults;
    c.adults = adults;
    document.getElementById('pKids').value = c.kids;
    document.getElementById('pAdults').value = c.adults;
    update();
    toast(`${c.kids} Kinder & Jugendliche, ${c.adults} Erwachsene übernommen` + (noAge ? ` (${noAge} ohne Alter als Kinder gezählt)` : ''));
  });
  draw();
}

// Druckbarer Einkaufszettel mit Abhak-Kästchen (nutzt den Druckbereich der Getränkekarte)
function printPartyList(c, r) {
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.innerHTML = `
    <div class="shop-print">
      <h1>Einkaufsliste Cocktailbar</h1>
      <p>${num(c.kids) + num(c.adults)} Personen (${num(c.kids)} Kinder &amp; Jugendliche, ${num(c.adults)} Erwachsene) ·
        ${num(c.evenings)} ${num(c.evenings) === 1 ? 'Abend' : 'Abende'} · ≈ ${Math.round(r.totalDrinks)} Cocktails · ${num(c.buffer)} % Puffer</p>
      <p>Cocktails: ${r.sel.map(x => `${esc(x.name)} (≈ ${Math.round(r.counts.get(x.id))})`).join(', ')}</p>
      <table>
        <thead><tr><th></th><th>Anzahl</th><th>Gebinde</th><th>Zutat</th><th class="num">Menge</th></tr></thead>
        <tbody>${r.rows.map(x => `<tr><td class="box">☐</td><td><strong>${x.packs} ×</strong></td><td>${esc(x.pack.label)}</td><td>${esc(x.key)}</td>
          <td class="num">${fmtAmount(x.v, x.unit)}</td></tr>`).join('')}</tbody>
      </table>
      <p class="small">Erstellt am ${new Date().toLocaleDateString('de-DE')} mit Vereinsorga · Schätzung aus den Rezepten</p>
    </div>`;
  document.body.classList.add('printing-menu');
  const done = () => { document.body.classList.remove('printing-menu'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
