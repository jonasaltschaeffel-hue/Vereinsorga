/* =====================================================================
   LSV Regensburg – Verwaltung von Artikeln, Flotte, Seiten und Reitern
   (gemeinsam genutzt von Editor und Verwaltungsseite)

   Grundsätze:
   - Es wird immer der aktuelle Stand aus GitHub gelesen.
   - Jede Aktion ist EIN Commit (alle betroffenen Dateien zusammen).
   - Artikel: das Archiv aktuelles/index.html ist die Hauptliste;
     die Startseite zeigt automatisch die ersten 3 daraus.
   - Flotte: die Karten in index.html (#fleet) sind die Hauptliste.
   ===================================================================== */
window.LSVCms = (() => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rid = p => p + Math.random().toString(36).slice(2, 8);
  const slugify = t => (String(t).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'seite';
  const toRoot = path => '../'.repeat(path.split('/').length - 1);
  const parse = src => new DOMParser().parseFromString(src, 'text/html');
  const serialize = (doc, src) => { const dt = /^\s*<!doctype[^>]*>/i.exec(src); return (dt ? dt[0] : '<!doctype html>') + '\n' + doc.documentElement.outerHTML + '\n'; };
  const unique = (slug, taken) => { let s = slug, n = 2; while (taken.includes(s)) s = slug + '-' + n++; return s; };
  const dateDe = d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('.') : d;

  /* ---------- Bilder ---------- */
  async function prepareImage(file, maxW = 2000){
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Nur JPG-, PNG- oder WebP-Bilder sind erlaubt.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Das Bild ist größer als 25 MB.');
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, maxW / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const png = file.type === 'image/png';
    const blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.85));
    return {bytes: new Uint8Array(await blob.arrayBuffer()), ext: png ? 'png' : 'jpg', url: URL.createObjectURL(blob)};
  }
  const picHtml = (id, src) => `<div class="pic placeholder"><img data-e="${id}" src="${esc(src)}" alt="" onerror="this.hidden=true" onload="this.parentElement.classList.remove('placeholder')"></div>`;

  /* =================================================================
     ARTIKEL
     ================================================================= */
  const ARCH = 'aktuelles/index.html';
  const region = (src, marker) => {
    const re = new RegExp('(<!-- ' + marker + ':START -->)([\\s\\S]*?)(<!-- ' + marker + ':END -->)');
    const m = re.exec(src); if (!m) throw new Error('Markierung ' + marker + ' fehlt.');
    return {inner: m[2], set: html => src.slice(0, m.index) + m[1] + '\n' + html + '        ' + m[3] + src.slice(m.index + m[0].length)};
  };
  function parseArticleCards(html){
    const d = parse('<div>' + html + '</div>');
    return [...d.querySelectorAll('a.news-card')].map(a => {
      const href = a.getAttribute('href'), img = a.querySelector('img');
      const q = s => a.querySelector(s);
      return {
        slug: href.split('/').pop().replace(/\.html$/, ''),
        datum: q('.date') ? q('.date').textContent.trim() : '',
        titel: q('h3') ? q('h3').innerHTML.trim() : '',
        kurz: q('p') ? q('p').innerHTML.trim() : '',
        img: img ? img.getAttribute('src').replace(/^(\.\.\/)+/, '') : '',
        ids: {cd: q('.date') && q('.date').dataset.e, ct: q('h3') && q('h3').dataset.e, ck: q('p') && q('p').dataset.e, img: img && img.dataset.e}
      };
    });
  }
  function articleCard(c, inArchive){
    const ids = c.ids || {}; const id = rid('n');
    const href = inArchive ? `${c.slug}.html` : `aktuelles/${c.slug}.html`;
    const src = (inArchive ? '../' : '') + c.img;
    return `        <a class="news-card" href="${href}">\n          ${picHtml(ids.img || id + '-img', src)}\n          <div class="body">\n` +
      `            <span class="date" data-e="${ids.cd || id + '-cd'}">${esc(c.datum)}</span>\n            <h3 data-e="${ids.ct || id + '-ct'}">${c.titel}</h3>\n` +
      `            <p data-e="${ids.ck || id + '-ck'}">${c.kurz}</p>\n            <span class="more">Weiterlesen →</span>\n          </div>\n        </a>\n`;
  }
  const articles = {
    async load(gh){
      const [archSrc, indexSrc] = await Promise.all([gh.getText(ARCH), gh.getText('index.html')]);
      return {archSrc, indexSrc, cards: parseArticleCards(region(archSrc, 'ARCHIV').inner)};
    },
    /** Archiv + Startseite (erste 3) aus der Liste neu schreiben */
    render(state, cards){
      const arch = region(state.archSrc, 'ARCHIV').set(cards.map(c => articleCard(c, true)).join(''));
      const idx = region(state.indexSrc, 'NEWS').set(cards.slice(0, 3).map(c => articleCard(c, false)).join(''));
      return [{path: ARCH, text: arch}, {path: 'index.html', text: idx}];
    },
    async create(gh, f){
      const titel = (f.titel || '').trim(), kurz = (f.kurztext || '').trim(), text = (f.text || '').trim();
      if (!titel || !kurz || !/^\d{4}-\d{2}-\d{2}$/.test(f.datum || '')) throw new Error('Bitte Titel, Datum und Kurztext ausfüllen.');
      const st = await this.load(gh);
      const slug = unique(slugify(titel), st.cards.map(c => c.slug).concat(['index']));
      const id = rid('n'), files = [];
      let img = `img/aktuelles/${slug}.jpg`;
      if (f.bild && f.bild.size){ const im = await prepareImage(f.bild); img = `img/aktuelles/${slug}.${im.ext}`; files.push({path: img, bytes: im.bytes}); }
      let body = '', k = 0;
      text.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean).forEach(p => {
        k++;
        body += p.startsWith('## ') ? `    <h2 data-e="${id}-h${k}">${esc(p.slice(3))}</h2>\n` : `    <p data-e="${id}-p${k}">${esc(p).replace(/\r?\n/g, '<br>')}</p>\n`;
      });
      if (!body) body = `    <p data-e="${id}-p1">${esc(kurz)}</p>\n`;
      const tpl = await gh.getText('admin/vorlagen/artikel.html');
      const page = tpl.split('{{TITEL_TEXT}}').join(esc(titel)).split('{{TITEL}}').join(esc(titel)).split('{{DATUM}}').join(esc(dateDe(f.datum)))
        .split('{{ID}}').join(id).split('{{BILD}}').join(picHtml(id + '-img', '../' + img)).split('{{TEXT}}').join(body.trimEnd());
      files.push({path: `aktuelles/${slug}.html`, text: page});
      const card = {slug, datum: dateDe(f.datum), titel: esc(titel), kurz: esc(kurz), img};
      files.push(...this.render(st, [card, ...st.cards]));
      await gh.commit(files, `Neuer Artikel: ${titel}`);
      return `aktuelles/${slug}.html`;
    },
    async remove(gh, slug){
      const st = await this.load(gh);
      const c = st.cards.find(x => x.slug === slug); if (!c) throw new Error('Artikel nicht gefunden.');
      const files = this.render(st, st.cards.filter(x => x.slug !== slug));
      files.push({path: `aktuelles/${slug}.html`, remove: true});
      await gh.commit(files, `Artikel gelöscht: ${c.titel.replace(/<[^>]+>/g, '')}`);
    },
    async move(gh, slug, dir){
      const st = await this.load(gh);
      const i = st.cards.findIndex(x => x.slug === slug), j = i + dir;
      if (i < 0 || j < 0 || j >= st.cards.length) return;
      const cards = st.cards.slice(); [cards[i], cards[j]] = [cards[j], cards[i]];
      await gh.commit(this.render(st, cards), 'Artikel-Reihenfolge geändert');
    },
    /** Karte und Artikelseite gemeinsam ändern (Titel, Datum, Kurztext, Bild) */
    async update(gh, slug, f){
      const st = await this.load(gh);
      const c = st.cards.find(x => x.slug === slug); if (!c) throw new Error('Artikel nicht gefunden.');
      const files = [];
      if (f.titel !== undefined) c.titel = esc(f.titel.trim());
      if (f.datum) c.datum = dateDe(f.datum);
      if (f.kurztext !== undefined) c.kurz = esc(f.kurztext.trim());
      if (f.bild && f.bild.size){ const im = await prepareImage(f.bild); c.img = `img/aktuelles/${slug}-${Date.now().toString(36)}.${im.ext}`; files.push({path: c.img, bytes: im.bytes}); }
      const pagePath = `aktuelles/${slug}.html`;
      try {
        const src = await gh.getText(pagePath), d = parse(src);
        const plain = c.titel.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        const h1 = d.querySelector('main h1'); if (h1) h1.textContent = plain;
        const dt = d.querySelector('main .date'); if (dt) dt.textContent = c.datum;
        if (d.title) d.title = plain + ' – LSV Regensburg';
        const im = d.querySelector('main .pic img'); if (im && f.bild && f.bild.size) im.setAttribute('src', '../' + c.img);
        files.push({path: pagePath, text: serialize(d, src)});
      } catch (e) { /* Seite fehlt: nur die Karte ändern */ }
      files.push(...this.render(st, st.cards));
      await gh.commit(files, `Artikel geändert: ${f.titel || slug}`);
    }
  };

  /* =================================================================
     FLOTTE (Hauptliste: Karten in index.html #fleet)
     ================================================================= */
  function parseFleet(indexSrc){
    const d = parse(indexSrc);
    return [...d.querySelectorAll('#fleet a.news-card')].map(a => {
      const img = a.querySelector('img');
      return {href: a.getAttribute('href'), slug: a.getAttribute('href').split('/').pop().replace(/\.html$/, ''),
        kind: a.dataset.kind || 'segel', meta: (a.querySelector('.date') || {}).innerHTML || '', name: (a.querySelector('h3') || {}).innerHTML || '',
        kurz: (a.querySelector('p') || {}).innerHTML || '', img: img ? img.getAttribute('src') : '', el: a.outerHTML};
    });
  }
  function fleetCard(c){
    const id = rid('f');
    return `        <a class="news-card" data-kind="${c.kind}" href="flotte/${c.slug}.html">\n          ${picHtml(id + '-img', c.img)}\n          <div class="body">\n` +
      `            <span class="date" data-e="${id}-m">${c.meta}</span>\n            <h3 data-e="${id}-n">${c.name}</h3>\n` +
      `            <p data-e="${id}-k">${c.kurz}</p>\n            <span class="more">Mehr erfahren →</span>\n          </div>\n        </a>`;
  }
  const fleet = {
    async load(gh){ const indexSrc = await gh.getText('index.html'); return {indexSrc, planes: parseFleet(indexSrc)}; },
    /** Reihenfolge/Art in index.html übernehmen; bestehende Karten bleiben unverändert erhalten */
    renderIndex(st, planes){
      const d = parse(st.indexSrc), box = d.querySelector('#fleet');
      if (!box) throw new Error('Flotten-Bereich nicht gefunden.');
      box.innerHTML = '\n' + planes.map(p => {
        if (p.el){ const t = d.createElement('template'); t.innerHTML = p.el; const a = t.content.firstElementChild; a.dataset.kind = p.kind; return '        ' + a.outerHTML; }
        return fleetCard(p);
      }).join('\n') + '\n      ';
      return {path: 'index.html', text: serialize(d, st.indexSrc)};
    },
    async add(gh, f){
      const name = (f.name || '').trim(); if (!name) throw new Error('Bitte einen Namen angeben.');
      const st = await this.load(gh);
      const slug = unique(slugify(name), st.planes.map(p => p.slug));
      const kind = ['segel', 'motor', 'ehemalig'].includes(f.kind) ? f.kind : 'segel', files = [];
      let img = `img/flotte/${slug}.jpg`;
      if (f.bild && f.bild.size){ const im = await prepareImage(f.bild); img = `img/flotte/${slug}.${im.ext}`; files.push({path: img, bytes: im.bytes}); }
      // Detailseite aus einer bestehenden Flugzeugseite als Vorlage
      const tplPath = st.planes[0] ? st.planes[0].href : null;
      if (!tplPath) throw new Error('Keine Vorlage gefunden.');
      const src = await gh.getText(tplPath), d = parse(src), art = d.querySelector('main article');
      const id = rid('f');
      [...art.children].forEach(el => { if (!el.matches('a.back, .date, h1, .pic')) el.remove(); });
      d.title = name + ' – LSV Regensburg';
      art.querySelector('h1').textContent = name; art.querySelector('h1').dataset.e = id + '-t';
      const dt = art.querySelector('.date'); dt.textContent = (f.meta || '').trim(); dt.dataset.e = id + '-d';
      const back = art.querySelector('a.back'); if (back) back.setAttribute('href', `../index.html#flotte-${kind}`);
      const pic = art.querySelector('.pic'); pic.outerHTML = picHtml(id + '-img', '../' + img);
      let html = '';
      (f.text || '').split(/\r?\n\s*\r?\n/).map(s => s.trim()).filter(Boolean).forEach((p, i) => { html += `\n    <p data-e="${id}-p${i}">${esc(p)}</p>`; });
      const rows = (f.daten || '').split(/\r?\n/).map(l => l.split(':')).filter(x => x.length >= 2 && x[0].trim());
      if (rows.length) html += `\n\n    <h2 data-e="${id}-h">Technische Daten</h2>\n    <table class="ad">` +
        rows.map(([k, ...v], i) => `\n        <tr><th data-e="${id}-k${i}">${esc(k.trim())}</th><td data-e="${id}-v${i}">${esc(v.join(':').trim())}</td></tr>`).join('') + `\n    </table>`;
      art.insertAdjacentHTML('beforeend', html + '\n  ');
      files.push({path: `flotte/${slug}.html`, text: serialize(d, src)});
      const plane = {slug, kind, meta: esc((f.meta || '').trim()), name: esc(name), kurz: esc((f.kurz || '').trim()), img};
      files.push(this.renderIndex(st, [...st.planes, plane]));
      await gh.commit(files, `Flugzeug hinzugefügt: ${name}`);
      return `flotte/${slug}.html`;
    },
    async remove(gh, slug){
      const st = await this.load(gh);
      const p = st.planes.find(x => x.slug === slug); if (!p) throw new Error('Flugzeug nicht gefunden.');
      await gh.commit([this.renderIndex(st, st.planes.filter(x => x.slug !== slug)), {path: p.href, remove: true}], `Flugzeug gelöscht: ${p.name.replace(/<[^>]+>/g, '')}`);
    },
    async move(gh, slug, dir){
      const st = await this.load(gh);
      const i = st.planes.findIndex(x => x.slug === slug), j = i + dir;
      if (i < 0 || j < 0 || j >= st.planes.length) return;
      const pl = st.planes.slice(); [pl[i], pl[j]] = [pl[j], pl[i]];
      await gh.commit([this.renderIndex(st, pl)], 'Flotten-Reihenfolge geändert');
    },
    async setKind(gh, slug, kind){
      const st = await this.load(gh);
      const p = st.planes.find(x => x.slug === slug); if (!p) throw new Error('Flugzeug nicht gefunden.');
      p.kind = kind;
      const files = [this.renderIndex(st, st.planes)];
      try {
        const src = await gh.getText(p.href), d = parse(src), back = d.querySelector('main a.back');
        if (back){ back.setAttribute('href', `../index.html#flotte-${kind}`); files.push({path: p.href, text: serialize(d, src)}); }
      } catch (e) {}
      await gh.commit(files, `Flugzeugart geändert: ${p.name.replace(/<[^>]+>/g, '')}`);
    }
  };

  /* =================================================================
     SEITEN & REITER
     ================================================================= */
  function readTabs(indexSrc){
    const d = parse(indexSrc);
    return [...d.querySelectorAll('#tabs a')].map(a => ({label: a.textContent.trim(), href: a.getAttribute('href')}));
  }
  function tabsHtml(tabs, filePath){
    const pre = toRoot(filePath);
    const li = tabs.map(t => {
      const ext = /^(https?:|mailto:|tel:)/.test(t.href);
      const cur = !ext && t.href === filePath ? ' class="current" aria-current="page"' : '';
      return `    <li><a href="${esc(ext ? t.href : pre + t.href)}"${cur}>${esc(t.label)}</a></li>`;
    }).join('\n');
    return `<!-- Reiter: im Bearbeitungsmodus unter „Verwaltung → Seiten & Reiter“ pflegen -->\n  <ul id="tabs">\n${li}\n  </ul>`;
  }
  const TABS_RE = /(<!-- Reiter[^\n]*-->\s*)?<ul id="tabs">[\s\S]*?<\/ul>/;
  const site = {
    async load(gh){
      const files = await gh.listFiles();
      const indexSrc = await gh.getText('index.html');
      const pagePaths = files.filter(f => /^seiten\/[^/]+\.html$/.test(f));
      const pages = await Promise.all(pagePaths.map(async path => {
        const d = parse(await gh.getText(path));
        return {path, titel: (d.querySelector('main h1') || {}).textContent || path};
      }));
      return {files, indexSrc, tabs: readTabs(indexSrc), pages};
    },
    /** Reiter in ALLEN Seiten schreiben; extra = zusätzliche/neue Seiten {path, text}, remove = zu löschende Pfade */
    async writeTabs(gh, st, tabs, msg, extra = [], remove = []){
      const htmlFiles = st.files.filter(f => /\.html$/.test(f) && !/^admin\/(einrichten|verwaltung)\.html$/.test(f) && !remove.includes(f));
      const out = [];
      for (const path of htmlFiles){
        const ex = extra.find(e => e.path === path);
        const src = ex ? ex.text : await gh.getText(path);
        if (!TABS_RE.test(src)){ if (ex) out.push(ex); continue; }
        // die Artikelvorlage wird später unter aktuelles/ verwendet -> Pfade wie dort
        const asPath = path.startsWith('admin/vorlagen/') ? 'aktuelles/_vorlage.html' : path;
        out.push({path, text: src.replace(TABS_RE, tabsHtml(tabs, asPath))});
      }
      extra.filter(e => !htmlFiles.includes(e.path)).forEach(e => out.push({path: e.path, text: e.text.replace(TABS_RE, tabsHtml(tabs, e.path))}));
      remove.forEach(path => out.push({path, remove: true}));
      await gh.commit(out, msg);
    },
    async createPage(gh, f){
      const titel = (f.titel || '').trim(); if (!titel) throw new Error('Bitte einen Titel angeben.');
      const st = await this.load(gh);
      const slug = unique(slugify(titel), st.pages.map(p => p.path.split('/').pop().replace('.html', '')));
      const path = `seiten/${slug}.html`;
      const tplPath = st.pages[0] && st.pages[0].path; if (!tplPath) throw new Error('Keine Vorlage gefunden.');
      const src = await gh.getText(tplPath), d = parse(src), art = d.querySelector('main article'), id = rid('s');
      [...art.children].forEach(el => { if (!el.matches('a.back, .date, h1')) el.remove(); });
      d.title = titel + ' – LSV Regensburg';
      art.querySelector('h1').textContent = titel; art.querySelector('h1').dataset.e = id + '-t';
      const dt = art.querySelector('.date'); dt.textContent = (f.eyebrow || '').trim(); dt.dataset.e = id + '-d';
      art.insertAdjacentHTML('beforeend', `\n    <p data-e="${id}-p1">Hier steht der Text der neuen Seite – im Bearbeitungsmodus anklicken und schreiben.</p>\n  `);
      const tabs = f.addTab ? [...st.tabs, {label: titel, href: path}] : st.tabs;
      await this.writeTabs(gh, st, tabs, `Neue Seite: ${titel}`, [{path, text: serialize(d, src)}]);
      return path;
    },
    async deletePage(gh, path){
      const st = await this.load(gh);
      await this.writeTabs(gh, st, st.tabs.filter(t => t.href !== path), `Seite gelöscht: ${path}`, [], [path]);
    },
    async saveTabs(gh, tabs){
      const st = await this.load(gh);
      await this.writeTabs(gh, st, tabs, 'Reiter geändert');
    }
  };

  return {esc, slugify, prepareImage, articles, fleet, site, dateDe};
})();
