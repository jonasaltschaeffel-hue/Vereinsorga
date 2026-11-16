/* =====================================================================
   LSV Regensburg – Speichern über GitHub (für GitHub Pages)

   Sicherheit: Der GitHub-Zugangsschlüssel (Fine-grained Token, nur für
   dieses Repository, nur "Contents: Read and write") liegt verschlüsselt
   in admin/zugang.json. Verschlüsselt wird im Browser mit AES-GCM; der
   Schlüssel dafür wird aus deinem Passwort abgeleitet (PBKDF2-SHA-256,
   600.000 Durchläufe – absichtlich langsam gegen Passwort-Raten).
   Ohne Passwort ist der Token nicht lesbar.
   ===================================================================== */
window.LSVGit = (() => {
  const ITER = 600000;
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ---------- Base64-Helfer (auch für UTF-8 und Binärdaten) ----------
  const bytesToB64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64ToBytes = b64 => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0));
  const textToB64 = t => bytesToB64(enc.encode(t));
  const b64ToText = b => dec.decode(b64ToBytes(b));

  // ---------- Verschlüsselung ----------
  async function deriveKey(password, salt, iter){
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  }
  async function encryptToken(token, password){
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITER);
    const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, enc.encode(token)));
    return {kdf: 'PBKDF2-SHA256', iter: ITER, salt: bytesToB64(salt), iv: bytesToB64(iv), token: bytesToB64(ct)};
  }
  async function decryptToken(cfg, password){
    const key = await deriveKey(password, b64ToBytes(cfg.salt), cfg.iter);
    try {
      const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64ToBytes(cfg.iv)}, key, b64ToBytes(cfg.token));
      return dec.decode(pt);
    } catch { throw new Error('Das Passwort ist falsch.'); }
  }

  // ---------- Zugangsdaten der Website ----------
  async function loadConfig(baseUrl){
    const r = await fetch(new URL('admin/zugang.json', baseUrl).href + '?v=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('Der Bearbeitungsmodus ist noch nicht eingerichtet (admin/einrichten.html).');
    return r.json();
  }

  // ---------- GitHub-Zugriff ----------
  function client(cfg, token){
    const repo = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
    const branch = cfg.branch || 'main';
    const prefix = cfg.pfad ? cfg.pfad.replace(/^\/|\/$/g, '') + '/' : '';   // falls die Website in einem Unterordner des Repos liegt
    const gh = async (path, opts = {}) => {
      const r = await fetch(path.startsWith('http') ? path : repo + path, {
        ...opts, cache: 'no-store',
        headers: {'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? {'Content-Type': 'application/json'} : {})}
      });
      if (!r.ok){
        let msg = r.status + ' ' + r.statusText;
        try { const j = await r.json(); if (j.message) msg = j.message; } catch {}
        if (r.status === 401) msg = 'GitHub-Schlüssel ungültig oder abgelaufen – bitte unter admin/einrichten.html neu einrichten.';
        if (r.status === 403 || r.status === 404) msg = 'Kein Schreibzugriff auf das Repository (' + msg + ').';
        throw new Error(msg);
      }
      return r.status === 204 ? null : r.json();
    };
    return {
      /** Prüft Zugriff; liefert true, wenn Schreiben erlaubt ist */
      async check(){
        const info = await gh('');
        return !!(info.permissions && (info.permissions.push || info.permissions.admin));
      },
      /** Aktuelle Version einer Datei direkt aus dem Repository (nicht aus dem Pages-Zwischenspeicher) */
      async getText(path){
        const j = await gh('/contents/' + encodeURI(prefix + path) + '?ref=' + encodeURIComponent(branch) + '&t=' + Date.now());
        if (j.content !== undefined && j.encoding === 'base64' && j.content !== '') return b64ToText(j.content);
        const blob = await gh('/git/blobs/' + j.sha);      // große Dateien
        return b64ToText(blob.content);
      },
      /** Alle Dateipfade der Website (relativ zur Website-Wurzel) */
      async listFiles(){
        const ref = await gh('/git/ref/heads/' + encodeURIComponent(branch));
        const t = await gh('/git/trees/' + ref.object.sha + '?recursive=1');
        return t.tree.filter(e => e.type === 'blob' && e.path.startsWith(prefix)).map(e => e.path.slice(prefix.length));
      },
      /** Mehrere Dateien in EINEM Commit speichern bzw. löschen.
          files: [{path, text} | {path, bytes} | {path, remove: true}] */
      async commit(files, message){
        const ref = await gh('/git/ref/heads/' + encodeURIComponent(branch));
        const parent = await gh('/git/commits/' + ref.object.sha);
        const tree = [];
        for (const f of files){
          if (f.remove){ tree.push({path: prefix + f.path, mode: '100644', type: 'blob', sha: null}); continue; }
          const content = f.bytes ? bytesToB64(f.bytes) : textToB64(f.text);
          const blob = await gh('/git/blobs', {method: 'POST', body: JSON.stringify({content, encoding: 'base64'})});
          tree.push({path: prefix + f.path, mode: '100644', type: 'blob', sha: blob.sha});
        }
        const newTree = await gh('/git/trees', {method: 'POST', body: JSON.stringify({base_tree: parent.tree.sha, tree})});
        const c = await gh('/git/commits', {method: 'POST', body: JSON.stringify({message, tree: newTree.sha, parents: [ref.object.sha]})});
        await gh('/git/refs/heads/' + encodeURIComponent(branch), {method: 'PATCH', body: JSON.stringify({sha: c.sha})});
        return c.sha;
      }
    };
  }

  // ---------- Angemeldet bleiben (nur in diesem Browser-Tab) ----------
  const SKEY = 'lsv-edit-session';
  const session = {
    get(){ try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch { return null; } },
    set(cfg, token){ sessionStorage.setItem(SKEY, JSON.stringify({cfg, token, t: Date.now()})); },
    clear(){ sessionStorage.removeItem(SKEY); }
  };

  return {encryptToken, decryptToken, loadConfig, client, session, b64ToText, textToB64};
})();
