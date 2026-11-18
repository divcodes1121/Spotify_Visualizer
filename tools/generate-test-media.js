#!/usr/bin/env node
/*
 * Generates abstract test artwork (PNG) + demo tracks with original synced lyrics
 * into ./test-media so you can try every visual feature without a Spotify login.
 * Zero dependencies: contains a tiny PNG encoder.  Run:  npm run media
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'test-media');
const IMG_DIR = path.join(OUT, 'images');
const SIZE = 800;

/* ---------------- PNG encoder ---------------- */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- math helpers ---------------- */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const mixC = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return mix(mix(hash(xi, yi, seed), hash(xi + 1, yi, seed), u), mix(hash(xi, yi + 1, seed), hash(xi + 1, yi + 1, seed), u), v);
}
function fbm(x, y, seed, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, seed + i * 17); f *= 2; a *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}
function gradient(stops, t) {
  t = clamp(t);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
      return mixC(c0, c1, (t - p0) / (p1 - p0 || 1));
    }
  }
  return stops[stops.length - 1][1];
}
const gauss = (dx, dy, r) => Math.exp(-(dx * dx + dy * dy) / (2 * r * r));

/* ---------------- artwork styles ---------------- */
const ART = {
  'neon-tide': (u, v) => {
    const bg = gradient([[0, hex('#12002e')], [0.6, hex('#5b0a7a')], [1, hex('#ff2d95')]], v * 0.8 + u * 0.2);
    const n = fbm(u * 3, v * 3, 1);
    let c = bg;
    for (let k = 0; k < 4; k++) {
      const wave = Math.sin(u * 7 + k * 1.3 + n * 4) * 0.08 + 0.25 + k * 0.17;
      const band = Math.exp(-Math.pow((v - wave) * 38, 2));
      c = mixC(c, k % 2 ? hex('#00f0ff') : hex('#7dffcb'), band * 0.85);
    }
    return c;
  },
  'golden-hour': (u, v) => {
    let c = gradient([[0, hex('#ffb347')], [0.45, hex('#ff6f61')], [0.75, hex('#6a2c70')], [1, hex('#1d1135')]], v);
    const d = Math.hypot(u - 0.5, v - 0.52);
    const sun = smooth(0.25, 0.235, d);
    const stripes = v > 0.55 ? (Math.sin(v * 140) > -0.2 + (v - 0.55) * 3 ? 1 : 0) : 1;
    c = mixC(c, gradient([[0, hex('#fff3b0')], [1, hex('#ff8c42')]], (v - 0.27) / 0.5), sun * stripes);
    c = mixC(c, hex('#ffd56b'), smooth(0.45, 0.24, d) * 0.25 * (1 - sun));
    return c;
  },
  'forest-echo': (u, v) => {
    const n = fbm(u * 4, v * 4, 7);
    const d = Math.hypot(u - 0.38, v - 0.62) + n * 0.12;
    const rings = 0.5 + 0.5 * Math.sin(d * 60);
    const base = gradient([[0, hex('#0b2e1f')], [0.5, hex('#1f6b45')], [1, hex('#c8e86b')]], n);
    return mixC(base, hex('#e7ffd1'), smooth(0.85, 1, rings) * 0.35 * (1 - d));
  },
  'midnight-drive': (u, v) => {
    let c = gradient([[0, hex('#05051a')], [0.5, hex('#1a1046')], [0.56, hex('#ff3cac')], [0.58, hex('#2b0f54')], [1, hex('#070418')]], v);
    if (v > 0.58) {
      const z = 1 / (v - 0.56);
      const gx = Math.abs(((u - 0.5) * z * 1.2) % 1);
      const gy = Math.abs((z * 0.6) % 1);
      const line = Math.max(smooth(0.06, 0, Math.min(gx, 1 - gx)), smooth(0.08, 0, Math.min(gy, 1 - gy)));
      c = mixC(c, hex('#ff4fd8'), line * clamp((v - 0.58) * 3));
    } else {
      const star = hash(Math.floor(u * 300), Math.floor(v * 300), 3) > 0.996 ? 1 : 0;
      c = mixC(c, [1, 1, 1], star * 0.9);
      const d = Math.hypot(u - 0.5, (v - 0.45) * 1.1);
      c = mixC(c, gradient([[0, hex('#ffe66d')], [1, hex('#ff3cac')]], (v - 0.25) / 0.3), smooth(0.2, 0.19, d));
    }
    return c;
  },
  'ice-bloom': (u, v) => {
    let c = hex('#e9f4ff');
    const blobs = [[0.3, 0.3, 0.2, '#9fd3ff'], [0.7, 0.4, 0.22, '#c7b8ff'], [0.45, 0.75, 0.25, '#8ef0e6'], [0.8, 0.8, 0.15, '#ffffff']];
    for (const [x, y, r, col] of blobs) c = mixC(c, hex(col), gauss(u - x, v - y, r) * 0.9);
    const n = fbm(u * 6, v * 6, 11);
    return mixC(c, hex('#4f8ad8'), smooth(0.62, 0.8, n) * 0.4);
  },
  ember: (u, v) => {
    const w = fbm(u * 3 + fbm(u * 2, v * 2, 5) * 2, v * 3 - 0.5, 9);
    const t = clamp(w * 1.4 - (1 - v) * 0.55);
    return gradient([[0, hex('#060000')], [0.35, hex('#5c0700')], [0.6, hex('#d7260e')], [0.8, hex('#ff8a00')], [1, hex('#ffe08a')]], t);
  },
  'lavender-haze': (u, v) => {
    const q = fbm(u * 2.5, v * 2.5, 21);
    const r = fbm(u * 2.5 + q * 3, v * 2.5 + q * 3, 33);
    return gradient([[0, hex('#2d1b4e')], [0.4, hex('#8e5bd1')], [0.7, hex('#ff9ecf')], [1, hex('#ffd9b3')]], r);
  },
  'mono-lines': (u, v) => {
    const line = Math.abs(Math.sin((u + v) * 60)) > 0.92 ? 1 : 0;
    let c = mixC(hex('#151515'), hex('#d9d9d9'), line * (0.3 + 0.7 * v));
    const d = Math.hypot(u - 0.68, v - 0.32);
    c = mixC(c, hex('#e63946'), smooth(0.1, 0.095, d));
    return c;
  },
  'citrus-pop': (u, v) => {
    let c = hex('#ffd23f');
    if (Math.hypot(u - 0.3, v - 0.35) < 0.22) c = hex('#ee4266');
    if (u > 0.5 && v > 0.45 && u < 0.92 && v < 0.88) c = hex('#0ead69');
    const tri = v > 0.55 && Math.abs(u - 0.32) < (v - 0.55) * 0.8;
    if (tri) c = hex('#3bceac');
    if (Math.hypot(u - 0.75, v - 0.22) < 0.09) c = hex('#540d6e');
    return c;
  },
  'deep-ocean': (u, v) => {
    const base = gradient([[0, hex('#0f6b78')], [0.5, hex('#06394a')], [1, hex('#010f1c')]], v);
    const n1 = fbm(u * 5, v * 5, 41), n2 = fbm(u * 5 + 3.1, v * 5 + 1.7, 42);
    const caustic = Math.pow(1 - Math.abs(n1 - n2) * 4, 8);
    return mixC(base, hex('#9ff6ff'), clamp(caustic) * (1 - v) * 0.8);
  },
};

