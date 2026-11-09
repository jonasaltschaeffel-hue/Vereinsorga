// Vereinsorga – App-Logik mit einfachem Hash-Router.
// Neue Module: Eintrag in MODULES + Routen in ROUTES ergänzen.

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('backBtn');

// perms: Kachel ist sichtbar, wenn der Benutzer mindestens eines dieser Rechte hat.
const DRINK_PERMS = ['ausgabe', 'einrichtung', 'abrechnung', 'statistik'];
const MODULES = [
  { href: '#/getraenke', emoji: '🥤', name: 'Getränkevergabe', desc: 'Personen, Getränke, Ausgabe, Abrechnung', perms: DRINK_PERMS },
  { href: '#/kalender', emoji: '📅', name: 'Kalender', desc: 'Termine & Veranstaltungen', perms: ['kalender', 'kalender_bearbeiten'] },
  { href: '#/admin', emoji: '🔑', name: 'Admin', desc: 'Benutzer & Rechte', perms: ['admin'] },
  { href: '#/einstellungen', emoji: '⚙️', name: 'Einstellungen', desc: 'Gerät, Sicherung, Import', perms: ['einstellungen'] },
  { href: '', emoji: '➕', name: 'Weitere Module', desc: 'folgen', disabled: true },
];
const canAny = perms => !perms || perms.some(p => Auth.can(p));

// ---------- Hilfsfunktionen ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = n => (n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const time = iso => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayKey = iso => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = key => new Date(key + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const norm = s => String(s ?? '').trim().toLowerCase();
const byName = (a, b) => a.name.localeCompare(b.name, 'de');
const parsePrice = v => {
  let s = String(v ?? '').replace(/[€\s]|EUR/gi, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
};

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function setTitle(text, back) {
  titleEl.textContent = text;
  backBtn.hidden = !back;
  backBtn.onclick = () => { location.hash = back; };
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// CSV, das deutsches Excel direkt richtig öffnet (Semikolon, Komma-Dezimalen, BOM).
function downloadCsv(filename, header, rows) {
  const cell = v => typeof v === 'number'
    ? String(v).replace('.', ',')
    : `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header, ...rows].map(r => r.map(cell).join(';'));
  download(filename, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

// ---------- Startseite ----------
async function renderHome() {
  setTitle('Vereinsorga');
  // Widget „Nächste Termine“ für alle, die den Kalender sehen dürfen
  const widget = Auth.can('kalender') || Auth.can('kalender_bearbeiten') ? await upcomingWidget() : null;
  view.innerHTML = `
    <p class="greeting">Hallo <strong>${esc(Auth.user().name)}</strong>!</p>
    ${Auth.isWaiting(Auth.user()) ? `
      <div class="card waiting">
        <h2>⏳ Dein Konto wartet auf Freigabe</h2>
        <p class="muted" style="margin:0">Ein Admin muss dir erst die Bereiche freigeben, die du nutzen darfst.
        Sobald das passiert ist, erscheinen sie hier automatisch (mit Internet nach spätestens 30 Sekunden).</p>
      </div>` : !MODULES.some(m => m.perms && !m.perms.includes('einstellungen') && canAny(m.perms)) ? `
      <div class="card">
        <h2>Keine Bereiche freigegeben</h2>
        <p class="muted" style="margin:0">Dir sind im Moment keine Bereiche freigegeben. Wende dich bei Bedarf an einen Admin.</p>
      </div>` : ''}
    ${widget && widget.position === 'above' ? widget.html : ''}
    <div class="tiles">
      ${MODULES.filter(m => canAny(m.perms)).map(m => `
        <a class="tile ${m.disabled ? 'disabled' : ''}" href="${m.href}">
          <span class="emoji">${m.emoji}</span>
          <strong>${esc(m.name)}</strong>
          <small>${esc(m.desc)}</small>
        </a>`).join('')}
    </div>
    ${widget && widget.position !== 'above' ? widget.html : ''}
    ${localStorage.getItem('deviceName') || !Auth.can('einstellungen') ? '' : `
      <div class="card" style="margin-top:14px">
        <h2>Tipp</h2>
        <p class="muted">Gib diesem Gerät in den <a href="#/einstellungen">Einstellungen</a> einen Namen,
        damit man später sieht, wo ein Eintrag erfasst wurde.</p>
      </div>`}
  `;
  if (widget) widget.bind(view);
}

// =====================================================================
// Getränkevergabe
// Datentypen: person {name, group}, drink {name, price, order},
// drinkEntry {bookingId, personId, personName, drinkId, drinkName, price, qty}
// Der Preis wird bei der Ausgabe mitgespeichert – spätere Preisänderungen
// verändern bereits gebuchte Getränke nicht.
// =====================================================================

// payment {personId, name, group, qty, sum, lines[], items[], entryIds[]}:
// eine bezahlte Rechnung. Die enthaltenen Ausgaben (entryIds) gelten als bezahlt.
async function loadDrinkData() {
  const [persons, drinks, entries, payments] = await Promise.all(
    [DB.all('person'), DB.all('drink'), DB.all('drinkEntry'), DB.all('payment')]);
  persons.sort(byName);
  drinks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byName(a, b));
  const paidIds = new Set(payments.flatMap(p => p.entryIds || []));
  return { persons, drinks, entries, payments, paidIds };
}

const dateTime = iso => new Date(iso).toLocaleString('de-DE',
  { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function drinkTabs(active) {
  const tabs = [['einrichtung', '1 · Einrichtung', 'einrichtung'], ['abrechnung', 'Abrechnung', 'abrechnung'],
    ['bezahlt', 'Bezahlt', 'abrechnung'], ['statistik', 'Statistik', 'statistik']].filter(t => Auth.can(t[2]));
  return `<nav class="tabs">
    ${tabs.map(([k, l]) => `<a href="#/getraenke/${k}" class="${k === active ? 'active' : ''}">${l}</a>`).join('')}
  </nav>`;
}

// ---------- Einrichtung: Personen & Getränke ----------
const KIND = {
  person: {
    title: 'Personen', none: 'Noch keine Personen.',
    sheet: /person|teilnehm|name|liste/i,
    fields: [['name', 'Name', 'z. B. Max Mustermann'], ['group', 'Gruppe (optional)', 'z. B. Rosenheim']],
    hint: 'Excel-Spalten: <b>Name</b> (oder <b>Vorname</b> + <b>Nachname</b>), optional <b>Gruppe</b>.',
    key: p => norm(p.name) + '|' + norm(p.group),
    line: p => `<span class="grow">${esc(p.name)}${p.group ? ` <span class="muted">· ${esc(p.group)}</span>` : ''}</span>`,
  },
  drink: {
    title: 'Getränke', none: 'Noch keine Getränke.',
    sheet: /getr|drink|preis|artikel/i,
    fields: [['name', 'Getränk', 'z. B. Spezi 0,5 l'], ['price', 'Preis in €', '2,00']],
    hint: 'Excel-Spalten: <b>Getränk</b> und <b>Preis</b>.',
    key: d => norm(d.name),
    line: d => `<span class="grow">${esc(d.name)}</span><span class="num">${euro(d.price)}</span>`,
  },
};

// Erkennt Spalten anhand der Überschriften; ohne Überschrift: 1. Spalte Name, 2. Spalte Gruppe/Preis.
function rowsToItems(kind, rows) {
  rows = rows.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(Boolean));
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  const find = re => head.findIndex(h => re.test(h));
  const items = [];
  if (kind === 'person') {
    let iVor = find(/vorname/), iNach = find(/nachname|familienname|zuname/);
    let iName = head.findIndex((h, i) => i !== iVor && i !== iNach && /^(name|teilnehmer|person|vollständiger name)/.test(h));
    let iGroup = find(/gruppe|ort|zelt|team|verein|klasse|kreis/);
    const hasHeader = [iVor, iNach, iName, iGroup].some(i => i >= 0);
    if (!hasHeader) { iName = 0; iGroup = rows[0].length > 1 ? 1 : -1; }
    if (iName < 0 && iVor < 0 && iNach < 0) iName = iGroup === 0 ? 1 : 0;
    for (const r of hasHeader ? rows.slice(1) : rows) {
      const name = iName >= 0 ? r[iName] : [r[iVor], r[iNach]].filter(Boolean).join(' ');
      if (name) items.push({ name, group: iGroup >= 0 ? (r[iGroup] || '') : '' });
    }
  } else {
    let iName = find(/getr|name|artikel|sorte|bezeichnung|produkt/);
    let iPrice = find(/preis|eur|€|betrag|kosten/);
    const hasHeader = iName >= 0 || iPrice >= 0;
    if (iName < 0) iName = iPrice === 0 ? 1 : 0;
    if (iPrice < 0) iPrice = iName === 0 ? 1 : 0;
    for (const r of hasHeader ? rows.slice(1) : rows) {
      if (r[iName]) items.push({ name: r[iName], price: parsePrice(r[iPrice]) });
    }
  }
  return items;
}

// Fügt neue Einträge hinzu; vorhandene (gleicher Name) werden nicht doppelt angelegt.
async function upsertItems(kind, objs, existing) {
  const k = KIND[kind];
  const map = new Map(existing.map(e => [k.key(e), e]));
  let order = existing.reduce((m, d) => Math.max(m, d.order ?? 0), 0);
  let added = 0, updated = 0, skipped = 0;
  for (const o of objs) {
    if (!o.name) continue;
    const cur = map.get(k.key(o));
    if (!cur) {
      const data = kind === 'drink' ? { name: o.name, price: o.price || 0, order: ++order } : { name: o.name, group: o.group || '' };
      map.set(k.key(o), await DB.save(kind, data));
      added++;
    } else if (kind === 'drink' && o.price !== cur.price) {
      map.set(k.key(o), await DB.save(kind, { ...cur, price: o.price }));
      updated++;
    } else skipped++;
  }
  return { added, updated, skipped };
}

function importMessage({ added, updated, skipped }) {
  const parts = [`${added} neu`];
  if (updated) parts.push(`${updated} Preis aktualisiert`);
  if (skipped) parts.push(`${skipped} schon vorhanden`);
  return parts.join(', ');
}

// Welcher Eintrag gerade in der Eingabezeile bearbeitet wird: { kind, id } oder null
let editing = null;
const priceInput = p => (p || 0).toFixed(2).replace('.', ',');

function setupCard(kind, items) {
  const k = KIND[kind];
  const ed = editing && editing.kind === kind ? items.find(x => x.id === editing.id) : null;
  const value = f => !ed ? '' : f === 'price' ? priceInput(ed.price) : (ed[f] || '');
  return `
  <div class="card" id="card-${kind}">
    <div class="card-head">
      <h2>${k.title} (${items.length})</h2>
      ${items.length > 10 ? `<input type="search" class="filter" placeholder="Suchen …" data-filter="${kind}">` : ''}
    </div>
    <form class="row add-form ${ed ? 'editing' : ''}">
      ${k.fields.map(([f, l, ph]) => `
        <div ${f === 'name' ? '' : 'class="shrink" style="width:150px"'}>
          <label>${l}</label>
          <input name="${f}" placeholder="${ph}" value="${esc(value(f))}" autocomplete="off" ${f === 'name' ? 'required' : ''} ${f === 'price' ? 'inputmode="decimal"' : ''}>
        </div>`).join('')}
      <button class="btn primary shrink" type="submit">${ed ? 'Speichern' : 'Hinzufügen'}</button>
      ${ed ? '<button class="btn shrink" type="button" data-cancel>Abbrechen</button>' : ''}
    </form>
    ${ed ? `<p class="edit-note">✎ „${esc(ed.name)}“ wird bearbeitet${kind === 'drink' ? ' – ein neuer Preis gilt für alle künftigen Ausgaben' : ''}.</p>` : ''}
    <div class="import-row">
      <label class="btn">📄 Excel-Datei importieren<input type="file" hidden data-file
        accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></label>
      <button class="btn" type="button" data-paste-toggle>📋 Aus Excel einfügen</button>
      <span class="muted">${k.hint}</span>
    </div>
    <div class="paste-box" hidden>
      <label>Zellen in Excel markieren, kopieren (Strg+C) und hier einfügen:</label>
      <textarea rows="5" placeholder="${kind === 'person' ? 'Name\tGruppe\nMax Mustermann\tRosenheim' : 'Getränk\tPreis\nSpezi\t2,00'}"></textarea>
      <button class="btn primary" type="button" data-paste-go>Übernehmen</button>
    </div>
    ${items.length ? `<ul class="list">${items.map((it, i) => `
      <li data-text="${esc(norm(it.name + ' ' + (it.group || '')))}" class="${ed && ed.id === it.id ? 'is-editing' : ''}">
        ${k.line(it)}
        ${kind === 'drink' ? `<button class="btn small" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">↑</button>` : ''}
        <button class="btn small" data-edit="${it.id}" aria-label="bearbeiten">✎</button>
        <button class="btn small danger" data-del="${it.id}" aria-label="löschen">✕</button>
      </li>`).join('')}</ul>` : `<p class="muted">${k.none}</p>`}
  </div>`;
}

function bindSetupCard(kind, items, entries) {
  const k = KIND[kind];
  const card = document.getElementById('card-' + kind);
  const rerender = () => renderEinrichtung().then(() => {
    document.querySelector(`#card-${kind} .add-form input`)?.focus();
  });
  const doImport = async rows => {
    const objs = rowsToItems(kind, rows);
    if (!objs.length) { alert('In der Liste wurden keine Einträge erkannt.'); return; }
    const res = await upsertItems(kind, objs, items);
    toast(`${k.title}: ${importMessage(res)}`);
    renderEinrichtung();
  };

  card.querySelector('.add-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const val = n => ev.target.querySelector(`[name="${n}"]`).value.trim();
    const obj = kind === 'drink' ? { name: val('name'), price: parsePrice(val('price')) } : { name: val('name'), group: val('group') };
    const ed = editing && editing.kind === kind ? items.find(x => x.id === editing.id) : null;
    if (ed) {
      await DB.save(kind, { ...ed, ...obj });
      editing = null;
      toast(`${obj.name} gespeichert`);
      rerender();
      return;
    }
    const res = await upsertItems(kind, [obj], items);
    toast(res.added ? `${obj.name} hinzugefügt` : res.updated ? `Preis von ${obj.name} aktualisiert` : `${obj.name} ist schon vorhanden`);
    rerender();
  });

  card.querySelector('[data-file]').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try { await doImport(await Sheet.readFile(file, k.sheet)); }
    catch (e) { alert('Import fehlgeschlagen: ' + e.message); }
  });

  const box = card.querySelector('.paste-box');
  card.querySelector('[data-paste-toggle]').addEventListener('click', () => {
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector('textarea').focus();
  });
  card.querySelector('[data-paste-go]').addEventListener('click', () => {
    const text = box.querySelector('textarea').value;
    if (text.trim()) doImport(Sheet.parseText(text));
  });

  card.querySelector('[data-filter]')?.addEventListener('input', ev => {
    const q = norm(ev.target.value);
    card.querySelectorAll('.list li').forEach(li => { li.hidden = q && !li.dataset.text.includes(q); });
  });

  card.querySelectorAll('[data-up]').forEach(btn => btn.addEventListener('click', async () => {
    const i = +btn.dataset.up;
    const list = items.slice();
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    for (let n = 0; n < list.length; n++) if (list[n].order !== n) await DB.save('drink', { ...list[n], order: n });
    renderEinrichtung();
  }));

  // ✎ lädt den Eintrag zurück in die Eingabezeile
  card.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', async () => {
    editing = { kind, id: btn.dataset.edit };
    await renderEinrichtung();
    const form = document.querySelector(`#card-${kind} .add-form`);
    form.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const input = form.querySelector('input');
    input.focus();
    input.select();
  }));
  card.querySelector('[data-cancel]')?.addEventListener('click', () => {
    editing = null;
    renderEinrichtung();
  });

  card.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    const it = items.find(x => x.id === btn.dataset.del);
    const used = entries.some(e => (kind === 'person' ? e.personId : e.drinkId) === it.id);
    const msg = `„${it.name}“ entfernen?` + (used ? '\nBereits gebuchte Getränke bleiben in der Abrechnung erhalten.' : '');
    if (!confirm(msg)) return;
    await DB.remove(it);
    renderEinrichtung();
  }));
}

