// Kalender: Monatsansicht, Termine mit Wiederholung, Kategorien mit Farben,
// ganz- und mehrtägige Termine. Rechte: „kalender“ (ansehen), „kalender_bearbeiten“.
//
// event {title, categoryId, allDay, start 'YYYY-MM-DD', end 'YYYY-MM-DD' (inklusive),
//        startTime 'HH:MM', endTime 'HH:MM', location, description,
//        repeat {freq, interval, weekdays[], until}, exdates[]}
// freq: none | daily | weekly | monthly | monthlyNth | monthlyLast | yearly
// calCategory {name, color, order}

// ---------- Datumsrechnung (UTC, damit Sommer-/Winterzeit nicht stört) ----------
const Cal = (() => {
  const pad = n => String(n).padStart(2, '0');
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const toKey = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const addDays = (k, n) => toKey(new Date(fromKey(k).getTime() + n * 864e5));
  const diffDays = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);
  const weekday = k => (fromKey(k).getUTCDay() + 6) % 7; // Mo = 0 … So = 6
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const WD = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const nthOf = k => Math.ceil(fromKey(k).getUTCDate() / 7);
  const isLastWeek = k => { const d = fromKey(k); return d.getUTCDate() + 7 > daysInMonth(d.getUTCFullYear(), d.getUTCMonth()); };
  const longDate = k => { const d = fromKey(k); return `${WD[weekday(k)]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const shortDate = k => { const d = fromKey(k); return `${WD_SHORT[weekday(k)]}, ${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`; };

  // Alle Beginn-Tage eines Termins, die den Zeitraum [from, to] berühren
  function occurrences(ev, from, to) {
    const dur = Math.max(0, diffDays(ev.start, ev.end || ev.start));
    const r = ev.repeat || {};
    const freq = r.freq || 'none';
    const iv = Math.max(1, parseInt(r.interval, 10) || 1);
    const last = r.until && r.until < to ? r.until : to;
    const ex = new Set(ev.exdates || []);
    const out = [];
    const push = s => { if (s >= ev.start && s <= last && addDays(s, dur) >= from && !ex.has(s)) out.push(s); };
    let guard = 0;

    if (freq === 'none') { push(ev.start); return out; }
    if (freq === 'daily') {
      const skip = Math.max(0, Math.floor((diffDays(ev.start, from) - dur) / iv));
      for (let s = addDays(ev.start, skip * iv); s <= last && guard++ < 3000; s = addDays(s, iv)) push(s);
    } else if (freq === 'weekly') {
      const days = (r.weekdays && r.weekdays.length ? r.weekdays : [weekday(ev.start)]).map(Number).sort();
      const monday = addDays(ev.start, -weekday(ev.start));
      let w = Math.max(0, Math.floor((diffDays(monday, from) - dur) / 7 / iv)) * iv;
      for (; guard++ < 2000; w += iv) {
        const ws = addDays(monday, w * 7);
        if (ws > last) break;
        days.forEach(d => push(addDays(ws, d)));
      }
    } else if (freq === 'monthly' || freq === 'monthlyNth' || freq === 'monthlyLast') {
      const sd = fromKey(ev.start);
      const y0 = sd.getUTCFullYear(), m0 = sd.getUTCMonth(), day = sd.getUTCDate();
      const wd = weekday(ev.start), nth = nthOf(ev.start);
      for (let i = 0; guard++ < 1200; i += iv) {
        const y = y0 + Math.floor((m0 + i) / 12), m = (m0 + i) % 12, dim = daysInMonth(y, m);
        const first = toKey(new Date(Date.UTC(y, m, 1)));
        if (first > last) break;
        let d;
        if (freq === 'monthly') { if (day > dim) continue; d = day; }
        else if (freq === 'monthlyNth') { d = 1 + ((wd - weekday(first) + 7) % 7) + (nth - 1) * 7; if (d > dim) continue; }
        else { const lastKey = toKey(new Date(Date.UTC(y, m, dim))); d = dim - ((weekday(lastKey) - wd + 7) % 7); }
        push(toKey(new Date(Date.UTC(y, m, d))));
      }
    } else if (freq === 'yearly') {
      const sd = fromKey(ev.start);
      for (let i = 0; guard++ < 300; i += iv) {
        const y = sd.getUTCFullYear() + i;
        if (sd.getUTCMonth() === 1 && sd.getUTCDate() === 29 && daysInMonth(y, 1) < 29) continue;
        const s = toKey(new Date(Date.UTC(y, sd.getUTCMonth(), sd.getUTCDate())));
        if (s > last) break;
        push(s);
      }
    }
    return out;
  }

  // Lesbare Beschreibung einer Wiederholung
  function repeatText(ev) {
    const r = ev.repeat || {};
    const iv = Math.max(1, parseInt(r.interval, 10) || 1);
    const every = (one, many) => iv === 1 ? one : `alle ${iv} ${many}`;
    const wdName = WD[weekday(ev.start)];
    let t = '';
    switch (r.freq) {
      case 'daily': t = every('täglich', 'Tage'); break;
      case 'weekly': {
        const days = (r.weekdays && r.weekdays.length ? r.weekdays : [weekday(ev.start)]).map(Number).sort();
        t = `${every('jede Woche', 'Wochen')} am ${days.map(d => WD[d]).join(', ')}`;
        break;
      }
      case 'monthly': t = `${every('jeden Monat', 'Monate')} am ${fromKey(ev.start).getUTCDate()}.`; break;
      case 'monthlyNth': t = `${every('jeden Monat', 'Monate')} am ${nthOf(ev.start)}. ${wdName}`; break;
      case 'monthlyLast': t = `${every('jeden Monat', 'Monate')} am letzten ${wdName}`; break;
      case 'yearly': t = every('jedes Jahr', 'Jahre'); break;
      default: return '';
    }
    return t + (r.until ? ` bis ${shortDate(r.until)}` : '');
  }

  return { pad, fromKey, toKey, addDays, diffDays, weekday, daysInMonth, todayKey, occurrences, repeatText,
    longDate, shortDate, nthOf, isLastWeek, WD, WD_SHORT, MONTHS };
})();

// ---------- Kalender-Seite ----------
const calState = { month: sessionStorage.getItem('calMonth') || Cal.todayKey().slice(0, 7), selected: sessionStorage.getItem('calSel') || Cal.todayKey() };
const DEFAULT_CATEGORIES = [
  ['cat-flugbetrieb', 'Flugbetrieb', '#2e7d32'], ['cat-arbeitsdienst', 'Arbeitsdienst', '#ef6c00'],
  ['cat-veranstaltung', 'Veranstaltung', '#1f5fa8'], ['cat-sitzung', 'Sitzung', '#7b1fa2'], ['cat-sonstiges', 'Sonstiges', '#607d8b'],
];
const canEditCal = () => Auth.can('kalender_bearbeiten');

async function loadCalendar() {
  let cats = await DB.all('calCategory');
  // Standard-Kategorien einmalig anlegen (feste IDs, damit mehrere Geräte keine Doppel erzeugen)
  if (!cats.length && canEditCal() && !(await DB.all('calCategory', { includeDeleted: true })).length) {
    for (const [i, [id, name, color]] of DEFAULT_CATEGORIES.entries()) await DB.save('calCategory', { id, name, color, order: i });
    cats = await DB.all('calCategory');
  }
  cats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'de'));
  return { cats, events: await DB.all('event') };
}

const timeText = ev => ev.allDay ? 'ganztägig' : `${ev.startTime || ''}${ev.endTime ? '–' + ev.endTime : ''} Uhr`;

// Termine je Tag im Zeitraum; jeder Eintrag: { ev, occ (Beginn-Tag), dayIndex, dur }
function eventsByDay(events, from, to) {
  const map = new Map();
  for (const ev of events) {
    const dur = Math.max(0, Cal.diffDays(ev.start, ev.end || ev.start));
    for (const occ of Cal.occurrences(ev, from, to)) {
      for (let i = 0; i <= dur; i++) {
        const day = Cal.addDays(occ, i);
        if (day < from || day > to) continue;
        if (!map.has(day)) map.set(day, []);
        map.get(day).push({ ev, occ, dayIndex: i, dur });
      }
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (b.ev.allDay - a.ev.allDay) || (b.dur - a.dur) || String(a.ev.startTime).localeCompare(String(b.ev.startTime)));
  }
  return map;
}

async function renderKalender() {
  setTitle('Kalender', '#/');
  const { cats, events } = await loadCalendar();
  const catMap = new Map(cats.map(c => [c.id, c]));
  const color = ev => catMap.get(ev.categoryId)?.color || '#8a96a3';
  const [y, m] = calState.month.split('-').map(Number);
  const first = `${calState.month}-01`;
  const gridStart = Cal.addDays(first, -Cal.weekday(first));
  const gridEnd = Cal.addDays(gridStart, 41);
  const byDay = eventsByDay(events, gridStart, gridEnd);
  const today = Cal.todayKey();
  if (calState.selected.slice(0, 7) !== calState.month && !(calState.selected >= gridStart && calState.selected <= gridEnd)) {
    calState.selected = calState.month === today.slice(0, 7) ? today : first;
  }
  const edit = canEditCal();

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = Cal.addDays(gridStart, i);
    const list = byDay.get(day) || [];
    cells.push(`
      <button class="cal-day ${day.slice(0, 7) !== calState.month ? 'other' : ''} ${day === today ? 'today' : ''} ${day === calState.selected ? 'selected' : ''}" data-day="${day}">
        <span class="cal-num">${Number(day.slice(8))}</span>
        <span class="cal-chips">${list.slice(0, 3).map(x => `
          <span class="cal-chip ${x.dur ? 'multi' : ''}" style="--c:${color(x.ev)}">${x.dayIndex > 0 ? '↳ ' : ''}${!x.ev.allDay && x.dayIndex === 0 && x.ev.startTime ? x.ev.startTime + ' ' : ''}${esc(x.ev.title)}</span>`).join('')}
          ${list.length > 3 ? `<span class="cal-more">+${list.length - 3} weitere</span>` : ''}
        </span>
        <span class="cal-dots">${list.slice(0, 4).map(x => `<i style="--c:${color(x.ev)}"></i>`).join('')}</span>
      </button>`);
  }

  const selList = byDay.get(calState.selected) || eventsByDay(events, calState.selected, calState.selected).get(calState.selected) || [];

  view.innerHTML = `
    <div class="cal-head">
      <button class="btn small" id="calPrev" aria-label="Vorheriger Monat">‹</button>
      <h2>${Cal.MONTHS[m - 1]} ${y}</h2>
      <button class="btn small" id="calNext" aria-label="Nächster Monat">›</button>
      <button class="btn small" id="calToday">Heute</button>
      <span class="grow"></span>
      ${edit ? '<button class="btn small" id="calCats">Kategorien</button><button class="btn primary small" id="calNew">+ Termin</button>' : ''}
    </div>
    ${cats.length ? `<div class="cal-legend">${cats.map(c => `<span><i style="--c:${c.color}"></i>${esc(c.name)}</span>`).join('')}</div>` : ''}
    <div class="cal-grid">
      ${Cal.WD_SHORT.map(d => `<div class="cal-wd">${d}</div>`).join('')}
      ${cells.join('')}
    </div>
    <div class="card cal-daylist">
      <div class="card-head">
        <h2>${Cal.longDate(calState.selected)}</h2>
        ${edit ? '<button class="btn small" id="calNewDay">+ Termin an diesem Tag</button>' : ''}
      </div>
      ${selList.length ? `<ul class="list">${selList.map((x, i) => `
        <li class="cal-item" data-i="${i}">
          <span class="cal-bar" style="--c:${color(x.ev)}"></span>
          <span class="grow"><strong>${esc(x.ev.title)}</strong>
            <span class="muted">${x.dur ? `${Cal.shortDate(x.occ)} – ${Cal.shortDate(Cal.addDays(x.occ, x.dur))} · ` : ''}${timeText(x.ev)}${x.ev.location ? ' · ' + esc(x.ev.location) : ''}${x.ev.repeat?.freq && x.ev.repeat.freq !== 'none' ? ' · 🔁' : ''}</span></span>
          <span class="muted">›</span>
        </li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Keine Termine.</p>'}
    </div>
  `;

  const go2 = delta => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    calState.month = Cal.toKey(d).slice(0, 7);
    sessionStorage.setItem('calMonth', calState.month);
    renderKalender();
  };
  document.getElementById('calPrev').onclick = () => go2(-1);
  document.getElementById('calNext').onclick = () => go2(1);
  document.getElementById('calToday').onclick = () => {
    calState.month = today.slice(0, 7); calState.selected = today;
    sessionStorage.setItem('calMonth', calState.month); sessionStorage.setItem('calSel', today);
    renderKalender();
  };
  view.querySelectorAll('.cal-day').forEach(b => b.addEventListener('click', () => {
    calState.selected = b.dataset.day;
    sessionStorage.setItem('calSel', calState.selected);
    if (b.dataset.day.slice(0, 7) !== calState.month) {
      calState.month = b.dataset.day.slice(0, 7);
      sessionStorage.setItem('calMonth', calState.month);
    }
    renderKalender();
  }));
  view.querySelectorAll('.cal-item').forEach(li => li.addEventListener('click', () => {
    const x = selList[+li.dataset.i];
    showEventDetail(x.ev, x.occ, catMap);
  }));
  if (edit) {
    document.getElementById('calNew').onclick = () => openEventForm(null, calState.selected, cats);
    document.getElementById('calNewDay').onclick = () => openEventForm(null, calState.selected, cats);
    document.getElementById('calCats').onclick = () => openCategories();
  }
}

// ---------- Dialog-Fenster ----------
function openModal(html, { onClose } = {}) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(back);
  document.body.classList.add('modal-open');
  const close = () => { closeModal(); if (onClose) onClose(); };
  back.addEventListener('click', ev => { if (ev.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  back._esc = ev => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', back._esc);
  return back.querySelector('.modal');
}
function closeModal() {
  document.querySelectorAll('.modal-backdrop').forEach(b => { document.removeEventListener('keydown', b._esc); b.remove(); });
  document.body.classList.remove('modal-open');
}

function showEventDetail(ev, occ, catMap) {
  const cat = catMap.get(ev.categoryId);
  const dur = Math.max(0, Cal.diffDays(ev.start, ev.end || ev.start));
  const rep = Cal.repeatText(ev);
  const modal = openModal(`
    <div class="modal-head" style="--c:${cat?.color || '#8a96a3'}">
      <span class="cal-bar"></span>
      <div class="grow"><h2>${esc(ev.title)}</h2>${cat ? `<span class="muted">${esc(cat.name)}</span>` : ''}</div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button>
    </div>
    <p>📅 ${dur ? `${Cal.shortDate(occ)} – ${Cal.shortDate(Cal.addDays(occ, dur))}` : Cal.longDate(occ)}<br>
       🕒 ${timeText(ev)}
       ${rep ? `<br>🔁 ${esc(rep)}` : ''}
       ${ev.location ? `<br>📍 ${esc(ev.location)}` : ''}</p>
    ${ev.description ? `<p class="cal-desc">${esc(ev.description)}</p>` : ''}
    ${canEditCal() ? `<div class="modal-actions">
      <button class="btn danger" id="evDel">Löschen</button>
      <span class="grow"></span>
      <button class="btn primary" id="evEdit">Bearbeiten</button>
    </div>` : ''}`);
  if (!canEditCal()) return;
  modal.querySelector('#evEdit').onclick = async () => openEventForm(ev, occ, (await loadCalendar()).cats);
  modal.querySelector('#evDel').onclick = () => deleteEvent(ev, occ);
}

const isRecurring = ev => ev.repeat && ev.repeat.freq && ev.repeat.freq !== 'none';

function deleteEvent(ev, occ) {
  if (!isRecurring(ev)) {
    if (!confirm(`Termin „${ev.title}“ löschen?`)) return;
    DB.remove(ev).then(() => { closeModal(); toast('Termin gelöscht'); renderKalender(); });
    return;
  }
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>Serientermin löschen</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <p>„${esc(ev.title)}“ ist ein wiederkehrender Termin. Was soll gelöscht werden?</p>
    <div class="choice-list">
      <button class="btn wide" data-scope="one">Nur dieser Termin (${Cal.shortDate(occ)})</button>
      <button class="btn wide" data-scope="following">Dieser und alle folgenden</button>
      <button class="btn danger wide" data-scope="all">Alle Termine der Serie</button>
    </div>`);
  modal.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', async () => {
    const scope = b.dataset.scope;
    if (scope === 'one') await DB.save('event', { ...ev, exdates: [...new Set([...(ev.exdates || []), occ])] });
    else if (scope === 'following' && occ > ev.start) await DB.save('event', { ...ev, repeat: { ...ev.repeat, until: Cal.addDays(occ, -1) } });
    else await DB.remove(ev);
    closeModal();
    toast('Gelöscht');
    renderKalender();
  }));
}

