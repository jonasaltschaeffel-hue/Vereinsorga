// Benutzer, Passwörter und Rechte.
// Passwörter werden nie im Klartext gespeichert, sondern mit PBKDF2 (SHA-256,
// eigenes Salz pro Benutzer) gehasht. Benutzer sind normale Datensätze (type 'user')
// und kommen so per Sicherung auf andere Geräte.
//
// Hinweis: Die Anmeldung schützt die App auf einem Gerät (z. B. Helfer am iPad).
// Da es keinen Server gibt, ist sie kein Schutz gegen jemanden, der direkt
// auf den Speicher des Geräts zugreift.
const Auth = (() => {
  const PERMS = [
    ['ausgabe', 'Getränkeausgabe durchführen'],
    ['einrichtung', 'Personen & Getränke verwalten'],
    ['abrechnung', 'Abrechnung & Zahlungen'],
    ['statistik', 'Statistik ansehen'],
    ['einstellungen', 'Einstellungen & Sicherung'],
    ['admin', 'Admin: Benutzer & Rechte verwalten (darf alles)'],
  ];
  const MIN_PASSWORD = 4;
  const enc = new TextEncoder();
  const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const randHex = n => toHex(crypto.getRandomValues(new Uint8Array(n)));
  const key = name => String(name ?? '').trim().toLowerCase();
  const available = () => !!(window.crypto && crypto.subtle);

  async function hash(password, salt) {
    const k = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' }, k, 256);
    return toHex(bits);
  }

  let current = null;

  async function users() {
    return (await DB.all('user')).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  async function findByName(name) {
    return (await DB.all('user')).find(u => key(u.name) === key(name));
  }

  async function createUser(name, password, perms) {
    const salt = randHex(16);
    return DB.save('user', { name: name.trim(), salt, hash: await hash(password, salt), perms, active: true });
  }

  async function setPassword(user, password) {
    const salt = randHex(16);
    return DB.save('user', { ...user, salt, hash: await hash(password, salt) });
  }

  function remember(id, persist) {
    sessionStorage.setItem('authUser', id);
    if (persist) localStorage.setItem('authUser', id); else localStorage.removeItem('authUser');
  }

  async function login(name, password, persist) {
    const u = await findByName(name);
    if (!u || u.active === false) return null;
    if (await hash(password, u.salt) !== u.hash) return null;
    current = u;
    remember(u.id, persist);
    return u;
  }

  function signIn(user, persist) {
    current = user;
    remember(user.id, persist);
  }

  // Bei jedem Seitenwechsel neu laden, damit geänderte Rechte sofort gelten.
  async function restore() {
    const id = sessionStorage.getItem('authUser') || localStorage.getItem('authUser');
    if (!id) { current = null; return null; }
    const u = (await DB.all('user')).find(x => x.id === id && x.active !== false);
    if (!u) { logout(); return null; }
    current = u;
    return u;
  }

  function logout() {
    current = null;
    sessionStorage.removeItem('authUser');
    localStorage.removeItem('authUser');
  }

  const isAdmin = u => !!u && u.active !== false && (u.perms || []).includes('admin');
  const can = perm => !!current && (isAdmin(current) || (current.perms || []).includes(perm));

  // ---------- Notfall-Code (setzt ein Admin-Passwort zurück) ----------
  const normCode = c => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function newRecoveryCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne verwechselbare Zeichen
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let s = '';
    for (let i = 0; i < 16; i++) {
      s += chars[bytes[i] % chars.length];
      if (i % 4 === 3 && i < 15) s += '-';
    }
    return s;
  }
  async function setRecoveryCode(code) {
    const salt = randHex(16);
    const old = (await DB.all('authRecovery'))[0];
    await DB.save('authRecovery', { id: old?.id || 'recovery', salt, hash: await hash(normCode(code), salt) });
  }
  async function checkRecoveryCode(code) {
    const r = (await DB.all('authRecovery'))[0];
    return !!r && await hash(normCode(code), r.salt) === r.hash;
  }

  return {
    PERMS, MIN_PASSWORD, available, users, findByName, createUser, setPassword, login, signIn, restore,
    logout, can, isAdmin, user: () => current, newRecoveryCode, setRecoveryCode, checkRecoveryCode,
  };
})();
