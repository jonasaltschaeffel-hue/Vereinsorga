/* =====================================================================
   3D-Segelflugzeug DG 505 (D-4961) – fliegt unter den Wolken.

   Das Modell wird hier im Code nach dem Vereinsfoto aufgebaut (keine
   externe 3D-Datei): hochovaler Rumpf mit schlankem Leitwerksträger,
   lange zweiteilige Haube, Flügel mit V-Stellung und Winglets,
   T-Leitwerk, Antenne, Räder und Bemalung (Zierlinie, D-4961, LT, Flagge).
   Gerendert mit three.js, das beim Laden aus dem Netz geholt wird.
   Klappt das nicht (z. B. offline), bleibt das Foto-Flugzeug aus
   js/segelflieger.js sichtbar.

   Flugverhalten:
   - Scrollen: Geradeausflug in Scrollrichtung (runter = rechts),
     Umdrehen als Kurve mit Querneigung, immer vom Betrachter weg.
   - Nicht scrollen: Thermikkreisen mit ca. 40° Schräglage und Steigen
     bis knapp unter die Wolkenbasis.
   ===================================================================== */
(() => {
  // three.js r147: letzte Version mit klassischen Skripten (funktioniert auch per Doppelklick / file://)
  const CDN = 'https://cdn.jsdelivr.net/npm/three@0.147.0/';
  const loadScript = src => new Promise((ok, fail) => {
    const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = fail; document.head.appendChild(el);
  });
  // Foto-Flugzeug nur als Notlösung zeigen (z. B. offline oder ohne WebGL)
  const showPhoto = () => { const ph = document.getElementById('glider-photo'); if (ph) ph.classList.add('show'); };
  // Das große ASK-21-Modell gleich parallel mitladen, damit es schneller bereit ist
  const modelReady = loadScript('js/ask21-modell.js').catch(() => {});
  loadScript(CDN + 'build/three.min.js')
    .then(() => { try { init(); } catch (e) { console.warn('3D-Segelflugzeug nicht verfügbar:', e); showPhoto(); } })
    .catch(showPhoto);

  function init(){
    const T = window.THREE;
    // Testschnittstelle (Browser-Konsole): __glider3d.paused = true, __glider3d.glider …
    const api = window.__glider3d = {paused: false};
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ================= Renderer & Kamera ================= */
    const canvas = document.createElement('canvas');
    canvas.id = 'glider-3d';
    canvas.setAttribute('aria-hidden', 'true');
    const renderer = new T.WebGLRenderer({canvas, alpha: true, antialias: true, powerPreference: 'low-power'});
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.physicallyCorrectLights = true;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);

    const scene = new T.Scene();
    const FOV = 30, PITCH = T.MathUtils.degToRad(18);   // Blick leicht nach oben
    const camera = new T.PerspectiveCamera(FOV, 1, 1, 2000);
    camera.rotation.set(PITCH, 0, 0);

    /* ================= Umgebung (Spiegelungen im Lack) ================= */
    const pmrem = new T.PMREMGenerator(renderer);
    const envScene = new T.Scene();
    envScene.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), new T.ShaderMaterial({
      side: T.BackSide,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 ground  = vec3(0.22, 0.25, 0.20);
          vec3 horizon = vec3(0.80, 0.84, 0.88);
          vec3 zenith  = vec3(0.22, 0.42, 0.80);
          vec3 c = y < 0.0 ? mix(horizon, ground, smoothstep(0.0, 0.2, -y)) : mix(horizon, zenith, smoothstep(0.0, 0.6, y));
          vec3 sunDir = normalize(vec3(0.25, 0.45, 0.85));
          c += vec3(7.0, 6.0, 4.8) * pow(max(dot(normalize(vDir), sunDir), 0.0), 300.0);
          gl_FragColor = vec4(c, 1.0);
        }`
    })));
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;

    /* ================= Licht: warme, tiefe Abendsonne von vorn (wie Foto) ================= */
    const sun = new T.DirectionalLight(0xffe2bd, 4.6);
    sun.position.set(25, 45, 85);         // vom Betrachter aus, etwas erhöht
    scene.add(sun);
    scene.add(new T.HemisphereLight(0xc9dcff, 0x262b24, 0.3));   // wenig Licht von unten -> dunkle Flügelunterseiten

    /* ================= Materialien ================= */
    const CREAM = 0xf3eee2;
    const paint = new T.MeshPhysicalMaterial({color: CREAM, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.6, side: T.DoubleSide});
    const glass = new T.MeshPhysicalMaterial({color: 0x0e1b2b, roughness: 0.03, metalness: 0.25, clearcoat: 1, envMapIntensity: 1.2, transparent: true, opacity: 0.82, side: T.DoubleSide, depthWrite: false});
    const rubber = new T.MeshStandardMaterial({color: 0x161616, roughness: 0.8});
    const BLUE = '#2459a8';

    /* ================= Helfer ================= */
    // Catmull-Rom-Interpolation für Stützwerte
    const spline = (xs, ys) => x => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
      let i = 0; while (x > xs[i + 1]) i++;
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
      const p0 = ys[Math.max(0, i - 1)], p1 = ys[i], p2 = ys[i + 1], p3 = ys[Math.min(ys.length - 1, i + 2)];
      return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    };
    // NACA-ähnliches Profil
    function airfoil(n, t, m = 0.02, p = 0.4){
      const pts = [];
      const yt = c => 5 * t * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
      const yc = c => c < p ? m / (p * p) * (2 * p * c - c * c) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * c - c * c);
      for (let i = n; i >= 0; i--){ const c = (1 - Math.cos(Math.PI * i / n)) / 2; pts.push([c, yc(c) + yt(c)]); }
      for (let i = 1; i < n; i++){ const c = (1 - Math.cos(Math.PI * i / n)) / 2; pts.push([c, yc(c) - yt(c)]); }
      return pts;
    }
    // Fläche aus Profilschnitten. sections: {le:[x,y,z], chord, t}; normal = Dickenrichtung
    function loft(sections, normal, n = 24, camber = 0.02){
      const pos = [], idx = [];
      let ring = 0;
      sections.forEach(sec => {
        const prof = airfoil(n, sec.t, camber); ring = prof.length;
        prof.forEach(([c, y]) => pos.push(sec.le[0] - c * sec.chord + normal[0] * y * sec.chord, sec.le[1] + normal[1] * y * sec.chord, sec.le[2] + normal[2] * y * sec.chord));
      });
      for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < ring; k++){
        const a = i * ring + k, b = i * ring + (k + 1) % ring, c = (i + 1) * ring + (k + 1) % ring, d = (i + 1) * ring + k;
        idx.push(a, b, c, a, c, d);
      }
      [0, sections.length - 1].forEach(i => { const b = i * ring; for (let k = 1; k < ring - 1; k++) idx.push(b, b + k, b + k + 1); });
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    }
    const canvasTex = (w, h, draw) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 8;
      return t;
    };

    /* ================= Rumpf (Maße in m, Nase bei s = 0, zeigt nach +X) ================= */
    const L = 8.18, NOSE = L / 2;
    const X = s => NOSE - s;
    //            s:  0     0.12  0.35  0.7   1.2   1.8   2.4   2.9   3.4   4.0   5.0   6.2   7.2   7.9   8.18
    const S  =      [0,    0.12, 0.35, 0.7,  1.2,  1.8,  2.4,  2.9,  3.4,  4.0,  5.0,  6.2,  7.2,  7.9,  8.18];
    const fW = spline(S, [0.01, 0.10, 0.21, 0.31, 0.37, 0.385,0.375,0.34, 0.27, 0.21, 0.165,0.135,0.115,0.09, 0.02]);  // halbe Breite (spitze Nase)
    const fT = spline(S, [0.01, 0.09, 0.20, 0.32, 0.39, 0.40, 0.39, 0.34, 0.27, 0.21, 0.17, 0.145,0.135,0.115,0.03]);  // Höhe nach oben
    const fB = spline(S, [0.01, 0.11, 0.25, 0.40, 0.50, 0.53, 0.53, 0.47, 0.34, 0.235,0.17, 0.135,0.12, 0.095,0.02]);  // Tiefe nach unten
    const fC = spline(S, [-0.06,-0.06,-0.05,-0.03,-0.01, 0,    0.01, 0.03, 0.06, 0.09, 0.12, 0.14, 0.15, 0.16, 0.16]); // Mittellinie

    // Querschnittsring: Winkel a von unten (−π/2) über rechte Seite (+Z) nach oben und links zurück
    const ringPt = (s, a) => {
      const sn = Math.sin(a), cs = Math.cos(a);
      const h = sn >= 0 ? fT(s) : fB(s);
      // leicht "superelliptisch" für die typisch volle GFK-Rumpfform
      const e = 0.85;
      const yy = Math.sign(sn) * Math.pow(Math.abs(sn), e) * h;
      const zz = Math.sign(cs) * Math.pow(Math.abs(cs), e) * fW(s);
      return [X(s), fC(s) + yy, zz];
    };
    const NS = 140, NA = 56;
    const fpos = [], fuv = [], fidx = [];
    for (let i = 0; i <= NS; i++){
      const u = i / NS, sv = L * (1 - Math.cos(Math.PI * u)) / 2 * 0.999 + 0.0005;   // feiner an Nase und Heck
      for (let j = 0; j <= NA; j++){
        const v = j / NA, a = -Math.PI / 2 + v * Math.PI * 2;
        fpos.push(...ringPt(sv, a)); fuv.push(sv / L, v);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NA; j++){
      const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 2, d = a + NA + 1;
      fidx.push(a, d, b, b, d, c);
    }
    const fusGeo = new T.BufferGeometry();
    fusGeo.setAttribute('position', new T.Float32BufferAttribute(fpos, 3));
    fusGeo.setAttribute('uv', new T.Float32BufferAttribute(fuv, 2));
    fusGeo.setIndex(fidx); fusGeo.computeVertexNormals();

    // Rumpfbemalung als Textur: u = Länge (Nase→Heck), v = Umfang (unten, rechts, oben, links)
    const TW = 4096, TH = 1024;
    const fusTex = canvasTex(TW, TH, (g, w, h) => {
      g.fillStyle = '#f3eee2'; g.fillRect(0, 0, w, h);
      const ux = s => s / L * w;                  // Länge -> Pixel
      const vy = v => (1 - v) * h;                // Umfang -> Pixel (Textur ist vertikal gespiegelt)
      // Umfang an einer Stelle (für unverzerrte Schrift)
      const perim = s => Math.PI * (3 * (fW(s) + (fT(s) + fB(s)) / 2) - Math.sqrt((3 * fW(s) + (fT(s) + fB(s)) / 2) * (fW(s) + 3 * (fT(s) + fB(s)) / 2)));
      const vOfAngle = a => (a + Math.PI / 2) / (Math.PI * 2);
      [1, -1].forEach(side => {
        // Seite: rechts (+Z) liegt bei Winkel 0, links bei π
        const base = side > 0 ? 0 : Math.PI;
        const up = side > 0 ? 1 : -1;             // auf der linken Seite läuft v nach unten
        // blaue Zierlinie: kräftige Linie + feine Linie, von der Nase bis hinter den Flügel
        const lineAt = (ang, thick) => {
          g.fillStyle = BLUE;
          const v = vOfAngle(base + up * ang);
          g.fillRect(ux(0.45), vy(v) - thick / 2, ux(3.25) - ux(0.45), thick);
        };
        lineAt(0.30, 22); lineAt(0.18, 7);
        // kleines Logo-Rechteck vor der Haube (angedeutet)
        // Kennzeichen D-4961 am Leitwerksträger, unter der Flügelhinterkante
        const sC = 4.55, hText = 0.27;              // Buchstabenhöhe in m
        const pxPerMAround = h / perim(sC), pxPerMAlong = w / L;
        g.save();
        g.translate(ux(sC), vy(vOfAngle(base + up * 0.02)));
        if (side < 0) g.scale(-1, -1);                 // linke Seite: gedreht, damit es lesbar ist
        g.scale(1, pxPerMAround / pxPerMAlong);
        g.fillStyle = BLUE; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `bold ${Math.round(hText * pxPerMAlong)}px Arial, Helvetica, sans-serif`;
        g.fillText('D-4961', 0, 0);
        g.restore();
      });
    });
    const fusMat = paint.clone(); fusMat.map = fusTex; fusMat.side = T.FrontSide;
    const glider = new T.Group();
    glider.add(new T.Mesh(fusGeo, fusMat));

    /* ================= Haube: lang, zweiteilig, mit Rahmen ================= */
    const cS0 = 0.62, cS1 = 3.08, cLen = cS1 - cS0;
    const cpos = [], cidx = [];
    const CN = 60, CA = 28;
    // Punkt auf der Haube: sv = Position längs, a = 0 (rechts) … π (links)
    const canopyPt = (sv, a, grow = 0) => {
      const t = (sv - cS0) / cLen;
      const bump = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.85))), 0.7);   // vorne flach anlaufend
      const hwid = fW(sv) * 0.78 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, t * 1.05))), 0.35) + grow;
      const top = fC(sv) + fT(sv) * 0.5;
      return [X(sv), top + Math.sin(a) * (0.1 + 0.26 * bump + grow), Math.cos(a) * hwid];
    };
    for (let i = 0; i <= CN; i++){
      const sv = cS0 + (i / CN) * cLen;
      for (let j = 0; j <= CA; j++) cpos.push(...canopyPt(sv, Math.PI * j / CA));
    }
    for (let i = 0; i < CN; i++) for (let j = 0; j < CA; j++){
      const a = i * (CA + 1) + j, b = a + 1, c = a + CA + 2, d = a + CA + 1;
      cidx.push(a, b, d, b, c, d);
    }
    const canGeo = new T.BufferGeometry();
    canGeo.setAttribute('position', new T.Float32BufferAttribute(cpos, 3)); canGeo.setIndex(cidx); canGeo.computeVertexNormals();
    const canopy = new T.Mesh(canGeo, glass);
    glider.add(canopy);
    // dunkles Cockpit-Inneres und zwei Piloten (durch die getönte Haube sichtbar wie auf dem Foto)
    const dark = new T.MeshStandardMaterial({color: 0x07090c, roughness: 0.9});
    const tub = new T.Mesh(new T.SphereGeometry(1, 24, 12), dark);
    tub.scale.set(cLen * 0.47, 0.16, fW(1.9) * 0.74);
    tub.position.set(X(cS0 + cLen / 2), fC(1.9) + fT(1.9) * 0.5, 0);
    glider.add(tub);
    const skin = new T.MeshStandardMaterial({color: 0x2a2420, roughness: 0.8});
    [[1.25, 0.19], [2.45, 0.21]].forEach(([sp, hh]) => {
      const head = new T.Mesh(new T.SphereGeometry(0.11, 16, 12), skin);
      head.position.set(X(sp), fC(sp) + fT(sp) * 0.5 + hh, 0);
      glider.add(head);
    });
    // Rahmen zwischen vorderer und hinterer Haube (weißer Bügel) als Rohr entlang des Haubenquerschnitts
    const framePts = [];
    for (let j = 0; j <= 16; j++) framePts.push(new T.Vector3(...canopyPt(2.02, Math.PI * j / 16, 0.012)));
    glider.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(framePts), 32, 0.035, 8, false), paint));
    // Haubenrand (Dichtung) unten entlang beider Seiten
    [0, Math.PI].forEach(a => {
      const pts = [];
      for (let i = 0; i <= 24; i++) pts.push(new T.Vector3(...canopyPt(cS0 + 0.04 + (cLen - 0.08) * i / 24, a === 0 ? 0.02 : Math.PI - 0.02, 0.004)));
      glider.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 48, 0.012, 6, false), paint));
    });

    /* ================= Flügel: 20 m, Zuspitzung, V-Stellung, Winglets ================= */
    const WING_Y = fC(2.6) + fT(2.6) * 0.55, DIH = Math.tan(T.MathUtils.degToRad(3.2));
    const LE0 = X(2.45);
    // [Spannweite, Flügeltiefe, Dicke, Vorderkanten-Rücklage]
    const st = [[0, 1.02, 0.15, 0], [3.0, 0.98, 0.145, 0.02], [6.2, 0.80, 0.14, 0.06], [8.5, 0.56, 0.13, 0.12], [9.82, 0.36, 0.12, 0.17]];
    const wingSecs = [];
    [...st].reverse().forEach(([sp, ch, t, sw]) => wingSecs.push({le: [LE0 - sw, WING_Y + sp * DIH, -sp], chord: ch, t}));
    st.slice(1).forEach(([sp, ch, t, sw]) => wingSecs.push({le: [LE0 - sw, WING_Y + sp * DIH, sp], chord: ch, t}));
    const wingMat = paint.clone(); wingMat.envMapIntensity = 0.35;
    const wing = new T.Mesh(loft(wingSecs, [0, 1, 0], 26), wingMat);
    glider.add(wing);
    [1, -1].forEach(side => {
      const tip = [LE0 - 0.17, WING_Y + 9.82 * DIH, side * 9.82];
      glider.add(new T.Mesh(loft([
        {le: [tip[0], tip[1], tip[2]], chord: 0.36, t: 0.10},
        {le: [tip[0] - 0.10, tip[1] + 0.22, tip[2] + side * 0.05], chord: 0.30, t: 0.10},
        {le: [tip[0] - 0.24, tip[1] + 0.52, tip[2] + side * 0.08], chord: 0.17, t: 0.09}
      ], [0, 0, 1], 16, 0), paint));
    });
    // „LT“ unter dem rechten Flügel (von unten lesbar)
    const ltTex = canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = BLUE; g.font = 'bold 230px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('LT', w / 2, h / 2 + 10);
    });
    const ltWing = new T.Mesh(new T.PlaneGeometry(1.3, 0.62),new T.MeshStandardMaterial({map: ltTex, transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2}));
    ltWing.rotation.set(Math.PI / 2, 0, Math.PI);       // flach unter den Flügel, entlang der Spannweite (wie auf dem Foto)
    ltWing.position.set(LE0 - 0.52, WING_Y + 5 * DIH - 0.075, 5.0);
    glider.add(ltWing);

    /* ================= Seitenleitwerk (gepfeilte Vorderkante) & T-Leitwerk ================= */
    const finBaseY = fC(7.2) + fT(7.2) * 0.6;
    const finTopY = finBaseY + 1.28;
    const finSecs = [
      {le: [X(6.85), finBaseY - 0.08, 0], chord: 1.22, t: 0.12},
      {le: [X(7.25), finBaseY + 0.6, 0], chord: 0.98, t: 0.12},
      {le: [X(7.62), finTopY, 0], chord: 0.70, t: 0.12}
    ];
    glider.add(new T.Mesh(loft(finSecs, [0, 0, 1], 20, 0), paint));
    const stab = [-1.8, -0.9, 0, 0.9, 1.8].map(z => {
      const f = Math.abs(z) / 1.8;
      return {le: [X(7.45) - f * 0.16, finTopY + 0.03, z], chord: 0.66 - f * 0.26, t: 0.10};
    });
    glider.add(new T.Mesh(loft(stab, [0, 1, 0], 16, 0), paint));
    // Antenne / Pitot an der Leitwerksspitze nach vorn
    const ant = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.5, 6), rubber);
    ant.rotation.z = Math.PI / 2; ant.position.set(X(7.62) + 0.28, finTopY - 0.06, 0);
    glider.add(ant);

    // „LT“ und Flagge am Seitenleitwerk, beidseitig
    const finDecal = (tex, w, h, x, y) => [1, -1].forEach(side => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({map: tex, transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2}));
      m.position.set(x, y, side * 0.068);
      if (side < 0) m.rotation.y = Math.PI;
      glider.add(m);
    });
    finDecal(canvasTex(512, 320, (g, w, h) => {
      g.fillStyle = BLUE; g.font = 'bold 290px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('LT', w / 2, h / 2 + 14);
    }), 0.66, 0.41, X(7.78), finBaseY + 0.38);
    finDecal(canvasTex(96, 60, (g, w, h) => {
      ['#111', '#d10000', '#ffcc00'].forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * h / 3, w, h / 3 + 1); });
    }), 0.22, 0.14, X(7.66), finBaseY + 0.92);

    /* ================= Räder (vorne und unter dem Leitwerk) ================= */
    const wheel = (r, wdt, s, depth) => {
      const m = new T.Mesh(new T.CylinderGeometry(r, r, wdt, 20), rubber);
      m.rotation.x = Math.PI / 2;
      m.position.set(X(s), fC(s) - fB(s) - r * 0.35 + depth, 0);
      glider.add(m);
    };
    wheel(0.1, 0.06, 0.95, 0.02);   // Bugrad
    wheel(0.1, 0.06, 7.75, 0.0);    // Spornrad

    // Die selbst gebaute DG 505 ist nur noch Notlösung, falls die ASK 21 nicht lädt.
    // Bis dahin bleibt das Flugzeug unsichtbar – so taucht beim Laden nichts Falsches auf.
    const fallbackParts = [...glider.children];
    glider.clear();
    scene.add(glider);
    const reveal = () => canvas.classList.add('ready');   // sanft einblenden (CSS)

    /* ================= ASK 21 (D-1463) aus dem Sketchfab-Modell =================
       Modell: "ASK 21 Mi" von helijah, CC BY 4.0 (js/ask21-modell.js).
       Umbau zur Vereins-ASK-21: Motormast, Propeller und Motorklappen entfernt,
       Lack weiß (Flügelspitzen/Höhenleitwerk ohne Blau), Zierlinie dunkelblau,
       Kennzeichen D-1463 am Rumpf und unter dem Flügel, Flagge am Seitenleitwerk.
       Solange es lädt (oder falls es fehlt), fliegt die selbst gebaute DG 505. */
    const LIVERY = {
      reg: 'D-1463',
      navy: [36, 36, 150],
      // Positionen in der Textur (1024×1024), per Test gegen das Modell ermittelt
      // (die Textur ist im Modell vertikal gespiegelt, daher flipY)
      regFus: [{x: 335, y: 724, w: 150, flipY: true}, {x: 735, y: 873, w: 150, flipY: true}],
      regWing: {x: 690, y: 465, w: 230, rot: 0, flipY: true},                 // Flügelunterseite
      flag: [{x: 42, y: 818, w: 30, flipY: true}, {x: 998, y: 955, w: 30, flipY: true}],
    };
    api.livery = LIVERY;
    loadAsk21()
      .then(reveal)
      .catch(e => { console.warn('ASK 21 nicht geladen, DG 505 als Ersatz:', e); glider.clear(); glider.add(...fallbackParts); reveal(); });

    async function loadAsk21(){
      await loadScript(CDN + 'examples/js/loaders/GLTFLoader.js');
      await modelReady;
      if (!window.ASK21_GLB_B64) throw new Error('js/ask21-modell.js fehlt');
      const raw = atob(window.ASK21_GLB_B64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      const gltf = await new Promise((ok, fail) => new T.GLTFLoader().parse(buf.buffer, '', ok, fail));
      const model = gltf.scene;
      model.updateMatrixWorld(true);

      // --- Teile der Motorversion entfernen (zusammenhängende Teilflächen nach Lage auswählen) ---
      const dropComponents = (mesh, test) => {
        const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index.array;
        const m = mesh.matrixWorld, v = new T.Vector3();
        const keyMap = new Map(), rep = new Int32Array(pos.count);
        for (let i = 0; i < pos.count; i++){
          const k = pos.getX(i).toFixed(4) + ',' + pos.getY(i).toFixed(4) + ',' + pos.getZ(i).toFixed(4);
          if (!keyMap.has(k)) keyMap.set(k, i); rep[i] = keyMap.get(k);
        }
        const par = new Int32Array(pos.count).map((_, i) => i);
        const find = a => { while (par[a] !== a){ par[a] = par[par[a]]; a = par[a]; } return a; };
        for (let t = 0; t < idx.length; t += 3){ const a = find(rep[idx[t]]); par[find(rep[idx[t + 1]])] = a; par[find(rep[idx[t + 2]])] = a; }
        const box = new Map();
        for (let t = 0; t < idx.length; t += 3){
          const r = find(rep[idx[t]]);
          if (!box.has(r)) box.set(r, new T.Box3());
          for (let k = 0; k < 3; k++) box.get(r).expandByPoint(v.fromBufferAttribute(pos, idx[t + k]).applyMatrix4(m));
        }
        const keep = [];
        for (let t = 0; t < idx.length; t += 3) if (!test(box.get(find(rep[idx[t]])))) keep.push(idx[t], idx[t + 1], idx[t + 2]);
        geo.setIndex(keep);
      };
      model.traverse(o => {
        if (!o.isMesh) return;
        if (o.name === 'Object_6') o.visible = false;                                   // Motormast
        if (o.name === 'Object_4') dropComponents(o, b => b.min.x > -0.5 && b.max.x < 1.4 && b.max.y < 0.1 && b.min.y > -0.3 && Math.abs(b.max.z) < 0.35 && b.max.x - b.min.x > 1.5);  // Motorklappen
        if (o.name === 'Object_5') dropComponents(o, b => b.min.x > -0.5 && b.max.x < -0.3 && b.min.y > 0.05);  // Propeller + Nabe
      });
      // Weiche Übergänge zwischen den Flügelabschnitten: Normalen an gleichen Positionen mitteln
      // (nur bei kleinen Winkeln – echte Kanten wie die Hinterkante bleiben scharf)
      const smoothNormals = (geo, maxDeg = 35) => {
        const pos = geo.attributes.position, nor = geo.attributes.normal;
        const cosMax = Math.cos(maxDeg * Math.PI / 180);
        const groups = new Map();
        for (let i = 0; i < pos.count; i++){
          const k = pos.getX(i).toFixed(3) + ',' + pos.getY(i).toFixed(3) + ',' + pos.getZ(i).toFixed(3);
          (groups.get(k) || groups.set(k, []).get(k)).push(i);
        }
        const out = new Float32Array(nor.count * 3);
        const a = new T.Vector3(), b = new T.Vector3(), sum = new T.Vector3();
        groups.forEach(list => list.forEach(i => {
          a.fromBufferAttribute(nor, i); sum.set(0, 0, 0);
          list.forEach(j => { b.fromBufferAttribute(nor, j); if (a.dot(b) >= cosMax) sum.add(b); });
          sum.normalize(); out.set([sum.x, sum.y, sum.z], i * 3);
        }));
        geo.setAttribute('normal', new T.BufferAttribute(out, 3));
      };
      ['Object_4', 'Object_5'].forEach(n => { const o = model.getObjectByName(n); if (o) smoothNormals(o.geometry); });

      // Motorkasten: der hintere Teil des Innenraums (hinter dem Flügel) wird als eigenes Teil weiß lackiert
      const interior = model.getObjectByName('Object_12');
      if (interior){
        const box = interior.clone();
        box.geometry = interior.geometry.clone();
        const isBay = b => b.min.x > -0.6;
        dropComponents(box, b => !isBay(b));            // Kopie: nur der Motorkasten
        dropComponents(interior, isBay);                // Original: Motorkasten entfernt
        box.material = new T.MeshPhysicalMaterial({color: 0xececec, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.5, side: T.DoubleSide});
        interior.parent.add(box);
      }

      // --- Lack & Bemalung: Originaltextur auf eine Canvas kopieren und anpassen ---
      let exterior = null;
      model.traverse(o => { if (o.isMesh && o.material.name === 'DefaultWhite' && o.material.map) exterior = o.material.map; });
      const img = exterior.image;
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d');
      const tex = new T.CanvasTexture(cv);
      tex.flipY = exterior.flipY; tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
      tex.wrapS = exterior.wrapS; tex.wrapT = exterior.wrapT;
      const paintLivery = (L) => {
      g.drawImage(img, 0, 0);
      const W = cv.width, H = cv.height, sc = W / 1024;
      const LIVERY = L;
      const data = g.getImageData(0, 0, W, H), px = data.data;
      for (let i = 0; i < px.length; i += 4){
        const r = px[i], gg = px[i + 1], b = px[i + 2];
        if (b > r + 60 && b > gg + 60){                       // blaue Flächen
          const y = (i / 4 / W | 0) / sc;
          if (y < 660){ px[i] = px[i + 1] = px[i + 2] = 236; }  // Flügelspitzen & Höhenleitwerk -> weiß
          else { px[i] = LIVERY.navy[0]; px[i + 1] = LIVERY.navy[1]; px[i + 2] = LIVERY.navy[2]; }  // Zierlinie dunkelblau
        }
      }
      g.putImageData(data, 0, 0);
      // Flügelunterseite als durchgehende, gleichmäßig weiße Fläche (ohne eingebackene Abschnittsschattierung)
      g.fillStyle = 'rgb(236,236,236)';
      g.fillRect(0, 408 * sc, 1010 * sc, 108 * sc);
      const navy = `rgb(${LIVERY.navy.join(',')})`;
      const text = (str, x, y, w, rot = 0, flipX = false, flipY = false) => {
        g.save(); g.translate(x * sc, y * sc); g.rotate(rot); g.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        g.fillStyle = navy; g.textAlign = 'center'; g.textBaseline = 'middle';
        let size = 40 * sc; g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
        size *= (w * sc) / g.measureText(str).width; g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
        g.fillText(str, 0, 0); g.restore();
      };
      LIVERY.regFus.forEach(p => text(LIVERY.reg, p.x, p.y, p.w, 0, p.flipX, p.flipY));
      text(LIVERY.reg, LIVERY.regWing.x, LIVERY.regWing.y, LIVERY.regWing.w, LIVERY.regWing.rot, false, !!LIVERY.regWing.flipY);
      LIVERY.flag.forEach(p => {
        const fw = p.w * sc, fh = fw * 0.6;
        const cols = p.flipY ? ['#ffcc00', '#d10000', '#111'] : ['#111', '#d10000', '#ffcc00'];
        cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(p.x * sc - fw / 2, p.y * sc - fh / 2 + i * fh / 3, fw, fh / 3 + 1); });
      });
      tex.needsUpdate = true;
      };
      paintLivery(LIVERY);
      api.paintLivery = paintLivery;

      const lack = new T.MeshPhysicalMaterial({map: tex, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.55, side: T.DoubleSide});
      model.traverse(o => {
        if (!o.isMesh) return;
        if (o.material.name === 'DefaultWhite') o.material = lack;
        else if (o.material.name === 'transparentExt') o.material = glass;       // Haube: dunkel getönt
        else if (o.material.name === 'transparent') o.visible = false;           // Instrumentengläser
      });

      // Nase im Modell zeigt nach −X -> drehen, damit sie wie beim Flugmodell nach +X zeigt
      model.rotation.y = Math.PI;
      glider.clear();
      glider.add(model);
      api.model = model; api.liveryCanvas = cv;
    }

    /* ================= Sichtfeld & Höhen ================= */
    let D, hw, cruiseAlt, ceilAlt;
    const altForScreen = f => {
      const a = Math.atan((f - 0.5) * 2 * Math.tan(T.MathUtils.degToRad(FOV / 2)));
      return D * Math.tan(PITCH - a);
    };
    function resize(){
      const w = innerWidth, h = innerHeight;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      D = 95 * Math.max(1, 1.35 / camera.aspect);                  // auf schmalen Bildschirmen weiter weg
      const hfov = 2 * Math.atan(Math.tan(T.MathUtils.degToRad(FOV / 2)) * camera.aspect);
      hw = D * Math.tan(hfov / 2);
      cruiseAlt = altForScreen(0.80);
      ceilAlt = altForScreen(0.62);                                  // knapp unter der Basis der nahen Wolken
    }
    addEventListener('resize', resize);
    resize();

    /* ================= Flugzustand ================= */
    const IDLE_MS = 1800;
    const p = new T.Vector3(hw * 0.25, cruiseAlt, -D);
    let psi = 0, bank = 0, v = 22;
    let mode = 'cruise', dir = 1, turnSign = 0;
    let lastY = scrollY, lastScroll = performance.now(), scrollVel = 0;

    addEventListener('scroll', () => {
      const d = scrollY - lastY; lastY = scrollY;
      if (d !== 0){ dir = Math.sign(d); scrollVel = Math.min(4000, Math.abs(d) * 60); lastScroll = performance.now(); mode = 'cruise'; }
    }, {passive: true});

    const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

    // Foto-Version entfernen – ab jetzt fliegt das 3D-Modell
    const photo = document.getElementById('glider-photo');
    if (photo) photo.remove();
    const sky = document.getElementById('sky');
    if (sky) sky.after(canvas); else document.body.prepend(canvas);

    Object.assign(api, {glider, camera, p});

    let last = performance.now();
    function frame(now){
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (api.paused){ renderer.render(scene, camera); requestAnimationFrame(frame); return; }
      scrollVel *= Math.exp(-dt * 3);
      let yawRate, vs;

      if (mode === 'cruise'){
        const vT = 22 + Math.min(30, scrollVel * 0.03);
        v += (vT - v) * Math.min(1, dt * 2);
        const zCorr = T.MathUtils.clamp((D + p.z) * 0.02, -0.5, 0.5);   // sanft zur Sollentfernung zurück
        const psiDes = Math.atan2(zCorr, dir);
        const diff = angDiff(psiDes, psi);
        if (Math.abs(diff) > Math.PI / 2){
          if (!turnSign) turnSign = Math.cos(psi) >= 0 ? 1 : -1;      // Umkehrkurve vom Betrachter weg
          yawRate = turnSign * 0.65;
        } else {
          turnSign = 0;
          yawRate = T.MathUtils.clamp(diff * 1.1, -0.5, 0.5);
        }
        vs = p.y > cruiseAlt ? -1.1 : (cruiseAlt - p.y) * 0.5;
        if (!reduceMotion && now - lastScroll > IDLE_MS && Math.abs(diff) < 0.2) mode = 'circle';
      } else {
        v += (20 - v) * Math.min(1, dt);
        yawRate = 2 * Math.PI / 14;
        vs = p.y < ceilAlt ? 1.0 : 0;
      }

      psi += yawRate * dt;
      p.x += Math.cos(psi) * v * dt;
      p.z += -Math.sin(psi) * v * dt;
      p.y += vs * dt;

      const bankT = T.MathUtils.clamp(Math.atan(v * yawRate / 9.81), -0.8, 0.8);   // max. ca. 45°
      bank += (bankT - bank) * Math.min(1, dt * 2.5);

      const edge = hw * (-p.z / D) + 14;
      if (p.x > edge) p.x = -edge; else if (p.x < -edge) p.x = edge;

      glider.position.copy(p);
      glider.rotation.set(-bank, psi, -0.035 + vs * 0.02, 'YXZ');

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
})();
