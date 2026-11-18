/*
 * Visuals — the animated layers of the immersive view:
 *   bg canvas:  slow-moving blobs of the current palette (the "color mesh")
 *   fx canvas:  floating particles + audio visualizer (bars / mirror / wave / ring / dots)
 * Colors glide smoothly to each new palette.
 */
import { AudioBus } from './audio.js';

const lerp = (a, b, t) => a + (b - a) * t;
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const frac = (x) => ((x % 1) + 1) % 1;
const ring = (x) => { const d = frac(x); return Math.min(d, 1 - d); }; // shortest distance around a loop

// Point on a rectangle's perimeter, u ∈ [0,1) clockwise from the top-left corner, with the outward normal.
function rectPoint(u, x, y, w, h) {
  const P = 2 * (w + h);
  let s = frac(u) * P;
  if (s < w) return [x + s, y, 0, -1];
  s -= w;
  if (s < h) return [x + w, y + s, 1, 0];
  s -= h;
  if (s < w) return [x + w - s, y + h, 0, 1];
  s -= w;
  return [x, y + h - s, -1, 0];
}
// Same idea for round covers (circle / vinyl); u=0 sits at the top-left like the rectangle.
function circlePoint(u, cx, cy, r) {
  const a = -0.75 * Math.PI + frac(u) * Math.PI * 2;
  const nx = Math.cos(a), ny = Math.sin(a);
  return [cx + nx * r, cy + ny * r, nx, ny];
}
function hue2rgb(h) {
  const f = (n) => { const k = (n + h * 12) % 12; return 255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}

export class Visuals {
  constructor({ bg, fx, art, glow }) {
    this.bg = bg; this.fx = fx; this.art = art; this.glow = glow;
    this.bctx = bg.getContext('2d');
    this.fctx = fx.getContext('2d');
    this.gctx = glow?.getContext('2d');
    this.edges = null;
    this.edgesT = null;
    this.s = {};
    this.colors = Array.from({ length: 5 }, () => [40, 40, 60]);
    this.target = this.colors.map((c) => c.slice());
    this.base = [10, 10, 16]; this.baseT = this.base.slice();
    this.base2 = [24, 24, 32]; this.base2T = this.base2.slice();
    this.accent = [30, 215, 96]; this.accentT = this.accent.slice();
    this.particles = [];
    this.artRect = null;
    this.artRectAt = 0;
    this.lastT = 0;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  configure(s) {
    this.s = s;
    this.fx.style.opacity = 1;
    const want = s.particles ? s.particleCount : 0;
    while (this.particles.length < want) this.particles.push(this.newParticle(true));
    this.particles.length = want;
  }

  // Album art used by the "fluid" background (crossfades between songs).
  setArt(url) {
    if (!url) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.artImgPrev = this.artImg || null;
      this.artImg = img;
      this.artFadeStart = this.lastT || 0;
    };
    img.src = url;
  }

  drawFluid(ctx, W, H, t) {
    const sp = this.s.motionSpeed ?? 1;
    const fade = Math.min(1, ((this.lastT || 0) - (this.artFadeStart || 0)) / 1.6);
    const R = Math.max(W, H);
    const copies = [
      [0.22, 0.28, 1.05, 0.031], [0.8, 0.22, 0.9, -0.026], [0.28, 0.85, 0.95, 0.022], [0.82, 0.8, 1.1, -0.029], [0.5, 0.5, 0.7, 0.04],
    ];
    const paint = (img, alpha) => {
      if (!img || alpha <= 0) return;
      copies.forEach(([x, y, s, rot], i) => {
        const cx = W * (x + Math.sin(t * sp * 0.05 + i * 1.9) * 0.08);
        const cy = H * (y + Math.cos(t * sp * 0.043 + i * 1.3) * 0.08);
        const size = R * s;
        ctx.save();
        ctx.globalAlpha = alpha * (i === 4 ? 0.7 : 0.95);
        ctx.translate(cx, cy);
        ctx.rotate(t * sp * rot * Math.PI * 2 + i);
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
      });
    };
    paint(this.artImgPrev, 1 - fade);
    paint(this.artImg, this.artImgPrev ? fade : 1);
    if (fade >= 1) this.artImgPrev = null;
  }

  // Ambilight colors sampled from the cover's edges (32 values, clockwise).
  setEdges(edges) {
    if (!edges?.length) return;
    this.edgesT = edges.map((c) => c.slice());
    if (!this.edges || this.edges.length !== edges.length) this.edges = edges.map((c) => c.slice());
  }

  // Soft organic 0..1 "noise" (layered sines) so the lights never sit still.
  wobble(x, t) {
    return 0.5 + 0.25 * Math.sin(x * 1.7 + t * 1.3) + 0.15 * Math.sin(x * 3.9 - t * 2.1) + 0.1 * Math.sin(x * 7.3 + t * 0.7);
  }

  sampleEdges(v) {
    const E = this.edges, n = E.length;
    const f = frac(v) * n, i = Math.floor(f) % n;
    return mixRGB(E[i], E[(i + 1) % n], f - Math.floor(f));
  }

  /*
   * Color + brightness (~0..1) of the LED strip at perimeter position u.
   * lvl is the beat level, smoothed with a ~150 ms time constant (Hyperion-style smoothing),
   * so the lights react to the music without flickering.
   */
  ledColor(u, t, lvl) {
    const s = this.s;
    const sp = s.ledSpeed ?? 1;
    let c, b;
    switch (s.edgeLights) {
      case 'mirror':
        // Classic Ambilight: each screen edge follows the cover's edge, with a slow drift and shimmer.
        c = this.sampleEdges(u + 0.03 * Math.sin(t * 0.35 * sp));
        b = 0.55 + 0.35 * this.wobble(u * 9, t * sp);
        break;
      case 'chase': {
        c = this.sampleEdges(u - t * sp * 0.03);
        b = 0.08;
        for (let q = 0; q < 3; q++) {
          const head = frac(t * sp * 0.09 + q / 3);
          b = Math.max(b, Math.exp(-frac(head - u) * 18)); // bright head with a fading tail
        }
        break;
      }
      case 'breathe':
        c = this.sampleEdges(u + t * sp * 0.012);
        b = 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.1 * sp)) + 0.6 * lvl;
        break;
      case 'rainbow':
        c = hue2rgb(frac(u - t * sp * 0.05));
        b = 0.42 + 0.45 * Math.exp(-(ring(u - t * sp * 0.07) ** 2) / 0.006) + 0.15 * this.wobble(u * 11, t * sp);
        break;
      case 'flow':
      default: {
        // Cover colors circulate around the corners while two soft light pulses travel along the strip.
        c = this.sampleEdges(u - t * sp * 0.035);
        const p1 = Math.exp(-(ring(u - t * sp * 0.06) ** 2) / 0.004);
        const p2 = Math.exp(-(ring(u - t * sp * 0.06 - 0.5) ** 2) / 0.004);
        b = 0.4 + 0.5 * Math.max(p1, p2) + 0.18 * this.wobble(u * 12, t * sp);
      }
    }
    return [c, b * ((s.ledBrightness ?? 75) / 100) * (0.85 + 0.5 * lvl)];
  }

  // Soft light spill (low-res canvas, screen-blended): Ambilight halo around the cover + LED glow along the edges.
  // Defaults aim for "bias lighting" levels (~10–15% of white, per SMPTE RP 166), not a floodlight.
  drawGlow(t, lvl) {
    const ctx = this.gctx;
    if (!ctx) return;
    const W = this.glow.width, H = this.glow.height, s = this.s;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    if (!this.edges) return;
    const sc = W / innerWidth;
    const n = this.edges.length;
    const sp = s.ledSpeed ?? 1;

    if (s.ambilight && s.artStyle !== 'hidden') {
      const r = this.getArtRect(t * 1000);
      if (r) {
        const x = r.left * sc, y = r.top * sc, w = r.width * sc, h = r.height * sc;
        const size = Math.max(w, h);
        const k = (s.ambiStrength ?? 55) / 100;
        const round = s.artStyle === 'circle' || s.artStyle === 'vinyl';
        const orbit = frac(t * sp * 0.045); // two light "hot spots" slowly orbit the cover
        ctx.globalCompositeOperation = 'screen'; // overlapping glows blend toward the color, not to white
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n;
          const [px, py, nx, ny] = round ? circlePoint(u, x + w / 2, y + h / 2, w / 2) : rectPoint(u, x, y, w, h);
          const c = this.sampleEdges(u + t * sp * 0.012); // colors rotate gently around the cover
          const spot = Math.max(Math.exp(-(ring(u - orbit) ** 2) / 0.01), Math.exp(-(ring(u - orbit - 0.5) ** 2) / 0.01));
          const life = 0.45 + 0.35 * spot + 0.2 * this.wobble(u * 8, t * sp * 0.8);
          const a = Math.min(0.5, 0.34 * k * life * (1 + lvl * 0.7));
          const rad = size * (0.3 + 0.05 * lvl + 0.03 * Math.sin(t * 0.6 * sp + u * 6)) * Math.max(0.6, Math.sqrt(k));
          const cx = px + nx * size * 0.05, cy = py + ny * size * 0.05;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
          g.addColorStop(0, rgba(c, a));
          g.addColorStop(0.5, rgba(c, a * 0.3));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        }
      }
    }

    if (s.edgeLights && s.edgeLights !== 'off' && (s.ledGlow ?? 85) > 0) {
      this.drawEdgeGlow(ctx, W, H, t, lvl, Math.min(W, H) * 0.14 * ((s.ledGlow ?? 85) / 100));
    }
  }

  /*
   * Edge light as one continuous band: each side is cut into thin slices that sit edge-to-edge,
   * each fading inward with its own color, so there are no blobs or dots — just a smooth wash of
   * light that flows around the corners.
   */
  drawEdgeGlow(ctx, W, H, t, lvl, reach) {
    ctx.globalCompositeOperation = 'screen';
    const P = 2 * (W + H);
    const slice = 5; // glow-canvas px per slice (~14 screen px), blurred together by CSS
    const sides = [
      { len: W, start: 0, rect: (a, b) => [a, 0, b - a, reach], grad: (a) => [a, 0, a, reach] },
      { len: H, start: W, rect: (a, b) => [W - reach, a, reach, b - a], grad: (a) => [W, a, W - reach, a] },
      { len: W, start: W + H, rect: (a, b) => [W - b, H - reach, b - a, reach], grad: (a) => [W - a, H, W - a, H - reach] },
      { len: H, start: 2 * W + H, rect: (a, b) => [0, H - b, reach, b - a], grad: (a) => [0, H - a, reach, H - a] },
    ];
    for (const side of sides) {
      const n = Math.max(1, Math.ceil(side.len / slice));
      for (let j = 0; j < n; j++) {
        const a = (j * side.len) / n, b2 = ((j + 1) * side.len) / n;
        const [c, br] = this.ledColor((side.start + (a + b2) / 2) / P, t, lvl);
        if (br < 0.03) continue;
        const [gx0, gy0, gx1, gy1] = side.grad(a);
        const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
        g.addColorStop(0, rgba(c, Math.min(0.7, 0.56 * br)));
        g.addColorStop(0.35, rgba(c, Math.min(0.28, 0.2 * br)));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        const [rx, ry, rw, rh] = side.rect(a, b2);
        ctx.fillRect(rx, ry, rw + 0.6, rh + 0.6); // tiny overlap hides seams
      }
    }
  }

  // The crisp LED strip itself, hugging the screen edge (full resolution, additive).
  drawStrip(ctx, W, H, t, bass) {
    const s = this.s;
    if (!this.edges || !s.edgeLights || s.edgeLights === 'off') return;
    const th = (s.ledThickness ?? 3) * this.dpr;
    if (th <= 0) return;
    const K = 200;
    // One pass, flat ends, no additive blending: segments meet edge-to-edge as a continuous line
    // (round caps + additive overlap is what made the old strip look like a row of dots).
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
    ctx.lineWidth = th;
    for (let k = 0; k < K; k++) {
      const u0 = k / K, u1 = (k + 1) / K;
      const [c, b] = this.ledColor((u0 + u1) / 2, t, bass);
      if (b < 0.03) continue;
      const [x0, y0] = rectPoint(u0, th / 2, th / 2, W - th, H - th);
      const [x1, y1] = rectPoint(u1, th / 2, th / 2, W - th, H - th);
      ctx.strokeStyle = rgba(mixRGB(c, [255, 255, 255], 0.2), Math.min(0.85, b * 0.85));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  setPalette(p) {
    this.target = p.mesh.map((c) => c.slice());
    this.baseT = p.bg.slice();
    this.base2T = p.bg2.slice();
    this.accentT = p.accent.slice();
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.bg.width = Math.max(1, Math.round(innerWidth * 0.3));
    this.bg.height = Math.max(1, Math.round(innerHeight * 0.3));
    this.fx.width = Math.round(innerWidth * dpr);
    this.fx.height = Math.round(innerHeight * dpr);
    if (this.glow) {
      this.glow.width = Math.max(1, Math.round(innerWidth * 0.35));
      this.glow.height = Math.max(1, Math.round(innerHeight * 0.35));
    }
    this.artRect = null;
  }

  newParticle(anywhere = false) {
    return {
      x: Math.random(), y: anywhere ? Math.random() : 1.05 + Math.random() * 0.1,
      z: 0.25 + Math.random() * 0.75, c: (Math.random() * 5) | 0, ph: Math.random() * Math.PI * 2,
    };
  }

  frame(t, playing) {
    const dt = Math.min(0.05, t - (this.lastT || t));
    this.lastT = t;
    const k = 1 - Math.pow(0.04, dt); // ~1s color glide
    this.colors.forEach((c, i) => { for (let j = 0; j < 3; j++) c[j] = lerp(c[j], this.target[i][j], k); });
    for (let j = 0; j < 3; j++) {
      this.base[j] = lerp(this.base[j], this.baseT[j], k);
      this.base2[j] = lerp(this.base2[j], this.base2T[j], k);
      this.accent[j] = lerp(this.accent[j], this.accentT[j], k);
    }
    if (this.edges && this.edgesT) {
      for (let i = 0; i < this.edges.length; i++) for (let j = 0; j < 3; j++) this.edges[i][j] = lerp(this.edges[i][j], this.edgesT[i][j], k);
    }
    AudioBus.update(t, playing);
    const react = (this.s.reactivity ?? 100) / 100;
    const bass = AudioBus.bass * react;
    // Light level follows the beat through a ~150 ms smoothing filter (like Hyperion's linear smoothing).
    this.lvl = (this.lvl || 0) + (Math.min(1, bass) - (this.lvl || 0)) * (1 - Math.exp(-dt / 0.15));
    document.documentElement.style.setProperty('--pulse', this.s.artPulse ? Math.min(1, bass).toFixed(3) : '0');
    document.documentElement.style.setProperty('--energy', Math.min(1, AudioBus.energy * react).toFixed(3));
    this.drawBackground(t, bass);
    this.drawGlow(t, this.lvl);
    this.drawFx(t, dt, bass, playing);
  }

  drawBackground(t, bass) {
    const ctx = this.bctx, W = this.bg.width, H = this.bg.height, s = this.s;
    const mode = s.background;
    ctx.globalCompositeOperation = 'source-over';
    if (mode === 'room') {
      // A dark wall faintly tinted by the song, so the lights have something to glow on.
      const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
      g.addColorStop(0, rgba(this.base2.map((v) => v * 0.7), 1));
      g.addColorStop(1, rgba(this.base.map((v) => v * 0.45), 1));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    if (mode === 'solid') {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, rgba(this.base2, 1));
      g.addColorStop(0.55, rgba(this.base, 1));
      g.addColorStop(1, rgba(this.colors[0].map((v) => v * 0.35), 1));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const x = W * (0.5 + 0.3 * Math.sin(t * 0.07 * s.motionSpeed)), y = H * (0.4 + 0.2 * Math.cos(t * 0.05 * s.motionSpeed));
      const rg = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.7);
      rg.addColorStop(0, rgba(this.colors[0], 0.35));
      rg.addColorStop(1, rgba(this.colors[0], 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    if (mode === 'mesh' || mode === 'fluid') { ctx.fillStyle = rgba(this.base, 1); ctx.fillRect(0, 0, W, H); }
    else ctx.clearRect(0, 0, W, H);
    if (mode === 'art' || mode === 'video' || mode === 'canvas' || mode === 'color') return;
    let meshAlpha = 1;
    if (mode === 'fluid') {
      this.drawFluid(ctx, W, H, t);
      meshAlpha = ((s.meshOpacity ?? 60) / 100) * 0.45;
      if (!this.artImg) meshAlpha = 1;
    }
    const sp = s.motionSpeed ?? 1;
    const R = Math.max(W, H);
    ctx.globalAlpha = meshAlpha;
    for (let i = 0; i < 5; i++) {
      const a = t * sp * (0.06 + i * 0.021);
      const x = W * (0.5 + 0.42 * Math.sin(a * 1.3 + i * 2.1));
      const y = H * (0.5 + 0.42 * Math.cos(a * 0.9 + i * 1.7));
      const r = R * (0.42 + 0.1 * Math.sin(a * 2 + i)) * (1 + bass * 0.22);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(this.colors[i], 0.75));
      g.addColorStop(0.55, rgba(this.colors[i], 0.25));
      g.addColorStop(1, rgba(this.colors[i], 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  getArtRect(now) {
    if (!this.artRect || now - this.artRectAt > 400) {
      const r = this.art?.getBoundingClientRect();
      this.artRect = r && r.width ? r : null;
      this.artRectAt = now;
    }
    return this.artRect;
  }

  drawFx(t, dt, bass, playing) {
    const ctx = this.fctx, W = this.fx.width, H = this.fx.height, s = this.s, dpr = this.dpr;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // particles
    const speed = (s.motionSpeed ?? 1) * (playing ? 1 : 0.35) * (1 + AudioBus.energy * 2);
    const size = (s.particleSize ?? 100) / 100;
    for (const p of this.particles) {
      p.y -= (0.012 + 0.03 * p.z) * speed * dt;
      p.x += Math.sin(t * 0.4 + p.ph) * 0.006 * dt;
      if (p.y < -0.05) Object.assign(p, this.newParticle());
      const r = (1.2 + 4 * p.z) * dpr * size * (1 + bass * 0.7);
      const a = (0.18 + 0.45 * p.z) * (0.65 + 0.35 * Math.sin(t * 1.5 + p.ph));
      const x = p.x * W, y = p.y * H;
      const col = this.colors[p.c];
      ctx.fillStyle = rgba(col.map((v) => Math.min(255, v * 1.4 + 40)), a * 0.25);
      ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(col.map((v) => Math.min(255, v * 1.5 + 70)), a);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    this.drawStrip(ctx, W, H, t, this.lvl);
    const type = s.visualizer;
    if (!type || type === 'off') return;
    ctx.globalAlpha = (s.vizOpacity ?? 70) / 100;
    const maxH = H * (s.vizHeight ?? 22) / 100;
    const grad = ctx.createLinearGradient(0, H, 0, H - maxH);
    grad.addColorStop(0, rgba(this.accent, 0.95));
    grad.addColorStop(1, rgba(this.colors[1], 0.15));

    if (type === 'bars' || type === 'mirror') {
      const n = Math.max(24, Math.min(96, Math.round(W / (14 * dpr))));
      const vals = AudioBus.bars(type === 'mirror' ? Math.ceil(n / 2) : n);
      const bw = W / n, gap = Math.max(1, bw * 0.28);
      ctx.fillStyle = grad;
      for (let i = 0; i < n; i++) {
        const v = type === 'mirror' ? vals[Math.abs(i - (n - 1) / 2) | 0] : vals[i];
        const h = Math.max(3 * dpr, v * maxH);
        ctx.beginPath();
        ctx.roundRect(i * bw + gap / 2, H - h, bw - gap, h + 4 * dpr, Math.min((bw - gap) / 2, 6 * dpr));
        ctx.fill();
      }
    } else if (type === 'wave') {
      const n = 64, vals = AudioBus.bars(n);
      const pts = Array.from({ length: n }, (_, i) => [(i / (n - 1)) * W, H - 6 * dpr - vals[i] * maxH * (0.85 + 0.15 * Math.sin(t * 3 + i * 0.4))]);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(0, H);
        ctx.lineTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < n; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        ctx.lineTo(W, pts[n - 1][1]);
        ctx.lineTo(W, H);
        ctx.closePath();
      };
      path(); ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = rgba(this.accent, 0.9); ctx.lineWidth = 2 * dpr; ctx.stroke();
    } else if (type === 'dots') {
      const cols = Math.max(24, Math.round(W / (18 * dpr))), rows = 10;
      const vals = AudioBus.bars(cols);
      const cw = W / cols, ch = maxH / rows, r = Math.min(cw, ch) * 0.32;
      for (let i = 0; i < cols; i++) {
        const lit = Math.round(vals[i] * rows);
        for (let j = 0; j < rows; j++) {
          ctx.fillStyle = j < lit ? rgba(j > rows * 0.75 ? this.colors[2] : this.accent, 0.9) : 'rgba(255,255,255,0.06)';
          ctx.beginPath(); ctx.arc(i * cw + cw / 2, H - j * ch - ch / 2, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (type === 'circle') {
      const rect = this.getArtRect(t * 1000);
      const cx = rect ? (rect.left + rect.width / 2) * dpr : W / 2;
      const cy = rect ? (rect.top + rect.height / 2) * dpr : H / 2;
      const base = rect ? (Math.max(rect.width, rect.height) / 2) * dpr + 14 * dpr : Math.min(W, H) * 0.2;
      const n = 120, vals = AudioBus.bars(n / 2);
      const len = base * 0.6 * ((s.vizHeight ?? 22) / 22);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2 * dpr, (Math.PI * 2 * base / n) * 0.45);
      for (let i = 0; i < n; i++) {
        const v = vals[i < n / 2 ? i : n - 1 - i];
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + t * 0.05;
        const l = 3 * dpr + v * len;
        ctx.strokeStyle = rgba(this.colors[i % 5].map((c) => Math.min(255, c * 1.3 + 30)), 0.9);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * base, cy + Math.sin(ang) * base);
        ctx.lineTo(cx + Math.cos(ang) * (base + l), cy + Math.sin(ang) * (base + l));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