async function renderEinrichtung() {
  setTitle('Getränkevergabe', '#/');
  const { persons, drinks, entries } = await loadDrinkData();
  const ready = persons.length && drinks.length;
  view.innerHTML = `
    ${drinkTabs('einrichtung')}
    ${ready ? `
      <div class="card start-card">
        <div class="grow"><strong>${persons.length} Personen · ${drinks.length} Getränke</strong>
          <div class="muted">Alles bereit für die Ausgabe.</div></div>
        ${Auth.can('ausgabe') ? '<a class="btn primary big" href="#/ausgabe">▶ Ausgabe starten</a>' : ''}
      </div>` : `
      <div class="card"><strong>So geht's:</strong>
        <p class="muted" style="margin:6px 0 0">Lege unten die Personen und die Getränke mit Preis an – einzeln,
        als Excel-Datei oder per Kopieren &amp; Einfügen aus Excel. Danach „Ausgabe starten“.</p></div>`}
    <div class="setup-grid">
      ${setupCard('person', persons)}
      ${setupCard('drink', drinks)}
    </div>
  `;
  bindSetupCard('person', persons, entries);
  bindSetupCard('drink', drinks, entries);
}

// ---------- Abrechnung pro Person ----------
// Fasst offene Ausgaben je Person zusammen. Ergebnis hat dieselbe Form wie eine
// bezahlte Rechnung (payment), damit beide gleich angezeigt werden können.
function summarizeByPerson(entries, persons) {
  const pMap = new Map(persons.map(p => [p.id, p]));
  const m = new Map();
  for (const e of entries) {
    const key = e.personId || '_';
    let s = m.get(key);
    if (!s) {
      const p = pMap.get(e.personId);
      s = { id: key, name: p?.name || e.personName || 'Ohne Person', group: p ? p.group : (e.personGroup || ''),
        qty: 0, sum: 0, lineMap: new Map(), items: [] };
      m.set(key, s);
    }
    const lk = e.drinkId + '|' + (e.price || 0);
    const l = s.lineMap.get(lk) || { name: e.drinkName, price: e.price || 0, qty: 0 };
    l.qty += e.qty;
    s.lineMap.set(lk, l);
    s.qty += e.qty;
    s.sum += e.qty * (e.price || 0);
    s.items.push({ id: e.id, bookingId: e.bookingId, at: e.createdAt, drinkName: e.drinkName, qty: e.qty, price: e.price || 0 });
  }
  return [...m.values()].map(s => {
    s.lines = [...s.lineMap.values()];
    delete s.lineMap;
    s.items.sort((a, b) => a.at.localeCompare(b.at));
    return s;
  }).sort(byName);
}

// Ausgaben einer Rechnung, gruppiert nach Buchung, mit Uhrzeit
function bookingsOf(items) {
  const m = new Map();
  for (const e of items || []) {
    const k = e.bookingId || e.at;
    const b = m.get(k) || { at: e.at, parts: [], sum: 0 };
    b.parts.push(`${e.qty}× ${esc(e.drinkName)}`);
    b.sum += e.qty * (e.price || 0);
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => a.at.localeCompare(b.at));
}

function billCard(b, { cls = '', sub = '', actions = '' } = {}) {
  const bookings = bookingsOf(b.items);
  return `
    <div class="card bill ${cls}" data-text="${esc(norm(b.name + ' ' + (b.group || '')))}">
      <div class="bill-head">
        <div class="grow"><strong>${esc(b.name)}</strong>${b.group ? ` <span class="muted">· ${esc(b.group)}</span>` : ''}
          ${sub ? `<div class="bill-sub">${sub}</div>` : ''}</div>
        <div class="bill-total">${euro(b.sum)}</div>
        ${actions}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Getränk</th><th class="num">Anzahl</th><th class="num">Preis</th><th class="num">Betrag</th></tr></thead>
        <tbody>${b.lines.map(l => `
          <tr><td>${esc(l.name)}</td><td class="num">${l.qty}</td><td class="num">${euro(l.price)}</td><td class="num">${euro(l.qty * l.price)}</td></tr>`).join('')}
        </tbody>
      </table></div>
      ${bookings.length ? `
        <details class="times"><summary>Uhrzeiten der Ausgaben (${bookings.length})</summary>
          <ul class="list">${bookings.map(x => `
            <li><span class="muted time-col">${dateTime(x.at)}</span><span class="grow">${x.parts.join(', ')}</span>
            <span class="num">${euro(x.sum)}</span></li>`).join('')}</ul>
        </details>` : ''}
    </div>`;
}

function bindBillSearch(inputId, getQuery, setQuery) {
  const input = document.getElementById(inputId);
  const apply = () => {
    const q = norm(input.value);
    view.querySelectorAll('.bill').forEach(c => { c.hidden = q && !c.dataset.text.includes(q); });
  };
  input.value = getQuery();
  input.addEventListener('input', () => { setQuery(input.value); apply(); });
  apply();
}

// Personen, die während des aktuellen Besuchs der Seite auf „bezahlt“ gesetzt wurden.
// Sie bleiben ausgegraut unten stehen, bis die Seite verlassen wird.
let paidThisVisit = [];
let billQuery = '';

