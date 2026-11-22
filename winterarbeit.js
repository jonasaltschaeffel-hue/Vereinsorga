// Winterarbeit: Aufgabenlisten für Flugzeuge, Fahrzeuge und Infrastruktur.
// Verantwortliche schreiben Aufgaben auf, die erledigt werden müssen. Wer eine Aufgabe erledigt hat,
// hakt sie ab: Name, Stunden, Bemerkung und Unterschrift direkt auf dem Gerät.
// Ein Verantwortlicher kann erledigte Aufgaben anschließend prüfen (abzeichnen).
// Rechte: „winterarbeit“ (ansehen, Aufgaben abhaken & unterschreiben),
//         „winterarbeit_verwalten“ (Objekte & Aufgaben anlegen, prüfen, alles bearbeiten).
//
// waObject {name, kind: 'flugzeug'|'fahrzeug'|'infrastruktur', ident, note, archived}
// waTask   {objectId, objectName, objectKind, season, title, details, important, order,
//           status: 'offen'|'erledigt', workers, hours (je Person), doneNote, signature, doneAt, doneUid,
//           approvedBy, approvedSig, approvedAt}

const WA_KINDS = {
  flugzeug: { emoji: '✈️', name: 'Flugzeuge', one: 'Flugzeug', ph: 'z. B. ASK 21', identPh: 'z. B. D-1234',
    ideas: ['Jahresnachprüfung vorbereiten', 'Rumpf und Flächen reinigen & polieren', 'Haube reinigen & polieren', 'Ruderanschlüsse prüfen & schmieren',
      'Reifen und Bremse prüfen', 'Batterien prüfen & laden', 'Instrumente und Funk prüfen', 'Anhänger prüfen'] },
  fahrzeug: { emoji: '🚜', name: 'Fahrzeuge', one: 'Fahrzeug', ph: 'z. B. Winde, Lepo, Traktor', identPh: 'z. B. R-LS 123',
    ideas: ['Ölwechsel', 'Reifen und Luftdruck prüfen', 'Batterie prüfen', 'Seil prüfen / spleißen', 'Frostschutz prüfen', 'Fahrzeug reinigen', 'TÜV-Termin vereinbaren'] },
  infrastruktur: { emoji: '🏠', name: 'Infrastruktur', one: 'Infrastruktur', ph: 'z. B. Halle, Werkstatt, Vereinsheim', identPh: '',
    ideas: ['Halle aufräumen', 'Werkstatt aufräumen', 'Vereinsheim putzen', 'Heizung prüfen', 'Rasenmäher warten', 'Platzmarkierungen erneuern'] },
};
const WA_ORDER = Object.keys(WA_KINDS);
const waState = { season: '', kind: 'all', tab: 'objekte', filter: 'offen' };
const canManageWa = () => Auth.can('winterarbeit_verwalten');
const canTickWa = () => canManageWa() || Auth.can('winterarbeit');
const waHours = n => (Math.round((n || 0) * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const waDay = iso => iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const waToday = () => dayKey(new Date().toISOString());
// Winter-Saison: Juli bis Juni, z. B. „2026/27“
const waSeasonOf = d => {
  const [y, m] = String(d || waToday()).slice(0, 10).split('-').map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}/${String(start + 1).slice(2)}`;
};
const waObjLabel = o => `${o.name}${o.ident ? ` · ${o.ident}` : ''}`;
const waWorkers = t => String(t.workers || '').split(/\s*(?:,|;|\bund\b|&|\+)\s*/i).map(s => s.trim()).filter(Boolean);
const waTaskHours = t => (t.hours || 0) * Math.max(1, waWorkers(t).length);
// Helfer dürfen eigene Häkchen zurücknehmen, solange die Aufgabe nicht geprüft ist
const waCanUntick = t => canManageWa() || (Auth.can('winterarbeit') && t.doneUid === Auth.user()?.uid && !t.approvedAt);

async function loadWa() {
  const [objects, tasks] = await Promise.all([DB.all('waObject'), DB.all('waTask')]);
  objects.sort((a, b) => WA_ORDER.indexOf(a.kind) - WA_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, 'de'));
  tasks.sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  return { objects, tasks };
}

// Aufgaben der gewählten Saison – in der aktuellen Saison auch noch offene aus früheren Saisons
function waSeasonTasks(tasks) {
  const cur = waSeasonOf();
  return tasks.filter(t => t.season === waState.season || (waState.season === cur && t.status !== 'erledigt' && t.season < cur));
}
function waSeasons(tasks) {
  const list = [...new Set([waSeasonOf(), ...tasks.map(t => t.season)])].filter(Boolean).sort().reverse();
  if (!waState.season || !list.includes(waState.season)) waState.season = waSeasonOf();
  return list;
}

const waProgress = (done, total) => `
  <div class="wa-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}">
    <span style="width:${total ? Math.round(done / total * 100) : 0}%"></span>
  </div>`;

// ---------- Übersicht ----------
async function renderWinterarbeit() {
  setTitle('Winterarbeit', '#/');
  const { objects, tasks } = await loadWa();
  const manage = canManageWa();
  const seasons = waSeasons(tasks);
  if (waState.tab === 'verwalten' && !manage) waState.tab = 'objekte';

  view.innerHTML = `
    <section class="wa-hero">
      <div class="wa-hero-top">
        <div class="grow">
          <div class="wa-hero-kicker">❄️ Winterarbeit</div>
          <h2 id="waHeroTitle"></h2>
        </div>
        <select id="waSeason" aria-label="Saison">${seasons.map(s => `<option value="${s}" ${s === waState.season ? 'selected' : ''}>Saison ${s}</option>`).join('')}</select>
      </div>
      <div id="waHeroStats"></div>
      <div class="wa-hero-actions">
        <button class="btn" id="waPrint">🖨 Aufgabenliste drucken</button>
        <button class="btn" id="waCsv">⬇ Excel</button>
      </div>
    </section>
    <nav class="tabs" id="waTabs">
      ${[['objekte', '📋 Aufgaben'], ['helfer', '👥 Helfer'], ...(manage ? [['verwalten', '⚙️ Objekte verwalten']] : [])].map(([k, l]) =>
        `<a href="#/winterarbeit" data-v="${k}" class="${waState.tab === k ? 'active' : ''}">${l}</a>`).join('')}
    </nav>
    <div id="waBody"></div>`;

  const draw = () => {
    const all = waSeasonTasks(tasks);
    const shown = all.filter(t => waState.kind === 'all' || t.objectKind === waState.kind);
    const done = shown.filter(t => t.status === 'erledigt');
    const toCheck = done.filter(t => !t.approvedAt).length;
    document.getElementById('waHeroTitle').textContent = shown.length
      ? (done.length === shown.length ? 'Alles erledigt – super! 🎉' : `${shown.length - done.length} ${shown.length - done.length === 1 ? 'Aufgabe' : 'Aufgaben'} offen`)
      : 'Noch keine Aufgaben';
    document.getElementById('waHeroStats').innerHTML = `
      ${waProgress(done.length, shown.length)}
      <div class="wa-hero-stats">
        <span><strong>${done.length}</strong> von ${shown.length} erledigt</span>
        <span><strong>${waHours(done.reduce((s, t) => s + waTaskHours(t), 0))}</strong> Stunden</span>
        <span><strong>${new Set(done.flatMap(t => waWorkers(t).map(norm))).size}</strong> Helfer</span>
        ${manage ? `<span class="${toCheck ? 'wa-attn' : ''}"><strong>${toCheck}</strong> zu prüfen</span>` : ''}
      </div>`;
    const kindChips = `<div class="chips wa-kinds" id="waKind">
      ${[['all', 'Alle'], ...Object.entries(WA_KINDS).map(([k, v]) => [k, `${v.emoji} ${v.name}`])].map(([k, l]) =>
        `<button class="chip ${waState.kind === k ? 'active' : ''}" data-k="${k}">${l}</button>`).join('')}</div>`;
    const body = document.getElementById('waBody');
    if (waState.tab === 'verwalten') body.innerHTML = waManageHtml(objects, tasks);
    else if (waState.tab === 'helfer') body.innerHTML = kindChips + waHelperHtml(done);
    else body.innerHTML = kindChips + waObjectGridHtml(objects, shown);

    body.querySelector('#waKind')?.addEventListener('click', ev => {
      const c = ev.target.closest('.chip');
      if (!c) return;
      waState.kind = c.dataset.k;
      draw();
    });
    body.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => { location.hash = '#/winterarbeit/' + el.dataset.open; }));
    body.querySelectorAll('[data-obj]').forEach(el => el.addEventListener('click', () => openWaObjectForm(objects.find(o => o.id === el.dataset.obj), tasks)));
    body.querySelectorAll('[data-newobj]').forEach(el => el.addEventListener('click', () => openWaObjectForm(null, tasks, el.dataset.newobj)));
    body.querySelectorAll('[data-task]').forEach(el => el.addEventListener('click', () => openWaTask(tasks.find(t => t.id === el.dataset.task))));
  };

  document.getElementById('waSeason').addEventListener('change', ev => { waState.season = ev.target.value; draw(); });
  document.getElementById('waTabs').addEventListener('click', ev => {
    const a = ev.target.closest('a[data-v]');
    if (!a) return;
    ev.preventDefault();
    waState.tab = a.dataset.v;
    document.querySelectorAll('#waTabs a').forEach(x => x.classList.toggle('active', x === a));
    draw();
  });
  const current = () => waSeasonTasks(tasks).filter(t => waState.kind === 'all' || t.objectKind === waState.kind);
  document.getElementById('waPrint').addEventListener('click', () => {
    const list = current();
    if (!list.length) return toast('Keine Aufgaben zum Drucken');
    printWa(list, objects, waState.kind !== 'all' ? WA_KINDS[waState.kind].name : '');
  });
  document.getElementById('waCsv').addEventListener('click', () => {
    const list = current();
    if (!list.length) return toast('Keine Aufgaben vorhanden');
    waCsv(list);
  });
  draw();
}

function waObjectGridHtml(objects, shown) {
  const manage = canManageWa();
  const list = objects.filter(o => (waState.kind === 'all' || o.kind === waState.kind) && (!o.archived || shown.some(t => t.objectId === o.id)));
  if (!list.length) return `<div class="wa-empty">
      <div class="wa-empty-icon">🛠️</div>
      <strong>${objects.length ? 'Hier gibt es nichts.' : 'Noch keine Flugzeuge, Fahrzeuge oder Infrastruktur angelegt'}</strong>
      <p class="muted">${manage ? 'Lege unter „⚙️ Objekte verwalten“ an, woran im Winter gearbeitet wird – danach kannst du Aufgaben dazuschreiben.'
        : 'Ein Verantwortlicher für die Winterarbeit muss sie erst anlegen.'}</p>
      ${manage && !objects.length ? '<button class="btn primary" data-newobj="flugzeug">＋ Erstes Objekt anlegen</button>' : ''}
    </div>`;
  const recent = shown.filter(t => t.status === 'erledigt').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 5);
  return `<div class="wa-grid">${list.map(o => {
      const ts = shown.filter(t => t.objectId === o.id);
      const done = ts.filter(t => t.status === 'erledigt').length;
      const open = ts.length - done;
      const important = ts.filter(t => t.status !== 'erledigt' && t.important).length;
      return `<button class="wa-obj-card kind-${o.kind}" data-open="${o.id}">
        <span class="wa-obj-icon">${WA_KINDS[o.kind]?.emoji || '🔧'}</span>
        <span class="wa-obj-name"><strong>${esc(o.name)}</strong>${o.ident ? `<small>${esc(o.ident)}</small>` : ''}</span>
        ${waProgress(done, ts.length)}
        <span class="wa-obj-foot">
          ${ts.length ? (open ? `<span><b>${open}</b> offen</span>` : '<span class="wa-alldone">✔ alles erledigt</span>') : '<span class="muted">keine Aufgaben</span>'}
          ${done && open ? `<span class="muted">${done} erledigt</span>` : ''}
          ${important ? `<span class="wa-imp-badge">❗ ${important} wichtig</span>` : ''}
          ${o.archived ? '<span class="tag">archiviert</span>' : ''}
        </span>
      </button>`;
    }).join('')}</div>
    ${recent.length ? `<div class="card wa-recent">
      <h2>Zuletzt erledigt</h2>
      <ul class="list">${recent.map(t => `<li data-task="${t.id}" role="button" tabindex="0">
        <span class="wa-check-done">✓</span>
        <span class="grow"><strong>${esc(t.title)}</strong>
          <small class="muted">${WA_KINDS[t.objectKind]?.emoji || ''} ${esc(t.objectName)} · ${esc(t.workers)} · ${waDay(t.doneAt)}</small></span>
        ${t.approvedAt ? '<span class="tag ok">geprüft</span>' : ''}
      </li>`).join('')}</ul>
    </div>` : ''}`;
}

function waHelperHtml(done) {
  const people = new Map();
  for (const t of done) for (const w of waWorkers(t)) {
    const p = people.get(norm(w)) || { name: w, hours: 0, n: 0 };
    p.hours += t.hours || 0;
    p.n++;
    people.set(norm(w), p);
  }
  const list = [...people.values()].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, 'de'));
  if (!list.length) return '<div class="wa-empty"><div class="wa-empty-icon">👥</div><strong>Noch keine erledigten Aufgaben</strong><p class="muted">Sobald Aufgaben abgehakt werden, erscheinen hier die Helfer und ihre Stunden.</p></div>';
  const max = Math.max(...list.map(p => p.hours), 1);
  return `<div class="card">
    <h2>Stunden pro Helfer</h2>
    <ul class="list wa-helpers">${list.map((p, i) => `<li>
      <span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>
      <span class="grow"><strong>${esc(p.name)}</strong>${i === 0 && list.length > 1 ? ' 🏆' : ''}
        <span class="wa-bar"><span style="width:${Math.round(p.hours / max * 100)}%"></span></span>
        <small class="muted">${p.n} ${p.n === 1 ? 'Aufgabe' : 'Aufgaben'}</small></span>
      <span class="num">${waHours(p.hours)} h</span></li>`).join('')}</ul>
  </div>`;
}

function waManageHtml(objects, tasks) {
  return Object.entries(WA_KINDS).map(([k, v]) => {
    const list = objects.filter(o => o.kind === k);
    return `<div class="card">
      <div class="card-head"><h2>${v.emoji} ${v.name}</h2><button class="btn small" data-newobj="${k}">＋ ${v.one}</button></div>
      ${list.length ? `<ul class="list">${list.map(o => {
        const n = tasks.filter(t => t.objectId === o.id).length;
        return `<li class="wa-row ${o.archived ? 'archived' : ''}" data-obj="${o.id}" role="button" tabindex="0">
          <span class="grow"><strong>${esc(o.name)}</strong>${o.ident ? ` <span class="muted">· ${esc(o.ident)}</span>` : ''}
            ${o.archived ? ' <span class="tag">archiviert</span>' : ''}
            ${o.note ? `<small class="muted" style="display:block">${esc(o.note)}</small>` : ''}</span>
          <span class="muted">${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'}</span><span class="muted">✎</span></li>`;
      }).join('')}</ul>` : '<p class="muted" style="margin:0">Noch nichts angelegt.</p>'}
    </div>`;
  }).join('');
}

