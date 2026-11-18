/*
 * AudioBus — one place the visuals read "how loud / how bassy is it right now".
 * Sources, in priority order:
 *   1. System-audio capture (screen-share with audio) — real reactivity for Spotify playback
 *   2. Internal analyser (demo synth or local audio files in test-media/audio)
 *   3. Simulated — a tempo-locked procedural spectrum (Spotify streams are DRM-protected,
 *      so their audio can't be analysed directly)
 */
const BINS = 256;

export const AudioBus = {
  internal: null,
  capture: null,
  useInternal: false,
  bpm: 110,
  raw: new Float32Array(BINS),
  byteBuf: null,
  bass: 0, mid: 0, high: 0, energy: 0,
  _bars: null,

  get label() {
    if (this.capture) return 'System audio';
    if (this.useInternal && this.internal) return 'Live audio';
    return 'Simulated';
  },
  get analyser() {
    if (this.capture) return this.capture.analyser;
    if (this.useInternal && this.internal) return this.internal;
    return null;
  },

  update(t, playing) {
    const an = this.analyser;
    const raw = this.raw;
    if (an) {
      if (!this.byteBuf || this.byteBuf.length !== an.frequencyBinCount) this.byteBuf = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(this.byteBuf);
      const usable = Math.floor(this.byteBuf.length * 0.7);
      for (let i = 0; i < BINS; i++) raw[i] = this.byteBuf[Math.floor((i / BINS) * usable)] / 255;
    } else if (playing) {
      const beat = (t * this.bpm) / 60;
      const kick = Math.exp(-(beat % 1) * 7);
      const hat = Math.exp(-((beat * 2 + 0.5) % 1) * 12);
      const swell = 0.75 + 0.25 * Math.sin(t * 0.21);
      for (let k = 0; k < BINS; k++) {
        const f = k / BINS;
        const base = Math.pow(1 - f, 1.5) * 0.62;
        const wob = 0.5 + 0.5 * Math.sin(t * 1.7 + k * 0.31) * Math.sin(t * 0.73 + k * 0.17);
        const target = (base * (0.55 + 0.45 * wob) + kick * Math.max(0, 1 - f * 5) * 0.55 + hat * Math.max(0, f - 0.45) * 0.3) * swell;
        raw[k] += (target - raw[k]) * 0.35;
      }
    } else {
      for (let k = 0; k < BINS; k++) raw[k] *= 0.9;
    }
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += raw[i]; return s / (b - a); };
    const ease = (prev, v, up = 0.5, down = 0.12) => prev + (v - prev) * (v > prev ? up : down);
    this.bass = ease(this.bass, avg(1, 10));
    this.mid = ease(this.mid, avg(10, 60));
    this.high = ease(this.high, avg(60, 180));
    this.energy = ease(this.energy, avg(1, 180), 0.3, 0.08);
  },

  // Log-spaced bars, 0..1, lightly smoothed.
  bars(n) {
    if (!this._bars || this._bars.length !== n) this._bars = new Float32Array(n);
    const out = this._bars, raw = this.raw;
    const minB = 1, maxB = BINS - 1;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(minB * Math.pow(maxB / minB, i / n));
      const b = Math.max(a + 1, Math.floor(minB * Math.pow(maxB / minB, (i + 1) / n)));
      let s = 0;
      for (let j = a; j < b; j++) s += raw[j];
      const v = Math.min(1, (s / (b - a)) * (1 + (i / n) * 0.9));
      out[i] += (v - out[i]) * (v > out[i] ? 0.55 : 0.18);
    }
    return out;
  },

  async captureSystem() {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture is not supported in this browser.');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include', selfBrowserSurface: 'exclude',
    });
    const tracks = stream.getAudioTracks();
    if (!tracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio was shared. Pick "Entire screen" and turn on "Share system audio".');
    }
    stream.getVideoTracks().forEach((t) => { t.enabled = false; });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream(tracks));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    src.connect(analyser);
    this.capture = { stream, ctx, analyser };
    tracks[0].addEventListener('ended', () => this.stopCapture());
    return true;
  },

  stopCapture() {
    if (!this.capture) return;
    this.capture.stream.getTracks().forEach((t) => t.stop());
    this.capture.ctx.close().catch(() => {});
    this.capture = null;
    this.onchange?.();
  },
};
