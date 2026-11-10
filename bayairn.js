// BayAirn: Teilnehmerliste (Anmeldung) mit Konto pro Person.
// bayParticipant {name, group, age, func, tshirt, size, note}
// bayBooking {participantId, kind: 'kosten' | 'zahlung', amount, text, date}
// Getränke: Personen in der Getränkevergabe mit participantId gehören zu einem Teilnehmer.
// Ihre Ausgaben erscheinen auf dessen Konto; bezahlt wird über das Konto.
// Recht: „bayairn“.

const BAY_FUNCS = ['Teilnehmer', 'Betreuer', 'Helfer', 'LSJ', 'Orga', 'Leitung', 'Küche'];

// Vor- und Nachname: neue Einträge speichern beides getrennt (name = „Vorname Nachname“ für Suche & Getränke).
// Ältere Einträge mit nur „name“ werden am letzten Leerzeichen aufgeteilt.
function splitName(p) {
  if (p.firstName || p.lastName) return { first: p.firstName || '', last: p.lastName || '' };
  const parts = String(p.name || '').trim().split(/\s+/);
  return parts.length > 1 ? { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] } : { first: parts[0] || '', last: '' };
}
const fullName = (first, last) => `${first.trim()} ${last.trim()}`.trim();
const BAY_SIZES = ['116', '128', '140', '152', '164', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const BAY_QUICK = { kosten: ['Teilnehmerbeitrag', 'T-Shirt', 'Ausflug', 'Sonstiges'], zahlung: ['Überweisung', 'Bar bezahlt', 'Anzahlung'] };
const bayState = { query: '', func: '' };

async function loadBay() {
  const [participants, bookings, persons, entries, payments, events] = await Promise.all([
    DB.all('bayParticipant'), DB.all('bayBooking'), DB.all('person'), DB.all('drinkEntry'), DB.all('payment'), DB.all('drinkEvent')]);
  participants.sort(byName);
  return { participants, bookings, persons, entries, payments, events };
}

const bayEventName = (ctx, id) => !id ? 'Bisherige Daten' : (ctx.events.find(e => e.id === id)?.name || 'Getränke-Event');

// Konto eines Teilnehmers: Buchungen + Getränke (je Event) − in der Getränkevergabe bezahlte Getränke
function bayAccount(p, ctx) {
  const items = [];
  for (const b of ctx.bookings) {
    if (b.participantId !== p.id) continue;
    items.push({ date: b.date || b.createdAt.slice(0, 10), text: b.text || (b.kind === 'zahlung' ? 'Zahlung' : 'Kosten'),
      amount: b.kind === 'zahlung' ? -b.amount : b.amount, kind: b.kind, rec: b });
  }
  const personIds = new Set(ctx.persons.filter(x => x.participantId === p.id).map(x => x.id));
  const byEvent = new Map();
  for (const e of ctx.entries) {
    if (!personIds.has(e.personId)) continue;
    const k = e.eventId || '';
    const g = byEvent.get(k) || { qty: 0, sum: 0, last: '' };
    g.qty += e.qty;
    g.sum += e.qty * (e.price || 0);
    if (e.createdAt > g.last) g.last = e.createdAt;
    byEvent.set(k, g);
  }
  for (const [evId, g] of byEvent) {
    items.push({ date: g.last.slice(0, 10), text: `Getränke – ${bayEventName(ctx, evId)} (${g.qty})`, amount: g.sum, kind: 'getraenke' });
  }
  for (const pay of ctx.payments) {
    if (personIds.has(pay.personId)) {
      items.push({ date: pay.createdAt.slice(0, 10), text: 'Getränke bezahlt (Getränkevergabe)', amount: -pay.sum, kind: 'getraenkezahlung' });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  const saldo = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  return { items, saldo };
}

const saldoText = s => s > 0.004 ? `offen ${euro(s)}` : s < -0.004 ? `Guthaben ${euro(-s)}` : 'ausgeglichen';
const saldoClass = s => s > 0.004 ? 'open' : s < -0.004 ? 'credit' : 'zero';

async function renderBayAirn() {
  setTitle('BayAirn', '#/');
  const ctx = await loadBay();
  const { participants } = ctx;
  const accounts = new Map(participants.map(p => [p.id, bayAccount(p, ctx)]));
  const openSum = [...accounts.values()].reduce((s, a) => s + Math.max(0, a.saldo), 0);
  const funcs = [...new Set([...BAY_FUNCS, ...participants.map(p => p.func).filter(Boolean)])];
  const funcCount = f => participants.filter(p => p.func === f).length;
  const shirts = participants.filter(p => p.tshirt);
  const sizeCounts = BAY_SIZES.map(s => [s, shirts.filter(p => p.size === s).length]).filter(([, n]) => n);
  const noSize = shirts.filter(p => !p.size).length;

  view.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Teilnehmer gesamt</span><strong>${participants.length}</strong></div>
      <div class="kpi"><span>T-Shirts</span><strong>${shirts.length}</strong></div>
      <div class="kpi"><span>Offene Beträge</span><strong>${euro(openSum)}</strong></div>
    </div>
    <div class="card">
      <div class="action-row">
        <button class="btn primary" id="bayNew">＋ Teilnehmer</button>
        <label class="btn" style="margin:0">📄 Excel-Import<input type="file" id="bayFile" hidden
          accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></label>
        <button class="btn" id="bayBulk">💶 Sammelbuchung</button>
        ${Auth.can('einrichtung') ? '<button class="btn" id="bayToDrinks">🥤 In Getränkevergabe übernehmen</button>' : ''}
        <button class="btn" id="bayExport">⬇ Excel-Export</button>
        <span class="grow"></span>
        <button class="btn danger" id="bayReset">Liste zurücksetzen</button>
      </div>
      <p class="muted" style="margin:10px 0 0;font-size:14px">Excel-Spalten: <b>Vorname</b> und <b>Nachname</b> (oder <b>Name</b> mit beidem), optional
        <b>Gruppe</b>, <b>Alter</b>, <b>Funktion</b>, <b>T-Shirt</b> (ja/nein) und <b>Größe</b>.</p>
    </div>
    ${participants.length ? `
    <div class="bay-summary">
      <div class="card"><h2>Nach Funktion</h2>
        <ul class="list">${funcs.filter(funcCount).map(f => `<li><span class="grow">${esc(f)}</span><span class="num">${funcCount(f)}</span></li>`).join('')}
          ${participants.filter(p => !p.func).length ? `<li><span class="grow muted">ohne Funktion</span><span class="num">${participants.filter(p => !p.func).length}</span></li>` : ''}</ul></div>
      <div class="card"><h2>T-Shirts nach Größe</h2>
        ${shirts.length ? `<ul class="list">${sizeCounts.map(([s, n]) => `<li><span class="grow">${s}</span><span class="num">${n}</span></li>`).join('')}
          ${noSize ? `<li><span class="grow muted">Größe fehlt</span><span class="num">${noSize}</span></li>` : ''}</ul>`
          : '<p class="muted" style="margin:0">Noch keine T-Shirts gewünscht.</p>'}</div>
    </div>` : ''}
    <div class="card">
      <div class="card-head"><h2>Teilnehmer (${participants.length})</h2></div>
      <input type="search" id="baySearch" placeholder="🔍 Name oder Gruppe suchen …" autocomplete="off" value="${esc(bayState.query)}">
      <div class="chips" id="bayFuncs">
        <button class="chip ${!bayState.func ? 'active' : ''}" data-f="">Alle</button>
        ${funcs.filter(funcCount).map(f => `<button class="chip ${bayState.func === f ? 'active' : ''}" data-f="${esc(f)}">${esc(f)}</button>`).join('')}
      </div>
      <ul class="list bay-list" id="bayList"></ul>
    </div>`;

  const drawList = () => {
    const q = norm(bayState.query);
    const list = participants.filter(p => (!bayState.func || p.func === bayState.func) && (!q || norm(p.name + ' ' + (p.group || '')).includes(q)));
    document.getElementById('bayList').innerHTML = list.length ? list.map(p => {
      const a = accounts.get(p.id);
      const info = [p.group, p.age ? `${p.age} J.` : '', p.func, p.tshirt ? `👕 ${p.size || '?'}` : ''].filter(Boolean).map(esc).join(' · ');
      return `<li class="bay-item" data-id="${p.id}">
        <span class="avatar">${esc(p.name.trim().charAt(0).toUpperCase() || '?')}</span>
        <span class="grow"><strong>${esc(p.name)}</strong><span class="muted">${info || '—'}</span></span>
        <span class="saldo ${saldoClass(a.saldo)}">${saldoText(a.saldo)}</span>
        <span class="muted">›</span>
      </li>`;
    }).join('') : `<li><span class="muted">${participants.length ? 'Niemand gefunden.' : 'Noch keine Teilnehmer. Leg sie mit „＋ Teilnehmer“ an oder importiere eine Excel-Liste.'}</span></li>`;
    document.querySelectorAll('.bay-item').forEach(li => li.addEventListener('click', () =>
      openBayParticipant(participants.find(p => p.id === li.dataset.id))));
  };
  drawList();

  document.getElementById('baySearch').addEventListener('input', ev => { bayState.query = ev.target.value; drawList(); });
  document.getElementById('bayFuncs').addEventListener('click', ev => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    bayState.func = chip.dataset.f;
    document.querySelectorAll('#bayFuncs .chip').forEach(c => c.classList.toggle('active', c === chip));
    drawList();
  });
  document.getElementById('bayNew').addEventListener('click', () => openBayParticipant(null));
  document.getElementById('bayFile').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const res = await importBayRows(await Sheet.readFile(file, /teilnehm|anmeld|bayairn|liste/i), participants);
      toast(`Import: ${res.added} neu, ${res.skipped} schon vorhanden`);
      if (res.noLast) alert(`${res.noLast} Zeile(n) ohne Nachnamen wurden übersprungen. Bitte in der Liste Vor- und Nachnamen ergänzen und erneut importieren.`);
      renderBayAirn();
    } catch (e) { alert('Import fehlgeschlagen: ' + e.message); }
  });
  document.getElementById('bayBulk').addEventListener('click', () => openBayBulk(participants, funcs));
  document.getElementById('bayToDrinks')?.addEventListener('click', () => openBayToDrinks(ctx));
  document.getElementById('bayExport').addEventListener('click', () => bayExport(ctx, accounts));
  document.getElementById('bayReset').addEventListener('click', () => openBayReset(ctx, accounts));
}

// ---------- Teilnehmer anlegen / bearbeiten, mit Konto ----------
async function openBayParticipant(p) {
  const isNew = !p;
  const ctx = await loadBay();
  const funcs = [...new Set([...BAY_FUNCS, ...ctx.participants.map(x => x.func).filter(Boolean)])];
  const groups = [...new Set(ctx.participants.map(x => x.group).filter(Boolean))].sort();
  const acc = isNew ? null : bayAccount(p, ctx);
  const d = p || { name: '', group: '', age: '', func: 'Teilnehmer', tshirt: false, size: '', note: '' };
  const nm = splitName(d);
  const linked = isNew ? [] : ctx.persons.filter(x => x.participantId === p.id);

  const modal = openModal(`
    <div class="modal-head">
      <div class="grow"><h2>${isNew ? 'Neuer Teilnehmer' : esc(p.name)}</h2>
        ${acc ? `<span class="saldo ${saldoClass(acc.saldo)}">${saldoText(acc.saldo)}</span>` : ''}</div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button>
    </div>
    <form id="bayForm" class="ev-form">
      <div class="row">
        <div><label for="bFirst">Vorname</label><input id="bFirst" required maxlength="40" value="${esc(nm.first)}" autocomplete="off"></div>
        <div><label for="bLast">Nachname</label><input id="bLast" required maxlength="40" value="${esc(nm.last)}" autocomplete="off"></div>
      </div>
      <div class="row">
        <div><label for="bGroup">Gruppe (optional)</label><input id="bGroup" list="bGroups" maxlength="60" value="${esc(d.group || '')}" placeholder="z. B. Rosenheim">
          <datalist id="bGroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
        <div class="shrink" style="width:110px"><label for="bAge">Alter</label><input id="bAge" type="number" min="0" max="120" inputmode="numeric" value="${esc(d.age ?? '')}"></div>
      </div>
      <div class="row">
        <div><label for="bFunc">Funktion</label>
          <select id="bFunc"><option value="">— keine —</option>
            ${funcs.map(f => `<option value="${esc(f)}" ${f === d.func ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
      </div>
      <div class="row" style="align-items:center">
        <div><label class="check" style="margin-top:22px"><input type="checkbox" id="bShirt" ${d.tshirt ? 'checked' : ''}> T-Shirt gewünscht</label></div>
        <div id="bSizeBox"><label for="bSize">Größe</label>
          <select id="bSize"><option value="">— bitte wählen —</option>${BAY_SIZES.map(s => `<option ${s === d.size ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      </div>
      <label for="bNote">Notiz (optional)</label>
      <textarea id="bNote" rows="2" maxlength="500" placeholder="z. B. Allergien, Abholung …">${esc(d.note || '')}</textarea>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${!isNew ? '<button class="btn danger" type="button" id="bDelete">Löschen</button>' : ''}
        <span class="grow"></span>
        <button class="btn" type="button" data-close>Abbrechen</button>
        <button class="btn primary" type="submit">${isNew ? 'Anlegen' : 'Speichern'}</button>
      </div>
    </form>
    ${acc ? `
      <h3 class="sub-title">Konto</h3>
      <div class="table-wrap"><table class="account">
        <thead><tr><th>Datum</th><th>Posten</th><th class="num">Betrag</th></tr></thead>
        <tbody>${acc.items.length ? acc.items.map((i, n) => `
          <tr class="${i.rec ? 'editable' : ''}" data-n="${n}">
            <td>${new Date(i.date + 'T12:00').toLocaleDateString('de-DE')}</td>
            <td>${esc(i.text)}${i.kind === 'getraenke' || i.kind === 'getraenkezahlung' ? ' <span class="muted">· automatisch</span>' : ''}</td>
            <td class="num ${i.amount < 0 ? 'pos' : ''}">${i.amount < 0 ? '− ' + euro(-i.amount) : euro(i.amount)}</td>
          </tr>`).join('') : '<tr><td colspan="3" class="muted">Noch keine Buchungen.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="2"><strong>Saldo</strong></td><td class="num"><strong>${saldoText(acc.saldo)}</strong></td></tr></tfoot>
      </table></div>
      <div class="action-row" style="margin-top:10px">
        <button class="btn" id="bCharge">＋ Kosten buchen</button>
        <button class="btn primary" id="bPay">＋ Zahlung buchen</button>
        ${acc.saldo > 0.004 ? `<button class="btn" id="bPayAll">✓ Alles bezahlt (${euro(acc.saldo)})</button>` : ''}
      </div>
      <p class="muted" style="font-size:14px;margin:8px 0 0">${linked.length
        ? `Verknüpft mit der Getränkevergabe (${linked.map(x => esc(bayEventName(ctx, x.eventId))).join(', ')}) – Getränke erscheinen automatisch.`
        : 'Noch nicht mit der Getränkevergabe verknüpft („In Getränkevergabe übernehmen“).'}</p>` : ''}`, { onClose: renderBayAirn });
  modal.classList.add('wide');

  const $ = id => modal.querySelector('#' + id);
  const toggleSize = () => { $('bSizeBox').style.visibility = $('bShirt').checked ? 'visible' : 'hidden'; };
  $('bShirt').addEventListener('change', toggleSize);
  toggleSize();
  if (isNew) $('bFirst').focus();

  $('bayForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = msg => { const e = modal.querySelector('.form-error'); e.textContent = msg; e.hidden = !msg; };
    const firstName = $('bFirst').value.trim(), lastName = $('bLast').value.trim();
    if (!firstName) return err('Bitte den Vornamen eingeben.');
    if (!lastName) return err('Bitte den Nachnamen eingeben.');
    const name = fullName(firstName, lastName);
    const dup = ctx.participants.find(x => norm(x.name) === norm(name) && x.id !== p?.id);
    if (dup && !confirm(`Es gibt schon „${dup.name}“. Trotzdem speichern?`)) return;
    const ageVal = $('bAge').value.trim();
    const rec = await DB.save('bayParticipant', {
      ...(p || {}), name, firstName, lastName, group: $('bGroup').value.trim(), age: ageVal === '' ? '' : Math.max(0, parseInt(ageVal, 10) || 0),
      func: $('bFunc').value.trim(), tshirt: $('bShirt').checked, size: $('bShirt').checked ? $('bSize').value : '',
      note: $('bNote').value.trim(),
    });
    toast(isNew ? `${name} angelegt` : 'Gespeichert');
    if (isNew) { closeModal(); renderBayAirn(); } else openBayParticipant(rec);
  });
  $('bDelete')?.addEventListener('click', async () => {
    const own = ctx.bookings.filter(b => b.participantId === p.id);
    if (!confirm(`„${p.name}“ mit ${own.length} Kontobuchung(en) löschen?\nVerknüpfte Getränke bleiben in der Getränkevergabe erhalten.`)) return;
    for (const b of own) await DB.remove(b);
    await DB.remove(p);
    closeModal();
    toast(`${p.name} gelöscht`);
    renderBayAirn();
  });
  if (!acc) return;
  $('bCharge').addEventListener('click', () => openBayBooking(p, 'kosten'));
  $('bPay').addEventListener('click', () => openBayBooking(p, 'zahlung'));
  $('bPayAll')?.addEventListener('click', () => openBayBooking(p, 'zahlung', null, acc.saldo));
  modal.querySelectorAll('tr.editable').forEach(tr => tr.addEventListener('click', () => {
    const item = acc.items[+tr.dataset.n];
    openBayBooking(p, item.rec.kind, item.rec);
  }));
}

// Buchung anlegen oder bearbeiten
function openBayBooking(p, kind, rec, presetAmount) {
  const isNew = !rec;
  const today = new Date().toISOString().slice(0, 10);
  const modal = openModal(`
    <div class="modal-head">
      <button class="icon-btn back" id="bkBack" aria-label="Zurück">←</button>
      <div class="grow"><h2>${isNew ? (kind === 'zahlung' ? 'Zahlung buchen' : 'Kosten buchen') : 'Buchung bearbeiten'}</h2>
        <span class="muted">${esc(p.name)}</span></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button>
    </div>
    <form id="bkForm" class="ev-form">
      <div class="seg" role="radiogroup" aria-label="Art">
        <label><input type="radio" name="kind" value="kosten" ${kind !== 'zahlung' ? 'checked' : ''}><span>Kosten</span></label>
        <label><input type="radio" name="kind" value="zahlung" ${kind === 'zahlung' ? 'checked' : ''}><span>Zahlung eingegangen</span></label>
      </div>
      <div class="row">
        <div class="shrink" style="width:150px"><label for="bkAmount">Betrag in €</label>
          <input id="bkAmount" inputmode="decimal" required value="${rec ? priceInput(rec.amount) : presetAmount ? priceInput(presetAmount) : ''}"></div>
        <div><label for="bkDate">Datum</label><input id="bkDate" type="date" required value="${rec?.date || today}"></div>
      </div>
      <label for="bkText">Text</label>
      <input id="bkText" maxlength="80" value="${esc(rec?.text || (presetAmount ? 'Restbetrag bezahlt' : ''))}" placeholder="z. B. Teilnehmerbeitrag">
      <div class="chips" id="bkQuick"></div>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${!isNew ? '<button class="btn danger" type="button" id="bkDelete">Löschen</button>' : ''}
        <span class="grow"></span>
        <button class="btn primary" type="submit">${isNew ? 'Buchen' : 'Speichern'}</button>
      </div>
    </form>`, { onClose: renderBayAirn });
  const $ = id => modal.querySelector('#' + id);
  const back = () => openBayParticipant(p);
  $('bkBack').addEventListener('click', back);
  const drawQuick = () => {
    const k = modal.querySelector('[name=kind]:checked').value;
    $('bkQuick').innerHTML = BAY_QUICK[k].map(t => `<button type="button" class="chip">${t}</button>`).join('');
  };
  drawQuick();
  modal.querySelectorAll('[name=kind]').forEach(r => r.addEventListener('change', drawQuick));
  $('bkQuick').addEventListener('click', ev => { const c = ev.target.closest('.chip'); if (c) $('bkText').value = c.textContent; });
  $('bkAmount').focus();

  $('bkForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const amount = parsePrice($('bkAmount').value);
    if (!(amount > 0)) { const e = modal.querySelector('.form-error'); e.textContent = 'Bitte einen Betrag größer als 0 eingeben.'; e.hidden = false; return; }
    const k = modal.querySelector('[name=kind]:checked').value;
    await DB.save('bayBooking', { ...(rec || {}), participantId: p.id, kind: k, amount, text: $('bkText').value.trim(), date: $('bkDate').value });
    toast(k === 'zahlung' ? `Zahlung ${euro(amount)} gebucht` : `${euro(amount)} gebucht`);
    back();
  });
  $('bkDelete')?.addEventListener('click', async () => {
    if (!confirm('Diese Buchung löschen?')) return;
    await DB.remove(rec);
    toast('Buchung gelöscht');
    back();
  });
}

// Sammelbuchung: gleiche Buchung für viele Teilnehmer
function openBayBulk(participants, funcs) {
  const today = new Date().toISOString().slice(0, 10);
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>Sammelbuchung</h2>
      <span class="muted">Eine Buchung für mehrere Teilnehmer auf einmal</span></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <form id="blkForm" class="ev-form">
      <div class="seg" role="radiogroup" aria-label="Art">
        <label><input type="radio" name="kind" value="kosten" checked><span>Kosten</span></label>
        <label><input type="radio" name="kind" value="zahlung"><span>Zahlung</span></label>
      </div>
      <div class="row">
        <div class="shrink" style="width:150px"><label for="blkAmount">Betrag in €</label><input id="blkAmount" inputmode="decimal" required></div>
        <div><label for="blkDate">Datum</label><input id="blkDate" type="date" required value="${today}"></div>
      </div>
      <label for="blkText">Text</label>
      <input id="blkText" maxlength="80" required placeholder="z. B. Teilnehmerbeitrag">
      <div class="chips" id="blkQuick">${BAY_QUICK.kosten.map(t => `<button type="button" class="chip">${t}</button>`).join('')}</div>
      <label for="blkWho">Für wen?</label>
      <select id="blkWho">
        <option value="all">Alle Teilnehmer</option>
        <option value="shirt">Alle mit T-Shirt</option>
        ${funcs.map(f => `<option value="f:${esc(f)}">Funktion: ${esc(f)}</option>`).join('')}
      </select>
      <p id="blkCount" class="muted" style="margin:8px 0 0"></p>
      <p class="form-error" hidden></p>
      <div class="modal-actions"><span class="grow"></span>
        <button class="btn" type="button" data-close>Abbrechen</button>
        <button class="btn primary" type="submit">Buchen</button></div>
    </form>`);
  const $ = id => modal.querySelector('#' + id);
  const targets = () => {
    const w = $('blkWho').value;
    return participants.filter(p => w === 'all' || (w === 'shirt' && p.tshirt) || (w.startsWith('f:') && p.func === w.slice(2)));
  };
  const showCount = () => { const n = targets().length; $('blkCount').textContent = `Betrifft ${n} ${n === 1 ? 'Person' : 'Personen'}.`; };
  $('blkWho').addEventListener('change', showCount);
  showCount();
  $('blkQuick').addEventListener('click', ev => {
    const c = ev.target.closest('.chip');
    if (!c) return;
    $('blkText').value = c.textContent;
    if (c.textContent === 'T-Shirt') { $('blkWho').value = 'shirt'; showCount(); }
  });
  $('blkForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = msg => { const e = modal.querySelector('.form-error'); e.textContent = msg; e.hidden = !msg; };
    const amount = parsePrice($('blkAmount').value);
    const list = targets();
    if (!(amount > 0)) return err('Bitte einen Betrag größer als 0 eingeben.');
    if (!list.length) return err('Niemand ausgewählt.');
    const kind = modal.querySelector('[name=kind]:checked').value;
    const text = $('blkText').value.trim();
    if (!confirm(`„${text}“ über ${euro(amount)} für ${list.length} Personen buchen?`)) return;
    for (const p of list) await DB.save('bayBooking', { participantId: p.id, kind, amount, text, date: $('blkDate').value });
    closeModal();
    toast(`${list.length} Buchungen angelegt`);
    renderBayAirn();
  });
}

// Excel-Import der Teilnehmerliste
async function importBayRows(rows, existing) {
  rows = rows.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(Boolean));
  if (!rows.length) throw new Error('Die Liste ist leer.');
  const head = rows[0].map(norm);
  const find = re => head.findIndex(h => re.test(h));
  const iVor = find(/vorname/), iNach = find(/nachname|familienname|zuname/);
  let iName = head.findIndex((h, i) => i !== iVor && i !== iNach && /^(name|teilnehmer|person|vollständiger name)/.test(h));
  const iGroup = find(/gruppe|ort|verein|team/), iAge = find(/alter|age/), iFunc = find(/funktion|rolle/);
  const iShirt = find(/t-?shirt|shirt/), iSize = find(/größe|groesse|grösse|size/);
  const hasHeader = [iVor, iNach, iName, iGroup, iAge, iFunc, iShirt, iSize].some(i => i >= 0);
  if (!hasHeader) iName = 0;
  else if (iName < 0 && iVor < 0 && iNach < 0) iName = 0;
  const yes = v => /^(ja|j|x|yes|y|1|true|wahr)$/i.test(String(v || '').trim());
  const known = new Set(existing.map(p => norm(p.name)));
  let added = 0, skipped = 0, noLast = 0;
  for (const r of hasHeader ? rows.slice(1) : rows) {
    // Vor- und Nachname getrennt; steht nur „Name“ in der Liste, wird am letzten Leerzeichen geteilt
    let first = '', last = '';
    if (iVor >= 0 || iNach >= 0) {
      first = iVor >= 0 ? (r[iVor] || '') : '';
      last = iNach >= 0 ? (r[iNach] || '') : '';
      if (!last && first) ({ first, last } = splitName({ name: first }));
    } else ({ first, last } = splitName({ name: r[iName] || '' }));
    if (!first && !last) continue;
    if (!first || !last) { noLast++; continue; }
    const name = fullName(first, last);
    if (known.has(norm(name))) { skipped++; continue; }
    let size = iSize >= 0 ? (r[iSize] || '').toUpperCase().replace(/\s/g, '') : '';
    if (size && !BAY_SIZES.includes(size)) size = BAY_SIZES.find(s => s === size.replace(/^GR\.?/, '')) || size;
    const tshirt = iShirt >= 0 ? yes(r[iShirt]) || (!!size && !/^(nein|n|no|0)$/i.test(r[iShirt] || '')) : !!size;
    const age = iAge >= 0 && r[iAge] !== '' ? parseInt(r[iAge], 10) : '';
    await DB.save('bayParticipant', { name, firstName: first, lastName: last, group: iGroup >= 0 ? r[iGroup] || '' : '', age: Number.isNaN(age) ? '' : age,
      func: iFunc >= 0 ? r[iFunc] || '' : 'Teilnehmer', tshirt, size: tshirt ? size : '', note: '' });
    known.add(norm(name));
    added++;
  }
  return { added, skipped, noLast };
}

// Teilnehmer als Personen in ein Getränke-Event übernehmen (und verknüpfen)
function openBayToDrinks(ctx) {
  const events = ctx.events.filter(e => !e.archived).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>In Getränkevergabe übernehmen</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    ${events.length ? `
      <p>Alle ${ctx.participants.length} Teilnehmer werden im gewählten Getränke-Event als Personen angelegt und mit ihrem Konto verknüpft.
      Wer dort schon (mit gleichem Namen) steht, wird nur verknüpft.</p>
      <label for="tdEvent">Getränke-Event</label>
      <select id="tdEvent">${events.map(e => `<option value="${e.id}" ${e.id === currentEventId() ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      <div class="modal-actions"><span class="grow"></span>
        <button class="btn" data-close>Abbrechen</button>
        <button class="btn primary" id="tdGo">Übernehmen</button></div>`
      : `<p>Es gibt noch kein Getränke-Event. Lege zuerst in der Getränkevergabe ein Event an.</p>
        <div class="modal-actions"><span class="grow"></span><a class="btn primary" href="#/getraenke">Zur Getränkevergabe</a></div>`}`);
  modal.querySelector('#tdGo')?.addEventListener('click', async ev => {
    ev.currentTarget.disabled = true;
    const evId = modal.querySelector('#tdEvent').value;
    const persons = ctx.persons.filter(x => x.eventId === evId);
    let added = 0, linked = 0, already = 0;
    for (const p of ctx.participants) {
      if (persons.some(x => x.participantId === p.id)) { already++; continue; }
      const same = persons.find(x => !x.participantId && norm(x.name) === norm(p.name));
      if (same) { await DB.save('person', { ...same, participantId: p.id }); linked++; }
      else { await DB.save('person', { name: p.name, group: p.group || '', participantId: p.id, eventId: evId }); added++; }
    }
    closeModal();
    toast(`${added} angelegt, ${linked} verknüpft${already ? `, ${already} waren schon da` : ''}`);
    renderBayAirn();
  });
}

function bayExport(ctx, accounts) {
  downloadCsv('bayairn_teilnehmer.csv', ['Vorname', 'Nachname', 'Gruppe', 'Alter', 'Funktion', 'T-Shirt', 'Größe', 'Saldo € (offen +)', 'Notiz'],
    ctx.participants.map(p => [splitName(p).first, splitName(p).last, p.group || '', p.age === '' || p.age == null ? '' : Number(p.age), p.func || '',
      p.tshirt ? 'ja' : 'nein', p.size || '', accounts.get(p.id).saldo, p.note || '']));
}

// Liste zurücksetzen – nur mit Bestätigung durch Eintippen
function openBayReset(ctx, accounts) {
  const word = 'ZURÜCKSETZEN';
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>Liste zurücksetzen</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <p>Damit werden <strong>alle ${ctx.participants.length} Teilnehmer</strong> und <strong>${ctx.bookings.length} Kontobuchungen</strong>
    gelöscht – auf allen Geräten. Die Getränkevergabe bleibt unverändert.</p>
    <p>Lade vorher am besten den Excel-Export herunter.</p>
    <button class="btn" id="rsExport">⬇ Excel-Export herunterladen</button>
    <label for="rsWord" style="margin-top:14px">Zum Bestätigen <b>${word}</b> eintippen</label>
    <input id="rsWord" autocomplete="off">
    <div class="modal-actions"><span class="grow"></span>
      <button class="btn" data-close>Abbrechen</button>
      <button class="btn danger" id="rsGo" disabled>Endgültig zurücksetzen</button></div>`);
  const input = modal.querySelector('#rsWord');
  input.addEventListener('input', () => { modal.querySelector('#rsGo').disabled = input.value.trim().toUpperCase() !== word; });
  modal.querySelector('#rsExport').addEventListener('click', () => bayExport(ctx, accounts));
  modal.querySelector('#rsGo').addEventListener('click', async ev => {
    ev.currentTarget.disabled = true;
    for (const b of ctx.bookings) await DB.remove(b);
    for (const p of ctx.participants) await DB.remove(p);
    closeModal();
    toast('Teilnehmerliste zurückgesetzt');
    renderBayAirn();
  });
}