// ---------- Seite eines Objekts: Aufgabenliste ----------
async function renderWaObject(id) {
  setTitle('Winterarbeit', '#/winterarbeit');
  const { objects, tasks } = await loadWa();
  waSeasons(tasks);
  const o = objects.find(x => x.id === id);
  if (!o) {
    view.innerHTML = '<div class="card"><p>Dieses Objekt gibt es nicht mehr.</p><a class="btn" href="#/winterarbeit">Zur Übersicht</a></div>';
    return;
  }
  const manage = canManageWa();
  const k = WA_KINDS[o.kind] || WA_KINDS.flugzeug;
  const mine = waSeasonTasks(tasks).filter(t => t.objectId === o.id);
  const open = mine.filter(t => t.status !== 'erledigt');
  const done = mine.filter(t => t.status === 'erledigt').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const ideas = k.ideas.filter(i => !mine.some(t => norm(t.title) === norm(i)));

  view.innerHTML = `
    <section class="wa-obj-head kind-${o.kind}">
      <span class="wa-obj-icon big">${k.emoji}</span>
      <div class="grow">
        <div class="wa-hero-kicker">${k.one} · Saison ${esc(waState.season)}</div>
        <h2>${esc(o.name)}${o.ident ? ` <small>${esc(o.ident)}</small>` : ''}</h2>
        ${o.note ? `<p class="muted" style="margin:2px 0 0">${esc(o.note)}</p>` : ''}
      </div>
      <button class="btn small" id="waPrintObj">🖨 Drucken</button>
    </section>
    <div class="wa-obj-progress">
      ${waProgress(done.length, mine.length)}
      <span class="muted">${done.length} von ${mine.length} erledigt · ${waHours(done.reduce((s, t) => s + waTaskHours(t), 0))} Std.</span>
    </div>
    ${manage && !o.archived ? `
      <form class="wa-add" id="waAdd">
        <input id="waAddTitle" placeholder="Neue Aufgabe für ${esc(o.name)} …" maxlength="120" autocomplete="off">
        <label class="wa-imp-toggle" title="Als wichtig markieren"><input type="checkbox" id="waAddImp">❗ wichtig</label>
        <button class="btn primary" type="submit">Hinzufügen</button>
      </form>
      <div class="wa-add-more"><button class="btn small" id="waAddMany" type="button">📋 Mehrere auf einmal</button></div>
      ${ideas.length && mine.length < 3 ? `<div class="wa-ideas"><span class="muted">Vorschläge:</span>
        ${ideas.map(i => `<button class="chip" data-idea="${esc(i)}">＋ ${esc(i)}</button>`).join('')}</div>` : ''}` : ''}
    <div class="card wa-tasks">
      <h2>Offen <span class="wa-count">${open.length}</span></h2>
      ${open.length ? `<ul class="wa-list">${open.map(t => waTaskLi(t, o)).join('')}</ul>`
        : `<p class="wa-none">${mine.length ? '🎉 Alles erledigt!' : manage ? 'Noch keine Aufgaben – oben eintragen.' : 'Noch keine Aufgaben eingetragen.'}</p>`}
    </div>
    ${done.length ? `<div class="card wa-tasks">
      <h2>Erledigt <span class="wa-count ok">${done.length}</span></h2>
      <ul class="wa-list">${done.map(t => waTaskLi(t, o)).join('')}</ul>
    </div>` : ''}`;

  const addTask = async (title, important) => {
    const max = tasks.filter(t => t.objectId === o.id).reduce((m, t) => Math.max(m, t.order ?? 0), 0);
    await DB.save('waTask', waNewTask(o, title, important, max + 1));
  };
  document.getElementById('waAdd')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const title = document.getElementById('waAddTitle').value.trim();
    if (!title) return;
    await addTask(title, document.getElementById('waAddImp').checked);
    toast('Aufgabe hinzugefügt');
    await renderWaObject(id);
    document.getElementById('waAddTitle')?.focus();
  });
  document.getElementById('waAddMany')?.addEventListener('click', () => openWaManyTasks(o, tasks));
  view.querySelectorAll('[data-idea]').forEach(b => b.addEventListener('click', async () => {
    await addTask(b.dataset.idea, false);
    toast('Aufgabe hinzugefügt');
    renderWaObject(id);
  }));
  view.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const t = tasks.find(x => x.id === b.dataset.check);
    if (t.status === 'erledigt') openWaTask(t);
    else if (canTickWa()) openWaTick(t);
    else toast('Dafür fehlt dir die Berechtigung');
  }));
  view.querySelectorAll('.wa-task').forEach(li => li.addEventListener('click', () => openWaTask(tasks.find(x => x.id === li.dataset.id))));
  document.getElementById('waPrintObj').addEventListener('click', () => {
    if (!mine.length) return toast('Keine Aufgaben zum Drucken');
    printWa(mine, objects, '');
  });
}

