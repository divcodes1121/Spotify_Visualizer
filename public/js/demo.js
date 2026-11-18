// Test-media support: turns ./test-media into playable demo tracks, with a tiny
// generative synth (or your own audio files) so visuals react to real sound.

let mediaPromise = null;
export function loadMedia(force = false) {
  if (!mediaPromise || force) {
    mediaPromise = fetch('/api/media').then((r) => r.json()).catch(() => ({ images: [], videos: [], audio: [], tracks: [] }));
  }
  return mediaPromise;
}

const stripExt = (n) => n.replace(/\.[^.]+$/, '');
const titleCase = (s) => stripExt(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const mediaUrl = (folder, name) => (!name ? '' : /^(\/|https?:)/.test(name) ? name : `/media/${folder}/${encodeURIComponent(name)}`);

export async function demoTracks() {
  const m = await loadMedia(true);
  const usedImages = new Set(), usedAudio = new Set();
  const base = (t) => ({ source: 'demo', playable: true, artistList: [t.artists], bpm: 110, key: 45, mode: 'minor', ...t });

  const tracks = m.tracks.map((t) => {
    usedImages.add(t.image); if (t.audio) usedAudio.add(t.audio);
    const image = mediaUrl('images', t.image);
    return base({ ...t, uri: `demo:${t.id}`, image, thumb: image, audio: t.audio ? mediaUrl('audio', t.audio) : null });
  });

  // Audio files you drop into test-media/audio become tracks (paired with a same-named image if present).
  m.audio.filter((a) => !usedAudio.has(a.name)).forEach((a, i) => {
    const img = m.images.find((im) => stripExt(im.name) === stripExt(a.name)) || m.images[i % Math.max(1, m.images.length)];
    if (img) usedImages.add(img.name);
    tracks.push(base({
      id: `audio-${a.name}`, uri: `demo:audio:${a.name}`, name: titleCase(a.name), artists: 'Local audio file',
      album: 'test-media/audio', image: img?.url || '', thumb: img?.url || '', audio: a.url, duration: 0, lrc: null,
    }));
  });

  // Any extra image you drop into test-media/images becomes an instrumental demo track.
  m.images.filter((im) => !usedImages.has(im.name)).forEach((im, i) => {
    tracks.push(base({
      id: `img-${im.name}`, uri: `demo:img:${im.name}`, name: titleCase(im.name), artists: 'Your test image',
      album: 'test-media/images', image: im.url, thumb: im.url, duration: 120000,
      bpm: 92 + ((i * 11) % 40), key: 40 + ((i * 5) % 12), mode: i % 2 ? 'major' : 'minor', lrc: null,
    }));
  });
  return tracks;
}

/* ---------------- generative synth ---------------- */
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PROG = {
  minor: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]],
  major: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]],
};

export class DemoSynth {
  constructor() { this.ctx = null; this.timer = null; this.volume = 0.7; }

  ensure() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.55;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.75;
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.05); }

  start(track) {
    this.ensure();
    this.stopSynth();
    this.bpm = track.bpm || 110;
    this.root = track.key || 45;
    this.prog = PROG[track.mode] || PROG.minor;
    this.step = 0;
    this.next = this.ctx.currentTime + 0.06;
    this.ctx.resume();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopSynth() { clearInterval(this.timer); this.timer = null; }
  pause() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  schedule() {
    const s16 = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.next, s16);
      this.next += s16;
      this.step++;
    }
  }

  playStep(step, t, s16) {
    const pos = step % 16, bar = Math.floor(step / 16);
    const chord = this.prog[bar % 4];
    const intro = bar < 2;
    if (pos % 4 === 0) this.kick(t);
    if (!intro && (pos === 4 || pos === 12)) this.snare(t);
    if (pos % 2 === 0) this.hat(t, pos % 4 === 2 ? 0.18 : 0.08);
    if (!intro && [0, 3, 6, 8, 11, 14].includes(pos)) this.bass(t, this.root + chord[0] - 12, s16 * 1.6);
    if (pos === 0) this.pad(t, chord.map((n) => this.root + 12 + n), s16 * 16);
    if (!intro && pos % 2 === 1) this.pluck(t, this.root + 24 + chord[(step >> 1) % 3], s16);
  }

  env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  kick(t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    this.env(g, t, 0.004, 0.9, 0.38);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.45);
  }

  noiseHit(t, type, freq, peak, dec) {
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = type; f.frequency.value = freq;
    this.env(g, t, 0.002, peak, dec);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dec + 0.05);
  }
  hat(t, v) { this.noiseHit(t, 'highpass', 7500, v, 0.05); }
  snare(t) { this.noiseHit(t, 'bandpass', 1900, 0.45, 0.2); }

  bass(t, note, len) {
    const o = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = midi(note);
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + len);
    this.env(g, t, 0.01, 0.35, len);
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + len + 0.05);
  }

  pad(t, notes, len) {
    const f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + len * 0.25);
    g.gain.linearRampToValueAtTime(0.0001, t + len * 1.02);
    f.connect(g).connect(this.master);
    for (const n of notes) for (const det of [-7, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + len * 1.05);
    }
  }

  pluck(t, note, len) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = midi(note);
    this.env(g, t, 0.003, 0.12, len * 2.5);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + len * 3);
  }

  // Route an <audio> element (local file) through the same analyser.
  attachElement(audioEl) {
    this.ensure();
    this.stopSynth();
    if (!audioEl._auraSource) {
      audioEl._auraSource = this.ctx.createMediaElementSource(audioEl);
      audioEl._auraSource.connect(this.master);
    }
    this.ctx.resume();
  }
}