async function renderAbrechnung(fresh) {
  if (fresh) { paidThisVisit = []; billQuery = ''; }
  setTitle('Getränkevergabe', '#/');
  const { persons, entries, payments, paidIds } = await loadDrinkData();
  const bills = summarizeByPerson(entries.filter(e => !paidIds.has(e.id)), persons);
  const justPaid = paidThisVisit.map(id => payments.find(p => p.id === id)).filter(Boolean);
  const openIds = new Set(bills.map(b => b.id));
  const justPaidIds = new Set(justPaid.map(p => p.personId));
  const nothingOpen = persons.filter(p => !openIds.has(p.id) && !justPaidIds.has(p.id));
  const total = bills.reduce((s, b) => s + b.sum, 0);

  view.innerHTML = `
    ${drinkTabs('abrechnung')}
    <div class="card">
      <p style="margin:0 0 12px"><strong>${bills.length}</strong> ${bills.length === 1 ? 'Person hat' : 'Personen haben'} offene Beträge ·
        zusammen <strong>${euro(total)}</strong>${justPaid.length ? ` · <span class="muted">${justPaid.length} gerade bezahlt</span>` : ''}</p>
      <div class="row">
        <div><input type="search" id="billSearch" placeholder="Person oder Gruppe suchen …"></div>
        <button class="btn shrink" id="csvSum">Excel: Summen</button>
        <button class="btn shrink" id="csvDetail">Excel: Einzelposten</button>
        <button class="btn shrink" onclick="window.print()">Drucken</button>
      </div>
    </div>
    <div id="bills">
      ${bills.map(b => billCard(b, { actions: `<button class="btn pay-btn" data-pay="${esc(b.id)}">✓ Bezahlt</button>` })).join('')}
      ${justPaid.map(p => billCard(p, {
        cls: 'paid',
        sub: `✓ bezahlt um ${time(p.createdAt)}`,
        actions: `<button class="btn small" data-unpay="${p.id}">Rückgängig</button>`,
      })).join('')}
    </div>
    ${!bills.length && !justPaid.length ? `<div class="card"><p class="muted" style="margin:0">${payments.length
      ? 'Keine offenen Beträge – alle Rechnungen sind bezahlt. Sie stehen unter „Bezahlt“.'
      : 'Es wurden noch keine Getränke ausgegeben.'}</p></div>` : ''}
    ${nothingOpen.length && (bills.length || justPaid.length) ? `
      <div class="card">
        <h2>Nichts offen (${nothingOpen.length})</h2>
        <p class="muted" style="margin:0">${nothingOpen.map(p => esc(p.name)).join(', ')}</p>
      </div>` : ''}
  `;

  bindBillSearch('billSearch', () => billQuery, q => { billQuery = q; });

  view.querySelectorAll('[data-pay]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const b = bills.find(x => x.id === btn.dataset.pay);
    const rec = await DB.save('payment', {
      personId: b.id, name: b.name, group: b.group || '', qty: b.qty,
      sum: Math.round(b.sum * 100) / 100, lines: b.lines,
      items: b.items.map(({ id, ...rest }) => rest), entryIds: b.items.map(i => i.id),
    });
    paidThisVisit.push(rec.id);
    toast(`${b.name}: ${euro(b.sum)} bezahlt`);
    renderAbrechnung(false);
  }));
  view.querySelectorAll('[data-unpay]').forEach(btn => btn.addEventListener('click', async () => {
    const p = justPaid.find(x => x.id === btn.dataset.unpay);
    await DB.remove(p);
    paidThisVisit = paidThisVisit.filter(id => id !== p.id);
    toast(`${p.name} wieder offen`);
    renderAbrechnung(false);
  }));

  document.getElementById('csvSum').addEventListener('click', () => {
    downloadCsv('abrechnung_offen_summen.csv', ['Person', 'Gruppe', 'Anzahl Getränke', 'Betrag €'],
      bills.map(b => [b.name, b.group, b.qty, Math.round(b.sum * 100) / 100]));
  });
  document.getElementById('csvDetail').addEventListener('click', () => {
    const rows = [];
    for (const b of bills) for (const i of b.items) {
      rows.push([b.name, b.group, new Date(i.at).toLocaleDateString('de-DE'), time(i.at), i.drinkName, i.qty, i.price,
        Math.round(i.qty * i.price * 100) / 100]);
    }
    downloadCsv('abrechnung_offen_einzelposten.csv', ['Person', 'Gruppe', 'Datum', 'Uhrzeit', 'Getränk', 'Anzahl', 'Preis €', 'Betrag €'], rows);
  });
}

// ---------- Bezahlte Rechnungen (Backup) ----------
let paidQuery = '';

async function renderBezahlt() {
  setTitle('Getränkevergabe', '#/');
  const { payments } = await loadDrinkData();
  payments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = payments.reduce((s, p) => s + p.sum, 0);

  view.innerHTML = `
    ${drinkTabs('bezahlt')}
    <div class="card">
      <p style="margin:0 0 12px"><strong>${payments.length}</strong> bezahlte Rechnungen · zusammen <strong>${euro(total)}</strong></p>
      <div class="row">
        <div><input type="search" id="paidSearch" placeholder="Person oder Gruppe suchen …"></div>
        <button class="btn shrink" id="csvPaid">Excel exportieren</button>
        <button class="btn shrink" onclick="window.print()">Drucken</button>
      </div>
    </div>
    ${payments.length ? payments.map(p => billCard(p, {
      sub: `✓ bezahlt ${dateTime(p.createdAt)} Uhr`,
      actions: `<button class="btn small danger" data-unpay="${p.id}">Zurücknehmen</button>`,
    })).join('') : '<div class="card"><p class="muted" style="margin:0">Noch keine Rechnung bezahlt.</p></div>'}
  `;

  bindBillSearch('paidSearch', () => paidQuery, q => { paidQuery = q; });
  view.querySelectorAll('[data-unpay]').forEach(btn => btn.addEventListener('click', async () => {
    const p = payments.find(x => x.id === btn.dataset.unpay);
    if (!confirm(`Zahlung von ${p.name} (${euro(p.sum)}) zurücknehmen?\nDer Betrag erscheint dann wieder in der Abrechnung.`)) return;
    await DB.remove(p);
    toast(`${p.name} wieder offen`);
    renderBezahlt();
  }));
  document.getElementById('csvPaid').addEventListener('click', () => {
    downloadCsv('bezahlte_rechnungen.csv', ['Person', 'Gruppe', 'Bezahlt am', 'Uhrzeit', 'Anzahl Getränke', 'Betrag €'],
      payments.map(p => [p.name, p.group, new Date(p.createdAt).toLocaleDateString('de-DE'), time(p.createdAt), p.qty, p.sum]));
  });
}

