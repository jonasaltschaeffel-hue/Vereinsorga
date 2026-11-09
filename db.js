// Lokale Datenhaltung (IndexedDB) – die App arbeitet immer zuerst lokal (offline-fähig).
// Jeder Datensatz hat id, type, createdAt, updatedAt, deleted, device und by.
// _pending = true heißt: Änderung ist noch nicht in Firebase hochgeladen.
// Beim Zusammenführen gewinnt pro id die Version mit dem neuesten updatedAt;
// gelöscht wird nur markiert (deleted), damit das Löschen auch abgeglichen wird.
const DB = (() => {
  const DB_NAME = 'vereinsorga';
  const STORE = 'records';
  const SYNC_TYPES = ['person', 'drink', 'drinkEntry', 'payment'];
  let dbPromise;
  let onChange = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('type', 'type');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      t.onerror = () => reject(t.error);
    });
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function deviceName() {
    return localStorage.getItem('deviceName') || 'Unbenanntes Gerät';
  }

  const syncable = type => SYNC_TYPES.includes(type);
  const changed = () => { if (onChange) onChange(); };

  async function all(type, { includeDeleted = false } = {}) {
    const rows = await tx('readonly', s => s.index('type').getAll(type));
    return includeDeleted ? rows : rows.filter(r => !r.deleted);
  }

  async function allRecords() {
    return tx('readonly', s => s.getAll());
  }

  async function save(type, data) {
    const now = new Date().toISOString();
    const rec = {
      ...data,
      id: data.id || uuid(),
      type,
      createdAt: data.createdAt || now,
      updatedAt: now,
      device: deviceName(),
      by: (typeof Auth !== 'undefined' && Auth.user()?.name) || '', // wer den Eintrag gespeichert hat
      deleted: false,
      _pending: syncable(type),
    };
    await tx('readwrite', s => s.put(rec));
    changed();
    return rec;
  }

  async function remove(rec) {
    const upd = { ...rec, deleted: true, updatedAt: new Date().toISOString(), device: deviceName(),
      by: (typeof Auth !== 'undefined' && Auth.user()?.name) || rec.by || '', _pending: syncable(rec.type) };
    await tx('readwrite', s => s.put(upd));
    changed();
    return upd;
  }

  // Import einer Sicherung: neuere Version gewinnt, importierte Daten werden danach hochgeladen.
  async function merge(records) {
    const existing = new Map((await allRecords()).map(r => [r.id, r]));
    let added = 0, updated = 0;
    await tx('readwrite', s => {
      for (const raw of records) {
        if (!raw || !raw.id || !raw.type) continue;
        const r = { ...raw, _pending: syncable(raw.type) };
        const cur = existing.get(r.id);
        if (!cur) { s.put(r); added++; }
        else if ((r.updatedAt || '') > (cur.updatedAt || '')) { s.put(r); updated++; }
      }
    });
    if (added || updated) changed();
    return { added, updated };
  }

  // Daten aus Firebase übernehmen. Eine lokale, noch nicht hochgeladene neuere Änderung bleibt bestehen.
  async function mergeRemote(records) {
    const existing = new Map((await allRecords()).map(r => [r.id, r]));
    let n = 0;
    await tx('readwrite', s => {
      for (const r of records) {
        const cur = existing.get(r.id);
        if (!cur || (r.updatedAt || '') > (cur.updatedAt || '')) {
          s.put({ ...r, _pending: false });
          n++;
        } else if (cur._pending && cur.updatedAt === r.updatedAt) {
          s.put({ ...cur, _pending: false });
        }
      }
    });
    return n;
  }

  async function pending() {
    return (await allRecords()).filter(r => r._pending);
  }

  // Nach dem Hochladen: Merker entfernen, außer der Datensatz wurde inzwischen erneut geändert.
  async function markSynced(list) {
    const cur = new Map((await allRecords()).map(r => [r.id, r]));
    await tx('readwrite', s => {
      for (const r of list) {
        const c = cur.get(r.id);
        if (c && c.updatedAt === r.updatedAt) s.put({ ...c, _pending: false });
      }
    });
  }

  // Alle Daten dieses Geräts (erneut) zum Hochladen vormerken – z. B. beim Umzug von localhost.
  async function markAllPending() {
    const rows = (await allRecords()).filter(r => syncable(r.type) && !r._pending);
    await tx('readwrite', s => { for (const r of rows) s.put({ ...r, _pending: true }); });
    if (rows.length) changed();
    return rows.length;
  }

  return {
    all, allRecords, save, remove, merge, mergeRemote, pending, markSynced, markAllPending,
    uuid, deviceName, SYNC_TYPES, setOnChange: fn => { onChange = fn; },
  };
})();