function render(fn, seed) {
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = fn(x / SIZE, y / SIZE);
      const g = (hash(x, y, seed) - 0.5) * 0.035; // film grain
      const i = (y * SIZE + x) * 3;
      buf[i] = clamp(c[0] + g) * 255;
      buf[i + 1] = clamp(c[1] + g) * 255;
      buf[i + 2] = clamp(c[2] + g) * 255;
    }
  }
  return encodePNG(SIZE, SIZE, buf);
}

/* ---------------- demo tracks (original lyrics) ---------------- */
const TRACKS = [
  { image: 'neon-tide', name: 'Neon Tide', artists: 'Harbor Static', album: 'Low Light Signals', bpm: 118, key: 45, mode: 'minor', lyrics: [
    'Streetlights pulling at the sea', 'Every wave a frequency', 'I can hear you in the static', 'Calling colors back to me',
    '', 'Ride the neon tide', 'Let it light us from inside', 'Ride the neon tide', 'Nothing left for us to hide',
    '', 'Glass and chrome along the shore', 'We were never here before', 'Ride the neon tide', 'Ride the neon tide'] },
  { image: 'golden-hour', name: 'Sunset Protocol', artists: 'The Paper Suns', album: 'Daybreak Archive', bpm: 96, key: 48, mode: 'major', lyrics: [
    'Half the sky is made of honey', 'Half is turning into blue', 'Every shadow getting longer', 'Every road leads back to you',
    '', 'Hold the golden hour', 'Hold it while it shines', 'Hold the golden hour', 'Before it falls behind the lines',
    '', 'Windows burning orange', 'Pages turning slow', 'Hold the golden hour', 'And never let it go'] },
  { image: 'forest-echo', name: 'Forest Echo', artists: 'Moss & Mirrors', album: 'Rings of Green', bpm: 88, key: 43, mode: 'minor', lyrics: [
    'Footsteps soft on fallen leaves', 'Something whispers through the trees', 'Every ring a year remembered', 'Every branch a memory',
    '', 'Echo, echo, call my name', 'The forest never sounds the same', 'Echo, echo, through the pines', 'I leave the noisy world behind',
    '', 'Rain is drumming on the canopy', 'Roots are holding on to me', 'Echo, echo', 'Echo, echo'] },
  { image: 'midnight-drive', name: 'Midnight Drive', artists: 'Low Orbit', album: 'Gridlines', bpm: 124, key: 40, mode: 'minor', lyrics: [
    'Engine humming, city fading', 'Grid lines stretching to the stars', 'Radio is playing something', 'That sounds a lot like who we are',
    '', 'Midnight drive, we come alive', 'Headlights cutting through the haze', 'Midnight drive, just you and I', 'Racing past the yesterdays',
    '', 'Pink horizon, never ending', 'Hands up out the window frame', 'Midnight drive, we come alive', 'Nothing ever stays the same'] },
  { image: 'ice-bloom', name: 'Ice Bloom', artists: 'Glass Garden', album: 'Winter Color', bpm: 76, key: 50, mode: 'major', lyrics: [
    'Frost is painting on the window', 'Flowers made of light and cold', 'Every breath a little cloud', 'Every story softly told',
    '', 'Bloom in the ice', 'Bloom in the white', 'Even in winter', 'Something is bright',
    '', 'Quiet morning, crystal ceiling', 'Sunlight spilling through the blue', 'Bloom in the ice', 'I bloom with you'] },
  { image: 'ember', name: 'Ember', artists: 'Ash Theory', album: 'Heat Map', bpm: 132, key: 38, mode: 'minor', lyrics: [
    'Spark it up in the dark', 'Watch it climb, watch it start', 'Every ember finds the air', 'Every fire needs a heart',
    '', 'Burn, burn, light it up', 'Turn the night to gold', 'Burn, burn, never stop', 'We were never cold',
    '', 'Smoke is curling into stories', 'Red and orange in your eyes', 'Burn, burn, light it up', 'Watch the embers rise'] },
  { image: 'lavender-haze', name: 'Violet Hours', artists: 'Soft Satellite', album: 'Dreamstate', bpm: 100, key: 47, mode: 'major', lyrics: [
    'Purple clouds are rolling in', 'Painting softly on my skin', 'Slow it down and let it spin', 'Violet hours, here again',
    '', 'Floating, floating', 'Through the violet hours', 'Floating, floating', 'Covered up in flowers',
    '', 'Peach and pink along the edges', 'Every color melting through', 'Floating, floating', 'Violet hours with you'] },
  { image: 'mono-lines', name: 'Monochrome (Instrumental)', artists: 'Line Study', album: 'Black & White', bpm: 110, key: 41, mode: 'minor', lyrics: null },
  { image: 'citrus-pop', name: 'Citrus Pop', artists: 'Juice Club', album: 'Fruit Salad Radio', bpm: 128, key: 52, mode: 'major', lyrics: [
    'Lemon yellow, cherry red', 'Bubbles floating in my head', 'Turn it up and jump around', 'Shake the colors off the ground',
    '', 'Pop, pop, citrus pop', 'Sweet and sour, never stop', 'Pop, pop, citrus pop', 'Squeeze the summer, take the top',
    '', 'Green and purple, mint and lime', 'Every flavor, every time', 'Pop, pop, citrus pop', 'Pop, pop, citrus pop'] },
  { image: 'deep-ocean', name: 'Deep Ocean', artists: 'Undertow', album: 'Pressure', bpm: 70, key: 36, mode: 'minor', lyrics: [
    'Sinking slowly, light above me', 'Ripples dancing on the floor', 'Every heartbeat getting quiet', 'Every sound a distant shore',
    '', 'Down in the deep ocean', 'Where the blue turns into black', 'Down in the deep ocean', 'I am never coming back',
    '', 'Silver bubbles, ancient water', 'Holding on to every breath', 'Down in the deep ocean', 'Peaceful in the depth'] },
];

