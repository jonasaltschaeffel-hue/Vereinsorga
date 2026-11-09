// Verbindung zu Firebase über die offiziellen REST-Schnittstellen
// (Authentication + Cloud Firestore) – ohne fremde Bibliothek.
// Die Konfiguration ist öffentlich; geschützt wird über die Firestore-Regeln (firestore.rules).
const FB = (() => {
  const CONFIG = {
    apiKey: 'AIzaSyBktqbMLsRp6rFAqO-y_ZiymG26jmWtfEE',
    projectId: 'lsv-regensburg-6a517',
  };
  const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';
  const TOKEN = 'https://securetoken.googleapis.com/v1/token';
  const DOCS = `projects/${CONFIG.projectId}/databases/(default)/documents`;
  const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
  // Anmelde-E-Mails sind intern und werden nie benutzt, um Mails zu verschicken.
  const EMAIL_DOMAIN = 'vereinsorga.invalid';

  class FbError extends Error {
    constructor(code, status) { super(code); this.code = code; this.status = status; }
  }

  async function call(url, { method = 'GET', body, token, form } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: body ? JSON.stringify(body) : form,
      });
    } catch {
      throw new FbError('NETWORK', 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = Array.isArray(data) ? data[0]?.error : data.error;
      throw new FbError(err?.message || err?.status || 'HTTP_' + res.status, res.status);
    }
    return data;
  }

  // ---------- Anmeldung ----------
  const newEmail = () => 'u-' + DB.uuid().replace(/-/g, '').slice(0, 16) + '@' + EMAIL_DOMAIN;
  const session = d => ({ uid: d.localId || d.user_id, idToken: d.idToken || d.id_token,
    refreshToken: d.refreshToken || d.refresh_token, exp: Date.now() + Number(d.expiresIn || d.expires_in || 3600) * 1000 });

  async function signUp(email, password) {
    return session(await call(`${AUTH}:signUp?key=${CONFIG.apiKey}`,
      { method: 'POST', body: { email, password, returnSecureToken: true } }));
  }
  async function signIn(email, password) {
    return session(await call(`${AUTH}:signInWithPassword?key=${CONFIG.apiKey}`,
      { method: 'POST', body: { email, password, returnSecureToken: true } }));
  }
  async function refresh(refreshToken) {
    return session(await call(`${TOKEN}?key=${CONFIG.apiKey}`,
      { method: 'POST', form: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken) }));
  }

  // ---------- Firestore-Werte <-> JavaScript ----------
  function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
    return { stringValue: String(v) };
  }
  function toFields(obj) {
    const f = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined && !k.startsWith('_')) f[k] = toValue(v);
    return f;
  }
  function fromValue(v) {
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('stringValue' in v) return v.stringValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
    if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
    return null;
  }
  function fromFields(f) {
    const o = {};
    for (const [k, v] of Object.entries(f)) o[k] = fromValue(v);
    return o;
  }
  const docName = (coll, id) => `${DOCS}/${coll}/${id}`;
  const fromDoc = doc => ({ ...fromFields(doc.fields || {}), id: decodeURIComponent(doc.name.split('/').pop()) });
  const path = (coll, id) => `${coll}/${encodeURIComponent(id)}`;

  // ---------- Firestore ----------
  async function getDoc(coll, id, token) {
    try { return fromDoc(await call(`${FS}/${path(coll, id)}`, { token })); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }

  // writes: [{ coll, id, data, serverTime? }, { coll, id, delete: true }] – alles oder nichts
  function commit(writes, token) {
    return call(`${FS}:commit`, {
      method: 'POST', token,
      body: {
        writes: writes.map(w => w.delete ? { delete: docName(w.coll, w.id) } : {
          update: { name: docName(w.coll, w.id), fields: toFields(w.data) },
          ...(w.serverTime ? { updateTransforms: [{ fieldPath: w.serverTime, setToServerValue: 'REQUEST_TIME' }] } : {}),
        }),
      },
    });
  }

  // Dokumente einer Sammlung; mit since: nur seit diesem Server-Zeitpunkt geänderte (Feld syncedAt)
  async function query(coll, { since, limit = 300 } = {}, token) {
    const sq = { from: [{ collectionId: coll }], limit };
    if (since !== undefined) {
      sq.where = { fieldFilter: { field: { fieldPath: 'syncedAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since } } };
      sq.orderBy = [{ field: { fieldPath: 'syncedAt' }, direction: 'ASCENDING' }];
    }
    const rows = await call(`${FS}:runQuery`, { method: 'POST', token, body: { structuredQuery: sq } });
    return rows.filter(r => r.document).map(r => fromDoc(r.document));
  }

  return { Error: FbError, newEmail, signUp, signIn, refresh, getDoc, commit, query, projectId: CONFIG.projectId };
})();
