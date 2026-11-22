// Winterarbeit: Arbeiten an Flugzeugen, Fahrzeugen und Infrastruktur dokumentieren.
// Wer gearbeitet hat, unterschreibt den Eintrag direkt auf dem Gerät (Finger, Stift oder Maus).
// Ein Werkstattleiter / Verantwortlicher kann den Eintrag zusätzlich abzeichnen.
// Rechte: „winterarbeit“ (ansehen, eigene Arbeiten eintragen & unterschreiben),
//         „winterarbeit_verwalten“ (Objekte verwalten, abzeichnen, alle Einträge bearbeiten).
//
// waObject {name, kind: 'flugzeug'|'fahrzeug'|'infrastruktur', ident, note, archived}
// waEntry  {objectId, objectName, objectKind, season, date, worker, hours, work, material,
//           signature (PNG-Data-URL), signedAt, uid,
//           approvedBy, approvedSig, approvedAt}
// Eine Änderung am Eintrag braucht eine neue Unterschrift und hebt die Abzeichnung auf.

const WA_KINDS = {
  flugzeug: { emoji: '✈️', name: 'Flugzeuge', one: 'Flugzeug', ph: 'z. B. ASK 21', identPh: 'z. B. D-1234' },
  fahrzeug: { emoji: '🚜', name: 'Fahrzeuge', one: 'Fahrzeug', ph: 'z. B. Winde, Lepo, Traktor', identPh: 'z. B. R-LS 123' },
  infrastruktur: { emoji: '🏠', name: 'Infrastruktur', one: 'Infrastruktur', ph: 'z. B. Halle, Werkstatt, Vereinsheim', identPh: '' },
};
const waState = { season: '', view: 'objekt', kind: 'all' };
const canManageWa = () => Auth.can('winterarbeit_verwalten');
const waHours = n => (Math.round((n || 0) * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const waDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const waToday = () => dayKey(new Date().toISOString());
// Winter-Saison: Juli bis Juni, z. B. „2026/27“
const waSeasonOf = d => {
  const [y, m] = String(d || waToday()).split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}/${String(start + 1).slice(2)}`;
};
const waObjLabel = o => `${o.name}${o.ident ? ` (${o.ident})` : ''}`;
// eigener, noch nicht abgezeichneter Eintrag – oder Verwalter
const waCanEdit = e => canManageWa() || (Auth.can('winterarbeit') && e.uid === Auth.user()?.uid && !e.approvedAt);

async function loadWa() {
  const [objects, entries] = await Promise.all([DB.all('waObject'), DB.all('waEntry')]);
  objects.sort((a, b) => Object.keys(WA_KINDS).indexOf(a.kind) - Object.keys(WA_KINDS).indexOf(b.kind) || a.name.localeCompare(b.name, 'de'));
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { objects, entries };
}

// ---------- Übersicht ----------
async function renderWinterarbeit() {
  setTitle('Winterarbeit', '#/');
  const { objects, entries } = await loadWa();
  const manage = canManageWa();
  const canWrite = manage || Auth.can('winterarbeit');
  const seasons = [...new Set([waSeasonOf(), ...entries.map(e => e.season)])].filter(Boolean).sort().reverse();
  if (!waState.season || !seasons.includes(waState.season)) waState.season = waSeasonOf();
  if (waState.view === 'objekte' && !manage) waState.view = 'objekt';

  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>❄️ Winterarbeit</h2>
        <select id="waSeason" class="filter" aria-label="Saison">${seasons.map(s =>
          `<option value="${s}" ${s === waState.season ? 'selected' : ''}>Saison ${s}</option>`).join('')}</select>
      </div>
      <div class="action-row">
        ${canWrite ? '<button class="btn primary" id="waNew">＋ Arbeit eintragen</button>' : ''}
        <button class="btn" id="waPrint">🖨 Nachweis drucken</button>
        <button class="btn" id="waCsv">⬇ Excel</button>
      </div>
      <div class="wa-stats" id="waStats"></div>
    </div>
    <nav class="tabs" id="waTabs">
      ${[['objekt', 'Nach Objekt'], ['person', 'Nach Person'], ...(manage ? [['objekte', '⚙️ Objekte verwalten']] : [])].map(([k, l]) =>
        `<a href="#/winterarbeit" data-v="${k}" class="${waState.view === k ? 'active' : ''}">${l}</a>`).join('')}
    </nav>
    <div id="waBody"></div>`;

  const seasonEntries = () => entries.filter(e => e.season === waState.season);
  const kindOk = k => waState.kind === 'all' || waState.kind === k;

  const draw = () => {
    const list = seasonEntries();
    const shown = list.filter(e => kindOk(e.objectKind));
    const open = shown.filter(e => !e.approvedAt).length;
    document.getElementById('waStats').innerHTML = `
      <span><strong>${waHours(shown.reduce((s, e) => s + (e.hours || 0), 0))}</strong> Stunden</span>
      <span><strong>${shown.length}</strong> ${shown.length === 1 ? 'Eintrag' : 'Einträge'}</span>
      <span><strong>${new Set(shown.map(e => norm(e.worker))).size}</strong> Helfer</span>
      <span class="${open ? 'wa-open' : ''}"><strong>${open}</strong> nicht abgezeichnet</span>`;
    const body = document.getElementById('waBody');
    const kindChips = `<div class="chips" id="waKind" style="margin:0 0 12px">
      ${[['all', 'Alle'], ...Object.entries(WA_KINDS).map(([k, v]) => [k, `${v.emoji} ${v.name}`])].map(([k, l]) =>
        `<button class="chip ${waState.kind === k ? 'active' : ''}" data-k="${k}">${l}</button>`).join('')}</div>`;

    if (waState.view === 'objekte') body.innerHTML = objectsHtml(objects, entries);
    else if (waState.view === 'person') body.innerHTML = kindChips + personHtml(shown);
    else body.innerHTML = kindChips + objectViewHtml(objects, shown);

    body.querySelector('#waKind')?.addEventListener('click', ev => {
      const c = ev.target.closest('.chip');
      if (!c) return;
      waState.kind = c.dataset.k;
      draw();
    });
    body.querySelectorAll('[data-entry]').forEach(li => li.addEventListener('click', () =>
      openWaEntry(entries.find(e => e.id === li.dataset.entry), objects)));
    body.querySelectorAll('[data-obj]').forEach(b => b.addEventListener('click', () =>
      openWaObjectForm(objects.find(o => o.id === b.dataset.obj), entries)));
    body.querySelectorAll('[data-newobj]').forEach(b => b.addEventListener('click', () =>
      openWaObjectForm(null, entries, b.dataset.newobj)));
    body.querySelectorAll('[data-addfor]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      openWaEntryForm(null, objects, b.dataset.addfor);
    }));
  };

  document.getElementById('waSeason').addEventListener('change', ev => { waState.season = ev.target.value; draw(); });
  document.getElementById('waTabs').addEventListener('click', ev => {
    const a = ev.target.closest('a[data-v]');
    if (!a) return;
    ev.preventDefault();
    waState.view = a.dataset.v;
    document.querySelectorAll('#waTabs a').forEach(x => x.classList.toggle('active', x === a));
    draw();
  });
  document.getElementById('waNew')?.addEventListener('click', () => openWaEntryForm(null, objects));
  document.getElementById('waPrint').addEventListener('click', () => {
    const list = seasonEntries().filter(e => kindOk(e.objectKind));
    if (!list.length) return toast('Keine Einträge zum Drucken');
    printWa(list, waState.view === 'person' ? 'person' : 'objekt');
  });
  document.getElementById('waCsv').addEventListener('click', () => {
    const list = seasonEntries().filter(e => kindOk(e.objectKind)).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (!list.length) return toast('Keine Einträge vorhanden');
    downloadCsv(`winterarbeit_${waState.season.replace('/', '-')}.csv`,
      ['Datum', 'Bereich', 'Objekt', 'Name', 'Stunden', 'Ausgeführte Arbeiten', 'Material', 'Unterschrieben am', 'Abgezeichnet von', 'Abgezeichnet am'],
      list.map(e => [e.date ? new Date(e.date + 'T12:00').toLocaleDateString('de-DE') : '', WA_KINDS[e.objectKind]?.one || '', e.objectName,
        e.worker, e.hours || 0, e.work, e.material || '', e.signedAt ? new Date(e.signedAt).toLocaleString('de-DE') : '',
        e.approvedBy || '', e.approvedAt ? new Date(e.approvedAt).toLocaleString('de-DE') : '']));
  });
  draw();
}