const waNewTask = (o, title, important, order) => ({
  objectId: o.id, objectName: o.name, objectKind: o.kind, season: waSeasonOf(), title, details: '', important: !!important, order,
  status: 'offen', workers: '', hours: 0, doneNote: '', signature: '', doneAt: '', doneUid: '', approvedBy: '', approvedSig: '', approvedAt: '' });

function waTaskLi(t) {
  const done = t.status === 'erledigt';
  return `<li class="wa-task ${done ? 'done' : ''} ${t.important && !done ? 'important' : ''}" data-id="${t.id}" role="button" tabindex="0">
    <button class="wa-check" data-check="${t.id}" aria-label="${done ? 'Erledigt – Details' : 'Als erledigt abhaken'}">${done ? '✓' : ''}</button>
    <span class="grow">
      <span class="wa-task-title">${esc(t.title)}${t.important && !done ? ' <span class="wa-imp">wichtig</span>' : ''}${t.season !== waState.season ? ` <span class="tag">aus ${esc(t.season)}</span>` : ''}</span>
      ${t.details ? `<span class="wa-task-details">${esc(t.details)}</span>` : ''}
      ${done ? `<span class="wa-task-meta">✔ ${esc(t.workers)} · ${waDay(t.doneAt)}${t.hours ? ` · ${waHours(t.hours)} h${waWorkers(t).length > 1 ? ' je Person' : ''}` : ''}
        ${t.approvedAt ? `<span class="tag ok">geprüft · ${esc(t.approvedBy)}</span>` : canManageWa() ? '<span class="tag new">zu prüfen</span>' : ''}</span>
        ${t.doneNote ? `<span class="wa-task-details">„${esc(t.doneNote)}“</span>` : ''}` : ''}
    </span>
    ${done && t.signature ? `<img class="wa-sig-thumb" src="${t.signature}" alt="Unterschrift">` : ''}
  </li>`;
}

