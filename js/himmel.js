/* =====================================================================
   Wolkenhimmel (WebGL) – wird auf allen Seiten verwendet.
   Benötigt ein <canvas id="sky"> im Dokument. Die Wolken ziehen beim
   Scrollen von links nach rechts und treiben langsam weiter.
   ===================================================================== */
(() => {
const VS = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FS = `
precision highp float;
uniform vec2  uRes;
uniform float uScroll;   // Scrollposition in Bildschirmhöhen
uniform float uTime;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
const mat2 M = mat2(1.6, 1.2, -1.2, 1.6);
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * noise(p); p = M * p; a *= 0.5; }
  return v;
}
// "Billow"-Rauschen für die typischen Blumenkohl-Quellungen
float billow(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * abs(noise(p) * 2.0 - 1.0); p = M * p; a *= 0.5; }
  return v;
}

// Dichte einer Cumulus-Schicht. p.y = Höhe über der Wolkenbasis.
// hq = 1.0 für den sichtbaren Punkt (mit Feindetail), 0.0 für Schattenproben.
// Einzelne, kompakte Quellwolken: pro Zelle höchstens eine Wolke mit zufälliger Lage,
// Breite und Höhe. Jede Wolke besteht aus einem Hauptturm und zwei Nebentürmen (Kuppeln),
// dazwischen bleibt freier blauer Himmel – keine langen, zusammenhängenden Bänder.
const float CW = 2.3;   // Zellbreite (mittlerer Abstand der Wolken)
float dome(float x, float c, float w, float h){
  float t = (x - c) / w;
  return h * sqrt(max(0.0, 1.0 - t * t));
}
float cloudHeight(float x, float seed){
  float cell = floor(x / CW);
  float H = 0.0;
  for (int k = -1; k <= 1; k++){
    float id = cell + float(k);
    vec2 s = vec2(id, seed);
    if (hash(s + 0.17) < 0.30) continue;                 // hier steht keine Wolke
    float wv = CW * (0.20 + 0.17 * hash(s + 1.3));         // halbe Breite
    float c  = (id + 0.5 + (hash(s + 2.9) - 0.5) * 0.45) * CW;
    float h  = wv * (0.55 + 0.30 * hash(s + 4.1));         // Höhe: etwa ein Drittel der Breite
    H = max(H, dome(x, c, wv, h));
    // Nebentürme seitlich, etwas niedriger
    float c1 = c - wv * (0.35 + 0.30 * hash(s + 5.7));
    float c2 = c + wv * (0.35 + 0.30 * hash(s + 6.3));
    H = max(H, dome(x, c1, wv * (0.45 + 0.15 * hash(s + 7.1)), h * (0.55 + 0.25 * hash(s + 8.9))));
    H = max(H, dome(x, c2, wv * (0.45 + 0.15 * hash(s + 9.4)), h * (0.60 + 0.30 * hash(s + 3.6))));
  }
  return H;
}

float cloud(vec2 p, float seed, float hq){
  // wo stehen Wolken und wie hoch sind sie (günstig, vorab)
  float x  = p.x + (noise(p * 0.9 + seed) - 0.5) * 0.25;
  float H  = cloudHeight(x, seed);
  // freier Himmel: teure Berechnung überspringen
  if (p.y > H + 0.6) return 0.0;

  vec2 w = vec2(fbm(p * 0.9 + seed), fbm(p * 0.9 + seed + 7.3)) - 0.5;
  vec2 q = p + w * 0.55;
  float d  = (H - q.y) * 2.2;
  d += (billow(q * 3.2 + seed) - 0.35) * 1.0;   // Blumenkohl-Quellungen an der Oberseite
  if (hq > 0.5) d += (fbm(q * 7.0 - seed) - 0.5) * 0.25;
  // Wolkenbasis (Kondensationsniveau): im Großen flach, aber nicht wie mit dem Lineal gezogen –
  // sanfte, großzügige Wellen, eine feine ruhige Struktur und an den Rändern weich nach oben gezogen.
  float wave   = (noise(vec2(p.x * 0.9, seed + 2.0)) - 0.5) * 0.09      // lange, flache Wellen
               + (noise(vec2(p.x * 3.2, seed + 7.0)) - 0.5) * 0.035;    // feinere, ruhige Struktur
  float lift   = (1.0 - smoothstep(0.02, 0.35, H)) * 0.10;              // Ränder biegen nach oben
  float bumps  = (billow(vec2(p.x * 5.0, p.y * 2.0 + seed)) - 0.35) * 0.03; // leichte Unregelmäßigkeit
  float baseY = p.y - wave - lift - bumps;
  d *= smoothstep(0.0, 0.085, baseY);
  // keine dünnen Ausläufer entlang der Basis: nur wo eine echte Quellung steht
  d *= smoothstep(0.0, 0.14, H);
  return clamp(d, 0.0, 1.0);
}

// Sonne steht hinter den Wolken (Gegenlicht wie auf dem Referenzfoto)
vec2 sunPos(float aspect){ return vec2(aspect * 0.60, 0.80); }

vec3 skyColor(vec2 uv, float aspect){
  // tiefes, leicht entsättigtes Sommerblau, zum Horizont hin dunstig-hell
  vec3 top = vec3(0.15, 0.31, 0.66);
  vec3 mid = vec3(0.26, 0.47, 0.79);
  vec3 hor = vec3(0.68, 0.78, 0.88);
  float y = uv.y;
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.42, y));
  c = mix(c, top, smoothstep(0.42, 1.1, y));
  // zu den Seiten etwas dunkler (Polarisation des Himmelslichts)
  float sx = abs(uv.x / aspect - 0.5) * 2.0;
  c *= 1.0 - 0.12 * sx * sx;

  vec2 s = sunPos(aspect);
  vec2 v = uv - s;
  float sd = length(v);
  // weicher Lichthof um die verdeckte Sonne
  c += vec3(0.80, 0.88, 1.00) * (0.12 * exp(-sd * 2.6) + 0.05 * exp(-sd * 0.8));
  // Sonnenstrahlen (crepuskulare Strahlen) – breit und weich
  vec2 dir = v / max(sd, 1e-4);
  float r = noise(dir * 3.5 + 3.0) * 0.65 + noise(dir * 8.0 + 11.0) * 0.35;
  r = smoothstep(0.30, 0.90, r);
  float fall = exp(-sd * 1.3) * smoothstep(0.05, 0.4, sd);
  c += vec3(0.72, 0.84, 1.00) * r * 0.07 * fall;
  c -= vec3(0.02, 0.03, 0.04) * (1.0 - r) * fall;
  return c;
}

void layer(inout vec3 col, vec2 uv, float aspect, float scale, float base, float speed, float drift, float haze, float seed){
  float off = -(uScroll * speed + uTime * drift) * scale;
  vec2 p = vec2(uv.x * scale + off + seed * 11.0, (uv.y - base) * scale);
  if (p.y < -0.1 || p.y > 3.2) return;
  float d = cloud(p, seed, 1.0);
  if (d <= 0.001) return;

  // Licht: Dichte Richtung Sonne abtasten -> Selbstverschattung.
  // Die Richtung zeigt von jedem Pixel zur Sonne, dadurch leuchten
  // die der Sonne zugewandten dünnen Ränder silbern (Gegenlicht).
  vec2 s = sunPos(aspect);
  vec2 dir = normalize(s - uv + 1e-4);
  float occl = cloud(p + dir * 0.07, seed, 0.0) * 0.55
             + cloud(p + dir * 0.24, seed, 0.0) * 0.45;
  // dünne Randbereiche – nicht an der flachen Unterseite (die bleibt dunkel)
  float thin  = (1.0 - smoothstep(0.0, 0.55, d)) * smoothstep(0.02, 0.18, p.y);
  float nearS = exp(-length(uv - s) * 1.5);            // Nähe zur Sonne
  float light = clamp(1.0 - occl * 1.15, 0.0, 1.0);

  vec3 dark = vec3(0.50, 0.53, 0.61);   // dicker Wolkenkern im Schatten
  vec3 mid  = vec3(0.76, 0.78, 0.84);
  vec3 lit  = vec3(0.98, 0.98, 0.99);
  vec3 c = mix(dark, mid, light);
  // Oberseite sonnenbeschienen weiß, nach unten hin grauer
  float top = smoothstep(0.15, 0.7, p.y);
  c = mix(c, lit, clamp(light * light * 0.9 + thin * 0.5 + top * 0.35, 0.0, 1.0));
  // Silberrand – je näher an der Sonne, desto heller
  c += vec3(1.0, 0.99, 0.96) * thin * (0.12 + nearS * 0.55);
  // dunklere, leicht bläuliche Wolkenbasis
  c = mix(c, c * vec3(0.76, 0.79, 0.87), (1.0 - smoothstep(0.0, 0.35, p.y)) * 0.7);
  // Dunst mit Entfernung
  c = mix(c, skyColor(uv, aspect), haze);

  float a = smoothstep(0.0, 0.32, d);
  col = mix(col, c, a);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes.y;
  float aspect = uRes.x / uRes.y;
  vec3 col = skyColor(uv, aspect);

  //       scale base  speed drift haze  seed
  layer(col, uv, aspect, 10.0, 0.04, 0.16, 0.004, 0.50, 1.0);
  layer(col, uv, aspect, 6.5,  0.14, 0.28, 0.006, 0.32, 2.0);
  layer(col, uv, aspect, 4.2,  0.28, 0.45, 0.009, 0.16, 3.0);
  layer(col, uv, aspect, 2.6,  0.42, 0.75, 0.012, 0.04, 4.0);

  // leichtes Korn gegen Banding
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('sky');
  if (!canvas) return;
  // Info-Unterseiten (body.artikel) zeigen statt Wolken einen ruhigen hellblauen Verlauf
  if (document.body.classList.contains('artikel')) return;
  const gl = canvas.getContext('webgl', {antialias: false, alpha: false, premultipliedAlpha: false});
  if (!gl) return; // Fallback: CSS-Farbverlauf des Canvas bleibt sichtbar
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uScroll = gl.getUniformLocation(prog, 'uScroll');
    const uTime = gl.getUniformLocation(prog, 'uTime');

    // Renderauflösung: Wolken sind weich, daher reicht ca. die halbe Auflösung (max. ~1 Mio. Pixel)
    const QUALITY = 0.5;
    const resize = () => {
      let s = Math.min(devicePixelRatio || 1, 1.5) * QUALITY;
      const px = innerWidth * innerHeight * s * s;
      if (px > 1e6) s *= Math.sqrt(1e6 / px);
      canvas.width = Math.round(innerWidth * s);
      canvas.height = Math.round(innerHeight * s);
      gl.viewport(0, 0, canvas.width, canvas.height);
      lastScroll = -1;
    };
    let lastScroll = -1, lastDraw = 0, lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
    addEventListener('resize', resize);
    resize();
    const drawSky = (t) => {
      if (lost) return; // Fallback: CSS-Farbverlauf des Canvas bleibt sichtbar
      const sc = scrollY;
      // nur neu zeichnen, wenn gescrollt wurde – sonst max. 15x/s für das langsame Treiben
      if (sc === lastScroll && (reduceMotion || t - lastDraw < 66)) return;
      lastScroll = sc; lastDraw = t;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uScroll, sc / innerHeight);
      gl.uniform1f(uTime, reduceMotion ? 0 : t / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // nach dem ersten fertigen Bild weich einblenden (siehe #sky.ready in stil.css)
      if (!canvas.classList.contains('ready')) requestAnimationFrame(() => canvas.classList.add('ready'));
    };

  const loop = (t) => { drawSky(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();