const waEntryLi = (e, showObj) => `
  <li class="wa-entry" data-entry="${e.id}" role="button" tabindex="0">
    <span class="grow">
      <strong>${esc(e.worker)}</strong> <span class="muted">· ${waDate(e.date)}${showObj ? ` · ${WA_KINDS[e.objectKind]?.emoji || ''} ${esc(e.objectName)}` : ''}</span>
      <span class="wa-work">${esc(e.work)}</span>
      <span class="wa-tags">${e.signature ? '<span class="tag">✍️ unterschrieben</span>' : '<span class="tag warn">ohne Unterschrift</span>'}
        ${e.approvedAt ? `<span class="tag ok">✔ abgezeichnet · ${esc(e.approvedBy)}</span>` : ''}</span>
    </span>
    <span class="num">${waHours(e.hours)} h</span>
  </li>`;

function objectViewHtml(objects, shown) {
  const groups = new Map();
  for (const e of shown) {
    const g = groups.get(e.objectId) || { id: e.objectId, name: e.objectName, kind: e.objectKind, list: [] };
    g.list.push(e);
    groups.set(e.objectId, g);
  }
  // Objekte ohne Einträge (aktiv) ebenfalls zeigen, damit man direkt eintragen kann
  const canWrite = canManageWa() || Auth.can('winterarbeit');
  for (const o of objects) if (!o.archived && !groups.has(o.id) && (waState.kind === 'all' || waState.kind === o.kind))
    groups.set(o.id, { id: o.id, name: o.name, kind: o.kind, list: [] });
  const order = Object.keys(WA_KINDS);
  const list = [...groups.values()].map(g => {
    const o = objects.find(x => x.id === g.id);
    return { ...g, label: o ? waObjLabel(o) : g.name, kind: o?.kind || g.kind };
  }).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (b.list.length > 0) - (a.list.length > 0) || a.label.localeCompare(b.label, 'de'));
  if (!list.length) return `<div class="card"><p class="muted" style="margin:0">${objects.length ? 'Für diese Auswahl gibt es noch keine Einträge.'
    : canManageWa() ? 'Noch keine Objekte angelegt. Lege unter „⚙️ Objekte verwalten“ Flugzeuge, Fahrzeuge und Infrastruktur an.'
    : 'Noch keine Objekte angelegt. Ein Verantwortlicher für die Winterarbeit muss sie erst anlegen.'}</p></div>`;
  return list.map(g => `
    <div class="card">
      <div class="card-head">
        <h2>${WA_KINDS[g.kind]?.emoji || '🔧'} ${esc(g.label)}</h2>
        <span class="muted">${waHours(g.list.reduce((s, e) => s + (e.hours || 0), 0))} h</span>
        ${canWrite && objects.some(o => o.id === g.id && !o.archived) ? `<button class="btn small" data-addfor="${g.id}" aria-label="Arbeit an ${esc(g.label)} eintragen">＋</button>` : ''}
      </div>
      ${g.list.length ? `<ul class="list">${g.list.map(e => waEntryLi(e, false)).join('')}</ul>` : '<p class="muted" style="margin:0">Noch keine Arbeiten eingetragen.</p>'}
    </div>`).join('');
}

