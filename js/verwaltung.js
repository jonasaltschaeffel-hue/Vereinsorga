/* =====================================================================
   Verwaltung: Artikel, Flotte, Seiten & Reiter (admin/verwaltung.html)
   ===================================================================== */
(() => {
  const app = document.getElementById('app');
  const base = new URL('..', location.href);
  const $ = (s, el = document) => el.querySelector(s);
  const esc = LSVCms.esc;
  const plain = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
  const toast = (msg, bad) => { const t = $('#toast'); t.textContent = msg; t.style.background = bad ? '#a3261a' : '#1d7a3a'; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', bad ? 7000 : 4000); };
  const busy = on => { $('#busy').style.display = on ? 'grid' : 'none'; };
  const img = p => p ? new URL(p, base).href + '?v=' + Date.now() : '';
  let gh = null, tab = 'artikel';

  async function run(fn, okMsg){
    busy(true);
    try { await fn(); if (okMsg) toast(okMsg + ' ✓ – auf der Website in ca. 1 Minute sichtbar'); await render(); }
    catch (err){ toast(err.message, true); }
    finally { busy(false); }
  }
  function dialog(title, fields, submitText){
    return new Promise(resolve => {
      const m = document.createElement('div'); m.className = 'modal';
      m.innerHTML = `<form class="dialog"><h3>${title}</h3>${fields}<div class="actions"><button type="button" class="b" data-x>Abbrechen</button><button class="b main">${submitText}</button></div></form>`;
      document.body.appendChild(m);
      $('[data-x]', m).onclick = () => { m.remove(); resolve(null); };
      $('form', m).onsubmit = ev => { ev.preventDefault(); const fd = new FormData(ev.target); m.remove(); resolve(fd); };
      const first = $('input, textarea, select', m); if (first) first.focus();
    });
  }
  const fdObj = fd => { const o = {}; for (const [k, v] of fd.entries()) o[k] = v; return o; };

  /* ---------------- Anmeldung ---------------- */
  function start(){
    const s = LSVGit.session.get();
    if (!s){ return showLogin(); }
    gh = LSVGit.client(s.cfg, s.token);
    $('#logout').hidden = false;
    $('#logout').onclick = () => { LSVGit.session.clear(); location.reload(); };
    render();
  }
  function showLogin(){
    app.innerHTML = `<form class="login"><h2>Anmelden</h2><p class="hint">Mit dem Passwort des Bearbeitungsmodus.</p><input name="pw" type="password" required autocomplete="current-password" placeholder="Passwort"><div class="err"></div><button class="b main">Anmelden</button></form>`;
    const f = $('form', app); f.pw.focus();
    f.onsubmit = async ev => {
      ev.preventDefault(); $('.err', f).textContent = 'Prüfe …';
      try {
        const cfg = await LSVGit.loadConfig(base);
        const token = await LSVGit.decryptToken(cfg, f.pw.value);
        const pub = {owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, pfad: cfg.pfad};
        if (!await LSVGit.client(pub, token).check()) throw new Error('Kein Schreibzugriff.');
        LSVGit.session.set(pub, token); start();
      } catch (err){ $('.err', f).textContent = err.message; }
    };
  }

  /* ---------------- Darstellung ---------------- */
  async function render(){
    app.innerHTML = `
      <nav class="tabs">
        <button data-t="artikel">Artikel</button><button data-t="flotte">Flotte</button><button data-t="seiten">Seiten &amp; Reiter</button>
      </nav>
      <main><div class="panel" id="panel"><p class="hint">Lade aktuellen Stand aus GitHub …</p></div></main>`;
    app.querySelectorAll('nav.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.t === tab); b.onclick = () => { tab = b.dataset.t; render(); }; });
    const panel = $('#panel');
    try {
      if (tab === 'artikel') await renderArticles(panel);
      if (tab === 'flotte') await renderFleet(panel);
      if (tab === 'seiten') await renderSite(panel);
    } catch (err){ panel.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  }

  /* ---------------- Artikel ---------------- */
  async function renderArticles(panel){
    const st = await LSVCms.articles.load(gh);
    panel.innerHTML = `<h2>Artikel</h2><p class="hint">Die ersten drei stehen auf der Startseite unter „Aktuelles“, alle im Archiv „Alle Meldungen“.</p>
      <p><button class="b main" id="new">+ Neuer Artikel</button></p><div id="list"></div>`;
    const list = $('#list', panel);
    st.cards.forEach((c, i) => {
      const r = document.createElement('div'); r.className = 'row';
      r.innerHTML = `<img src="${img(c.img)}" alt="" onerror="this.style.visibility='hidden'">
        <div class="info"><div class="t">${c.titel}${i < 3 ? '<span class="badge">Startseite</span>' : ''}</div><div class="s">${esc(c.datum)} · ${c.kurz}</div></div>
        <div class="btns"><button class="b" data-a="up" ${i === 0 ? 'disabled' : ''} title="nach oben">↑</button><button class="b" data-a="down" ${i === st.cards.length - 1 ? 'disabled' : ''} title="nach unten">↓</button>
        <button class="b" data-a="edit">Bearbeiten</button><a class="b" href="../aktuelles/${c.slug}.html" target="_blank">Öffnen</a><button class="b del" data-a="del">Löschen</button></div>`;
      r.onclick = async ev => {
        const a = ev.target.closest('button') && ev.target.closest('button').dataset.a; if (!a) return;
        if (a === 'up' || a === 'down') run(() => LSVCms.articles.move(gh, c.slug, a === 'up' ? -1 : 1), 'Reihenfolge geändert');
        if (a === 'del' && confirm(`Artikel „${plain(c.titel)}“ wirklich löschen?\nDie Artikelseite wird entfernt (über die Commits bei GitHub wiederherstellbar).`)) run(() => LSVCms.articles.remove(gh, c.slug), 'Artikel gelöscht');
        if (a === 'edit'){
          const iso = /^(\d{2})\.(\d{2})\.(\d{4})$/.test(c.datum) ? c.datum.split('.').reverse().join('-') : '';
          const fd = await dialog('Artikel bearbeiten', `
            <label>Titel<input name="titel" required maxlength="140" value="${esc(plain(c.titel))}"></label>
            <label>Datum<input name="datum" type="date" value="${iso}"></label>
            <label>Kurztext auf der Karte<textarea name="kurztext" rows="3" maxlength="500">${esc(plain(c.kurz))}</textarea></label>
            <label>Neues Bild <small>leer lassen = Bild behalten</small><input name="bild" type="file" accept="image/jpeg,image/png,image/webp"></label>
            <p class="hint">Den eigentlichen Artikeltext bearbeitest du direkt auf der Artikelseite.</p>`, 'Speichern');
          if (fd) run(() => LSVCms.articles.update(gh, c.slug, fdObj(fd)), 'Artikel geändert');
        }
      };
      list.appendChild(r);
    });
    $('#new', panel).onclick = async () => {
      const fd = await dialog('Neuer Artikel', `
        <label>Titel<input name="titel" required maxlength="140"></label>
        <label>Datum<input name="datum" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label>
        <label>Kurztext für die Karte (ca. 2 Sätze)<textarea name="kurztext" required rows="3" maxlength="500"></textarea></label>
        <label>Artikeltext<small>Leerzeile = neuer Absatz · Zeile mit „## “ = Zwischenüberschrift</small><textarea name="text" rows="8"></textarea></label>
        <label>Bild (optional)<input name="bild" type="file" accept="image/jpeg,image/png,image/webp"></label>`, 'Artikel anlegen');
      if (fd) run(() => LSVCms.articles.create(gh, fdObj(fd)), 'Artikel angelegt');
    };
  }

  /* ---------------- Flotte ---------------- */
  async function renderFleet(panel){
    const st = await LSVCms.fleet.load(gh);
    panel.innerHTML = `<h2>Flotte</h2><p class="hint">Reihenfolge wie auf der Startseite. Verkaufte Flugzeuge einfach auf „Ehemalig“ stellen. Texte und technische Daten bearbeitest du direkt auf der Website im Bearbeitungsmodus.</p>
      <p><button class="b main" id="new">+ Flugzeug hinzufügen</button></p><div id="list"></div>`;
    const list = $('#list', panel);
    st.planes.forEach((p, i) => {
      const r = document.createElement('div'); r.className = 'row';
      r.innerHTML = `<img src="${img(p.img)}" alt="" onerror="this.style.visibility='hidden'">
        <div class="info"><div class="t">${p.name}</div><div class="s">${p.meta}</div></div>
        <select data-a="kind" title="Art"><option value="segel"${p.kind === 'segel' ? ' selected' : ''}>Segelflugzeug</option><option value="motor"${p.kind === 'motor' ? ' selected' : ''}>Motorflugzeug</option><option value="ehemalig"${p.kind === 'ehemalig' ? ' selected' : ''}>Ehemalig</option></select>
        <div class="btns"><button class="b" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="b" data-a="down" ${i === st.planes.length - 1 ? 'disabled' : ''}>↓</button>
        <a class="b" href="../${p.href}" target="_blank">Öffnen</a><button class="b del" data-a="del">Löschen</button></div>`;
      $('select', r).onchange = e => run(() => LSVCms.fleet.setKind(gh, p.slug, e.target.value), 'Art geändert');
      r.onclick = ev => {
        const a = ev.target.closest('button') && ev.target.closest('button').dataset.a; if (!a) return;
        if (a === 'up' || a === 'down') run(() => LSVCms.fleet.move(gh, p.slug, a === 'up' ? -1 : 1), 'Reihenfolge geändert');
        if (a === 'del' && confirm(`„${plain(p.name)}“ wirklich aus der Flotte löschen?\nDie Detailseite wird entfernt.`)) run(() => LSVCms.fleet.remove(gh, p.slug), 'Flugzeug gelöscht');
      };
      list.appendChild(r);
    });
    $('#new', panel).onclick = async () => {
      const fd = await dialog('Flugzeug hinzufügen', `
        <label>Name<input name="name" required placeholder="z. B. ASK 21"></label>
        <label>Art<select name="kind"><option value="segel">Segelflugzeug</option><option value="motor">Motorflugzeug</option><option value="ehemalig">Ehemaliges Flugzeug</option></select></label>
        <label>Zeile über dem Namen<input name="meta" placeholder="z. B. Doppelsitzer · Schulung"></label>
        <label>Kurztext für die Karte<textarea name="kurz" rows="2"></textarea></label>
        <label>Beschreibung<small>Leerzeile = neuer Absatz</small><textarea name="text" rows="4"></textarea></label>
        <label>Technische Daten<small>eine Zeile pro Wert, z. B. „Spannweite: 17 m“</small><textarea name="daten" rows="5" placeholder="Kennzeichen: D-1234&#10;Baujahr: 1990&#10;Spannweite: 15 m"></textarea></label>
        <label>Bild (Querformat)<input name="bild" type="file" accept="image/jpeg,image/png,image/webp"></label>`, 'Hinzufügen');
      if (fd) run(() => LSVCms.fleet.add(gh, fdObj(fd)), 'Flugzeug hinzugefügt');
    };
  }

  /* ---------------- Seiten & Reiter ---------------- */
  async function renderSite(panel){
    const st = await LSVCms.site.load(gh);
    const pageOpts = sel => [`<option value="">– Seite wählen –</option>`]
      .concat(st.pages.map(p => `<option value="${p.path}"${p.path === sel ? ' selected' : ''}>${esc(p.titel)}</option>`))
      .concat([`<option value="__url"${sel && !st.pages.some(p => p.path === sel) ? ' selected' : ''}>Andere Adresse …</option>`]).join('');
    panel.innerHTML = `<h2>Reiter in der Kopfleiste</h2><p class="hint">Gilt für alle Seiten gleichzeitig.</p>
      <div id="tabs"></div>
      <p class="btns" style="margin-top:12px"><button class="b" id="addtab">+ Reiter</button><button class="b main" id="savetabs">Reiter speichern</button></p>
      <div class="section"><h2>Unterseiten</h2><p class="hint">Seiten im Ordner „seiten“.</p>
      <p><button class="b main" id="newpage">+ Neue Seite</button></p><div id="pages"></div></div>`;
    let tabs = st.tabs.map(t => ({...t}));
    const tabsEl = $('#tabs', panel);
    const drawTabs = () => {
      tabsEl.innerHTML = '';
      tabs.forEach((t, i) => {
        const r = document.createElement('div'); r.className = 'tabrow';
        const known = st.pages.some(p => p.path === t.href);
        r.innerHTML = `<input value="${esc(t.label)}" placeholder="Beschriftung"><select>${pageOpts(t.href)}</select>
          <input class="url" value="${known ? '' : esc(t.href)}" placeholder="https://…" style="${known ? 'display:none' : ''}">
          <button class="b" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="b" data-a="down" ${i === tabs.length - 1 ? 'disabled' : ''}>↓</button><button class="b del" data-a="del">✕</button>`;
        const [lab, url] = r.querySelectorAll('input'), sel = $('select', r);
        lab.oninput = () => t.label = lab.value;
        sel.onchange = () => { if (sel.value === '__url'){ url.style.display = ''; t.href = url.value; } else { url.style.display = 'none'; t.href = sel.value; } };
        url.oninput = () => t.href = url.value.trim();
        r.onclick = ev => {
          const a = ev.target.closest('button') && ev.target.closest('button').dataset.a; if (!a) return;
          if (a === 'del') tabs.splice(i, 1);
          if (a === 'up') [tabs[i - 1], tabs[i]] = [tabs[i], tabs[i - 1]];
          if (a === 'down') [tabs[i + 1], tabs[i]] = [tabs[i], tabs[i + 1]];
          drawTabs();
        };
        tabsEl.appendChild(r);
      });
    };
    drawTabs();
    $('#addtab', panel).onclick = () => { tabs.push({label: 'Neuer Reiter', href: ''}); drawTabs(); };
    $('#savetabs', panel).onclick = () => {
      const bad = tabs.find(t => !t.label.trim() || !t.href);
      if (bad) return toast('Bitte bei jedem Reiter Beschriftung und Ziel angeben.', true);
      run(() => LSVCms.site.saveTabs(gh, tabs.map(t => ({label: t.label.trim(), href: t.href}))), 'Reiter gespeichert');
    };
    const pagesEl = $('#pages', panel);
    st.pages.forEach(p => {
      const r = document.createElement('div'); r.className = 'row';
      const inTabs = st.tabs.some(t => t.href === p.path);
      r.innerHTML = `<div class="info"><div class="t">${esc(p.titel)}${inTabs ? '<span class="badge">Reiter</span>' : ''}</div><div class="s">${p.path}</div></div>
        <div class="btns"><a class="b" href="../${p.path}" target="_blank">Öffnen</a><button class="b del" data-a="del">Löschen</button></div>`;
      r.onclick = ev => {
        if (!(ev.target.closest('button') && ev.target.closest('button').dataset.a === 'del')) return;
        if (confirm(`Seite „${p.titel}“ wirklich löschen?${inTabs ? '\nDer zugehörige Reiter wird ebenfalls entfernt.' : ''}\nLinks auf diese Seite von anderen Seiten bitte danach anpassen.`))
          run(() => LSVCms.site.deletePage(gh, p.path), 'Seite gelöscht');
      };
      pagesEl.appendChild(r);
    });
    $('#newpage', panel).onclick = async () => {
      const fd = await dialog('Neue Seite', `
        <label>Titel<input name="titel" required maxlength="80" placeholder="z. B. Fluglager 2027"></label>
        <label>Kleine Zeile über dem Titel<input name="eyebrow" maxlength="80" placeholder="z. B. Jugend"></label>
        <label class="cb"><input type="checkbox" name="addTab" checked> Als Reiter in der Kopfleiste anzeigen</label>`, 'Seite anlegen');
      if (fd){ const o = fdObj(fd); o.addTab = fd.has('addTab'); run(() => LSVCms.site.createPage(gh, o), 'Seite angelegt'); }
    };
  }

  start();
})();