// mehrere Aufgaben, eine pro Zeile
function openWaManyTasks(o, tasks) {
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>Mehrere Aufgaben</h2><div class="muted">${esc(o.name)} · eine Aufgabe pro Zeile</div></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <form id="waManyForm" class="ev-form">
      <textarea id="waMany" rows="8" placeholder="${esc(WA_KINDS[o.kind].ideas.slice(0, 3).join('\n'))}"></textarea>
      <p class="muted" style="margin:0">Ein „!“ am Anfang markiert eine Aufgabe als wichtig.</p>
      <div class="modal-actions"><span class="grow"></span>
        <button class="btn" type="button" data-close>Abbrechen</button>
        <button class="btn primary" type="submit">Hinzufügen</button></div>
    </form>`);
  modal.querySelector('#waMany').focus();
  modal.querySelector('#waManyForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const lines = modal.querySelector('#waMany').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return closeModal();
    let order = tasks.filter(t => t.objectId === o.id).reduce((m, t) => Math.max(m, t.order ?? 0), 0);
    for (const l of lines) {
      const imp = l.startsWith('!');
      await DB.save('waTask', waNewTask(o, l.replace(/^!+\s*/, '').slice(0, 120), imp, ++order));
    }
    closeModal();
    toast(`${lines.length} ${lines.length === 1 ? 'Aufgabe' : 'Aufgaben'} hinzugefügt`);
    renderWaObject(o.id);
  });
}

// ---------- Abhaken ----------
function openWaTick(t) {
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>✓ Aufgabe abhaken</h2>
      <div class="muted">${WA_KINDS[t.objectKind]?.emoji || ''} ${esc(t.objectName)}</div></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <div class="wa-tick-title">${esc(t.title)}</div>
    ${t.details ? `<p class="muted" style="margin:4px 0 0">${esc(t.details)}</p>` : ''}
    <form id="waTickForm" class="ev-form">
      <div class="row">
        <div><label for="wtWorkers">Erledigt von</label>
          <input id="wtWorkers" required maxlength="120" value="${esc(Auth.user()?.name || '')}" autocomplete="off"></div>
        <div class="shrink" style="width:130px"><label for="wtHours">Stunden</label>
          <input id="wtHours" inputmode="decimal" placeholder="z. B. 2,5"></div>
      </div>
      <p class="muted" style="margin:4px 0 0;font-size:13px">Mehrere Helfer mit Komma trennen – die Stunden gelten dann je Person.</p>
      <label for="wtNote">Bemerkung (optional)</label>
      <input id="wtNote" maxlength="300" placeholder="z. B. Lager getauscht, Rest beim nächsten Mal">
      ${sigBox('wtSig', 'Unterschrift')}
      <p class="form-error" hidden></p>
      <div class="modal-actions"><span class="grow"></span>
        <button class="btn" type="button" data-close>Abbrechen</button>
        <button class="btn primary wa-done-btn" type="submit">✓ Erledigt &amp; unterschreiben</button></div>
    </form>`);
  modal.classList.add('wa-modal');
  const $ = id => modal.querySelector('#' + id);
  const pad = signaturePad($('wtSig'));
  modal.querySelector('[data-sigclear]').addEventListener('click', () => pad.clear());
  $('waTickForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = msg => { const x = modal.querySelector('.form-error'); x.textContent = msg; x.hidden = !msg; };
    const workers = $('wtWorkers').value.trim();
    const raw = $('wtHours').value.trim();
    const hours = raw ? parseFloat(raw.replace(',', '.')) : 0;
    if (!workers) return err('Bitte eintragen, wer die Aufgabe erledigt hat.');
    if (raw && !(hours > 0 && hours <= 24)) return err('Bitte gültige Stunden eingeben (z. B. 2,5).');
    if (pad.isEmpty()) return err('Bitte unterschreiben.');
    await DB.save('waTask', { ...t, status: 'erledigt', workers, hours: Math.round(hours * 100) / 100, doneNote: $('wtNote').value.trim(),
      signature: pad.toDataUrl(), doneAt: new Date().toISOString(), doneUid: Auth.user()?.uid || '' });
    closeModal();
    toast('✓ Erledigt – danke!');
    route({ keepScroll: true });
  });
}