function personHtml(shown) {
  const people = new Map();
  for (const e of shown) {
    const k = norm(e.worker);
    const p = people.get(k) || { name: e.worker, hours: 0, list: [] };
    p.hours += e.hours || 0;
    p.list.push(e);
    people.set(k, p);
  }
  const list = [...people.values()].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, 'de'));
  if (!list.length) return '<div class="card"><p class="muted" style="margin:0">Für diese Auswahl gibt es noch keine Einträge.</p></div>';
  return `<div class="card">
      <h2>Stunden pro Person</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th class="num">Einträge</th><th class="num">Stunden</th></tr></thead>
        <tbody>${list.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${p.list.length}</td><td class="num"><strong>${waHours(p.hours)}</strong></td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    ${list.map(p => `<div class="card">
      <div class="card-head"><h2>👤 ${esc(p.name)}</h2><span class="muted">${waHours(p.hours)} h</span></div>
      <ul class="list">${p.list.map(e => waEntryLi(e, true)).join('')}</ul>
    </div>`).join('')}`;
}

function objectsHtml(objects, entries) {
  return Object.entries(WA_KINDS).map(([k, v]) => {
    const list = objects.filter(o => o.kind === k);
    return `<div class="card">
      <div class="card-head"><h2>${v.emoji} ${v.name}</h2><button class="btn small" data-newobj="${k}">＋ ${v.one}</button></div>
      ${list.length ? `<ul class="list">${list.map(o => {
        const n = entries.filter(e => e.objectId === o.id).length;
        return `<li class="wa-obj ${o.archived ? 'archived' : ''}" data-obj="${o.id}" role="button" tabindex="0">
          <span class="grow"><strong>${esc(o.name)}</strong>${o.ident ? ` <span class="muted">· ${esc(o.ident)}</span>` : ''}
            ${o.archived ? ' <span class="tag">archiviert</span>' : ''}
            ${o.note ? `<span class="wa-work">${esc(o.note)}</span>` : ''}</span>
          <span class="muted">${n} ${n === 1 ? 'Eintrag' : 'Einträge'}</span></li>`;
      }).join('')}</ul>` : '<p class="muted" style="margin:0">Noch nichts angelegt.</p>'}
    </div>`;
  }).join('');
}

