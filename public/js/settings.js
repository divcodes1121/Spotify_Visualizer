// Every customizable option lives here: defaults, the settings-panel schema (grouped in tabs), and presets.
const KEY = 'aura.settings';

export const FONTS = {
  Inter: "'Inter', system-ui, sans-serif",
  'Instrument Serif': "'Instrument Serif', Georgia, serif",
  Syne: "'Syne', system-ui, sans-serif",
  Unbounded: "'Unbounded', system-ui, sans-serif",
  'Space Grotesk': "'Space Grotesk', system-ui, sans-serif",
  Outfit: "'Outfit', system-ui, sans-serif",
  'Playfair Display': "'Playfair Display', Georgia, serif",
  'Bebas Neue': "'Bebas Neue', Impact, sans-serif",
  'JetBrains Mono': "'JetBrains Mono', ui-monospace, monospace",
  Caveat: "'Caveat', cursive",
};

export const DEFAULTS = {
  // general
  openOnPlay: true,
  autoFullscreen: true,
  hideIdle: true,
  showClock: true,
  showDevice: true,
  upNext: true,

  // glass & interface
  glassStyle: 'liquid',
  glassBlur: 16,
  glassTint: 8,
  spotlight: true,
  libraryAurora: true,
  uiFont: 'Inter',
  libraryView: 'list',

  // colors
  colorMode: 'auto',
  customAccent: '#1ed760',
  colorBoost: 100,
  videoColors: true,

  // lights (TV-Ambilight style)
  // Calibrated toward bias-lighting levels (~10–15% of screen white) rather than a floodlight.
  ambilight: true,
  ambiStrength: 70,
  edgeLights: 'flow',
  ledSpeed: 1,
  ledBrightness: 80,
  ledThickness: 0, // 0 = lights only (no visible strip line)
  ledGlow: 85,

  // background
  background: 'room',
  bgVideo: '',
  blur: 70,
  bgDim: 30,
  saturation: 150,
  meshOpacity: 60,
  motionSpeed: 1,
  grain: true,
  vignette: true,

  // particles
  particles: false,
  particleCount: 60,
  particleSize: 100,

  // visualizer & art
  visualizer: 'off',
  vizHeight: 14,
  vizOpacity: 45,
  reactivity: 100,
  artPulse: true,
  layout: 'split',
  artStyle: 'rounded',
  artSize: 100,
  artGlow: true,
  artTilt: true,
  artReflection: false,

  // lyrics
  showLyrics: true,
  lyricsStyle: 'fluid',
  wordSync: true,
  lyricsSpring: true,
  lyricsFont: 'Inter',
  lyricsSize: 42,
  lyricsWeight: 800,
  lyricsSpacing: 40,
  lyricsAlign: 'left',
  lyricsBlur: true,
  lyricsGlow: true,
  lyricsOffset: 0,

  // track videos
  trackVideos: true,
  autoMatchVideos: true,
  videoDim: 40,
  ytAuto: false,
  ytKey: '',
};

const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));
const fontOpts = () => Object.keys(FONTS).map((f) => ({ value: f, label: f }));

export const TABS = ['Look', 'Lights', 'Lyrics', 'Video', 'Layout', 'General'];

