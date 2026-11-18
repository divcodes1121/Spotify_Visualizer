/*
 * Liquid glass — real refraction for glass panels.
 * For each element we render a displacement map (a "normal map" of a rounded-rect lens with
 * a curved bezel), wrap it in an SVG filter (feImage → feDisplacementMap), and apply it with
 * `backdrop-filter: url(#id)`. Chromium-only; elsewhere elements keep the frosted fallback.
 */
const NS = 'http://www.w3.org/2000/svg';
export const liquidSupported = (() => {
  try { return !!window.chrome && CSS.supports('backdrop-filter', 'url(#a)'); } catch { return false; }
})();

let svg = null;
let counter = 0;
const registry = new Set();
let enabled = true;

function ensureSvg() {
  if (svg) return svg;
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.append(document.createElementNS(NS, 'defs'));
  document.body.append(svg);
  return svg;
}

// Displacement map for a rounded rectangle: pixels near the edge sample from further inside,
// like light bending through a thick convex glass rim. R = x shift, G = y shift (128 = none).
function makeMap(W, H, R, bezel) {
  const s = 0.5; // render at half resolution, the filter scales it up
  const w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hx = W / 2, hy = H / 2, r = Math.min(R, hx, hy);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const px = (i + 0.5) / s - hx, py = (j + 0.5) / s - hy;
      const qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const sdf = outside + Math.min(Math.max(qx, qy), 0) - r; // <0 inside
      let nx = 0, ny = 0;
      if (qx > 0 && qy > 0) { nx = ox / (outside || 1); ny = oy / (outside || 1); }
      else if (qx > qy) nx = 1; else ny = 1;
      nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
      const dist = -sdf;
      let amt = 0;
      if (dist >= 0 && dist < bezel) {
        const t = 1 - dist / bezel;          // 1 at the rim, 0 where the flat center starts
        amt = Math.pow(t, 2.2);              // convex squircle-ish profile
      }
      const k = (j * w + i) * 4;
      d[k] = 128 - nx * amt * 127;
      d[k + 1] = 128 - ny * amt * 127;
      d[k + 2] = 128;
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function build(entry) {
  const { el, filter, image, disp, opts } = entry;
  const rect = el.getBoundingClientRect();
  const W = Math.round(rect.width), H = Math.round(rect.height);
  if (W < 4 || H < 4 || (W === entry.W && H === entry.H)) return;
  entry.W = W; entry.H = H;
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  const bezel = Math.min(opts.bezel, Math.min(W, H) / 2);
  for (const node of [filter, image]) {
    node.setAttribute('x', 0); node.setAttribute('y', 0);
    node.setAttribute('width', W); node.setAttribute('height', H);
  }
  image.setAttribute('href', makeMap(W, H, radius, bezel));
  disp.setAttribute('scale', opts.scale);
  if (enabled) el.style.setProperty('--lg', `url(#${entry.id})`);
}

export function liquidGlass(el, { bezel = 22, scale = 46 } = {}) {
  if (!liquidSupported || !el || el._lg) return;
  const defs = ensureSvg().firstChild;
  const id = `lg${++counter}`;
  const filter = document.createElementNS(NS, 'filter');
  filter.id = id;
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const image = document.createElementNS(NS, 'feImage');
  image.setAttribute('preserveAspectRatio', 'none');
  image.setAttribute('result', 'map');
  const disp = document.createElementNS(NS, 'feDisplacementMap');
  disp.setAttribute('in', 'SourceGraphic');
  disp.setAttribute('in2', 'map');
  disp.setAttribute('xChannelSelector', 'R');
  disp.setAttribute('yChannelSelector', 'G');
  filter.append(image, disp);
  defs.append(filter);
  const entry = { el, id, filter, image, disp, opts: { bezel, scale }, W: 0, H: 0 };
  el._lg = entry;
  el.classList.add('lg-on');
  registry.add(entry);
  let t = null;
  new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => build(entry), 60); }).observe(el);
  requestAnimationFrame(() => build(entry));
}

export function setLiquidEnabled(on) {
  enabled = on && liquidSupported;
  for (const e of registry) {
    if (enabled && e.W) e.el.style.setProperty('--lg', `url(#${e.id})`);
    else e.el.style.removeProperty('--lg');
  }
  document.documentElement.classList.toggle('liquid', enabled);
}
