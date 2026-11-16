/* =====================================================================
   Segelflugzeug (Foto) im Himmel – fliegt unter den Wolkenbasen.

   - Beim Scrollen fliegt es geradeaus in Scrollrichtung
     (runter = nach rechts, hoch = nach links, mit Kurve beim Umdrehen).
   - Wird eine Weile nicht gescrollt, kreist es wie in der Thermik
     (perspektivisch: vorne größer und tiefer, hinten kleiner und höher,
     beim Wenden von vorn/hinten gesehen schmal) und steigt dabei langsam
     bis knapp unter die Wolken.
   - Beim nächsten Scrollen verlässt es den Kreis und gleitet wieder ab.
   Benötigt <img id="glider-photo"> im Dokument.
   ===================================================================== */
(() => {
  const el = document.getElementById('glider-photo');
  if (!el) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Einstellungen ----
  const IDLE_MS       = 1800;   // so lange ohne Scrollen, bis es zu kreisen beginnt
  const SCROLL_FACTOR = 0.45;   // Flugstrecke pro gescrolltem Pixel
  const CIRCLE_TIME   = 15;     // Sekunden pro Vollkreis
  const CLIMB_RATE    = 0.008;  // Steigen in Bildschirmhöhen pro Sekunde (ca. 1,5 Kreise bis unter die Wolken)
  const SINK_RATE     = 0.006;  // Sinken im Geradeausflug
  const CRUISE_Y      = 0.78;   // Flughöhe im Geradeausflug (Anteil der Höhe von oben)
  const CEILING_Y     = 0.60;   // höchster Punkt: knapp unter der Basis der nahen Wolken

  let vw, vh, W, H;
  const size = () => {
    vw = innerWidth; vh = innerHeight;
    W = Math.max(150, Math.min(300, vw * 0.18));
    H = W * (el.naturalHeight && el.naturalWidth ? el.naturalHeight / el.naturalWidth : 0.71);
    el.style.width = W + 'px';
  };
  addEventListener('resize', size);
  el.complete ? size() : el.addEventListener('load', size);
  size();

  // ---- Zustand ----
  let mode = 'cruise';
  let x = vw * 0.62;          // Mittelpunkt in px
  let climb = 0;              // Höhe über der Reiseflughöhe (Anteil von vh)
  let facing = 1;             // Blickrichtung: +1 rechts, -1 links
  let sx = 1;                 // aktuelle horizontale Skalierung (Kurve / Perspektive)
  let vx = 0;                 // Geschwindigkeit im Geradeausflug (px/s)
  let theta = 0, cx = 0;      // Kreisflug
  let lastY = scrollY, lastScroll = performance.now(), pending = 0;

  addEventListener('scroll', () => {
    pending += scrollY - lastY;
    lastY = scrollY;
    lastScroll = performance.now();
  }, {passive: true});

  const wrap = () => {
    if (x > vw + W * 0.6) { x = -W * 0.6; cx -= vw + W * 1.2; }
    if (x < -W * 0.6)     { x = vw + W * 0.6; cx += vw + W * 1.2; }
  };

  let last = performance.now();
  function frame(now){
    if (!el.isConnected) return;   // das 3D-Modell hat übernommen
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const R = Math.min(vw * 0.16, 230);
    let depth = 0, roll = -2;

    if (pending !== 0){
      // Scrollen: geradeaus in Scrollrichtung fliegen
      const dir = Math.sign(pending);
      if (mode === 'circle'){ mode = 'cruise'; facing = Math.sign(Math.cos(theta)) || dir; }
      facing = dir;
      vx += (pending * SCROLL_FACTOR / Math.max(dt, 0.016) - vx) * 0.25;
      pending = 0;
    }

    if (mode === 'cruise'){
      x += vx * dt;
      vx *= Math.exp(-dt * 2.2);                    // ausrollen
      climb = Math.max(0, climb - SINK_RATE * dt);  // langsam absinken
      sx += (facing - sx) * Math.min(1, dt * 3.5);  // Kurve beim Umdrehen
      if (Math.abs(vx) > 30) roll = -2 - Math.sign(vx) * 1.5;
      if (!reduceMotion && now - lastScroll > IDLE_MS && Math.abs(vx) < 25){
        // Thermik gefunden: Kreisen beginnen, nahtlos aus der aktuellen Richtung
        mode = 'circle';
        theta = facing > 0 ? 0 : Math.PI;
        cx = x;
      }
    } else {
      theta += (Math.PI * 2 / CIRCLE_TIME) * dt;
      x = cx + R * Math.sin(theta);
      depth = Math.cos(theta);                       // +1 = vorne (nah), -1 = hinten
      sx += (Math.cos(theta) - sx) * Math.min(1, dt * 8);
      climb = Math.min(CRUISE_Y - CEILING_Y, climb + CLIMB_RATE * dt);
      roll = -2 + Math.sin(theta) * 4;
    }
    wrap();

    // Perspektive: vorne etwas größer und tiefer, hinten kleiner und höher
    const s = 1 + depth * 0.14;
    const y = vh * (CRUISE_Y - climb) + depth * R * 0.16;
    const flip = Math.sign(sx) || 1;
    const scaleX = flip * Math.max(0.08, Math.abs(sx)) * s;
    el.style.transform =
      `translate3d(${(x - W / 2).toFixed(1)}px, ${(y - H / 2).toFixed(1)}px, 0) rotate(${roll.toFixed(2)}deg) scale(${scaleX.toFixed(3)}, ${s.toFixed(3)})`;
    // weiter weg = etwas mehr Dunst (nur wenn das Foto als Notlösung sichtbar ist)
    if (el.classList.contains('show')) el.style.opacity = (0.93 + depth * 0.05).toFixed(3);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