export const SCHEMA = [
  { tab: 'Lights', title: 'Ambilight around the cover', items: [
    { key: 'ambilight', type: 'toggle', label: 'Cover glows onto the wall behind it (like an Ambilight TV)' },
    { key: 'ambiStrength', type: 'range', label: 'Glow strength', min: 20, max: 220, step: 5, unit: '%', when: (s) => s.ambilight },
  ] },
  { tab: 'Lights', title: 'LED strip around the screen', items: [
    { key: 'edgeLights', type: 'select', label: 'Effect', options: opts(
      ['off', 'Off'], ['flow', 'Flow: cover colors travel around the corners'], ['mirror', 'Mirror: each edge matches the cover’s edge'],
      ['chase', 'Chase: light comets race around'], ['breathe', 'Breathe: pulses with the beat'], ['rainbow', 'Spectrum: full rainbow cycle']) },
    { key: 'ledSpeed', type: 'range', label: 'Speed', min: 0, max: 4, step: 0.1, unit: '×', when: (s) => s.edgeLights !== 'off' },
    { key: 'ledBrightness', type: 'range', label: 'Brightness', min: 20, max: 200, step: 5, unit: '%', when: (s) => s.edgeLights !== 'off' },
    { key: 'ledThickness', type: 'range', label: 'Visible strip line (0 = lights only)', min: 0, max: 12, step: 1, unit: 'px', when: (s) => s.edgeLights !== 'off' },
    { key: 'ledGlow', type: 'range', label: 'Glow spill into the screen', min: 0, max: 250, step: 5, unit: '%', when: (s) => s.edgeLights !== 'off' },
  ] },
  { tab: 'Look', title: 'Glass', items: [
    { key: 'glassStyle', type: 'select', label: 'Glass style', options: opts(
      ['liquid', 'Liquid glass (refraction)'], ['frosted', 'Frosted glass'], ['clear', 'Clear glass']) },
    { key: 'glassBlur', type: 'range', label: 'Glass blur', min: 0, max: 60, step: 1, unit: 'px' },
    { key: 'glassTint', type: 'range', label: 'Glass tint', min: 0, max: 30, step: 1, unit: '%' },
    { key: 'spotlight', type: 'toggle', label: 'Cursor light on glass' },
    { key: 'libraryAurora', type: 'toggle', label: 'Animated aurora behind the library' },
    { key: 'uiFont', type: 'select', label: 'Interface font', options: fontOpts() },
  ] },
  { tab: 'Look', title: 'Background', items: [
    { key: 'background', type: 'select', label: 'Style', options: opts(
      ['room', 'Dark room (lets the lights glow)'], ['fluid', 'Fluid art (Apple Music style)'], ['canvas', 'Canvas motion art (Spotify style)'],
      ['color', 'Album color (Spotify lyrics style)'], ['art-mesh', 'Blurred art + color mesh'], ['art', 'Blurred album art'],
      ['mesh', 'Animated color mesh'], ['solid', 'Smooth gradient'], ['video', 'Ambient video (test-media/videos)']) },
    { key: 'bgVideo', type: 'select', label: 'Ambient video', options: 'videos', when: (s) => s.background === 'video' },
    { key: 'blur', type: 'range', label: 'Blur', min: 0, max: 160, step: 2, unit: 'px' },
    { key: 'bgDim', type: 'range', label: 'Darken', min: 0, max: 85, step: 1, unit: '%' },
    { key: 'saturation', type: 'range', label: 'Saturation', min: 40, max: 260, step: 5, unit: '%' },
    { key: 'meshOpacity', type: 'range', label: 'Color mesh strength', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'motionSpeed', type: 'range', label: 'Motion speed', min: 0, max: 3, step: 0.1, unit: '×' },
    { key: 'grain', type: 'toggle', label: 'Film grain' },
    { key: 'vignette', type: 'toggle', label: 'Vignette' },
  ] },
  { tab: 'Look', title: 'Colors', items: [
    { key: 'colorMode', type: 'select', label: 'Color source', options: opts(['auto', 'Match album art / video'], ['custom', 'My own color']) },
    { key: 'customAccent', type: 'color', label: 'Custom color', when: (s) => s.colorMode === 'custom' },
    { key: 'colorBoost', type: 'range', label: 'Color intensity', min: 40, max: 200, step: 5, unit: '%' },
    { key: 'videoColors', type: 'toggle', label: 'Sample colors live from videos' },
  ] },
  { tab: 'Look', title: 'Particles', items: [
    { key: 'particles', type: 'toggle', label: 'Floating light particles' },
    { key: 'particleCount', type: 'range', label: 'Amount', min: 5, max: 250, step: 5, when: (s) => s.particles },
    { key: 'particleSize', type: 'range', label: 'Size', min: 30, max: 300, step: 10, unit: '%', when: (s) => s.particles },
  ] },
  { tab: 'Lyrics', title: 'Lyrics', items: [
    { key: 'showLyrics', type: 'toggle', label: 'Show lyrics' },
    { key: 'lyricsStyle', type: 'select', label: 'Style', options: opts(
      ['fluid', 'Fluid (Apple Music style)'], ['spotify', 'Spotify style'], ['karaoke', 'Karaoke color fill'], ['cinema', 'Cinema subtitles']) },
    { key: 'wordSync', type: 'toggle', label: 'Word-by-word highlight' },
    { key: 'lyricsSpring', type: 'toggle', label: 'Springy, staggered scrolling' },
    { key: 'lyricsFont', type: 'select', label: 'Font', options: fontOpts() },
    { key: 'lyricsSize', type: 'range', label: 'Size', min: 16, max: 110, step: 1, unit: 'px' },
    { key: 'lyricsWeight', type: 'range', label: 'Weight', min: 300, max: 900, step: 100 },
    { key: 'lyricsSpacing', type: 'range', label: 'Line spacing', min: 10, max: 120, step: 5, unit: '%' },
    { key: 'lyricsAlign', type: 'select', label: 'Alignment', options: opts(['left', 'Left'], ['center', 'Center'], ['right', 'Right']) },
    { key: 'lyricsBlur', type: 'toggle', label: 'Depth blur on far lines' },
    { key: 'lyricsGlow', type: 'toggle', label: 'Glow on the line being sung' },
    { key: 'lyricsOffset', type: 'range', label: 'Timing offset', min: -3000, max: 3000, step: 50, unit: 'ms' },
  ] },
  { tab: 'Video', title: 'Track videos', items: [
    { key: 'trackVideos', type: 'toggle', label: 'Play a track’s video when it has one' },
    { key: 'autoMatchVideos', type: 'toggle', label: 'Auto-match videos in test-media/videos by song name' },
    { key: 'videoDim', type: 'range', label: 'Darken video', min: 0, max: 80, step: 1, unit: '%' },
    { key: 'ytAuto', type: 'toggle', label: 'Auto-find YouTube music videos (needs API key)' },
    { key: 'ytKey', type: 'text', label: 'YouTube Data API key (free, optional)', placeholder: 'AIza…' },
  ] },
  { tab: 'Layout', title: 'Visualizer', items: [
    { key: 'visualizer', type: 'select', label: 'Style', options: opts(
      ['off', 'Off'], ['bars', 'Bars'], ['mirror', 'Mirrored bars'], ['wave', 'Wave'], ['circle', 'Ring around art'], ['dots', 'Dot matrix']) },
    { key: 'vizHeight', type: 'range', label: 'Height', min: 5, max: 60, step: 1, unit: '%' },
    { key: 'vizOpacity', type: 'range', label: 'Opacity', min: 10, max: 100, step: 5, unit: '%' },
    { key: 'reactivity', type: 'range', label: 'Beat reaction', min: 0, max: 250, step: 5, unit: '%' },
    { key: 'artPulse', type: 'toggle', label: 'Album art pulses to the beat' },
  ] },
  { tab: 'Layout', title: 'Layout & album art', items: [
    { key: 'layout', type: 'select', label: 'Layout', options: opts(
      ['split', 'Art left · lyrics right'], ['center', 'Centered stack'], ['lyrics', 'Lyrics focus'], ['minimal', 'Art only']) },
    { key: 'artStyle', type: 'select', label: 'Art shape', options: opts(
      ['rounded', 'Rounded'], ['square', 'Square'], ['circle', 'Circle'], ['vinyl', 'Spinning vinyl'], ['hidden', 'Hidden']) },
    { key: 'artSize', type: 'range', label: 'Art size', min: 50, max: 150, step: 5, unit: '%' },
    { key: 'artGlow', type: 'toggle', label: 'Colored glow behind art' },
    { key: 'artReflection', type: 'toggle', label: 'Glass-floor reflection under art' },
    { key: 'artTilt', type: 'toggle', label: '3D tilt follows the mouse' },
  ] },
  { tab: 'General', title: 'Window & playback', items: [
    { key: 'openOnPlay', type: 'toggle', label: 'Open immersive view when a song plays' },
    { key: 'autoFullscreen', type: 'toggle', label: 'Go fullscreen automatically' },
    { key: 'hideIdle', type: 'toggle', label: 'Hide controls when the mouse is idle' },
    { key: 'upNext', type: 'toggle', label: 'Show “Up next” card near the end of a song' },
    { key: 'showClock', type: 'toggle', label: 'Show clock' },
    { key: 'showDevice', type: 'toggle', label: 'Show playing device' },
  ] },
];

