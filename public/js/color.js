// Palette extraction from album art or video frames (k-means on a downscaled canvas).

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

export const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const css = (rgb) => `rgb(${rgb.map((v) => Math.round(v)).join(' ')})`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function samplePixels(source, size = 48) {
  canvas.width = size; canvas.height = size;
  ctx.drawImage(source, 0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127) px.push([d[i], d[i + 1], d[i + 2]]);
  return px;
}

function kmeans(px, k = 6, iters = 8) {
  if (!px.length) return [];
  // k-means++-ish init: start from the middle pixel, then pick the farthest each time
  const centers = [px[Math.floor(px.length / 2)].slice()];
  while (centers.length < k) {
    let best = null, bestD = -1;
    for (let i = 0; i < px.length; i += 3) {
      const d = Math.min(...centers.map((c) => dist2(c, px[i])));
      if (d > bestD) { bestD = d; best = px[i]; }
    }
    if (!best || bestD < 1) break;
    centers.push(best.slice());
  }
  const assign = new Array(px.length).fill(0);
  for (let it = 0; it < iters; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(px[i], centers[c]);
        if (d < bd) { bd = d; bi = c; }
      }
      assign[i] = bi;
      const s = sums[bi]; s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++;
    }
    sums.forEach((s, c) => { if (s[3]) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = centers.map(() => 0);
  assign.forEach((c) => counts[c]++);
  return centers.map((rgb, i) => ({ rgb, count: counts[i] / px.length, hsl: rgbToHsl(rgb) }))
    .filter((c) => c.count > 0.005)
    .sort((a, b) => b.count - a.count);
}

/*
 * Turns raw clusters into a palette tuned for a dark, glowing UI:
 *  mesh: 5 luminous colors for the animated background
 *  accent: readable highlight color, bg: deep base tone
 */
function buildPalette(clusters, boost = 1) {
  if (!clusters.length) return paletteFromHex('#1ed760', boost);
  const maxSat = Math.max(...clusters.map((c) => c.hsl[1]));
  const mono = maxSat < 0.12;
  const vibrancy = (c) => c.hsl[1] * (1 - Math.abs(c.hsl[2] - 0.5) * 1.5) * (0.4 + Math.sqrt(c.count));
  const byVibrancy = [...clusters].sort((a, b) => vibrancy(b) - vibrancy(a));
  const vibrant = byVibrancy[0];
  const dominant = clusters[0];

  const tune = (hsl, lMin, lMax, sMul = 1) => {
    const [h, s, l] = hsl;
    return hslToRgb([h, mono ? s : clamp(s * sMul * boost, 0, 1), clamp(l, lMin, lMax)]);
  };

  const ordered = [vibrant, ...byVibrancy.filter((c) => c !== vibrant)];
  const mesh = [];
  for (let i = 0; i < 5; i++) {
    const c = ordered[i % ordered.length];
    let [h, s, l] = c.hsl;
    if (i >= ordered.length) h = (h + 0.06 * i) % 1; // spread hues when the art has few colors
    mesh.push(tune([h, s, l], 0.28, 0.62, 1.15));
  }
  const accent = tune(vibrant.hsl, 0.6, 0.74, 1.25);
  const [dh, ds] = dominant.hsl;
  const bg = hslToRgb([dh, mono ? 0 : clamp(ds * 0.7, 0, 0.6), 0.08]);
  const bg2 = hslToRgb([vibrant.hsl[0], mono ? 0 : clamp(vibrant.hsl[1] * 0.8, 0, 0.7), 0.16]);
  // Mid-tone "card" color, like Spotify's lyrics background: saturated enough to feel like the cover,
  // dark enough for white text, light enough that dark upcoming lines stay readable.
  const cardSrc = vibrant.count > 0.08 || dominant.hsl[1] < 0.15 ? vibrant : dominant;
  const card = hslToRgb([cardSrc.hsl[0], mono ? 0.04 : clamp(cardSrc.hsl[1] * boost, 0.35, 0.72), 0.4]);
  return { mesh, accent, bg, bg2, card, mono, raw: clusters.map((c) => c.rgb) };
}

/*
 * Ambilight sampling: average colors along the 4 edges of the image, clockwise from the
 * top-left corner (top L→R, right T→B, bottom R→L, left B→T), boosted to look like LEDs.
 */
export function edgesFromSource(source, perSide = 8, boost = 1) {
  const S = 48, band = 6;
  canvas.width = S; canvas.height = S;
  ctx.drawImage(source, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  const avg = (x0, y0, x1, y1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * S + x) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    return [r / n, g / n, b / n];
  };
  const seg = S / perSide;
  const out = [];
  for (let j = 0; j < perSide; j++) out.push(avg(Math.floor(j * seg), 0, Math.ceil((j + 1) * seg), band));
  for (let j = 0; j < perSide; j++) out.push(avg(S - band, Math.floor(j * seg), S, Math.ceil((j + 1) * seg)));
  for (let j = perSide - 1; j >= 0; j--) out.push(avg(Math.floor(j * seg), S - band, Math.ceil((j + 1) * seg), S));
  for (let j = perSide - 1; j >= 0; j--) out.push(avg(0, Math.floor(j * seg), band, Math.ceil((j + 1) * seg)));
  return out.map((c) => {
    const [h, s, l] = rgbToHsl(c);
    // LEDs are emissive: push saturation up and keep lightness in a glowing range
    return hslToRgb([h, s < 0.08 ? s : clamp(s * 1.35 * boost, 0, 1), clamp(l, 0.42, 0.66)]);
  });
}

export function edgesFromPalette(p, perSide = 8) {
  return Array.from({ length: perSide * 4 }, (_, i) => p.mesh[Math.floor(i / perSide) % p.mesh.length].slice());
}

export function paletteFromSource(source, boost = 1) {
  return buildPalette(kmeans(samplePixels(source)), boost);
}

export async function paletteFromUrl(url, boost = 1) {
  const img = await loadImage(url);
  return paletteFromSource(img, boost);
}

// Palette + Ambilight edge colors from one image load.
export async function analyzeUrl(url, boost = 1) {
  const img = await loadImage(url);
  return { palette: paletteFromSource(img, boost), edges: edgesFromSource(img, 8, boost) };
}

export function paletteFromHex(hex, boost = 1) {
  const [h, s] = rgbToHsl(hexToRgb(hex));
  const sat = clamp(Math.max(s, 0.5) * boost, 0, 1);
  const hues = [0, 0.08, -0.08, 0.16, 0.5];
  return {
    mesh: hues.map((o, i) => hslToRgb([(h + o + 1) % 1, sat, 0.42 + (i % 2) * 0.12])),
    accent: hslToRgb([h, sat, 0.66]),
    bg: hslToRgb([h, sat * 0.5, 0.07]),
    bg2: hslToRgb([h, sat * 0.6, 0.15]),
    card: hslToRgb([h, clamp(sat, 0.35, 0.72), 0.4]),
    mono: false,
    raw: [hexToRgb(hex)],
  };
}

export function applyPaletteCSS(p, root = document.documentElement) {
  p.mesh.forEach((c, i) => root.style.setProperty(`--c${i + 1}`, css(c)));
  root.style.setProperty('--accent', css(p.accent));
  root.style.setProperty('--bg', css(p.bg));
  root.style.setProperty('--bg2', css(p.bg2));
  root.style.setProperty('--card', css(p.card));
}
