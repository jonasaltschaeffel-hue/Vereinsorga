// Automatischer Abgleich mit Firebase.
// 1. Hochladen: alle lokal geänderten Datensätze (_pending) → Firestore (mit Server-Zeitstempel syncedAt)
// 2. Herunterladen: alles, was seit dem letzten Abgleich auf dem Server geändert wurde
// Läuft nach jeder Änderung (kurz verzögert), alle 30 Sekunden, beim Wiederverbinden und beim Öffnen.
const Sync = (() => {
  const COLL = { drinkEvent: 'drinkevents', person: 'persons', drink: 'drinks', drinkEntry: 'entries', payment: 'payments',
    event: 'events', calCategory: 'calcategories' };
  const BATCH = 200;      // Schreibvorgänge pro Hochladen
  const PAGE = 300;       // Dokumente pro Abruf (muss größer als BATCH sein)
  const state = { status: 'idle', pending: 0, error: '', last: null };
  const listeners = new Set();
  let running = false, again = false, timer = null;

  const emit = () => listeners.forEach(fn => fn({ ...state }));
  // Nur abrufen, was der Benutzer laut Zugriffsregeln lesen darf (sonst lehnt der Server ab)
  const canRead = coll =>
    coll === 'payments' ? Auth.can('abrechnung') || Auth.can('statistik')
    : coll === 'events' || coll === 'calcategories' ? Auth.can('kalender') || Auth.can('kalender_bearbeiten')
    : ['ausgabe', 'einrichtung', 'abrechnung', 'statistik'].some(p => Auth.can(p));

  function schedule(ms = 1500) {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  async function countPending() {
    state.pending = (await DB.pending()).filter(r => COLL[r.type]).length;
  }

  async function run() {
    if (running) { again = true; return; }
    if (!Auth.user()) return;
    if (!navigator.onLine) { await countPending(); state.status = 'offline'; emit(); return; }
    running = true;
    state.status = 'syncing';
    emit();
    let changed = false;
    try {
      const token = await Auth.token();
      await Auth.refreshMember(token);
      if (!Auth.user()) throw new FB.Error('LOGGED_OUT', 0);
      await push(token);
      changed = await pull(token);
      state.status = 'ok';
      state.error = '';
      state.last = new Date().toISOString();
    } catch (e) {
      state.status = e.code === 'NETWORK' ? 'offline' : 'error';
      state.error = e.code || e.message;
      console.warn('Abgleich fehlgeschlagen:', e);
    }
    running = false;
    await countPending();
    emit();
    if (changed) window.dispatchEvent(new CustomEvent('sync-changed'));
    if (again) { again = false; schedule(300); }
  }

  async function push(token) {
    const pending = (await DB.pending()).filter(r => COLL[r.type]);
    let rejected = 0;
    for (const [type, coll] of Object.entries(COLL)) {
      const recs = pending.filter(r => r.type === type);
      for (let i = 0; i < recs.length; i += BATCH) {
        const batch = recs.slice(i, i + BATCH);
        const write = list => FB.commit(list.map(r => ({ coll, id: r.id, data: r, serverTime: 'syncedAt' })), token);
        try {
          await write(batch);
          await DB.markSynced(batch);
        } catch (e) {
          if (e.status !== 403) throw e;
          // Einzeln versuchen: Datensätze ohne Berechtigung werden verworfen statt endlos wiederholt.
          for (const r of batch) {
            try { await write([r]); }
            catch (e2) { if (e2.status !== 403) throw e2; rejected++; }
            await DB.markSynced([r]);
          }
        }
      }
    }
    if (rejected) {
      window.dispatchEvent(new CustomEvent('sync-rejected', { detail: rejected }));
    }
  }

  async function pull(token) {
    let changed = false;
    for (const [type, coll] of Object.entries(COLL)) {
      if (!canRead(coll)) continue;
      const key = 'sync.since.' + coll;
      let since = localStorage.getItem(key) || '1970-01-01T00:00:00Z';
      for (;;) {
        const docs = await FB.query(coll, { since, limit: PAGE }, token);
        if (docs.length) {
          if (await DB.mergeRemote(docs.map(d => ({ ...d, type })))) changed = true;
          since = docs[docs.length - 1].syncedAt;
          localStorage.setItem(key, since);
        }
        if (docs.length < PAGE) break;
      }
    }
    return changed;
  }

  // Nach einem Benutzerwechsel mit anderen Leserechten alles neu abrufen
  function resetCursors() {
    Object.values(COLL).forEach(c => localStorage.removeItem('sync.since.' + c));
  }

  function start() {
    DB.setOnChange(() => schedule(1500));
    window.addEventListener('online', () => schedule(200));
    window.addEventListener('offline', () => { state.status = 'offline'; emit(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(200); });
    setInterval(() => { if (document.visibilityState === 'visible') run(); }, 30000);
  }

  return { start, run, schedule, resetCursors, subscribe: fn => { listeners.add(fn); fn({ ...state }); }, state: () => ({ ...state }) };
})();