export const PRESETS = {
  Ambilight: {},
  'LED Party': {
    edgeLights: 'chase', ledSpeed: 2, ledBrightness: 115, ledGlow: 110, ambiStrength: 95,
    visualizer: 'mirror', vizHeight: 10, reactivity: 170, lyricsStyle: 'karaoke', lyricsFont: 'Unbounded', lyricsSize: 34,
  },
  Fluid: {
    background: 'fluid', particles: true, ambilight: false, edgeLights: 'off', visualizer: 'bars', artGlow: true,
  },
  Spotify: {
    background: 'color', lyricsStyle: 'spotify', layout: 'lyrics', wordSync: false, visualizer: 'off', ambilight: false, edgeLights: 'off',
    grain: false, vignette: false, lyricsAlign: 'left', lyricsWeight: 800, lyricsSize: 46, lyricsBlur: false, lyricsGlow: false,
    artReflection: false, artGlow: false,
  },
  Canvas: {
    background: 'canvas', layout: 'center', lyricsAlign: 'center', lyricsSize: 34, bgDim: 40, edgeLights: 'mirror', ledGlow: 70,
    artStyle: 'hidden', lyricsFont: 'Syne', vignette: true,
  },
  Neon: {
    background: 'mesh', colorBoost: 170, saturation: 200, meshOpacity: 95, motionSpeed: 1.6, visualizer: 'circle', edgeLights: 'rainbow',
    artStyle: 'circle', lyricsFont: 'Unbounded', lyricsSize: 34, lyricsStyle: 'karaoke', particles: true, particleCount: 140, vizOpacity: 90, reactivity: 160,
  },
  Editorial: {
    background: 'fluid', lyricsFont: 'Instrument Serif', lyricsWeight: 400, lyricsSize: 64, lyricsSpacing: 20,
    edgeLights: 'off', ambilight: false, artReflection: true, grain: true,
  },
  'Vinyl Lounge': {
    background: 'room', artStyle: 'vinyl', visualizer: 'wave', vizHeight: 12, lyricsFont: 'Playfair Display', edgeLights: 'mirror',
    lyricsWeight: 700, motionSpeed: 0.5, colorBoost: 80, ledSpeed: 0.5,
  },
  Karaoke: {
    layout: 'lyrics', lyricsFont: 'Bebas Neue', lyricsSize: 84, lyricsWeight: 400, lyricsAlign: 'center', edgeLights: 'breathe',
    lyricsStyle: 'karaoke', visualizer: 'mirror', vizHeight: 12, bgDim: 50,
  },
  Cinema: {
    background: 'canvas', layout: 'lyrics', lyricsStyle: 'cinema', showLyrics: true, artStyle: 'hidden', lyricsAlign: 'center',
    lyricsFont: 'Outfit', lyricsSize: 40, lyricsWeight: 600, edgeLights: 'mirror', ledThickness: 0, ledGlow: 90, bgDim: 35,
  },
  Retro: {
    background: 'art-mesh', grain: true, lyricsFont: 'JetBrains Mono', lyricsSize: 30, lyricsWeight: 700, edgeLights: 'off', ambilight: false,
    visualizer: 'dots', artStyle: 'square', saturation: 90, vignette: true, colorBoost: 70, glassStyle: 'frosted',
  },
};