// ---------- Aufgabe ansehen / bearbeiten / prüfen ----------
function openWaTask(t) {
  if (!t) return;
  const manage = canManageWa();
  const done = t.status === 'erledigt';
  if (!done && manage) return openWaTaskForm(t);
  if (!done) return canTickWa() ? openWaTick(t) : undefined;
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>${esc(t.title)}</h2>
      <div class="muted">${WA_KINDS[t.objectKind]?.emoji || ''} ${esc(t.objectName)} · Saison ${esc(t.season)}</div></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    ${t.details ? `<p style="margin:6px 0 0">${esc(t.details)}</p>` : ''}
    <dl class="wa-detail">
      <dt>Erledigt von</dt><dd>${esc(t.workers)}</dd>
      <dt>Am</dt><dd>${new Date(t.doneAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
      ${t.hours ? `<dt>Stunden</dt><dd>${waHours(t.hours)} h${waWorkers(t).length > 1 ? ` je Person (${waHours(waTaskHours(t))} h gesamt)` : ''}</dd>` : ''}
      ${t.doneNote ? `<dt>Bemerkung</dt><dd>${esc(t.doneNote)}</dd>` : ''}
    </dl>
    <div class="wa-sigs">
      <div class="wa-sig">
        <div class="sig-img">${t.signature ? `<img src="${t.signature}" alt="Unterschrift">` : ''}</div>
        <small>Unterschrift ${esc(t.workers)}</small>
      </div>
      <div class="wa-sig">
        <div class="sig-img">${t.approvedSig ? `<img src="${t.approvedSig}" alt="Prüfung">` : '<span class="muted">noch nicht geprüft</span>'}</div>
        <small>${t.approvedAt ? `Geprüft: ${esc(t.approvedBy)} · ${waDay(t.approvedAt)}` : 'Prüfung (Verantwortlicher)'}</small>
      </div>
    </div>
    <div id="waApprove" hidden>${sigBox('waApSig', `Prüfen als ${esc(Auth.user()?.name || '')}`)}<p class="form-error" hidden></p></div>
    <div class="modal-actions">
      ${waCanUntick(t) ? '<button class="btn" id="waReopen">↺ Wieder öffnen</button>' : ''}
      ${manage ? '<button class="btn" id="waEditTask">✎ Aufgabe bearbeiten</button>' : ''}
      <span class="grow"></span>
      ${manage && t.approvedAt ? '<button class="btn" id="waUnapprove">Prüfung aufheben</button>' : ''}
      ${manage && !t.approvedAt ? '<button class="btn primary" id="waApproveBtn">✔ Prüfen</button>' : ''}
    </div>`);
  modal.classList.add('wa-modal');
  const $ = id => modal.querySelector('#' + id);
  $('waEditTask')?.addEventListener('click', () => openWaTaskForm(t));
  $('waReopen')?.addEventListener('click', async () => {
    if (!confirm('Aufgabe wieder als offen markieren? Name, Stunden und Unterschrift werden entfernt.')) return;
    await DB.save('waTask', { ...t, status: 'offen', workers: '', hours: 0, doneNote: '', signature: '', doneAt: '', doneUid: '',
      approvedBy: '', approvedSig: '', approvedAt: '' });
    closeModal();
    toast('Aufgabe ist wieder offen');
    route({ keepScroll: true });
  });
  $('waUnapprove')?.addEventListener('click', async () => {
    await DB.save('waTask', { ...t, approvedBy: '', approvedSig: '', approvedAt: '' });
    closeModal();
    toast('Prüfung aufgehoben');
    route({ keepScroll: true });
  });
  let pad = null;
  $('waApproveBtn')?.addEventListener('click', async ev => {
    if (!pad) {
      $('waApprove').hidden = false;
      pad = signaturePad($('waApSig'));
      $('waApprove').querySelector('[data-sigclear]').addEventListener('click', () => pad.clear());
      ev.currentTarget.textContent = '✔ Unterschreiben & prüfen';
      $('waApSig').scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (pad.isEmpty()) { const x = $('waApprove').querySelector('.form-error'); x.textContent = 'Bitte unterschreiben.'; x.hidden = false; return; }
    await DB.save('waTask', { ...t, approvedBy: Auth.user()?.name || '', approvedSig: pad.toDataUrl(), approvedAt: new Date().toISOString() });
    closeModal();
    toast('Geprüft');
    route({ keepScroll: true });
  });
}

function openWaTaskForm(t) {
  DB.all('waObject').then(objects => {
    objects = objects.filter(o => !o.archived || o.id === t.objectId);
    const modal = openModal(`
      <div class="modal-head"><div class="grow"><h2>Aufgabe bearbeiten</h2></div>
        <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
      <form id="waTaskForm" class="ev-form">
        <label for="wfTitle">Aufgabe</label>
        <input id="wfTitle" required maxlength="120" value="${esc(t.title)}">
        <label for="wfDetails">Genauere Beschreibung (optional)</label>
        <textarea id="wfDetails" rows="3" maxlength="1000" placeholder="z. B. Werkzeug liegt im Schrank links">${esc(t.details || '')}</textarea>
        <label for="wfObj">Objekt</label>
        <select id="wfObj">${objects.map(o => `<option value="${o.id}" ${o.id === t.objectId ? 'selected' : ''}>${WA_KINDS[o.kind]?.emoji || ''} ${esc(waObjLabel(o))}</option>`).join('')}</select>
        <label class="check" style="margin-top:12px"><input type="checkbox" id="wfImp" ${t.important ? 'checked' : ''}> ❗ wichtig (steht oben)</label>
        ${t.status !== 'erledigt' && canTickWa() ? '<button type="button" class="btn wa-done-btn" id="wfTick" style="margin-top:14px;width:100%">✓ Jetzt abhaken</button>' : ''}
        <p class="form-error" hidden></p>
        <div class="modal-actions">
          <button class="btn danger" type="button" id="wfDel">Löschen</button>
          <span class="grow"></span>
          <button class="btn" type="button" data-close>Abbrechen</button>
          <button class="btn primary" type="submit">Speichern</button></div>
      </form>`);
    modal.classList.add('wa-modal');
    const $ = id => modal.querySelector('#' + id);
    $('wfTick')?.addEventListener('click', () => openWaTick(t));
    $('wfDel').addEventListener('click', async () => {
      if (!confirm(`Aufgabe „${t.title}“ löschen?`)) return;
      await DB.remove(t);
      closeModal();
      toast('Aufgabe gelöscht');
      route({ keepScroll: true });
    });
    $('waTaskForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const title = $('wfTitle').value.trim();
      if (!title) { const x = modal.querySelector('.form-error'); x.textContent = 'Bitte die Aufgabe eintragen.'; x.hidden = false; return; }
      const o = objects.find(x => x.id === $('wfObj').value);
      await DB.save('waTask', { ...t, title, details: $('wfDetails').value.trim(), important: $('wfImp').checked,
        objectId: o.id, objectName: o.name, objectKind: o.kind });
      closeModal();
      toast('Gespeichert');
      route({ keepScroll: true });
    });
  });
}

// ---------- Objekt anlegen / bearbeiten ----------
function openWaObjectForm(o, tasks, kind) {
  const isNew = !o;
  const d = o || { name: '', kind: kind || 'flugzeug', ident: '', note: '', archived: false };
  const used = o ? tasks.filter(t => t.objectId === o.id).length : 0;
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>${isNew ? 'Neues Objekt' : 'Objekt bearbeiten'}</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <form id="waObjForm" class="ev-form">
      <label>Bereich</label>
      <div class="wa-kind-pick">${Object.entries(WA_KINDS).map(([k, v]) => `
        <label class="kind-${k}"><input type="radio" name="woKind" value="${k}" ${k === d.kind ? 'checked' : ''}><span>${v.emoji}<b>${v.one}</b></span></label>`).join('')}</div>
      <label for="woName">Bezeichnung</label>
      <input id="woName" required maxlength="60" value="${esc(d.name)}">
      <label for="woIdent">Kennzeichen / Nummer (optional)</label>
      <input id="woIdent" maxlength="30" value="${esc(d.ident || '')}">
      <label for="woNote">Notiz (optional)</label>
      <input id="woNote" maxlength="120" value="${esc(d.note || '')}" placeholder="z. B. Jahresnachprüfung im Februar">
      ${isNew ? '' : `<label class="check" style="margin-top:12px"><input type="checkbox" id="woArchived" ${d.archived ? 'checked' : ''}> archiviert (wird in der Übersicht nicht mehr gezeigt)</label>`}
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${!isNew && !used ? '<button class="btn danger" type="button" id="woDel">Löschen</button>' : ''}
        <span class="grow"></span>
        <button class="btn" type="button" data-close>Abbrechen</button>
        <button class="btn primary" type="submit">${isNew ? 'Anlegen' : 'Speichern'}</button></div>
    </form>`);
  modal.classList.add('wa-modal');
  const $ = id => modal.querySelector('#' + id);
  const kindNow = () => modal.querySelector('input[name="woKind"]:checked').value;
  const setPh = () => { const k = WA_KINDS[kindNow()]; $('woName').placeholder = k.ph; $('woIdent').placeholder = k.identPh; };
  setPh();
  modal.querySelectorAll('input[name="woKind"]').forEach(r => r.addEventListener('change', setPh));
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
    const rec = await DB.save('waObject', { ...(o || {}), name, kind: kindNow(), ident: $('woIdent').value.trim(),
      note: $('woNote').value.trim(), archived: $('woArchived')?.checked || false });
    // Name in den Aufgaben mitziehen, damit Listen und Druck stimmen
    if (o && (o.name !== rec.name || o.kind !== rec.kind)) {
      for (const t of tasks.filter(x => x.objectId === o.id)) await DB.save('waTask', { ...t, objectName: rec.name, objectKind: rec.kind });
    }
    closeModal();
    toast(isNew ? `${name} angelegt` : 'Gespeichert');
    if (isNew) location.hash = '#/winterarbeit/' + rec.id; else renderWinterarbeit();
  });
}