// ---------- Objekt anlegen / bearbeiten ----------
function openWaObjectForm(o, entries, kind) {
  const isNew = !o;
  const d = o || { name: '', kind: kind || 'flugzeug', ident: '', note: '', archived: false };
  const used = o ? entries.filter(e => e.objectId === o.id).length : 0;
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>${isNew ? 'Neues Objekt' : 'Objekt bearbeiten'}</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <form id="waObjForm" class="ev-form">
      <label for="woKind">Bereich</label>
      <select id="woKind">${Object.entries(WA_KINDS).map(([k, v]) => `<option value="${k}" ${k === d.kind ? 'selected' : ''}>${v.emoji} ${v.one}</option>`).join('')}</select>
      <label for="woName">Bezeichnung</label>
      <input id="woName" required maxlength="60" value="${esc(d.name)}">
      <label for="woIdent">Kennzeichen / Nummer (optional)</label>
      <input id="woIdent" maxlength="30" value="${esc(d.ident || '')}">
      <label for="woNote">Notiz (optional)</label>
      <input id="woNote" maxlength="120" value="${esc(d.note || '')}" placeholder="z. B. Jahresnachprüfung im Februar">
      ${isNew ? '' : `<label class="check" style="margin-top:12px"><input type="checkbox" id="woArchived" ${d.archived ? 'checked' : ''}> archiviert (erscheint nicht mehr bei neuen Einträgen)</label>`}
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${!isNew && !used ? '<button class="btn danger" type="button" id="woDel">Löschen</button>' : ''}
        <span class="grow"></span>
        <button class="btn" type="button" data-close>Abbrechen</button>
        <button class="btn primary" type="submit">${isNew ? 'Anlegen' : 'Speichern'}</button></div>
    </form>`);
  const $ = id => modal.querySelector('#' + id);
  const setPh = () => { const k = WA_KINDS[$('woKind').value]; $('woName').placeholder = k.ph; $('woIdent').placeholder = k.identPh; };
  setPh();
  $('woKind').addEventListener('change', setPh);
  $('woName').focus();
  $('woDel')?.addEventListener('click', async () => {
    if (!confirm(`„${d.name}“ löschen?`)) return;
    await DB.remove(o);
    closeModal();
    toast(`${d.name} gelöscht`);
    renderWinterarbeit();
  });
  $('waObjForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const name = $('woName').value.trim();
    if (!name) { const e = modal.querySelector('.form-error'); e.textContent = 'Bitte eine Bezeichnung eingeben.'; e.hidden = false; return; }
    const rec = await DB.save('waObject', { ...(o || {}), name, kind: $('woKind').value, ident: $('woIdent').value.trim(),
      note: $('woNote').value.trim(), archived: $('woArchived')?.checked || false });
    // Name in bestehenden Einträgen mitziehen, damit Liste und Druck stimmen
    if (o && (o.name !== rec.name || o.kind !== rec.kind)) {
      for (const e of entries.filter(x => x.objectId === o.id)) await DB.save('waEntry', { ...e, objectName: rec.name, objectKind: rec.kind });
    }
    closeModal();
    toast(isNew ? `${name} angelegt` : 'Gespeichert');
    renderWinterarbeit();
  });
}

// ---------- Unterschriftenfeld ----------
// Zeichnet mit Finger, Stift oder Maus. Ergebnis: verkleinertes PNG (transparenter Hintergrund).
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, empty = true, last = null;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10213a';
    empty = true;
    canvas.dispatchEvent(new Event('sigchange'));
  };
  const pos = ev => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  canvas.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    drawing = true;
    last = pos(ev);
    ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = '#10213a'; ctx.fill();
  });
  canvas.addEventListener('pointermove', ev => {
    if (!drawing) return;
    const p = pos(ev);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
    if (empty) { empty = false; canvas.dispatchEvent(new Event('sigchange')); }
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  requestAnimationFrame(fit);
  return {
    isEmpty: () => empty,
    clear: fit,
    // auf die gezeichnete Fläche zuschneiden und auf max. 360 px Breite verkleinern (spart Speicher)
    toDataUrl() {
      const { width: w, height: h } = canvas;
      const data = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) return '';
      const pad = 6;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const scale = Math.min(1, 360 / cw, 140 / ch);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(cw * scale));
      out.height = Math.max(1, Math.round(ch * scale));
      out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}

const sigBox = (id, label) => `
  <div class="sig-wrap">
    <div class="sig-head"><label for="${id}">${label}</label><button type="button" class="btn small" data-sigclear="${id}">Löschen</button></div>
    <canvas id="${id}" class="sig-pad" aria-label="${label}"></canvas>
    <div class="sig-line">✕ hier mit Finger, Stift oder Maus unterschreiben</div>
  </div>`;

// ---------- Arbeit eintragen / bearbeiten ----------
function openWaEntryForm(e, objects, objectId) {
  const isNew = !e;
  const active = objects.filter(o => !o.archived || o.id === e?.objectId);
  if (!active.length) {
    alert(canManageWa() ? 'Bitte zuerst unter „⚙️ Objekte verwalten“ ein Flugzeug, Fahrzeug oder eine Infrastruktur anlegen.'
      : 'Es sind noch keine Objekte angelegt. Bitte einen Verantwortlichen für die Winterarbeit fragen.');
    return;
  }
  const d = e || { objectId: objectId || (waState.lastObj && active.some(o => o.id === waState.lastObj) ? waState.lastObj : ''),
    date: waToday(), worker: Auth.user()?.name || '', hours: '', work: '', material: '' };
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>${isNew ? 'Arbeit eintragen' : 'Eintrag bearbeiten'}</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <form id="waForm" class="ev-form">
      <label for="weObj">Woran wurde gearbeitet?</label>
      <select id="weObj" required>
        <option value="">– bitte wählen –</option>
        ${Object.entries(WA_KINDS).map(([k, v]) => {
          const list = active.filter(o => o.kind === k);
          return list.length ? `<optgroup label="${v.emoji} ${v.name}">${list.map(o =>
            `<option value="${o.id}" ${o.id === d.objectId ? 'selected' : ''}>${esc(waObjLabel(o))}</option>`).join('')}</optgroup>` : '';
        }).join('')}
      </select>
      <div class="row">
        <div><label for="weDate">Datum</label><input id="weDate" type="date" required value="${esc(d.date)}"></div>
        <div class="shrink" style="width:130px"><label for="weHours">Stunden</label>
          <input id="weHours" inputmode="decimal" required placeholder="z. B. 3,5" value="${d.hours ? String(d.hours).replace('.', ',') : ''}"></div>
      </div>
      <label for="weWorker">Name</label>
      <input id="weWorker" required maxlength="60" value="${esc(d.worker)}" autocomplete="off">
      <label for="weWork">Ausgeführte Arbeiten</label>
      <textarea id="weWork" rows="4" maxlength="2000" required placeholder="z. B. Haube poliert, Seitenruder-Lager geprüft und gefettet">${esc(d.work)}</textarea>
      <label for="weMat">Material / Ersatzteile (optional)</label>
      <input id="weMat" maxlength="200" value="${esc(d.material || '')}" placeholder="z. B. 1 l Hydrauliköl, 2 Reifen">
      ${isNew ? '' : '<p class="muted" style="margin:12px 0 0">Nach einer Änderung muss der Eintrag neu unterschrieben werden.' +
        (e.approvedAt ? ' Die Abzeichnung wird dabei aufgehoben.' : '') + '</p>'}
      ${sigBox('weSig', 'Unterschrift')}
      <p class="form-error" hidden></p>
      <div class="modal-actions"><span class="grow"></span>
        <button class="btn" type="button" data-close>Abbrechen</button>
        <button class="btn primary" type="submit">✍️ Unterschreiben &amp; speichern</button></div>
    </form>`);
  modal.classList.add('wide', 'wa-modal');
  const $ = id => modal.querySelector('#' + id);
  const pad = signaturePad($('weSig'));
  modal.querySelector('[data-sigclear]').addEventListener('click', () => pad.clear());
  if (!d.objectId) $('weObj').focus();
  $('waForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = msg => { const x = modal.querySelector('.form-error'); x.textContent = msg; x.hidden = !msg; };
    const obj = objects.find(o => o.id === $('weObj').value);
    const hours = parseFloat($('weHours').value.replace(',', '.'));
    const worker = $('weWorker').value.trim();
    const work = $('weWork').value.trim();
    const date = $('weDate').value;
    if (!obj) return err('Bitte auswählen, woran gearbeitet wurde.');
    if (!date) return err('Bitte ein Datum eingeben.');
    if (!(hours > 0) || hours > 24) return err('Bitte die Stunden eingeben (z. B. 3,5).');
    if (!worker) return err('Bitte den Namen eingeben.');
    if (!work) return err('Bitte beschreiben, was gemacht wurde.');
    if (pad.isEmpty()) return err('Bitte unterschreiben.');
    const now = new Date().toISOString();
    waState.lastObj = obj.id;
    await DB.save('waEntry', { ...(e || {}), objectId: obj.id, objectName: obj.name, objectKind: obj.kind,
      season: waSeasonOf(date), date, hours: Math.round(hours * 100) / 100, worker, work, material: $('weMat').value.trim(),
      signature: pad.toDataUrl(), signedAt: now, uid: e?.uid || Auth.user()?.uid || '',
      approvedBy: '', approvedSig: '', approvedAt: '' });
    waState.season = waSeasonOf(date);
    closeModal();
    toast(isNew ? 'Arbeit eingetragen und unterschrieben' : 'Eintrag gespeichert');
    renderWinterarbeit();
  });
}

