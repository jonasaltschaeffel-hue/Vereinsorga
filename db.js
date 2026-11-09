// Lokale Datenhaltung (IndexedDB).
// Jeder Datensatz hat id, type, createdAt, updatedAt, deleted und device.
// Dadurch lassen sich Daten später zwischen Geräten zusammenführen (Sync):
// pro id gewinnt die Version mit dem neuesten updatedAt; gelöscht wird nur markiert.
const DB = (() => {
  const DB_NAME = 'vereinsorga';
  const STORE = 'records';
  let dbPromise;

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
    };
    await tx('readwrite', s => s.put(rec));
    return rec;
  }

  async function remove(rec) {
    const upd = { ...rec, deleted: true, updatedAt: new Date().toISOString(), device: deviceName() };
    await tx('readwrite', s => s.put(upd));
    return upd;
  }

  // Import mit Zusammenführung: neuere Version gewinnt.
  async function merge(records) {
    const existing = new Map((await allRecords()).map(r => [r.id, r]));
    let added = 0, updated = 0;
    await tx('readwrite', s => {
      for (const r of records) {
        if (!r || !r.id || !r.type) continue;
        const cur = existing.get(r.id);
        if (!cur) { s.put(r); added++; }
        else if ((r.updatedAt || '') > (cur.updatedAt || '')) { s.put(r); updated++; }
      }
    });
    return { added, updated };
  }

  return { all, allRecords, save, remove, merge, uuid, deviceName };
})();