// ---------- Termin anlegen / bearbeiten ----------
function openEventForm(ev, day, cats) {
  const isNew = !ev;
  const recurring = !isNew && isRecurring(ev);
  const dur = isNew ? 0 : Math.max(0, Cal.diffDays(ev.start, ev.end || ev.start));
  // Beim Bearbeiten wird der angeklickte Termin der Serie gezeigt
  const occStart = isNew ? day : day;
  const e = ev || { title: '', categoryId: cats[0]?.id || '', allDay: false, startTime: '18:00', endTime: '20:00',
    location: '', description: '', repeat: { freq: 'none', interval: 1, weekdays: [], until: '' } };
  const r = { freq: 'none', interval: 1, weekdays: [], until: '', ...(e.repeat || {}) };
  const start = occStart, end = Cal.addDays(occStart, dur);

  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>${isNew ? 'Neuer Termin' : 'Termin bearbeiten'}</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <form id="evForm" class="ev-form">
      <label for="fTitle">Titel</label>
      <input id="fTitle" required maxlength="120" value="${esc(e.title)}" placeholder="z. B. Flugbetrieb">
      <label for="fCat">Kategorie</label>
      <select id="fCat">
        <option value="">— ohne Kategorie —</option>
        ${cats.map(c => `<option value="${c.id}" ${c.id === e.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <label class="check"><input type="checkbox" id="fAllDay" ${e.allDay ? 'checked' : ''}> Ganztägig</label>
      <div class="row">
        <div><label for="fStart">Beginn</label><input id="fStart" type="date" required value="${start}"></div>
        <div class="time-field"><label for="fStartTime">Uhrzeit</label><input id="fStartTime" type="time" value="${e.startTime || ''}"></div>
      </div>
      <div class="row">
        <div><label for="fEnd">Ende</label><input id="fEnd" type="date" required value="${end}"></div>
        <div class="time-field"><label for="fEndTime">Uhrzeit</label><input id="fEndTime" type="time" value="${e.endTime || ''}"></div>
      </div>
      <label for="fFreq">Wiederholung</label>
      <select id="fFreq"></select>
      <div id="repeatOpts">
        <div class="row">
          <div class="shrink" style="width:110px"><label for="fInterval" id="fIntervalLabel">Alle</label>
            <input id="fInterval" type="number" min="1" max="99" value="${r.interval || 1}" inputmode="numeric"></div>
          <div><label for="fUntil">Endet am (optional)</label><input id="fUntil" type="date" value="${r.until || ''}"></div>
        </div>
        <div id="weekdayBox" class="weekday-box">
          ${Cal.WD_SHORT.map((d, i) => `<label><input type="checkbox" name="wd" value="${i}"
            ${(r.weekdays && r.weekdays.length ? r.weekdays.map(Number) : []).includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}
        </div>
      </div>
      <label for="fLoc">Ort</label>
      <input id="fLoc" maxlength="120" value="${esc(e.location || '')}" placeholder="z. B. Flugplatz, Vereinsheim">
      <label for="fDesc">Beschreibung</label>
      <textarea id="fDesc" rows="4" maxlength="2000" placeholder="Notizen, Treffpunkt, Mitbringen …">${esc(e.description || '')}</textarea>
      ${recurring ? `
        <fieldset class="scope">
          <legend>Änderung gilt für</legend>
          <label class="check"><input type="radio" name="scope" value="one" checked> nur diesen Termin (${Cal.shortDate(day)})</label>
          <label class="check"><input type="radio" name="scope" value="all"> alle Termine der Serie</label>
        </fieldset>` : ''}
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        <button class="btn" type="button" data-close>Abbrechen</button>
        <span class="grow"></span>
        <button class="btn primary" type="submit">Speichern</button>
      </div>
    </form>`);

  const $ = id => modal.querySelector('#' + id);
  const fillFreq = () => {
    const s = $('fStart').value || start;
    const wd = Cal.WD[Cal.weekday(s)], dom = Cal.fromKey(s).getUTCDate();
    const opts = [['none', 'Keine'], ['daily', 'Täglich'], ['weekly', 'Wöchentlich'], ['monthly', `Monatlich am ${dom}.`],
      ['monthlyNth', `Monatlich am ${Cal.nthOf(s)}. ${wd}`], ...(Cal.isLastWeek(s) ? [['monthlyLast', `Monatlich am letzten ${wd}`]] : []),
      ['yearly', 'Jährlich']];
    const cur = $('fFreq').value || r.freq || 'none';
    $('fFreq').innerHTML = opts.filter(([k]) => !(k === 'monthlyNth' && Cal.nthOf(s) === 5))
      .map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
    if (!$('fFreq').value) $('fFreq').value = 'none';
  };
  const updateUi = () => {
    const allDay = $('fAllDay').checked;
    modal.querySelectorAll('.time-field').forEach(f => { f.hidden = allDay; });
    const freq = $('fFreq').value;
    // bei „Wöchentlich“ den Wochentag des Beginns vorauswählen
    if (freq === 'weekly' && !modal.querySelector('[name=wd]:checked') && $('fStart').value) {
      modal.querySelector(`[name=wd][value="${Cal.weekday($('fStart').value)}"]`).checked = true;
    }
    $('repeatOpts').hidden = freq === 'none';
    $('weekdayBox').hidden = freq !== 'weekly';
    $('fIntervalLabel').textContent = { daily: 'Alle … Tage', weekly: 'Alle … Wochen', yearly: 'Alle … Jahre' }[freq] || 'Alle … Monate';
    // Serien-Optionen nur sinnvoll, wenn „alle Termine“ gewählt ist
    const scopeOne = modal.querySelector('[name=scope][value=one]')?.checked;
    $('fFreq').disabled = !!scopeOne;
    modal.querySelectorAll('#repeatOpts input').forEach(i => { i.disabled = !!scopeOne; });
  };
  fillFreq();
  updateUi();
  if (recurring) $('fFreq').value = r.freq;
  updateUi();
  $('fAllDay').addEventListener('change', updateUi);
  $('fFreq').addEventListener('change', updateUi);
  modal.querySelectorAll('[name=scope]').forEach(x => x.addEventListener('change', updateUi));
  $('fStart').addEventListener('change', () => {
    // Ende mitschieben, damit die Dauer gleich bleibt
    const s = $('fStart').value;
    if (s) $('fEnd').value = Cal.addDays(s, Math.max(0, Cal.diffDays(start, end)));
    fillFreq();
    updateUi();
  });
  $('fTitle').focus();

  modal.querySelector('#evForm').addEventListener('submit', async sub => {
    sub.preventDefault();
    const err = msg => { const p = modal.querySelector('.form-error'); p.textContent = msg; p.hidden = !msg; };
    const title = $('fTitle').value.trim();
    const s = $('fStart').value, en = $('fEnd').value;
    const allDay = $('fAllDay').checked;
    const st = $('fStartTime').value, et = $('fEndTime').value;
    if (!title) return err('Bitte einen Titel eingeben.');
    if (!s || !en) return err('Bitte Beginn und Ende angeben.');
    if (en < s) return err('Das Ende liegt vor dem Beginn.');
    if (!allDay && !st) return err('Bitte eine Uhrzeit angeben oder „Ganztägig“ wählen.');
    if (!allDay && en === s && et && et < st) return err('Die End-Uhrzeit liegt vor der Beginn-Uhrzeit.');
    const freq = $('fFreq').value;
    const weekdays = [...modal.querySelectorAll('[name=wd]:checked')].map(c => Number(c.value));
    const repeat = freq === 'none' ? { freq: 'none' } : {
      freq, interval: Math.max(1, parseInt($('fInterval').value, 10) || 1),
      weekdays: freq === 'weekly' ? (weekdays.length ? weekdays : [Cal.weekday(s)]) : [],
      until: $('fUntil').value || '',
    };
    if (repeat.until && repeat.until < s) return err('Das Ende der Wiederholung liegt vor dem Beginn.');
    const fields = {
      title, categoryId: $('fCat').value, allDay, startTime: allDay ? '' : st, endTime: allDay ? '' : et,
      location: $('fLoc').value.trim(), description: $('fDesc').value.trim(),
    };
    const scope = modal.querySelector('[name=scope]:checked')?.value;

    if (isNew) {
      await DB.save('event', { ...fields, start: s, end: en, repeat, exdates: [] });
    } else if (!recurring) {
      await DB.save('event', { ...ev, ...fields, start: s, end: en, repeat });
    } else if (scope === 'one') {
      // Einzelnen Termin aus der Serie lösen: Ausnahme in der Serie + eigener Termin
      await DB.save('event', { ...ev, exdates: [...new Set([...(ev.exdates || []), day])] });
      await DB.save('event', { ...fields, start: s, end: en, repeat: { freq: 'none' }, exdates: [], seriesId: ev.id });
    } else {
      // Ganze Serie: Verschiebung des angeklickten Termins auf die Serie übertragen
      const shift = Cal.diffDays(day, s);
      const newStart = Cal.addDays(ev.start, shift);
      await DB.save('event', { ...ev, ...fields, start: newStart, end: Cal.addDays(newStart, Cal.diffDays(s, en)), repeat,
        exdates: shift ? [] : (ev.exdates || []) });
    }
    closeModal();
    calState.selected = s;
    calState.month = s.slice(0, 7);
    sessionStorage.setItem('calSel', s);
    sessionStorage.setItem('calMonth', calState.month);
    toast('Termin gespeichert');
    renderKalender();
  });
}

// ---------- Kategorien verwalten ----------
async function openCategories() {
  const { cats } = await loadCalendar();
  const modal = openModal(`
    <div class="modal-head"><div class="grow"><h2>Kategorien</h2></div>
      <button class="icon-btn" data-close aria-label="Schließen">✕</button></div>
    <p class="muted">Name und Farbe ändern sich sofort. Termine einer gelöschten Kategorie werden grau angezeigt.</p>
    <ul class="list cat-list">${cats.map(c => `
      <li data-id="${c.id}">
        <input type="color" value="${esc(c.color)}" aria-label="Farbe">
        <input class="grow" value="${esc(c.name)}" maxlength="40" aria-label="Name">
        <button class="btn small danger" data-del aria-label="Kategorie löschen">✕</button>
      </li>`).join('')}</ul>
    <form id="catNew" class="row" style="margin-top:12px">
      <div class="shrink"><input type="color" id="ncColor" value="#1f5fa8" aria-label="Farbe"></div>
      <div><input id="ncName" placeholder="Neue Kategorie" maxlength="40" required></div>
      <button class="btn primary shrink" type="submit">Hinzufügen</button>
    </form>`, { onClose: renderKalender });

  modal.querySelectorAll('.cat-list li').forEach(li => {
    const c = cats.find(x => x.id === li.dataset.id);
    const [colorIn, nameIn] = li.querySelectorAll('input');
    const save = async () => {
      const name = nameIn.value.trim();
      if (!name) { nameIn.value = c.name; return; }
      Object.assign(c, await DB.save('calCategory', { ...c, name, color: colorIn.value }));
    };
    colorIn.addEventListener('change', save);
    nameIn.addEventListener('change', save);
    li.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`Kategorie „${c.name}“ löschen?`)) return;
      await DB.remove(c);
      li.remove();
    });
  });
  modal.querySelector('#catNew').addEventListener('submit', async ev => {
    ev.preventDefault();
    const name = modal.querySelector('#ncName').value.trim();
    if (!name) return;
    const maxOrder = cats.reduce((mx, c) => Math.max(mx, c.order ?? 0), 0);
    await DB.save('calCategory', { name, color: modal.querySelector('#ncColor').value, order: maxOrder + 1 });
    openCategories();
  });
}