const pad = (n, w = 2) => String(n).padStart(w, '0');
function toLRC(lines, bpm) {
  if (!lines) return null;
  const spacing = (60 / bpm) * 8; // one line every 2 bars
  let t = (60 / bpm) * 8;        // 2-bar intro
  return lines.map((text) => {
    const m = Math.floor(t / 60), s = t - m * 60;
    const stamp = `[${pad(m)}:${pad(Math.floor(s))}.${pad(Math.floor((s % 1) * 100))}]`;
    t += spacing;
    return `${stamp}${text}`;
  }).join('\n');
}

/* ---------------- write everything ---------------- */
fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(path.join(OUT, 'videos'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'audio'), { recursive: true });

let seed = 1;
for (const [name, fn] of Object.entries(ART)) {
  const file = path.join(IMG_DIR, `${name}.png`);
  fs.writeFileSync(file, render(fn, seed++));
  console.log('  ✓ images/' + name + '.png');
}

const tracks = TRACKS.map((t, i) => {
  const lineCount = t.lyrics ? t.lyrics.length : 14;
  const durationSec = Math.round((60 / t.bpm) * 8 * (lineCount + 3));
  return {
    id: `demo-${t.image}`,
    name: t.name,
    artists: t.artists,
    album: t.album,
    image: `${t.image}.png`,
    audio: null,
    bpm: t.bpm,
    key: t.key,
    mode: t.mode,
    duration: durationSec * 1000,
    lrc: toLRC(t.lyrics, t.bpm),
    order: i,
  };
});
fs.writeFileSync(
  path.join(OUT, 'demo-tracks.json'),
  JSON.stringify({
    _readme: 'Demo tracks for Aura. image = file in images/, audio = optional file in audio/ (otherwise a built-in synth plays), lrc = synced lyrics in LRC format (or null for instrumental). Edit freely.',
    tracks,
  }, null, 2),
);
console.log('  ✓ demo-tracks.json (' + tracks.length + ' tracks)');
console.log('\n  Test media ready in ' + OUT + '\n');
