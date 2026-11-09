// Liest Excel-Dateien (.xlsx), CSV-Dateien und aus Excel kopierte Zellen –
// ohne externe Bibliothek, damit alles offline funktioniert.
// Ergebnis ist immer eine Tabelle: Array von Zeilen, jede Zeile ein Array von Texten.
const Sheet = (() => {
  // ---------- ZIP (eine .xlsx-Datei ist ein ZIP-Archiv) ----------
  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Dieser Browser kann .xlsx nicht lesen. Bitte in Excel als CSV speichern oder die Zellen kopieren und einfügen.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function unzip(buf) {
    const v = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const dec = new TextDecoder();
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Die Datei ist keine gültige Excel-Datei (.xlsx).');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const files = {};
    for (let k = 0; k < count; k++) {
      const nameLen = v.getUint16(p + 28, true);
      files[dec.decode(u8.subarray(p + 46, p + 46 + nameLen))] = {
        method: v.getUint16(p + 10, true),
        size: v.getUint32(p + 20, true),
        offset: v.getUint32(p + 42, true),
      };
      p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    }
    return {
      async read(name) {
        const f = files[name];
        if (!f) return null;
        const start = f.offset + 30 + v.getUint16(f.offset + 26, true) + v.getUint16(f.offset + 28, true);
        const raw = u8.subarray(start, start + f.size);
        return dec.decode(f.method === 0 ? raw : await inflate(raw));
      },
    };
  }

  // ---------- XLSX ----------
  const parseXml = s => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
  const colIndex = ref => {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return null;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  };

  async function readXlsx(buf, sheetPattern) {
    const zip = unzip(buf);
    const wb = parseXml(await zip.read('xl/workbook.xml') || '<x/>');
    const rels = parseXml(await zip.read('xl/_rels/workbook.xml.rels') || '<x/>');
    const sheets = tags(wb, 'sheet').map(s => ({
      name: s.getAttribute('name') || '',
      rid: s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id'),
    }));
    // Passendes Tabellenblatt (z. B. „Personen“) bevorzugen, sonst das erste.
    const sheet = sheets.find(s => sheetPattern && sheetPattern.test(s.name)) || sheets[0];
    let path = 'xl/worksheets/sheet1.xml';
    const rel = tags(rels, 'Relationship').find(r => sheet && r.getAttribute('Id') === sheet.rid);
    if (rel) {
      const t = rel.getAttribute('Target');
      path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    }
    const ssXml = await zip.read('xl/sharedStrings.xml');
    const shared = ssXml ? tags(parseXml(ssXml), 'si').map(si => tags(si, 't').map(t => t.textContent).join('')) : [];
    const wsXml = await zip.read(path);
    if (!wsXml) throw new Error('Tabellenblatt nicht gefunden.');

    const rows = [];
    for (const row of tags(parseXml(wsXml), 'row')) {
      const r = [];
      for (const c of tags(row, 'c')) {
        const col = colIndex(c.getAttribute('r')) ?? r.length;
        const type = c.getAttribute('t');
        const vEl = tags(c, 'v')[0];
        const v = vEl ? vEl.textContent : '';
        r[col] = type === 's' ? (shared[+v] ?? '')
          : type === 'inlineStr' ? tags(c, 't').map(t => t.textContent).join('')
          : v;
      }
      const idx = (parseInt(row.getAttribute('r'), 10) || rows.length + 1) - 1;
      rows[idx] = Array.from(r, x => x ?? '');
    }
    return Array.from(rows, r => r || []);
  }

  // ---------- CSV / eingefügter Text ----------
  function parseText(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0];
    const delim = ['\t', ';', ','].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function decodeText(buf) {
    // Excel speichert CSV unter Windows oft als Windows-1252 statt UTF-8.
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('windows-1252').decode(buf); }
  }

  async function readFile(file, sheetPattern) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (isZip) return readXlsx(buf, sheetPattern);
    if (/\.xls$/i.test(file.name)) {
      throw new Error('Das alte .xls-Format wird nicht unterstützt. Bitte in Excel „Speichern unter → Excel-Arbeitsmappe (.xlsx)“ wählen.');
    }
    return parseText(decodeText(buf));
  }

  return { readFile, parseText };
})();