// ---------- Gesamtstatistik ----------
const niceStep = x => {
  if (x <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

// Säulendiagramm: ausgegebene Getränke je Stunde (inline SVG, offline-fähig)
function hourChart(entries) {
  const by = new Map();
  for (const e of entries) {
    const h = new Date(e.createdAt).getHours();
    const g = by.get(h) || { qty: 0, sum: 0, drinks: new Map() };
    g.qty += e.qty;
    g.sum += e.qty * (e.price || 0);
    g.drinks.set(e.drinkName, (g.drinks.get(e.drinkName) || 0) + e.qty);
    by.set(h, g);
  }
  if (!by.size) return { html: '<p class="muted">Keine Ausgaben im gewählten Zeitraum.</p>', data: [] };
  const hs = [...by.keys()];
  const data = [];
  for (let h = Math.min(...hs); h <= Math.max(...hs); h++) data.push({ h, ...(by.get(h) || { qty: 0, sum: 0, drinks: new Map() }) });

  const maxQ = Math.max(...data.map(d => d.qty));
  const step = niceStep(maxQ / 4);
  const top = Math.ceil(maxQ / step) * step;
  const W = 720, H = 250, L = 40, R = 8, T = 12, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const cw = iw / data.length;
  const bw = Math.max(4, Math.min(44, cw - 4));
  const y = v => T + ih - (v / top) * ih;

  let svg = '';
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const every = data.length > 16 ? 3 : data.length > 10 ? 2 : 1;
  data.forEach((d, i) => {
    const x = L + i * cw + (cw - bw) / 2;
    const h = (d.qty / top) * ih;
    const yy = T + ih - h;
    const r = Math.min(4, bw / 2, h);
    if (d.qty) svg += `<path class="bar" d="M${x},${T + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${T + ih} Z"/>`;
    if (i % every === 0) svg += `<text x="${L + i * cw + cw / 2}" y="${H - 8}" text-anchor="middle">${d.h} Uhr</text>`;
  });
  data.forEach((d, i) => {
    svg += `<rect class="hit" data-i="${i}" x="${L + i * cw}" y="${T}" width="${cw}" height="${ih}"><title>${d.h}–${d.h + 1} Uhr: ${d.qty} Getränke</title></rect>`;
  });

  const html = `
    <div class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ausgegebene Getränke je Stunde">${svg}</svg>
      <div class="chart-tip" hidden></div>
    </div>
    <details class="times"><summary>Als Tabelle anzeigen</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>Uhrzeit</th><th class="num">Getränke</th><th class="num">Umsatz</th><th>Getränke im Detail</th></tr></thead>
        <tbody>${data.filter(d => d.qty).map(d => `<tr><td>${d.h}–${d.h + 1} Uhr</td><td class="num">${d.qty}</td><td class="num">${euro(d.sum)}</td>
          <td class="muted">${[...d.drinks].sort((a, b) => b[1] - a[1]).map(([n, q]) => `${q}× ${esc(n)}`).join(', ')}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`;
  return { html, data };
}

function bindChart(container, data) {
  const chart = container.querySelector('.chart');
  if (!chart) return;
  const tip = chart.querySelector('.chart-tip');
  const hits = chart.querySelectorAll('.hit');
  const show = rect => {
    const d = data[+rect.dataset.i];
    tip.innerHTML = `<strong>${d.h}–${d.h + 1} Uhr</strong><br>${d.qty} ${d.qty === 1 ? 'Getränk' : 'Getränke'} · ${euro(d.sum)}` +
      [...d.drinks].sort((a, b) => b[1] - a[1]).map(([n, q]) => `<br><span class="muted">${q}× ${esc(n)}</span>`).join('');
    tip.hidden = false;
    const r = rect.getBoundingClientRect();
    const c = chart.getBoundingClientRect();
    // neben die Spalte setzen (rechts, bei Platzmangel links), damit die Säule sichtbar bleibt
    const right = r.right - c.left + 4;
    const left = r.left - c.left - tip.offsetWidth - 4;
    tip.style.left = (right + tip.offsetWidth <= c.width || left < 0 ? Math.min(right, c.width - tip.offsetWidth) : left) + 'px';
    hits.forEach(h => h.classList.toggle('on', h === rect));
  };
  hits.forEach(h => {
    h.addEventListener('pointerenter', () => show(h));
    h.addEventListener('click', () => show(h));
  });
  chart.addEventListener('pointerleave', () => {
    tip.hidden = true;
    hits.forEach(h => h.classList.remove('on'));
  });
}

async function renderStatistik() {
  setTitle('Getränkevergabe', '#/');
  const { persons, entries, payments } = await loadDrinkData();
  const totalQty = entries.reduce((s, e) => s + e.qty, 0);
  const totalSum = entries.reduce((s, e) => s + e.qty * (e.price || 0), 0);
  const paidSum = payments.reduce((s, p) => s + p.sum, 0);
  const served = new Set(entries.map(e => e.personId)).size;
  const bookings = new Set(entries.map(e => e.bookingId || e.id)).size;

  const groupBy = keyFn => {
    const m = new Map();
    for (const e of entries) {
      const k = keyFn(e);
      const g = m.get(k) || { qty: 0, sum: 0 };
      g.qty += e.qty;
      g.sum += e.qty * (e.price || 0);
      m.set(k, g);
    }
    return m;
  };
  const byDrink = [...groupBy(e => e.drinkName)].sort((a, b) => b[1].qty - a[1].qty);
  const byDay = [...groupBy(e => dayKey(e.createdAt))].sort((a, b) => a[0].localeCompare(b[0]));
  const pGroup = new Map(persons.map(p => [p.id, p.group]));
  const byGroup = [...groupBy(e => pGroup.get(e.personId) ?? e.personGroup ?? '')].sort((a, b) => b[1].sum - a[1].sum);
  const hasGroups = byGroup.some(([g]) => g);
  const maxQty = Math.max(1, ...byDrink.map(([, g]) => g.qty));
  const days = byDay.map(([d]) => d);
  let chartDay = sessionStorage.getItem('chartDay') || 'all';
  if (chartDay !== 'all' && !days.includes(chartDay)) chartDay = 'all';

  const table = (head, rows, withBar) => `
    <div class="table-wrap"><table>
      <thead><tr><th>${head}</th><th class="num">Anzahl</th>${withBar ? '<th class="bar-col">Anteil</th>' : ''}<th class="num">Umsatz</th></tr></thead>
      <tbody>${rows.map(([k, g]) => `<tr>
        <td>${esc(k)}</td><td class="num">${g.qty}</td>
        ${withBar ? `<td class="bar-col"><div class="bar"><span style="width:${(g.qty / maxQty * 100).toFixed(1)}%"></span></div>
          <small class="muted">${(g.qty / totalQty * 100).toFixed(0)} %</small></td>` : ''}
        <td class="num">${euro(g.sum)}</td></tr>`).join('')}</tbody>
    </table></div>`;

  view.innerHTML = `
    ${drinkTabs('statistik')}
    <div class="kpis">
      <div class="kpi"><span>Getränke ausgegeben</span><strong>${totalQty}</strong></div>
      <div class="kpi"><span>Umsatz gesamt</span><strong>${euro(totalSum)}</strong></div>
      <div class="kpi"><span>Davon bezahlt</span><strong>${euro(paidSum)}</strong></div>
      <div class="kpi"><span>Noch offen</span><strong>${euro(Math.max(0, totalSum - paidSum))}</strong></div>
      <div class="kpi"><span>Personen versorgt</span><strong>${served}</strong></div>
      <div class="kpi"><span>Ø pro Person</span><strong>${euro(served ? totalSum / served : 0)}</strong></div>
    </div>
    ${entries.length ? `
      <div class="card">
        <div class="card-head">
          <h2>Getränke nach Uhrzeit</h2>
          ${days.length > 1 ? `<select id="chartDay" class="filter">
            <option value="all">Alle Tage</option>
            ${days.map(d => `<option value="${d}" ${d === chartDay ? 'selected' : ''}>${dayLabel(d)}</option>`).join('')}
          </select>` : ''}
        </div>
        <div id="hourChart"></div>
      </div>
      <div class="card"><h2>Nach Getränk</h2>${table('Getränk', byDrink, true)}
        <p class="muted" style="margin:10px 0 0">${bookings} Ausgaben insgesamt.</p></div>
      <div class="card"><h2>Nach Tag</h2>${table('Tag', byDay.map(([d, g]) => [dayLabel(d), g]))}</div>
      ${hasGroups ? `<div class="card"><h2>Nach Gruppe</h2>${table('Gruppe', byGroup.map(([k, g]) => [k || '— ohne Gruppe —', g]))}</div>` : ''}
      <button class="btn" id="csvStat">Excel: alle Ausgaben mit Uhrzeit</button>
    ` : '<div class="card"><p class="muted">Es wurden noch keine Getränke ausgegeben.</p></div>'}
  `;

  const drawChart = () => {
    const el = document.getElementById('hourChart');
    if (!el) return;
    const list = chartDay === 'all' ? entries : entries.filter(e => dayKey(e.createdAt) === chartDay);
    const { html, data } = hourChart(list);
    el.innerHTML = html;
    bindChart(el, data);
  };
  drawChart();
  document.getElementById('chartDay')?.addEventListener('change', ev => {
    chartDay = ev.target.value;
    sessionStorage.setItem('chartDay', chartDay);
    drawChart();
  });
  document.getElementById('csvStat')?.addEventListener('click', () => {
    const pName = new Map(persons.map(p => [p.id, p.name]));
    const rows = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(e => [
      new Date(e.createdAt).toLocaleDateString('de-DE'), time(e.createdAt), pName.get(e.personId) || e.personName,
      e.drinkName, e.qty, e.price || 0, Math.round(e.qty * (e.price || 0) * 100) / 100]);
    downloadCsv('alle_ausgaben.csv', ['Datum', 'Uhrzeit', 'Person', 'Getränk', 'Anzahl', 'Preis €', 'Betrag €'], rows);
  });
}

// ---------- Ausgabe-Seite (eigenständig, nur über „Ausgabe beenden“ verlassen) ----------
const kiosk = { person: null, cart: new Map(), group: '', search: '' };
let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* Bildschirm-wach-halten nicht verfügbar – kein Problem */ }
}

async function renderAusgabe() {
  setTitle('Getränkeausgabe');
  let { persons, drinks, entries, paidIds } = await loadDrinkData();
  kiosk.person = null;
  kiosk.cart.clear();
  kiosk.group = '';
  kiosk.search = '';

  if (!persons.length || !drinks.length) {
    view.innerHTML = `<div class="card"><h2>Noch nicht bereit</h2>
      <p>Bitte zuerst Personen und Getränke anlegen.</p>
      <a class="btn primary" href="#/getraenke/einrichtung">Zur Einrichtung</a></div>`;
    return;
  }
  const groups = [...new Set(persons.map(p => p.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

  view.innerHTML = `
    <div class="kiosk" id="kiosk">
      <div class="kiosk-head">
        <h1>🥤 Getränkeausgabe</h1>
        <span id="kClock" class="muted"></span>
        <button class="btn" id="kExit">Ausgabe beenden</button>
      </div>
      <div class="panes">
        <section class="pane pane-persons">
          <input id="kSearch" type="search" placeholder="🔍 Name suchen …" autocomplete="off">
          ${groups.length ? `<div class="chips" id="kGroups">
            <button class="chip active" data-g="">Alle</button>
            ${groups.map(g => `<button class="chip" data-g="${esc(g)}">${esc(g)}</button>`).join('')}
          </div>` : ''}
          <div class="person-grid" id="kPersons"></div>
        </section>
        <section class="pane pane-drinks" id="kDrinkPane">
          <div id="kSelected"></div>
          <div class="drink-grid" id="kDrinks">
            ${drinks.map(d => `<button class="drink-btn" data-id="${d.id}">
              ${esc(d.name)}<small>${euro(d.price)}</small><span class="count" hidden></span></button>`).join('')}
          </div>
          <div class="card cart" id="kCart"></div>
        </section>
      </div>
      <div class="card" id="kRecent"></div>
    </div>
  `;

  const $ = id => document.getElementById(id);
  const cartQty = () => [...kiosk.cart.values()].reduce((s, q) => s + q, 0);
  const cartSum = () => [...kiosk.cart].reduce((s, [id, q]) => s + q * (drinks.find(d => d.id === id).price || 0), 0);

  function drawPersons() {
    const q = norm(kiosk.search);
    const list = persons.filter(p => (!kiosk.group || p.group === kiosk.group) && (!q || norm(p.name + ' ' + p.group).includes(q)));
    $('kPersons').innerHTML = list.length ? list.map(p => `
      <button class="person-btn ${kiosk.person?.id === p.id ? 'selected' : ''}" data-id="${p.id}">
        ${esc(p.name)}${p.group ? `<small>${esc(p.group)}</small>` : ''}
      </button>`).join('') : '<p class="muted">Niemand gefunden.</p>';
  }

  function drawSelected() {
    const p = kiosk.person;
    $('kiosk').classList.toggle('has-person', !!p);
    $('kDrinkPane').classList.toggle('disabled', !p);
    if (!p) {
      $('kSelected').innerHTML = '<div class="pick-hint">Bitte zuerst eine Person auswählen</div>';
      return;
    }
    // Zahlungen sieht nur, wer Abrechnung oder Statistik darf – Helfer sehen stattdessen „heute“.
    const seesPaid = Auth.can('abrechnung') || Auth.can('statistik');
    const today = dayKey(new Date().toISOString());
    const mine = entries.filter(e => e.personId === p.id && (seesPaid ? !paidIds.has(e.id) : dayKey(e.createdAt) === today));
    const sum = mine.reduce((s, e) => s + e.qty * (e.price || 0), 0);
    const qty = mine.reduce((s, e) => s + e.qty, 0);
    $('kSelected').innerHTML = `
      <div class="selected-banner">
        <div class="grow"><strong>${esc(p.name)}</strong>${p.group ? ` <span class="muted">· ${esc(p.group)}</span>` : ''}
          <div class="muted">${seesPaid ? 'offen' : 'heute'}: ${qty} Getränke · ${euro(sum)}</div></div>
        <button class="btn" id="kChange">Person wechseln</button>
      </div>`;
    $('kChange').onclick = () => selectPerson(null);
  }

  function drawCart() {
    $('kDrinks').querySelectorAll('.drink-btn').forEach(b => {
      const q = kiosk.cart.get(b.dataset.id) || 0;
      const c = b.querySelector('.count');
      c.hidden = !q;
      c.textContent = q;
    });
    if (!kiosk.person) { $('kCart').hidden = true; return; }
    $('kCart').hidden = false;
    const n = cartQty();
    $('kCart').innerHTML = n ? `
      ${[...kiosk.cart].map(([id, q]) => {
        const d = drinks.find(x => x.id === id);
        return `<div class="cart-row">
          <span class="grow">${esc(d.name)}</span>
          <button class="qty-btn" data-minus="${id}" aria-label="weniger">−</button>
          <span class="num cart-qty">${q}</span>
          <button class="qty-btn" data-plus="${id}" aria-label="mehr">+</button>
          <span class="num cart-sum">${euro(q * (d.price || 0))}</span>
        </div>`;
      }).join('')}
      <button class="btn primary book-btn" id="kBook">✓ Buchen · ${n} ${n === 1 ? 'Getränk' : 'Getränke'} · ${euro(cartSum())}</button>
      <button class="btn small" id="kClear" style="margin-top:8px">Auswahl leeren</button>
    ` : '<p class="muted" style="margin:0">Getränke antippen – jedes Antippen zählt eins dazu.</p>';
  }

  function drawRecent() {
    const m = new Map();
    for (const e of entries) {
      const k = e.bookingId || e.id;
      const b = m.get(k) || { id: k, at: e.createdAt, person: e.personName, items: [], sum: 0 };
      b.items.push(e);
      b.sum += e.qty * (e.price || 0);
      m.set(k, b);
    }
    const recent = [...m.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
    $('kRecent').innerHTML = `<h2>Letzte Ausgaben</h2>` + (recent.length ? `<ul class="list">${recent.map(b => `
      <li>
        <span class="muted">${time(b.at)}</span>
        <span class="grow"><strong>${esc(b.person)}</strong> – ${b.items.map(e => `${e.qty}× ${esc(e.drinkName)}`).join(', ')}</span>
        <span class="num">${euro(b.sum)}</span>
        <button class="btn small danger" data-undo="${b.id}">Rückgängig</button>
      </li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Noch keine Ausgaben.</p>');
    $('kRecent').querySelectorAll('[data-undo]').forEach(btn => btn.onclick = async () => {
      const b = recent.find(x => x.id === btn.dataset.undo);
      if (b.items.some(e => paidIds.has(e.id))) {
        alert(`Diese Ausgabe an ${b.person} ist schon bezahlt. Bitte zuerst unter „Bezahlt“ die Zahlung zurücknehmen.`);
        return;
      }
      if (!confirm(`Ausgabe an ${b.person} (${time(b.at)}, ${euro(b.sum)}) rückgängig machen?`)) return;
      for (const e of b.items) await DB.remove(e);
      entries = await DB.all('drinkEntry');
      toast('Ausgabe rückgängig gemacht');
      drawRecent();
      drawSelected();
    });
  }

  function selectPerson(p) {
    if (kiosk.cart.size && kiosk.person?.id !== p?.id && !confirm('Die aktuelle Auswahl verwerfen?')) return;
    if (kiosk.person?.id !== p?.id) kiosk.cart.clear();
    kiosk.person = p;
    drawPersons();
    drawSelected();
    drawCart();
    window.scrollTo(0, 0);
  }

  $('kPersons').addEventListener('click', ev => {
    const btn = ev.target.closest('.person-btn');
    if (btn) selectPerson(persons.find(p => p.id === btn.dataset.id));
  });
  $('kSearch').addEventListener('input', ev => { kiosk.search = ev.target.value; drawPersons(); });
  $('kGroups')?.addEventListener('click', ev => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    kiosk.group = chip.dataset.g;
    $('kGroups').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
    drawPersons();
  });
  $('kDrinks').addEventListener('click', ev => {
    const btn = ev.target.closest('.drink-btn');
    if (!btn) return;
    if (!kiosk.person) { toast('Bitte zuerst eine Person auswählen'); return; }
    kiosk.cart.set(btn.dataset.id, (kiosk.cart.get(btn.dataset.id) || 0) + 1);
    if (navigator.vibrate) navigator.vibrate(20);
    drawCart();
  });
  $('kCart').addEventListener('click', async ev => {
    const t = ev.target;
    if (t.dataset.plus) kiosk.cart.set(t.dataset.plus, kiosk.cart.get(t.dataset.plus) + 1);
    else if (t.dataset.minus) {
      const q = kiosk.cart.get(t.dataset.minus) - 1;
      if (q > 0) kiosk.cart.set(t.dataset.minus, q); else kiosk.cart.delete(t.dataset.minus);
    } else if (t.id === 'kClear') kiosk.cart.clear();
    else if (t.closest('#kBook')) {
      // Auswahl sofort übernehmen und Oberfläche freigeben, damit direkt
      // die nächste Person gewählt werden kann; gespeichert wird danach.
      const p = kiosk.person;
      const n = cartQty();
      const items = [...kiosk.cart];
      const bookingId = DB.uuid();
      kiosk.cart.clear();
      kiosk.search = '';
      $('kSearch').value = '';
      selectPerson(null);
      for (const [id, qty] of items) {
        const d = drinks.find(x => x.id === id);
        await DB.save('drinkEntry', {
          bookingId, personId: p.id, personName: p.name, personGroup: p.group || '',
          drinkId: d.id, drinkName: d.name, price: d.price || 0, qty,
        });
      }
      entries = await DB.all('drinkEntry');
      toast(`✓ ${n} ${n === 1 ? 'Getränk' : 'Getränke'} für ${p.name} gebucht`);
      drawRecent();
      drawSelected();
      return;
    } else return;
    drawCart();
  });
  $('kExit').addEventListener('click', () => {
    if (!confirm(kiosk.cart.size ? 'Es gibt noch eine nicht gebuchte Auswahl. Trotzdem beenden?' : 'Getränkeausgabe beenden?')) return;
    location.hash = '#/';
  });

  drawPersons();
  drawSelected();
  drawCart();
  drawRecent();
}

setInterval(() => {
  const c = document.getElementById('kClock');
  if (c) c.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}, 1000);

// ---------- Einstellungen ----------
function syncText(s) {
  const wait = s.pending ? ` – ${s.pending} ${s.pending === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf das Hochladen` : '';
  if (s.status === 'syncing') return 'Abgleich läuft …';
  if (s.status === 'offline') return 'Keine Internetverbindung' + wait + '. Abgleich, sobald wieder Internet da ist.';
  if (s.status === 'error') return `Abgleich fehlgeschlagen (${s.error})${wait}.`;
  if (s.last) return `Alles abgeglichen (zuletzt ${time(s.last)} Uhr)${wait}.`;
  return 'Noch nicht abgeglichen' + wait + '.';
}

// Farbschema: 'light' | 'dark' | 'auto' (wie das Gerät)
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

async function renderEinstellungen() {
  setTitle('Einstellungen', '#/');
  const count = (await DB.allRecords()).filter(r => !r.deleted && DB.SYNC_TYPES.includes(r.type)).length;
  const theme = localStorage.getItem('theme') || 'auto';
  const seesCalendar = Auth.can('kalender') || Auth.can('kalender_bearbeiten');
  const wp = seesCalendar ? widgetPrefs() : null;
  const cats = seesCalendar ? (await loadCalendar()).cats : [];
  const catChecked = id => !wp.cats || wp.cats.includes(id);
  view.innerHTML = `
    <div class="card">
      <h2>Darstellung</h2>
      <div class="seg" role="radiogroup" aria-label="Farbschema">
        ${[['light', '☀️ Hell'], ['dark', '🌙 Dunkel'], ['auto', '⚙️ Automatisch']].map(([k, l]) => `
          <label><input type="radio" name="theme" value="${k}" ${theme === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
      <p class="muted" style="margin:10px 0 0;font-size:14px">„Automatisch“ folgt der Einstellung deines Geräts. Die Auswahl gilt für dieses Gerät.</p>
    </div>
    ${seesCalendar ? `
    <div class="card">
      <h2>Startseiten-Widget „Nächste Termine“</h2>
      <form id="widgetForm" class="widget-form">
        <label class="check"><input type="checkbox" name="show" ${wp.show ? 'checked' : ''}> Widget auf der Startseite anzeigen</label>
        <div class="widget-opts" ${wp.show ? '' : 'hidden'}>
          <div class="row">
            <div><label for="wTitle">Überschrift</label><input id="wTitle" name="title" maxlength="40" value="${esc(wp.title)}"></div>
            <div class="shrink" style="width:140px"><label for="wCount">Anzahl Termine</label>
              <select id="wCount" name="count">${[3, 4, 5, 6, 8, 10, 15, 20].map(n => `<option ${n === Number(wp.count) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          </div>
          <div class="row">
            <div><label for="wDays">Zeitraum</label>
              <select id="wDays" name="days">${[[7, 'nächste 7 Tage'], [14, 'nächste 2 Wochen'], [30, 'nächster Monat'], [90, 'nächste 3 Monate'], [180, 'nächstes halbes Jahr'], [365, 'nächstes Jahr']]
                .map(([n, l]) => `<option value="${n}" ${n === Number(wp.days) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label for="wPos">Position</label>
              <select id="wPos" name="position">
                <option value="above" ${wp.position === 'above' ? 'selected' : ''}>über den Kacheln</option>
                <option value="below" ${wp.position !== 'above' ? 'selected' : ''}>unter den Kacheln</option>
              </select></div>
          </div>
          <label class="check"><input type="checkbox" name="showTime" ${wp.showTime ? 'checked' : ''}> Uhrzeit anzeigen</label>
          <label class="check"><input type="checkbox" name="showLocation" ${wp.showLocation ? 'checked' : ''}> Ort anzeigen</label>
          <p class="muted" style="margin:14px 0 4px">Diese Kategorien anzeigen</p>
          <div class="perm-grid">
            ${cats.map(c => `<label class="check"><input type="checkbox" name="cat" value="${c.id}" ${catChecked(c.id) ? 'checked' : ''}>
              <i class="dot" style="--c:${c.color}"></i> ${esc(c.name)}</label>`).join('')}
            <label class="check"><input type="checkbox" name="cat" value="" ${catChecked('') ? 'checked' : ''}> ohne Kategorie</label>
          </div>
          <button class="btn small" type="button" id="wReset" style="margin-top:12px">Auf Standard zurücksetzen</button>
        </div>
      </form>
      <p class="muted" style="margin:10px 0 0;font-size:14px">Änderungen werden sofort gespeichert und gelten für dich auf diesem Gerät.</p>
    </div>` : ''}`;
  view.insertAdjacentHTML('beforeend', `
    <div class="card">
      <h2>Abgleich zwischen den Geräten</h2>
      <p id="syncInfo">${esc(syncText(Sync.state()))}</p>
      <div class="row">
        <button class="btn primary shrink" id="syncNow">Jetzt abgleichen</button>
        ${Auth.can('admin') ? '<button class="btn shrink" id="uploadAll">Alle Daten dieses Geräts hochladen</button>' : ''}
      </div>
      ${Auth.can('admin') ? `<p class="muted" style="margin:10px 0 0;font-size:14px">„Alle Daten dieses Geräts hochladen“ brauchst du nur einmal,
        um Daten zu übernehmen, die vor dem Abgleich erfasst wurden – z. B. nach dem Import einer alten Sicherung.</p>` : ''}
    </div>
    <div class="card">
      <h2>Dieses Gerät</h2>
      <form id="devForm" class="row">
        <div><label for="dev">Gerätename</label>
          <input id="dev" value="${esc(localStorage.getItem('deviceName') || '')}" placeholder="z. B. iPad Ausschank"></div>
        <button class="btn primary shrink" type="submit">Speichern</button>
      </form>
    </div>
    <div class="card">
      <h2>Sicherung</h2>
      <p class="muted">Auf diesem Gerät gespeichert: ${count} Einträge. Eine Sicherung ist eine Datei mit allen Daten –
      zum Aufbewahren oder um alte Daten (z. B. von localhost) zu übernehmen. Beim Import wird zusammengeführt,
      nichts wird doppelt angelegt.</p>
      <div class="row">
        <button class="btn primary shrink" id="exp">Sicherung exportieren</button>
        <label class="btn shrink" style="margin:0;color:var(--text);font-size:16px">Sicherung importieren
          <input id="imp" type="file" accept=".json,application/json" hidden></label>
      </div>
    </div>
    <div class="card">
      <h2>Offline-Nutzung</h2>
      <p class="muted">Installiere die App einmal mit Internet: <br>
      iPhone/iPad: Safari → Teilen → „Zum Home-Bildschirm“.<br>
      Android: Chrome → Menü → „App installieren“.<br>
      Windows: Edge/Chrome → Installieren-Symbol in der Adressleiste.<br>
      Danach funktioniert sie ohne Internet; Änderungen werden abgeglichen, sobald wieder Internet da ist.</p>
    </div>
  `);

  view.querySelectorAll('[name=theme]').forEach(r => r.addEventListener('change', () => {
    localStorage.setItem('theme', r.value);
    applyTheme(r.value);
  }));

  const wf = document.getElementById('widgetForm');
  if (wf) {
    const saveWidget = () => {
      const f = name => wf.elements[name];
      const checkedCats = [...wf.querySelectorAll('[name=cat]:checked')].map(c => c.value);
      const allCats = wf.querySelectorAll('[name=cat]').length;
      saveWidgetPrefs({
        show: f('show').checked,
        title: f('title').value.trim() || WIDGET_DEFAULTS.title,
        count: Number(f('count').value),
        days: Number(f('days').value),
        position: f('position').value,
        showTime: f('showTime').checked,
        showLocation: f('showLocation').checked,
        cats: checkedCats.length === allCats ? null : checkedCats, // alle angehakt = auch künftige Kategorien
      });
      wf.querySelector('.widget-opts').hidden = !f('show').checked;
    };
    wf.addEventListener('change', saveWidget);
    wf.addEventListener('submit', ev => ev.preventDefault());
    document.getElementById('wReset').addEventListener('click', () => {
      saveWidgetPrefs({ ...WIDGET_DEFAULTS });
      toast('Widget zurückgesetzt');
      renderEinstellungen();
    });
  }

  document.getElementById('syncNow').addEventListener('click', () => Sync.run());
  document.getElementById('uploadAll')?.addEventListener('click', async () => {
    if (!confirm('Alle Personen, Getränke, Ausgaben und Zahlungen dieses Geräts nach Firebase hochladen?\nVorhandene neuere Daten werden dabei nicht überschrieben.')) return;
    const n = await DB.markAllPending();
    toast(`${n} Einträge zum Hochladen vorgemerkt`);
    Sync.run();
  });
  document.getElementById('devForm').addEventListener('submit', ev => {
    ev.preventDefault();
    localStorage.setItem('deviceName', document.getElementById('dev').value.trim());
    toast('Gerätename gespeichert');
  });
  document.getElementById('exp').addEventListener('click', async () => {
    const records = (await DB.allRecords()).filter(r => DB.SYNC_TYPES.includes(r.type)).map(({ _pending, ...r }) => r);
    const data = { app: 'vereinsorga', version: 2, exportedAt: new Date().toISOString(), device: DB.deviceName(), records };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(`vereinsorga_${stamp}.json`, JSON.stringify(data, null, 1), 'application/json');
  });
  document.getElementById('imp').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'vereinsorga' || !Array.isArray(data.records)) throw new Error('Keine Vereinsorga-Sicherung');
      // Benutzer aus alten Sicherungen werden nicht übernommen – die liegen jetzt in Firebase.
      const { added, updated } = await DB.merge(data.records.filter(r => DB.SYNC_TYPES.includes(r.type)));
      toast(`Import: ${added} neu, ${updated} aktualisiert – wird hochgeladen`);
      renderEinstellungen();
    } catch (e) {
      alert('Import fehlgeschlagen: ' + e.message);
    }
  });
}

// ---------- Anmeldung & Erst-Einrichtung ----------
const userBtn = document.getElementById('userBtn');

// Navigiert zu einer Seite; ist sie schon offen, wird sie neu aufgebaut.
function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

function updateUserBtn() {
  const u = Auth.user();
  userBtn.hidden = !u;
  if (u) userBtn.textContent = '👤 ' + u.name;
}
userBtn.addEventListener('click', () => {
  const s = Sync.state();
  const warn = s.pending ? `\n\nAchtung: ${s.pending} Änderungen sind noch nicht hochgeladen. Sie werden hochgeladen, sobald sich hier wieder jemand online anmeldet.` : '';
  if (!confirm(`${Auth.user().name} abmelden?${warn}`)) return;
  Auth.logout();
  go('#/');
});

function authShell(inner) {
  setTitle('Vereinsorga');
  view.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    <img class="auth-logo" src="icon.svg" alt="" width="56" height="56">${inner}</div></div>`;
}

function pwField(id, label, autocomplete) {
  return `<label for="${id}">${label}</label>
    <div class="pw-wrap"><input id="${id}" type="password" autocomplete="${autocomplete}" required>
      <button type="button" class="pw-toggle" data-toggle="${id}" aria-label="Passwort anzeigen">👁</button></div>`;
}

function bindPwToggles() {
  view.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const input = document.getElementById(b.dataset.toggle);
    input.type = input.type === 'password' ? 'text' : 'password';
  }));
}

function formError(msg) {
  const e = view.querySelector('.form-error');
  e.textContent = msg;
  e.hidden = !msg;
}

const passwordProblem = (pw, pw2) =>
  pw.length < Auth.MIN_PASSWORD ? `Das Passwort braucht mindestens ${Auth.MIN_PASSWORD} Zeichen.`
  : pw2 !== undefined && pw !== pw2 ? 'Die beiden Passwörter stimmen nicht überein.' : '';

// Verständliche Meldungen für Firebase-Fehler
function fbMessage(e) {
  const c = String(e.code || e.message || '');
  if (c === 'NETWORK') return 'Keine Internetverbindung.';
  if (c.startsWith('WEAK_PASSWORD')) return `Das Passwort ist zu schwach (mindestens ${Auth.MIN_PASSWORD} Zeichen).`;
  if (c === 'PERMISSION_DENIED') return 'Der Server hat das abgelehnt (fehlende Rechte – oder die Zugriffsregeln sind noch nicht veröffentlicht).';
  if (c === 'CONFIGURATION_NOT_FOUND' || c.startsWith('OPERATION_NOT_ALLOWED')) return 'In Firebase ist die Anmeldung mit E-Mail/Passwort noch nicht eingeschaltet.';
  if (c === 'NO_SESSION') return 'Bitte einmal ab- und mit Internet wieder anmelden.';
  return e.message || c;
}

function renderNoCrypto() {
  authShell(`<h2>Sichere Verbindung nötig</h2>
    <p>Die Anmeldung funktioniert nur, wenn die App über <strong>https://</strong> (online) oder über
    <strong>http://localhost</strong> (auf dem PC) geöffnet wird.</p>`);
}

function renderBlocked() {
  authShell(`<h2>Server noch nicht bereit</h2>
    <p>Firebase lehnt den Zugriff ab. Meist sind die Zugriffsregeln noch nicht veröffentlicht
    (Firebase-Konsole → Firestore Database → Regeln).</p>
    <button class="btn primary wide" id="retry">Erneut versuchen</button>`);
  document.getElementById('retry').addEventListener('click', () => route());
}

function renderOfflineFirstStart() {
  authShell(`<h2>Internet nötig</h2>
    <p>Beim ersten Start auf einem Gerät braucht die App einmal eine Internetverbindung.</p>
    <button class="btn primary wide" id="retry">Erneut versuchen</button>`);
  document.getElementById('retry').addEventListener('click', () => route());
}

function renderSetup() {
  authShell(`
    <h2>Willkommen!</h2>
    <p class="muted">Lege das erste Konto an. Es bekommt Admin-Rechte und gilt danach auf allen Geräten –
    damit legst du weitere Benutzer an und vergibst Rechte.</p>
    <form id="setupForm">
      <label for="sName">Name</label><input id="sName" autocomplete="username" required>
      ${pwField('sPw', `Passwort (mind. ${Auth.MIN_PASSWORD} Zeichen)`, 'new-password')}
      ${pwField('sPw2', 'Passwort wiederholen', 'new-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary wide" type="submit">Admin-Konto anlegen</button>
    </form>`);
  bindPwToggles();
  document.getElementById('setupForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const name = document.getElementById('sName').value.trim();
    const pw = document.getElementById('sPw').value;
    const problem = !name ? 'Bitte einen Namen eingeben.' : passwordProblem(pw, document.getElementById('sPw2').value);
    if (problem) return formError(problem);
    const btn = ev.submitter;
    if (btn) { btn.disabled = true; btn.textContent = 'Wird angelegt …'; }
    try {
      await Auth.createFirstAdmin(name, pw);
      toast(`Willkommen, ${name}!`);
      go('#/');
      Sync.run();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Admin-Konto anlegen'; }
      formError(fbMessage(e));
    }
  });
}

function renderLogin(offline) {
  authShell(`
    <h2>Anmelden</h2>
    ${offline ? '<p class="muted">Keine Internetverbindung – anmelden können sich Benutzer, die auf diesem Gerät schon einmal online angemeldet waren.</p>' : ''}
    <form id="loginForm">
      <label for="lName">Name</label><input id="lName" autocomplete="username" required>
      ${pwField('lPw', 'Passwort', 'current-password')}
      <label class="check"><input type="checkbox" id="lKeep"> Angemeldet bleiben</label>
      <p class="muted hint">Nur auf eigenen Geräten ankreuzen, nicht am gemeinsamen Ausgabe-iPad.</p>
      <p class="form-error" hidden></p>
      <button class="btn primary wide" type="submit">Anmelden</button>
    </form>
    <button class="link-btn" id="forgot" type="button">Passwort vergessen?</button>
    <div class="auth-alt">
      <p class="muted">Noch kein Konto?</p>
      <button class="btn wide" id="toRegister" type="button">Konto erstellen</button>
    </div>`);
  document.getElementById('toRegister').addEventListener('click', renderRegister);
  bindPwToggles();
  document.getElementById('lName').focus();
  document.getElementById('loginForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = ev.submitter;
    if (btn) { btn.disabled = true; btn.textContent = 'Prüfe …'; }
    const res = await Auth.login(document.getElementById('lName').value, document.getElementById('lPw').value,
      document.getElementById('lKeep').checked);
    if (res.error) {
      if (btn) { btn.disabled = false; btn.textContent = 'Anmelden'; }
      document.getElementById('lPw').value = '';
      return formError(res.error);
    }
    if (res.offline) toast('Offline angemeldet – Abgleich, sobald Internet da ist');
    route();
    Sync.run();
  });
  document.getElementById('forgot').addEventListener('click', renderForgot);
}

function renderRegister() {
  authShell(`
    <h2>Konto erstellen</h2>
    <p class="muted">Nach dem Erstellen kannst du dich anmelden. Welche Bereiche du nutzen darfst,
    gibt ein Admin frei – bis dahin siehst du nur die Einstellungen.</p>
    <form id="regForm">
      <label for="rName">Name</label><input id="rName" autocomplete="username" maxlength="40" required>
      ${pwField('rPw', `Passwort (mind. ${Auth.MIN_PASSWORD} Zeichen)`, 'new-password')}
      ${pwField('rPw2', 'Passwort wiederholen', 'new-password')}
      <p class="form-error" hidden></p>
      <button class="btn primary wide" type="submit">Konto erstellen</button>
    </form>
    <button class="link-btn" id="back" type="button">Zurück zur Anmeldung</button>`);
  bindPwToggles();
  document.getElementById('rName').focus();
  document.getElementById('back').addEventListener('click', () => renderLogin(!navigator.onLine));
  document.getElementById('regForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const name = document.getElementById('rName').value.trim();
    const pw = document.getElementById('rPw').value;
    const problem = !name ? 'Bitte einen Namen eingeben.' : passwordProblem(pw, document.getElementById('rPw2').value);
    if (problem) return formError(problem);
    if (!navigator.onLine) return formError('Zum Erstellen eines Kontos braucht es eine Internetverbindung.');
    const btn = ev.submitter;
    if (btn) { btn.disabled = true; btn.textContent = 'Wird erstellt …'; }
    try {
      const res = await Auth.register(name, pw);
      if (res.error) {
        if (btn) { btn.disabled = false; btn.textContent = 'Konto erstellen'; }
        return formError(res.error);
      }
      toast(`Konto ${name} erstellt`);
      go('#/');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Konto erstellen'; }
      formError(fbMessage(e));
    }
  });
}

function renderForgot() {
  authShell(`
    <h2>Passwort vergessen</h2>
    <p><strong>Benutzer:</strong> Bitte einen Admin, dir unter <em>Admin → Passwort neu setzen</em> ein neues Passwort zu geben.</p>
    <p><strong>Einziger Admin:</strong> Öffne die Firebase-Konsole → <em>Firestore Database</em> → Sammlung <code>config</code>
    und lösche das Dokument <code>setup</code>. Danach zeigt die App wieder die Erst-Einrichtung und du legst ein
    neues Admin-Konto an. Alle Daten bleiben erhalten.</p>
    <button class="btn wide" id="back" type="button">Zurück zur Anmeldung</button>`);
  document.getElementById('back').addEventListener('click', () => renderLogin(!navigator.onLine));
}

// ---------- Admin: Benutzer & Rechte ----------
// Übersicht auf der Seite; die Benutzer selbst stehen in einem eigenen Fenster
// (Kacheln nebeneinander, mit Suche und Filter). Ein Klick öffnet die Details.
const adminState = { users: [], query: '', filter: 'all' };
const isNewUser = u => Auth.isWaiting(u) && u.active !== false;
const PERM_SHORT = { ausgabe: 'Ausgabe', einrichtung: 'Einrichtung', abrechnung: 'Abrechnung', statistik: 'Statistik',
  kalender: 'Kalender', kalender_bearbeiten: 'Kalender ✎', einstellungen: 'Einstellungen', admin: 'Admin' };

async function loadMembers() {
  adminState.users = await Auth.listMembers();
  return adminState.users;
}

async function renderAdmin() {
  setTitle('Admin', '#/');
  view.innerHTML = '<div class="card"><p class="muted" style="margin:0">Benutzer werden geladen …</p></div>';
  try {
    await loadMembers();
  } catch (e) {
    view.innerHTML = `<div class="card"><h2>Keine Verbindung</h2>
      <p>Die Benutzerverwaltung braucht eine Internetverbindung.</p>
      <p class="muted">${esc(fbMessage(e))}</p>
      <button class="btn primary" id="retry">Erneut versuchen</button></div>`;
    document.getElementById('retry').addEventListener('click', renderAdmin);
    return;
  }
  const users = adminState.users;
  const count = f => users.filter(f).length;
  const waiting = count(isNewUser);
  view.innerHTML = `
    <div class="admin-stats">
      <button class="stat" data-filter="all"><strong>${users.length}</strong><span>Benutzer</span></button>
      <button class="stat ${waiting ? 'attention' : ''}" data-filter="new"><strong>${waiting}</strong><span>warten auf Freigabe</span></button>
      <button class="stat" data-filter="admin"><strong>${count(u => Auth.isAdmin(u))}</strong><span>Admins</span></button>
      <button class="stat" data-filter="locked"><strong>${count(u => u.active === false)}</strong><span>gesperrt</span></button>
    </div>
    <div class="card">
      <h2>Benutzerverwaltung</h2>
      <p class="muted">Neue Benutzer erstellen ihr Konto selbst über „Konto erstellen“ auf der Anmeldeseite
      und sehen danach nur die Einstellungen. Im Benutzerfenster gibst du ihnen die Bereiche frei.</p>
      <div class="action-row">
        <button class="btn primary" id="openUsers">👥 Benutzer öffnen</button>
        <button class="btn" id="createUser">＋ Benutzer erstellen</button>
        ${waiting ? `<button class="btn" id="openNew">⏳ ${waiting} ${waiting === 1 ? 'neues Konto' : 'neue Konten'} ansehen</button>` : ''}
      </div>
    </div>
    <div class="card">
      <h2>Gut zu wissen</h2>
      <p class="muted" style="margin:0">Benutzer und Rechte sind in Firebase gespeichert und gelten auf allen Geräten.
      Änderungen wirken beim nächsten Abgleich (online spätestens nach 30 Sekunden). Ein Gerät, das gerade offline ist,
      bemerkt eine Sperre erst, wenn es wieder Internet hat. Admins dürfen immer alles.</p>
    </div>`;
  const open = filter => { adminState.filter = filter; adminState.query = ''; openUsersWindow(); };
  document.getElementById('openUsers').addEventListener('click', () => open('all'));
  document.getElementById('openNew')?.addEventListener('click', () => open('new'));
  document.getElementById('createUser').addEventListener('click', () => openCreateUser(false));
  view.querySelectorAll('.stat').forEach(b => b.addEventListener('click', () => open(b.dataset.filter)));
}

// Fenster mit allen Benutzern als Kacheln
function openUsersWindow() {
  const me = Auth.user();
  const FILTERS = [['all', 'Alle'], ['new', 'Wartet auf Freigabe'], ['admin', 'Admins'], ['locked', 'Gesperrt']];
  const modal = openModal(`
    <div class="modal-head">
      <div class="grow"><h2>👥 Benutzer <span class="muted" style="font-size:16px;font-weight:400">(${adminState.users.length})</span></h2></div>
      <button class="btn primary small" id="newUserBtn">＋ Benutzer erstellen</button>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button>
    </div>
    <input type="search" id="userSearch" placeholder="🔍 Benutzer suchen …" autocomplete="off" value="${esc(adminState.query)}">
    <div class="chips" id="userFilter">
      ${FILTERS.map(([k, l]) => `<button class="chip ${adminState.filter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}
    </div>
    <div class="user-grid" id="userGrid"></div>`, { onClose: renderAdmin });
  modal.classList.add('wide', 'fullscreen');
  modal.querySelector('#newUserBtn').addEventListener('click', () => openCreateUser(true));

  const draw = () => {
    const q = norm(adminState.query);
    const list = adminState.users.filter(u =>
      (!q || norm(u.name).includes(q)) &&
      (adminState.filter === 'all' || (adminState.filter === 'new' && isNewUser(u))
        || (adminState.filter === 'admin' && Auth.isAdmin(u)) || (adminState.filter === 'locked' && u.active === false)))
      .sort((a, b) => isNewUser(b) - isNewUser(a) || a.name.localeCompare(b.name, 'de'));
    modal.querySelector('#userGrid').innerHTML = list.length ? list.map(u => {
      const perms = (u.perms || []).includes('admin') ? ['admin'] : (u.perms || []).filter(p => p !== 'einstellungen');
      return `
        <button class="user-tile ${u.active === false ? 'locked' : ''} ${isNewUser(u) ? 'waiting' : ''}" data-id="${u.uid}">
          <span class="avatar">${esc(u.name.trim().charAt(0).toUpperCase() || '?')}</span>
          <strong>${esc(u.name)}</strong>
          <span class="tags">
            ${u.uid === me.uid ? '<span class="tag">Du</span>' : ''}
            ${isNewUser(u) ? '<span class="tag new">neu</span>' : ''}
            ${u.active === false ? '<span class="tag warn">gesperrt</span>' : ''}
          </span>
          <small>${perms.length ? perms.map(p => PERM_SHORT[p] || p).join(' · ') : 'keine Bereiche'}</small>
        </button>`;
    }).join('') : '<p class="muted">Kein Benutzer gefunden.</p>';
    modal.querySelectorAll('.user-tile').forEach(t => t.addEventListener('click', () =>
      openUserDetail(adminState.users.find(u => u.uid === t.dataset.id))));
  };

  const search = modal.querySelector('#userSearch');
  search.addEventListener('input', () => { adminState.query = search.value; draw(); });
  modal.querySelector('#userFilter').addEventListener('click', ev => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    adminState.filter = chip.dataset.f;
    modal.querySelectorAll('#userFilter .chip').forEach(c => c.classList.toggle('active', c === chip));
    draw();
  });
  draw();
  if (window.matchMedia('(pointer: fine)').matches) search.focus(); // am PC gleich lostippen; am Handy keine Tastatur aufklappen
}

// Admin legt selbst einen Benutzer an. fromList: danach zurück ins Benutzerfenster
function openCreateUser(fromList) {
  const modal = openModal(`
    <div class="modal-head">
      ${fromList ? '<button class="icon-btn back" id="backToList" aria-label="Zurück zur Liste">←</button>' : ''}
      <div class="grow"><h2>Benutzer erstellen</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button>
    </div>
    <form id="createForm">
      <div class="row">
        <div><label for="cuName">Name</label><input id="cuName" maxlength="40" autocomplete="off" required></div>
        <div>${pwField('cuPw', `Passwort (mind. ${Auth.MIN_PASSWORD} Zeichen)`, 'new-password')}</div>
      </div>
      <p class="muted" style="font-size:14px;margin:8px 0 0">Gib der Person Name und Passwort weiter. Sie kann sich damit sofort anmelden.</p>
      <h3 class="sub-title">Rechte</h3>
      <div class="perm-grid">${Auth.PERMS.map(([k, l]) => `
        <label class="check"><input type="checkbox" name="cuPerm" value="${k}" ${k === 'einstellungen' ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        <button class="btn" type="button" id="cuCancel">Abbrechen</button>
        <span class="grow"></span>
        <button class="btn primary" type="submit">Benutzer erstellen</button>
      </div>
    </form>`, { onClose: renderAdmin });
  modal.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const input = modal.querySelector('#' + b.dataset.toggle);
    input.type = input.type === 'password' ? 'text' : 'password';
  }));
  const leave = () => fromList ? openUsersWindow() : (closeModal(), renderAdmin());
  modal.querySelector('#backToList')?.addEventListener('click', leave);
  modal.querySelector('#cuCancel').addEventListener('click', leave);
  modal.querySelector('#cuName').focus();

  modal.querySelector('#createForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = msg => { const p = modal.querySelector('.form-error'); p.textContent = msg; p.hidden = !msg; };
    const name = modal.querySelector('#cuName').value.trim();
    const pw = modal.querySelector('#cuPw').value;
    const perms = [...modal.querySelectorAll('[name="cuPerm"]:checked')].map(c => c.value);
    const problem = !name ? 'Bitte einen Namen eingeben.' : passwordProblem(pw) || (!perms.length ? 'Bitte mindestens ein Recht auswählen.' : '');
    if (problem) return err(problem);
    const btn = ev.submitter;
    if (btn) { btn.disabled = true; btn.textContent = 'Wird erstellt …'; }
    try {
      await Auth.createMember(name, pw, perms);
      toast(`Benutzer ${name} erstellt`);
      await loadMembers();
      adminState.query = '';
      adminState.filter = 'all';
      openUsersWindow();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Benutzer erstellen'; }
      err(fbMessage(e));
    }
  });
}

// Detailfenster eines Benutzers: Rechte und Aktionen
function openUserDetail(u) {
  const me = Auth.user();
  const users = adminState.users;
  const activeAdmins = () => users.filter(x => Auth.isAdmin(x));
  const modal = openModal(`
    <div class="modal-head">
      <button class="icon-btn back" id="backToList" aria-label="Zurück zur Liste">←</button>
      <div class="grow"><h2>${esc(u.name)}</h2>
        <span class="tags">
          ${u.uid === me.uid ? '<span class="tag">Du</span>' : ''}
          ${Auth.isAdmin(u) ? '<span class="tag">Admin</span>' : ''}
          ${isNewUser(u) ? '<span class="tag new">wartet auf Freigabe</span>' : ''}
          ${u.active === false ? '<span class="tag warn">gesperrt</span>' : ''}
        </span>
        ${u.createdAt ? `<div class="muted" style="font-size:14px;margin-top:4px">erstellt ${dateTime(u.createdAt)}</div>` : ''}</div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button>
    </div>
    <h3 class="sub-title">Rechte</h3>
    <div class="perm-grid">${Auth.PERMS.map(([k, l]) => `
      <label class="check"><input type="checkbox" name="perm" value="${k}" ${(u.perms || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <p class="muted" style="font-size:14px;margin:8px 0 0">Häkchen werden sofort gespeichert.</p>
    <h3 class="sub-title">Aktionen</h3>
    <div class="action-row">
      ${isNewUser(u) ? '<button class="btn" data-act="known">Ist bekannt</button>' : ''}
      <button class="btn" data-act="pw">Passwort neu setzen</button>
      ${u.uid !== me.uid ? `
        <button class="btn" data-act="lock">${u.active === false ? 'Entsperren' : 'Sperren'}</button>
        <button class="btn danger" data-act="del">Löschen</button>` : ''}
    </div>`, { onClose: renderAdmin });

  const back = () => openUsersWindow();
  modal.querySelector('#backToList').addEventListener('click', back);

  // Aktion ausführen, Benutzer neu laden und Fenster aktualisieren
  const act = async (fn, okMsg, el, after = 'detail') => {
    if (el) el.disabled = true;
    try {
      await fn();
      if (okMsg) toast(okMsg);
      await loadMembers();
      const fresh = adminState.users.find(x => x.uid === u.uid || x.name === u.name);
      if (after === 'list' || !fresh) back(); else openUserDetail(fresh);
      return true;
    } catch (e) {
      alert(fbMessage(e));
      if (el) el.disabled = false;
      return false;
    }
  };

  modal.querySelectorAll('[name="perm"]').forEach(box => box.addEventListener('change', async () => {
    const perms = [...modal.querySelectorAll('[name="perm"]:checked')].map(c => c.value);
    const losesAdmin = Auth.isAdmin(u) && !perms.includes('admin');
    if (losesAdmin && activeAdmins().length <= 1) {
      box.checked = true;
      return alert('Es muss immer mindestens einen Admin geben.');
    }
    if (losesAdmin && u.uid === me.uid &&
      !confirm('Du nimmst dir selbst die Admin-Rechte. Danach kannst du diese Seite nicht mehr öffnen. Fortfahren?')) {
      box.checked = true;
      return;
    }
    modal.querySelectorAll('[name="perm"]').forEach(b => { b.disabled = true; });
    const ok = await act(() => Auth.updateMember(u, { perms }), `Rechte von ${u.name} gespeichert`);
    if (!ok) { modal.querySelectorAll('[name="perm"]').forEach(b => { b.disabled = false; }); box.checked = !box.checked; return; }
    if (u.uid === me.uid) { await Sync.run(); if (losesAdmin) { closeModal(); go('#/'); } }
  }));

  modal.querySelector('[data-act="known"]')?.addEventListener('click', ev =>
    act(() => Auth.updateMember(u, { approved: true }), `${u.name} ist jetzt als bekannt markiert`, ev.currentTarget));

  modal.querySelector('[data-act="pw"]').addEventListener('click', ev => {
    const pw = prompt(`Neues Passwort für ${u.name} (mind. ${Auth.MIN_PASSWORD} Zeichen):`);
    if (pw === null) return;
    const problem = passwordProblem(pw);
    if (problem) return alert(problem);
    act(() => Auth.resetPassword(u, pw), `Passwort von ${u.name} geändert`, ev.currentTarget);
  });

  modal.querySelector('[data-act="lock"]')?.addEventListener('click', ev => {
    const lock = u.active !== false;
    if (lock && Auth.isAdmin(u) && activeAdmins().length <= 1) return alert('Es muss immer mindestens einen Admin geben.');
    act(() => Auth.updateMember(u, { active: !lock }), lock ? `${u.name} gesperrt` : `${u.name} entsperrt`, ev.currentTarget);
  });

  modal.querySelector('[data-act="del"]')?.addEventListener('click', ev => {
    if (Auth.isAdmin(u) && activeAdmins().length <= 1) return alert('Es muss immer mindestens einen Admin geben.');
    if (!confirm(`Benutzer „${u.name}“ löschen? Der Zugang wird sofort ungültig. Bereits erfasste Einträge bleiben erhalten.`)) return;
    act(() => Auth.deleteMember(u), `${u.name} gelöscht`, ev.currentTarget, 'list');
  });
}

// ---------- Router ----------
// perms: Seite ist erreichbar, wenn der Benutzer mindestens eines dieser Rechte hat.
// refresh: Variante für das automatische Neuladen nach einem Abgleich.
const ROUTES = {
  '': { render: renderHome },
  'getraenke': { render: renderGetraenkeStart, perms: DRINK_PERMS },
  'getraenke/einrichtung': { render: renderEinrichtung, perms: ['einrichtung'] },
  'getraenke/abrechnung': { render: () => renderAbrechnung(true), refresh: () => renderAbrechnung(false), perms: ['abrechnung'] },
  'getraenke/bezahlt': { render: renderBezahlt, perms: ['abrechnung'] },
  'getraenke/statistik': { render: renderStatistik, perms: ['statistik'] },
  'ausgabe': { render: renderAusgabe, perms: ['ausgabe'] },
  'kalender': { render: renderKalender, perms: ['kalender', 'kalender_bearbeiten'] },
  'einstellungen': { render: renderEinstellungen, perms: ['einstellungen'] },
  'admin': { render: renderAdmin, perms: ['admin'] },
};

// Getränkevergabe öffnet die erste Seite, für die der Benutzer Rechte hat.
function renderGetraenkeStart() {
  const first = ['einrichtung', 'abrechnung', 'statistik'].find(p => Auth.can(p));
  location.replace(first ? `#/getraenke/${first}` : '#/ausgabe');
}

let routeRun = 0;
async function route(opts = {}) {
  const run = ++routeRun;
  const path = location.hash.replace(/^#\/?/, '');
  editing = null;
  if (!opts.refresh) closeModal();
  document.body.classList.remove('kiosk-mode');
  try {
    if (!Auth.available()) return renderNoCrypto();
    if (!Auth.user()) Auth.restore();
    updateUserBtn();
    if (!Auth.user()) {
      keepAwake(false);
      const status = await Auth.setupStatus();
      if (run !== routeRun) return; // inzwischen wurde schon weiter navigiert
      if (status === 'open') return renderSetup();
      if (status === 'blocked') return renderBlocked();
      const knownUsers = Object.keys(JSON.parse(localStorage.getItem('fb.members') || '{}')).length;
      if (status === 'offline' && !knownUsers) return renderOfflineFirstStart();
      return renderLogin(status === 'offline');
    }
    const r = ROUTES[path] || ROUTES[''];
    if (!canAny(r.perms)) {
      toast('Dafür fehlt dir die Berechtigung');
      location.replace('#/');
      return;
    }
    const isKiosk = path === 'ausgabe';
    document.body.classList.toggle('kiosk-mode', isKiosk);
    keepAwake(isKiosk);
    await (opts.refresh && r.refresh ? r.refresh : r.render)();
    if (!opts.keepScroll) window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><p>Fehler: ${esc(err.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', () => route());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.body.classList.contains('kiosk-mode')) keepAwake(true);
});

// Nach einem Abgleich mit neuen Daten die Seite auffrischen – aber nicht mitten in einer Eingabe.
window.addEventListener('sync-changed', () => {
  if (!Auth.user() || editing || document.querySelector('.modal-backdrop')) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if (document.body.classList.contains('kiosk-mode') && (kiosk.person || kiosk.cart.size)) return;
  route({ keepScroll: true, refresh: true });
});
window.addEventListener('auth-changed', () => route({ keepScroll: true, refresh: true }));
window.addEventListener('auth-revoked', () => {
  toast('Dein Konto wurde gesperrt oder gelöscht');
  go('#/');
});
window.addEventListener('sync-rejected', ev => {
  toast(`${ev.detail} Änderung(en) vom Server abgelehnt – fehlende Rechte`);
});

// ---------- Abgleich-Anzeige oben rechts & Service Worker ----------
const badge = document.getElementById('offlineBadge');
badge.addEventListener('click', () => { toast(syncText(Sync.state())); Sync.run(); });
Sync.subscribe(s => {
  const text = !Auth.user() ? (navigator.onLine ? '' : 'offline')
    : s.status === 'offline' ? 'offline' + (s.pending ? ` · ${s.pending}` : '')
    : s.status === 'syncing' ? '⟳'
    : s.status === 'error' ? '⚠ Abgleich'
    : s.pending ? `⟳ ${s.pending}` : s.last ? '✓' : '';
  badge.hidden = !text;
  badge.textContent = text;
  badge.title = syncText(s);
  const info = document.getElementById('syncInfo');
  if (info) info.textContent = syncText(s);
});

Sync.start();
route().then(() => { if (Auth.user()) Sync.run(); });

if ('serviceWorker' in navigator) {
  // Wurde eine neue App-Version installiert, einmal neu laden – aber nicht mitten in einer Ausgabe.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (document.body.classList.contains('kiosk-mode') && (kiosk.person || kiosk.cart.size)) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker nicht registriert:', err));
}
// Browser bitten, die Daten nicht automatisch zu löschen
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