// ---------- Eintrag ansehen, abzeichnen ----------
function openWaEntry(e, objects) {
  if (!e) return;
  const obj = objects.find(o => o.id === e.objectId);
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>${WA_KINDS[e.objectKind]?.emoji || '🔧'} ${esc(obj ? waObjLabel(obj) : e.objectName)}</h2>
      <div class="muted">${waDate(e.date)} · Saison ${esc(e.season)}</div></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <dl class="wa-detail">
      <dt>Name</dt><dd>${esc(e.worker)}</dd>
      <dt>Stunden</dt><dd>${waHours(e.hours)} h</dd>
      <dt>Ausgeführte Arbeiten</dt><dd class="wa-pre">${esc(e.work)}</dd>
      ${e.material ? `<dt>Material / Ersatzteile</dt><dd>${esc(e.material)}</dd>` : ''}
    </dl>
    <div class="wa-sigs">
      <div class="wa-sig">
        <div class="sig-img">${e.signature ? `<img src="${e.signature}" alt="Unterschrift ${esc(e.worker)}">` : ''}</div>
        <small>${esc(e.worker)}${e.signedAt ? ` · ${new Date(e.signedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</small>
      </div>
      <div class="wa-sig">
        <div class="sig-img">${e.approvedSig ? `<img src="${e.approvedSig}" alt="Abzeichnung ${esc(e.approvedBy)}">` : '<span class="muted">noch nicht abgezeichnet</span>'}</div>
        <small>${e.approvedAt ? `Abgezeichnet: ${esc(e.approvedBy)} · ${new Date(e.approvedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : 'Abzeichnung (Verantwortlicher)'}</small>
      </div>
    </div>
    <div id="waApprove" hidden>
      ${sigBox('waApSig', `Abzeichnen als ${esc(Auth.user()?.name || '')}`)}
      <p class="form-error" hidden></p>
    </div>
    <p class="muted" style="font-size:13px;margin:12px 0 0">Erfasst von ${esc(e.by || '–')} auf ${esc(e.device || '–')}</p>
    <div class="modal-actions">
      ${waCanEdit(e) ? '<button class="btn danger" id="waDel">Löschen</button>' : ''}
      <span class="grow"></span>
      ${waCanEdit(e) ? '<button class="btn" id="waEdit">✎ Bearbeiten</button>' : ''}
      ${canManageWa() && e.approvedAt ? '<button class="btn" id="waUnapprove">Abzeichnung aufheben</button>' : ''}
      ${canManageWa() && !e.approvedAt ? '<button class="btn primary" id="waApproveBtn">✔ Abzeichnen</button>' : ''}
    </div>`);
  modal.classList.add('wide', 'wa-modal');
  const $ = id => modal.querySelector('#' + id);
  $('waEdit')?.addEventListener('click', () => openWaEntryForm(e, objects));
  $('waDel')?.addEventListener('click', async () => {
    if (!confirm(`Eintrag von ${e.worker} vom ${waDate(e.date)} löschen?`)) return;
    await DB.remove(e);
    closeModal();
    toast('Eintrag gelöscht');
    renderWinterarbeit();
  });
  $('waUnapprove')?.addEventListener('click', async () => {
    if (!confirm('Abzeichnung aufheben?')) return;
    await DB.save('waEntry', { ...e, approvedBy: '', approvedSig: '', approvedAt: '' });
    closeModal();
    toast('Abzeichnung aufgehoben');
    renderWinterarbeit();
  });
  let pad = null;
  $('waApproveBtn')?.addEventListener('click', async ev => {
    if (!pad) {
      $('waApprove').hidden = false;
      pad = signaturePad($('waApSig'));
      modal.querySelector('[data-sigclear]').addEventListener('click', () => pad.clear());
      ev.currentTarget.textContent = '✔ Unterschreiben & abzeichnen';
      $('waApSig').scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (pad.isEmpty()) { const x = $('waApprove').querySelector('.form-error'); x.textContent = 'Bitte unterschreiben.'; x.hidden = false; return; }
    await DB.save('waEntry', { ...e, approvedBy: Auth.user()?.name || '', approvedSig: pad.toDataUrl(), approvedAt: new Date().toISOString() });
    closeModal();
    toast('Eintrag abgezeichnet');
    renderWinterarbeit();
  });
}

// ---------- Druck: Arbeitsnachweis mit Unterschriften ----------
function printWa(list, mode) {
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  const groups = new Map();
  for (const e of list.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const key = mode === 'person' ? norm(e.worker) : e.objectId;
    const title = mode === 'person' ? `👤 ${e.worker}` : `${WA_KINDS[e.objectKind]?.one || ''}: ${e.objectName}`;
    const g = groups.get(key) || { title, kind: e.objectKind, list: [] };
    g.list.push(e);
    groups.set(key, g);
  }
  const order = Object.keys(WA_KINDS);
  const sorted = [...groups.values()].sort((a, b) => mode === 'person' ? a.title.localeCompare(b.title, 'de')
    : order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title, 'de'));
  const sum = l => waHours(l.reduce((s, e) => s + (e.hours || 0), 0));
  const fmt = iso => iso ? new Date(iso).toLocaleDateString('de-DE') : '';
  area.innerHTML = `
    <div class="wa-print">
      <h1>Winterarbeit – Arbeitsnachweis Saison ${esc(waState.season)}</h1>
      <p>${list.length} Einträge · ${sum(list)} Stunden${waState.kind !== 'all' ? ` · nur ${WA_KINDS[waState.kind].name}` : ''}</p>
      ${sorted.map(g => `
        <h2>${esc(g.title)} <span>(${sum(g.list)} h)</span></h2>
        <table>
          <thead><tr><th>Datum</th>${mode === 'person' ? '<th>Objekt</th>' : '<th>Name</th>'}<th class="num">Std.</th><th>Ausgeführte Arbeiten</th><th>Unterschrift</th><th>Abgezeichnet</th></tr></thead>
          <tbody>${g.list.map(e => `<tr>
            <td>${e.date ? new Date(e.date + 'T12:00').toLocaleDateString('de-DE') : ''}</td>
            <td>${esc(mode === 'person' ? e.objectName : e.worker)}</td>
            <td class="num">${waHours(e.hours)}</td>
            <td>${esc(e.work)}${e.material ? `<div class="small">Material: ${esc(e.material)}</div>` : ''}</td>
            <td class="sig">${e.signature ? `<img src="${e.signature}" alt="">` : ''}<div class="small">${fmt(e.signedAt)}</div></td>
            <td class="sig">${e.approvedSig ? `<img src="${e.approvedSig}" alt="">` : ''}<div class="small">${e.approvedAt ? `${esc(e.approvedBy)}, ${fmt(e.approvedAt)}` : ''}</div></td>
          </tr>`).join('')}</tbody>
        </table>`).join('')}
      <p class="small">Erstellt am ${new Date().toLocaleDateString('de-DE')} mit Vereinsorga</p>
    </div>`;
  document.body.classList.add('printing-menu');
  const done = () => { document.body.classList.remove('printing-menu'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Unterschriften-Bilder erst laden lassen
  Promise.all([...area.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))
    .then(() => setTimeout(() => window.print(), 50));
}
