// Einkaufsrechner: Aus Personenzahl (Kinder + Erwachsene), Tagen und Wetter eine
// Einkaufsliste für Getränke schätzen. Richtwerte, Gebinde und Preise sind anpassbar
// und werden auf diesem Gerät gespeichert. Erreichbar über einen dezenten Link auf der
// Cocktail-Seite – für alle, die Cocktails bearbeiten oder Personen & Getränke verwalten dürfen.
//
// Zeile: {name, kid, adult (Liter pro Person und Tag), packLabel, packLiters, price (pro Gebinde),
//         hot (Warmgetränk: kein Wetterzuschlag), active}

// Richtwerte für eine Freizeit/Veranstaltung mit Verpflegung – nur Schätzungen, bitte an eure Erfahrung anpassen
const SHOP_DEFAULTS = [
  { name: 'Mineralwasser', kid: 0.8, adult: 0.8, packLabel: 'Kasten 12 × 1,0 l', packLiters: 12, price: 6, active: true },
  { name: 'Spezi / Cola-Mix', kid: 0.5, adult: 0.3, packLabel: 'Kasten 20 × 0,5 l', packLiters: 10, price: 16, active: true },
  { name: 'Limonade / Apfelschorle', kid: 0.4, adult: 0.25, packLabel: 'Kasten 20 × 0,5 l', packLiters: 10, price: 15, active: true },
  { name: 'Saft (Apfel, Orange)', kid: 0.2, adult: 0.1, packLabel: 'Karton 6 × 1,0 l', packLiters: 6, price: 9, active: true },
  { name: 'Milch / Kakao', kid: 0.15, adult: 0.05, packLabel: 'Karton 12 × 1,0 l', packLiters: 12, price: 14, active: true },
  { name: 'Tee (aufgebrüht)', kid: 0.1, adult: 0.15, packLabel: 'Packung 25 Beutel ≈ 6 l', packLiters: 6, price: 2, hot: true, active: true },
  { name: 'Kaffee (aufgebrüht)', kid: 0, adult: 0.3, packLabel: 'Packung 500 g ≈ 9 l', packLiters: 9, price: 7, hot: true, active: true },
  { name: 'Bier (nur Erwachsene)', kid: 0, adult: 0.4, packLabel: 'Kasten 20 × 0,5 l', packLiters: 10, price: 18, active: false },
];
const SHOP_WEATHER = { normal: ['normal', 1], warm: ['warm (über 25 °C)', 1.2], hot: ['heiß (über 30 °C)', 1.4] };

function shopConfig() {
  try {
    const c = JSON.parse(localStorage.getItem('shopConfig') || 'null');
    if (c && Array.isArray(c.items)) return c;
  } catch { /* Standardwerte */ }
  return { kids: 40, adults: 10, days: 3, weather: 'normal', buffer: 10, items: SHOP_DEFAULTS.map(x => ({ ...x })) };
}
const saveShopConfig = c => localStorage.setItem('shopConfig', JSON.stringify(c));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) || n < 0 ? 0 : n; };
const liters = n => n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 ? 1 : 0 }) + ' l';

// Bedarf pro Zeile berechnen
function shopCalc(c) {
  const factor = (SHOP_WEATHER[c.weather] || SHOP_WEATHER.normal)[1];
  const buffer = 1 + num(c.buffer) / 100;
  const rows = c.items.filter(i => i.active && i.name).map(i => {
    const perDay = num(c.kids) * num(i.kid) + num(c.adults) * num(i.adult);
    const need = perDay * num(c.days) * (i.hot ? 1 : factor) * buffer;
    const packs = num(i.packLiters) > 0 ? Math.ceil(need / num(i.packLiters) - 1e-9) : 0;
    return { ...i, need, packs, cost: packs * num(i.price) };
  }).filter(r => r.need > 0);
  return { rows, total: rows.reduce((s, r) => s + r.cost, 0), litersTotal: rows.reduce((s, r) => s + r.need, 0), factor };
}