const listeners = new Set();
let data = { ...DEFAULTS };

// When defaults are re-tuned, these keys are reset once for people who already have saved settings.
const VERSION = 4;
const MIGRATIONS = {
  3: ['ambiStrength', 'ledBrightness', 'ledThickness', 'ledGlow', 'videoDim'],
  4: ['ledThickness', 'ledGlow'],
};

export const Settings = {
  load() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { stored = {}; }
    data = { ...DEFAULTS, ...stored };
    const from = stored._v || 0;
    if (from < VERSION && Object.keys(stored).length) {
      for (const [v, keys] of Object.entries(MIGRATIONS)) if (from < Number(v)) keys.forEach((k) => { data[k] = DEFAULTS[k]; });
    }
    data._v = VERSION;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
    return data;
  },
  get: (k) => data[k],
  all: () => ({ ...data }),
  set(k, v) { this.patch({ [k]: v }); },
  patch(obj) {
    const changed = Object.keys(obj).filter((k) => k in DEFAULTS && data[k] !== obj[k]);
    if (!changed.length) return;
    changed.forEach((k) => { data[k] = obj[k]; });
    localStorage.setItem(KEY, JSON.stringify(data));
    listeners.forEach((fn) => fn(changed, data));
  },
  // Presets change the look but keep personal/functional choices.
  applyPreset(name) {
    const keep = ['openOnPlay', 'autoFullscreen', 'hideIdle', 'ytKey', 'ytAuto', 'trackVideos', 'autoMatchVideos', 'lyricsOffset', 'libraryView', 'customAccent'];
    const base = { ...DEFAULTS };
    keep.forEach((k) => { base[k] = data[k]; });
    this.patch({ ...base, ...PRESETS[name] });
  },
  reset() { this.patch({ ...DEFAULTS, ytKey: data.ytKey }); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