// ---------- Unterschriftenfeld ----------
// Zeichnet mit Finger, Stift oder Maus. Ergebnis: zugeschnittenes, verkleinertes PNG.
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, empty = true, last = null;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10213a'; ctx.fillStyle = '#10213a';
    empty = true;
  };
  const pos = ev => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  canvas.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    drawing = true;
    last = pos(ev);
    ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fill();
  });
  canvas.addEventListener('pointermove', ev => {
    if (!drawing) return;
    const p = pos(ev);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
    empty = false;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  requestAnimationFrame(fit);
  return {
    isEmpty: () => empty,
    clear: fit,
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

// ---------- Excel ----------
function waCsv(list) {
  downloadCsv(`winterarbeit_${waState.season.replace('/', '-')}.csv`,
    ['Bereich', 'Objekt', 'Aufgabe', 'Beschreibung', 'Wichtig', 'Status', 'Erledigt von', 'Stunden je Person', 'Stunden gesamt', 'Erledigt am', 'Bemerkung', 'Geprüft von', 'Geprüft am'],
    list.slice().sort((a, b) => WA_ORDER.indexOf(a.objectKind) - WA_ORDER.indexOf(b.objectKind) || a.objectName.localeCompare(b.objectName, 'de'))
      .map(t => [WA_KINDS[t.objectKind]?.one || '', t.objectName, t.title, t.details || '', t.important ? 'ja' : '', t.status === 'erledigt' ? 'erledigt' : 'offen',
        t.workers || '', t.hours || 0, waTaskHours(t), waDay(t.doneAt), t.doneNote || '', t.approvedBy || '', waDay(t.approvedAt)]));
}

// ---------- Druck: Aufgabenliste mit Abhak-Kästchen und Unterschriften ----------
function printWa(list, objects, subtitle) {
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  const groups = new Map();
  for (const t of list) {
    const g = groups.get(t.objectId) || { o: objects.find(o => o.id === t.objectId) || { name: t.objectName, kind: t.objectKind }, list: [] };
    g.list.push(t);
    groups.set(t.objectId, g);
  }
  const sorted = [...groups.values()].sort((a, b) => WA_ORDER.indexOf(a.o.kind) - WA_ORDER.indexOf(b.o.kind) || a.o.name.localeCompare(b.o.name, 'de'));
  const done = list.filter(t => t.status === 'erledigt').length;
  area.innerHTML = `
    <div class="wa-print">
      <h1>Winterarbeit ${esc(waState.season)}${subtitle ? ` – ${esc(subtitle)}` : ''}</h1>
      <p>${done} von ${list.length} Aufgaben erledigt · ${waHours(list.reduce((s, t) => s + (t.status === 'erledigt' ? waTaskHours(t) : 0), 0))} Stunden</p>
      ${sorted.map(g => {
        const items = g.list.slice().sort((a, b) => (a.status === 'erledigt') - (b.status === 'erledigt') || (b.important ? 1 : 0) - (a.important ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0));
        return `<h2>${WA_KINDS[g.o.kind]?.one || ''}: ${esc(waObjLabel(g.o))}</h2>
        <table>
          <thead><tr><th class="box"></th><th>Aufgabe</th><th>Erledigt von</th><th class="num">Std.</th><th>Datum</th><th>Unterschrift</th><th>Geprüft</th></tr></thead>
          <tbody>${items.map(t => `<tr>
            <td class="box">${t.status === 'erledigt' ? '☑' : '☐'}</td>
            <td>${t.important ? '<b>❗</b> ' : ''}${esc(t.title)}${t.details ? `<div class="small">${esc(t.details)}</div>` : ''}${t.doneNote ? `<div class="small">Bemerkung: ${esc(t.doneNote)}</div>` : ''}</td>
            <td>${esc(t.workers || '')}</td>
            <td class="num">${t.hours ? waHours(t.hours) : ''}</td>
            <td>${waDay(t.doneAt)}</td>
            <td class="sig">${t.signature ? `<img src="${t.signature}" alt="">` : ''}</td>
            <td class="sig">${t.approvedSig ? `<img src="${t.approvedSig}" alt="">` : ''}<div class="small">${t.approvedAt ? `${esc(t.approvedBy)}, ${waDay(t.approvedAt)}` : ''}</div></td>
          </tr>`).join('')}</tbody>
        </table>`;
      }).join('')}
      <p class="small">Erstellt am ${new Date().toLocaleDateString('de-DE')} mit Vereinsorga</p>
    </div>`;
  document.body.classList.add('printing-menu');
  const done2 = () => { document.body.classList.remove('printing-menu'); area.innerHTML = ''; window.removeEventListener('afterprint', done2); };
  window.addEventListener('afterprint', done2);
  Promise.all([...area.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))
    .then(() => setTimeout(() => window.print(), 50));
}