async function renderEinkauf() {
  setTitle('Einkaufsliste', '#/cocktails');
  const c = shopConfig();
  const bay = Auth.can('bayairn') ? await DB.all('bayParticipant') : [];
  view.innerHTML = `
    <div class="card">
      <h2>Wer ist dabei?</h2>
      <form id="shopForm" class="shop-inputs">
        <div><label for="sKids">Kinder &amp; Jugendliche (unter 18)</label><input id="sKids" name="kids" type="number" min="0" inputmode="numeric" value="${c.kids}"></div>
        <div><label for="sAdults">Erwachsene</label><input id="sAdults" name="adults" type="number" min="0" inputmode="numeric" value="${c.adults}"></div>
        <div><label for="sDays">Tage</label><input id="sDays" name="days" type="number" min="0.5" step="0.5" inputmode="decimal" value="${c.days}"></div>
        <div><label for="sWeather">Wetter</label><select id="sWeather" name="weather">${Object.entries(SHOP_WEATHER).map(([k, [l]]) =>
          `<option value="${k}" ${k === c.weather ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label for="sBuffer">Puffer in %</label><input id="sBuffer" name="buffer" type="number" min="0" max="100" step="5" inputmode="numeric" value="${c.buffer}"></div>
      </form>
      ${bay.length ? `<button class="btn small" id="sFromBay" style="margin-top:12px">✈️ Aus BayAirn übernehmen (${bay.length} Teilnehmer)</button>` : ''}
    </div>
    <div class="card" id="shopResult"></div>
    <details class="card shop-settings">
      <summary>⚙️ Richtwerte, Gebinde &amp; Preise anpassen</summary>
      <p class="muted" style="font-size:14px">Liter pro Person und Tag. Die Vorgaben sind grobe Schätzwerte – passe sie an eure Erfahrung an.
      „Warm“ = Warmgetränk (kein Wetterzuschlag). Änderungen werden auf diesem Gerät gespeichert.</p>
      <div class="table-wrap"><table class="shop-table">
        <thead><tr><th>Aktiv</th><th>Getränk</th><th class="num">Kind l/Tag</th><th class="num">Erw. l/Tag</th><th>Gebinde</th><th class="num">Liter je Gebinde</th><th class="num">Preis € je Gebinde</th><th>Warm</th><th></th></tr></thead>
        <tbody id="shopRows"></tbody>
      </table></div>
      <div class="action-row" style="margin-top:10px">
        <button class="btn small" id="sAdd">＋ Getränk</button>
        <button class="btn small" id="sReset">Auf Vorgaben zurücksetzen</button>
      </div>
    </details>`;

  const rowsEl = document.getElementById('shopRows');
  const drawRows = () => {
    rowsEl.innerHTML = c.items.map((i, n) => `
      <tr data-n="${n}">
        <td><input type="checkbox" data-f="active" ${i.active ? 'checked' : ''} aria-label="aktiv"></td>
        <td><input data-f="name" value="${esc(i.name)}" maxlength="40" aria-label="Getränk"></td>
        <td><input data-f="kid" class="numin" inputmode="decimal" value="${String(i.kid).replace('.', ',')}" aria-label="Liter pro Kind und Tag"></td>
        <td><input data-f="adult" class="numin" inputmode="decimal" value="${String(i.adult).replace('.', ',')}" aria-label="Liter pro Erwachsenem und Tag"></td>
        <td><input data-f="packLabel" value="${esc(i.packLabel)}" maxlength="40" aria-label="Gebinde"></td>
        <td><input data-f="packLiters" class="numin" inputmode="decimal" value="${String(i.packLiters).replace('.', ',')}" aria-label="Liter je Gebinde"></td>
        <td><input data-f="price" class="numin" inputmode="decimal" value="${i.price ? String(i.price).replace('.', ',') : ''}" aria-label="Preis je Gebinde"></td>
        <td><input type="checkbox" data-f="hot" ${i.hot ? 'checked' : ''} aria-label="Warmgetränk"></td>
        <td><button class="btn small danger" data-rm aria-label="Zeile löschen">✕</button></td>
      </tr>`).join('');
  };

  const drawResult = () => {
    const r = shopCalc(c);
    const people = num(c.kids) + num(c.adults);
    document.getElementById('shopResult').innerHTML = `
      <div class="card-head">
        <h2>🛒 Einkaufsliste</h2>
        <button class="btn small" id="sPrint">🖨 Drucken</button>
        <button class="btn small" id="sCsv">⬇ Excel</button>
      </div>
      <p class="muted" style="margin:0 0 10px">${people} Personen · ${num(c.days).toLocaleString('de-DE')} ${num(c.days) === 1 ? 'Tag' : 'Tage'} · Wetter ${(SHOP_WEATHER[c.weather] || SHOP_WEATHER.normal)[0]} · ${num(c.buffer)} % Puffer</p>
      ${r.rows.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Getränk</th><th class="num">Menge</th><th>Einkaufen</th><th class="num">ca. Kosten</th></tr></thead>
          <tbody>${r.rows.map(x => `<tr>
            <td>${esc(x.name)}</td><td class="num">${liters(x.need)}</td>
            <td><strong>${x.packs} ×</strong> ${esc(x.packLabel)}</td>
            <td class="num">${x.price ? euro(x.cost) : '–'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td><strong>Gesamt</strong></td><td class="num"><strong>${liters(r.litersTotal)}</strong></td><td></td>
            <td class="num"><strong>${euro(r.total)}</strong></td></tr></tfoot>
        </table></div>
        <p class="muted" style="font-size:13px;margin:10px 0 0">Schätzung nach Richtwerten pro Person und Tag – gerundet auf ganze Gebinde.
        Getränke, die übrig bleiben, kann man oft beim Getränkehändler zurückgeben – vorher nachfragen.</p>`
      : '<p class="muted" style="margin:0">Bitte Personen und Tage eingeben.</p>'}`;
    document.getElementById('sPrint')?.addEventListener('click', () => printShopList(c, r));
    document.getElementById('sCsv')?.addEventListener('click', () => downloadCsv('einkaufsliste.csv',
      ['Getränk', 'Menge Liter', 'Anzahl Gebinde', 'Gebinde', 'Preis € je Gebinde', 'Kosten €'],
      r.rows.map(x => [x.name, Math.round(x.need * 10) / 10, x.packs, x.packLabel, num(x.price), Math.round(x.cost * 100) / 100])));
  };

  const update = () => { saveShopConfig(c); drawResult(); };
  document.getElementById('shopForm').addEventListener('input', ev => {
    const f = ev.target.name;
    if (!f) return;
    c[f] = f === 'weather' ? ev.target.value : num(ev.target.value);
    update();
  });
  document.getElementById('shopForm').addEventListener('change', ev => {
    if (ev.target.name === 'weather') { c.weather = ev.target.value; update(); }
  });
  rowsEl.addEventListener('input', ev => {
    const tr = ev.target.closest('tr');
    const f = ev.target.dataset.f;
    if (!tr || !f) return;
    const item = c.items[+tr.dataset.n];
    item[f] = ev.target.type === 'checkbox' ? ev.target.checked : ['name', 'packLabel'].includes(f) ? ev.target.value : num(ev.target.value);
    update();
  });
  rowsEl.addEventListener('click', ev => {
    if (!ev.target.closest('[data-rm]')) return;
    c.items.splice(+ev.target.closest('tr').dataset.n, 1);
    drawRows();
    update();
  });
  document.getElementById('sAdd').addEventListener('click', () => {
    c.items.push({ name: 'Neues Getränk', kid: 0, adult: 0, packLabel: 'Kasten 20 × 0,5 l', packLiters: 10, price: 0, active: true });
    drawRows();
    update();
    rowsEl.lastElementChild.querySelector('[data-f=name]').select();
  });
  document.getElementById('sReset').addEventListener('click', () => {
    if (!confirm('Alle Richtwerte, Gebinde und Preise auf die Vorgaben zurücksetzen?')) return;
    c.items = SHOP_DEFAULTS.map(x => ({ ...x }));
    drawRows();
    update();
  });
  document.getElementById('sFromBay')?.addEventListener('click', () => {
    const withAge = bay.filter(p => p.age !== '' && p.age != null);
    const adults = withAge.filter(p => Number(p.age) >= 18).length;
    const noAge = bay.length - withAge.length;
    c.kids = bay.length - adults;
    c.adults = adults;
    document.getElementById('sKids').value = c.kids;
    document.getElementById('sAdults').value = c.adults;
    update();
    toast(`${c.kids} Kinder & Jugendliche, ${c.adults} Erwachsene übernommen` + (noAge ? ` (${noAge} ohne Alter als Kinder gezählt)` : ''));
  });

  drawRows();
  drawResult();
}

// Druckbare Einkaufsliste mit Abhak-Kästchen (nutzt den Druckbereich der Getränkekarte)
function printShopList(c, r) {
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.innerHTML = `
    <div class="shop-print">
      <h1>Einkaufsliste Getränke</h1>
      <p>${num(c.kids) + num(c.adults)} Personen (${num(c.kids)} Kinder &amp; Jugendliche, ${num(c.adults)} Erwachsene) ·
        ${num(c.days).toLocaleString('de-DE')} Tage · Wetter ${(SHOP_WEATHER[c.weather] || SHOP_WEATHER.normal)[0]} · ${num(c.buffer)} % Puffer</p>
      <table>
        <thead><tr><th></th><th>Anzahl</th><th>Gebinde</th><th>Getränk</th><th class="num">ca. Kosten</th></tr></thead>
        <tbody>${r.rows.map(x => `<tr><td class="box">☐</td><td><strong>${x.packs} ×</strong></td><td>${esc(x.packLabel)}</td><td>${esc(x.name)}</td>
          <td class="num">${x.price ? euro(x.cost) : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td colspan="3"><strong>Gesamt ca.</strong></td><td class="num"><strong>${euro(r.total)}</strong></td></tr></tfoot>
      </table>
      <p class="small">Erstellt am ${new Date().toLocaleDateString('de-DE')} mit Vereinsorga · Schätzung nach Richtwerten</p>
    </div>`;
  document.body.classList.add('printing-menu');
  const done = () => { document.body.classList.remove('printing-menu'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
