// Benutzer, Anmeldung und Rechte – über Firebase Authentication + Firestore (members/{uid}).
//
// Anmeldung mit Name + Passwort: Der Name wird über logins/{name} der internen
// Anmelde-E-Mail zugeordnet. Rechte stehen in members/{uid} und werden auch auf dem
// Server geprüft (firestore.rules).
//
// Offline: Wer sich auf einem Gerät schon einmal online angemeldet hat, kann sich dort
// auch ohne Internet anmelden. Dafür wird ein Prüfwert des Passworts (PBKDF2-Hash, nie
// das Passwort selbst) auf dem Gerät gespeichert.
const Auth = (() => {
  const PERMS = [
    ['ausgabe', 'Getränkeausgabe durchführen'],
    ['einrichtung', 'Personen & Getränke verwalten'],
    ['abrechnung', 'Abrechnung & Zahlungen'],
    ['statistik', 'Statistik ansehen'],
    ['einstellungen', 'Einstellungen & Sicherung'],
    ['admin', 'Admin: Benutzer & Rechte verwalten (darf alles)'],
  ];
  const MIN_PASSWORD = 6; // Mindestlänge von Firebase
  const LS_AUTH = 'fb.auth';        // Firebase-Sitzung { uid, idToken, refreshToken, exp }
  const LS_CACHE = 'fb.members';    // { [nameKey]: { uid, name, perms, active, email, verifier } }
  const UI_KEY = 'ui.user';         // angemeldeter Benutzer (uid)

  const enc = new TextEncoder();
  const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const randHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));
  const nameKey = name => String(name ?? '').trim().toLowerCase().replace(/\//g, '_');
  const available = () => !!(window.crypto && crypto.subtle);
  const readJson = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };

  async function hash(password, salt) {
    const k = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256);
    return toHex(bits);
  }

  let current = null;        // { uid, name, perms, active, email }
  let memoryPassword = null; // nur im Arbeitsspeicher: nach Offline-Anmeldung für die spätere Online-Anmeldung

  const loadAuth = () => readJson(LS_AUTH, null);
  const saveAuth = s => localStorage.setItem(LS_AUTH, JSON.stringify(s));
  const clearAuth = () => localStorage.removeItem(LS_AUTH);
  const cache = () => readJson(LS_CACHE, {});

  async function cacheMember(member, password) {
    const c = cache();
    const old = c[nameKey(member.name)];
    let verifier = old && old.uid === member.uid ? old.verifier : null;
    if (password) { const salt = randHex(16); verifier = { salt, hash: await hash(password, salt) }; }
    // alte Einträge desselben Benutzers (z. B. nach Umbenennung) entfernen
    for (const [k, v] of Object.entries(c)) if (v.uid === member.uid) delete c[k];
    c[nameKey(member.name)] = { uid: member.uid, name: member.name, perms: member.perms, active: member.active !== false,
      email: member.email, verifier };
    localStorage.setItem(LS_CACHE, JSON.stringify(c));
  }

  function startSession(member, persist) {
    const changedUser = (localStorage.getItem('sync.user') || '') !== member.uid;
    current = member;
    sessionStorage.setItem(UI_KEY, member.uid);
    if (persist) localStorage.setItem(UI_KEY, member.uid); else localStorage.removeItem(UI_KEY);
    if (changedUser) { Sync.resetCursors(); localStorage.setItem('sync.user', member.uid); }
  }

  function restore() {
    const uid = sessionStorage.getItem(UI_KEY) || localStorage.getItem(UI_KEY);
    if (!uid) { current = null; return null; }
    const m = Object.values(cache()).find(x => x.uid === uid && x.active);
    current = m ? { uid: m.uid, name: m.name, perms: m.perms, active: true, email: m.email } : null;
    if (!current) logout();
    return current;
  }

  function logout() {
    current = null;
    memoryPassword = null;
    sessionStorage.removeItem(UI_KEY);
    localStorage.removeItem(UI_KEY);
    clearAuth(); // gemeinsames Gerät: Firebase-Sitzung nicht liegen lassen
  }

  // Gültiges Firebase-Token für den angemeldeten Benutzer (erneuert es bei Bedarf)
  async function token() {
    let s = loadAuth();
    if (!s || s.uid !== current?.uid) {
      if (!memoryPassword || !current?.email) throw new FB.Error('NO_SESSION', 0);
      s = await FB.signIn(current.email, memoryPassword);
      saveAuth(s);
      memoryPassword = null;
    }
    if (Date.now() > s.exp - 60000) {
      s = { ...s, ...(await FB.refresh(s.refreshToken)) };
      saveAuth(s);
    }
    return s.idToken;
  }

  // Rechte vom Server nachladen (z. B. nach Änderung durch einen Admin)
  async function refreshMember(tok) {
    if (!current) return;
    const m = await FB.getDoc('members', current.uid, tok);
    if (!m || m.active === false) { logout(); window.dispatchEvent(new CustomEvent('auth-revoked')); return; }
    const updated = { ...current, name: m.name, perms: m.perms || [] };
    const permsChanged = JSON.stringify(updated.perms) !== JSON.stringify(current.perms) || updated.name !== current.name;
    current = updated;
    await cacheMember(updated);
    if (permsChanged) window.dispatchEvent(new CustomEvent('auth-changed'));
  }

  // 'done' = es gibt schon einen Admin, 'open' = Erst-Einrichtung nötig, 'offline',
  // 'blocked' = Server lehnt ab (Zugriffsregeln noch nicht veröffentlicht)
  async function setupStatus() {
    try { return (await FB.getDoc('config', 'setup')) ? 'done' : 'open'; }
    catch (e) {
      if (e.code === 'NETWORK') return 'offline';
      if (e.status === 403) return 'blocked';
      throw e;
    }
  }

  async function login(name, password, persist) {
    const nk = nameKey(name);
    if (navigator.onLine) {
      try {
        const lg = await FB.getDoc('logins', nk);
        if (!lg) return { error: 'Name oder Passwort falsch.' };
        let s;
        try { s = await FB.signIn(lg.email, password); }
        catch (e) { if (e.code === 'NETWORK') throw e; return { error: 'Name oder Passwort falsch.' }; }
        const m = await FB.getDoc('members', s.uid, s.idToken);
        if (!m || m.active === false) return { error: 'Dieses Konto ist gesperrt oder wurde gelöscht.' };
        saveAuth(s);
        const member = { uid: s.uid, name: m.name, perms: m.perms || [], active: true, email: lg.email };
        await cacheMember(member, password);
        memoryPassword = null;
        startSession(member, persist);
        return { user: member };
      } catch (e) {
        if (e.code !== 'NETWORK') return { error: 'Anmeldung fehlgeschlagen (' + e.code + ').' };
        // keine Verbindung → Offline-Anmeldung versuchen
      }
    }
    const c = cache()[nk];
    if (!c || !c.verifier) {
      return { error: 'Keine Internetverbindung. Ohne Internet können sich nur Benutzer anmelden, die auf diesem Gerät schon einmal online angemeldet waren.' };
    }
    if (!c.active || await hash(password, c.verifier.salt) !== c.verifier.hash) return { error: 'Name oder Passwort falsch.' };
    const member = { uid: c.uid, name: c.name, perms: c.perms, active: true, email: c.email };
    memoryPassword = loadAuth()?.uid === c.uid ? null : password;
    startSession(member, persist);
    return { user: member, offline: true };
  }

  // Erst-Einrichtung: erstes Admin-Konto (nur möglich, solange config/setup nicht existiert)
  async function createFirstAdmin(name, password) {
    const email = FB.newEmail();
    const s = await FB.signUp(email, password);
    const now = new Date().toISOString();
    await FB.commit([
      { coll: 'members', id: s.uid, data: { name, perms: ['admin'], active: true, createdAt: now } },
      { coll: 'logins', id: nameKey(name), data: { email, uid: s.uid, name } },
      { coll: 'config', id: 'setup', data: { createdAt: now, by: s.uid } },
    ], s.idToken);
    saveAuth(s);
    const member = { uid: s.uid, name, perms: ['admin'], active: true, email };
    await cacheMember(member, password);
    startSession(member, false);
    return member;
  }

  // ---------- Admin-Funktionen (brauchen Internet) ----------
  const memberData = m => ({ name: m.name, perms: m.perms || [], active: m.active !== false, createdAt: m.createdAt || new Date().toISOString() });

  async function listMembers() {
    const list = await FB.query('members', {}, await token());
    return list.map(m => ({ ...m, uid: m.id })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  // Selbst-Registrierung: neues Konto nur mit dem Recht „einstellungen“ – weitere Rechte gibt ein Admin frei.
  const NEW_USER_PERMS = ['einstellungen'];
  async function register(name, password) {
    if (await FB.getDoc('logins', nameKey(name))) return { error: `Der Name „${name}“ ist schon vergeben.` };
    const email = FB.newEmail();
    const s = await FB.signUp(email, password);
    try {
      await FB.commit([
        { coll: 'members', id: s.uid, data: memberData({ name, perms: NEW_USER_PERMS }) },
        { coll: 'logins', id: nameKey(name), data: { email, uid: s.uid, name } },
      ], s.idToken);
    } catch (e) {
      if (e.status === 403) return { error: `Der Name „${name}“ ist schon vergeben.` };
      throw e;
    }
    saveAuth(s);
    const member = { uid: s.uid, name, perms: NEW_USER_PERMS, active: true, email };
    await cacheMember(member, password);
    startSession(member, false);
    return { user: member };
  }
  // Konto wartet auf Freigabe: hat noch keines der Rechte außer „einstellungen“
  const isWaiting = u => !!u && !(u.perms || []).some(p => p !== 'einstellungen');

  async function updateMember(m, changes) {
    await FB.commit([{ coll: 'members', id: m.uid, data: memberData({ ...m, ...changes }) }], await token());
  }

  async function deleteMember(m) {
    await FB.commit([{ coll: 'members', id: m.uid, delete: true }, { coll: 'logins', id: nameKey(m.name), delete: true }], await token());
  }

  // Neues Passwort: Es wird ein neuer Firebase-Zugang angelegt und der alte stillgelegt
  // (ohne Server-Programm kann Firebase das Passwort eines anderen nicht direkt ändern).
  async function resetPassword(m, password) {
    const tok = await token();
    const email = FB.newEmail();
    const s = await FB.signUp(email, password);
    await FB.commit([
      { coll: 'members', id: s.uid, data: memberData(m) },
      { coll: 'members', id: m.uid, delete: true },
      { coll: 'logins', id: nameKey(m.name), data: { email, uid: s.uid, name: m.name } },
    ], tok);
    if (current && m.uid === current.uid) {
      saveAuth(s);
      const member = { ...current, uid: s.uid, email };
      await cacheMember(member, password);
      startSession(member, !!localStorage.getItem(UI_KEY));
    }
  }

  const isAdmin = u => !!u && u.active !== false && (u.perms || []).includes('admin');
  const can = perm => !!current && (isAdmin(current) || (current.perms || []).includes(perm));

  return {
    PERMS, MIN_PASSWORD, available, user: () => current, can, isAdmin, restore, logout, login, token,
    refreshMember, setupStatus, createFirstAdmin, register, isWaiting, listMembers, updateMember, deleteMember, resetPassword,
  };
})();
