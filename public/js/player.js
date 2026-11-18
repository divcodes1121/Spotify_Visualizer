/*
 * Player — one interface over three ways of playing:
 *   SpotifyEngine: Web Playback SDK (Aura itself is a Spotify device; Premium)
 *                  + "follow mode": mirrors whatever plays on your phone/desktop app (any account)
 *   DemoEngine:    test-media tracks with the built-in synth or local audio files
 * Emits: 'state' {track, position, duration, paused, at, device}, 'error', 'info', 'engine'
 */
import { Auth } from './auth.js';
import { Spotify, normalizeTrack } from './spotify.js';
import { DemoSynth } from './demo.js';
import { AudioBus } from './audio.js';

class Emitter {
  constructor() { this.handlers = {}; }
  on(e, fn) { (this.handlers[e] ||= []).push(fn); return this; }
  emit(e, ...a) { (this.handlers[e] || []).forEach((fn) => fn(...a)); }
}

const REPEAT = ['off', 'context', 'track'];

/* ======================= Spotify ======================= */
class SpotifyEngine {
  constructor(p) {
    this.p = p;
    this.sdk = null;
    this.deviceId = null;
    this.sdkActive = false;
    this.pollTimer = null;
    this.enabled = false;
    this.volume = 0.7;
  }

  init() {
    if (this.enabled) return;
    this.enabled = true;
    this.loadSDK();
    this.poll();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.pollSoon(100); });
  }

  loadSDK() {
    if (window.Spotify?.Player) return this.createPlayer();
    window.onSpotifyWebPlaybackSDKReady = () => this.createPlayer();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => this.p.emit('info', 'Spotify in-app player could not load — Aura will follow playback from your other devices.');
    document.head.append(s);
  }

  createPlayer() {
    const pl = new window.Spotify.Player({
      name: 'Aura Visual Player',
      getOAuthToken: (cb) => Auth.getToken().then(cb).catch(() => {}),
      volume: this.volume,
    });
    pl.addListener('ready', ({ device_id }) => { this.deviceId = device_id; this.p.emit('device', { ready: true }); });
    pl.addListener('not_ready', () => { this.deviceId = null; this.sdkActive = false; });
    pl.addListener('player_state_changed', (st) => this.onSdkState(st));
    pl.addListener('initialization_error', ({ message }) =>
      this.p.emit('info', `In-app playback unavailable (${message}). Play from any Spotify app — Aura will follow along.`));
    pl.addListener('authentication_error', ({ message }) => this.p.emit('error', `Spotify auth error: ${message}`));
    pl.addListener('account_error', () =>
      this.p.emit('info', 'In-app playback needs Spotify Premium. Play from any Spotify app and Aura will visualize it.'));
    pl.addListener('playback_error', ({ message }) => this.p.emit('error', `Playback error: ${message}`));
    pl.connect();
    this.sdk = pl;
  }

  onSdkState(st) {
    if (!st) { this.sdkActive = false; this.pollSoon(500); return; }
    this.sdkActive = true;
    const ct = st.track_window?.current_track;
    this.p._fromEngine(this, {
      track: ct ? normalizeTrack(ct) : null,
      position: st.position, duration: st.duration, paused: st.paused,
      shuffle: st.shuffle, repeat: st.repeat_mode, device: 'Aura',
    });
  }

  pollSoon(ms = 600) { clearTimeout(this.pollTimer); this.pollTimer = setTimeout(() => this.poll(), ms); }

  async poll() {
    clearTimeout(this.pollTimer);
    let delay = 5000;
    try {
      if (this.sdkActive && this.sdk) {
        this.onSdkState(await this.sdk.getCurrentState());
        delay = 3000;
      } else if (!document.hidden) {
        const st = await Spotify.playbackState();
        if (st?.item) {
          const track = normalizeTrack(st.item);
          this.p._fromEngine(this, {
            track, position: st.progress_ms || 0, duration: st.item.duration_ms, paused: !st.is_playing,
            shuffle: st.shuffle_state, repeat: REPEAT.indexOf(st.repeat_state), device: st.device?.name || 'Spotify',
          });
          const left = st.item.duration_ms - (st.progress_ms || 0);
          delay = st.is_playing ? Math.min(4000, Math.max(800, left + 400)) : 8000;
        } else {
          delay = 8000;
        }
      } else {
        delay = 15000;
      }
    } catch (e) {
      delay = e.status === 429 ? 30000 : 10000;
      if (e.status === 401 || e.status === 403) this.p.emit('authproblem', e);
    }
    if (this.enabled) this.pollTimer = setTimeout(() => this.poll(), delay);
  }

  async play(track, list = [], index = 0) {
    this.sdk?.activateElement?.(); // must run inside the click gesture
    const playable = list.filter((t) => t.source === 'spotify' && t.playable && t.uri?.startsWith('spotify:'));
    let i = playable.findIndex((t) => t.uri === track.uri);
    if (i < 0) { playable.splice(0, playable.length, track); i = 0; }
    const start = Math.max(0, Math.min(i - 30, playable.length - 100));
    const uris = playable.slice(start, start + 100).map((t) => t.uri);
    try {
      await Spotify.play(this.deviceId, { uris, offset: { uri: track.uri } });
    } catch (e) {
      if (e.status === 404) throw new Error('No active Spotify device. Open Spotify on any device and try again (in-app playback needs Premium).');
      if (e.status === 403) throw new Error('Spotify refused to start playback (Premium required). Start the song in the Spotify app — Aura will follow along.');
      throw e;
    }
    this.pollSoon(700);
  }

  async ctl(sdkFn, apiFn) {
    try {
      if (this.sdkActive && this.sdk) await sdkFn(this.sdk);
      else await apiFn();
    } catch (e) {
      this.p.emit('error', e.status === 403 ? 'Controlling playback requires Spotify Premium.' : e.message);
    }
    this.pollSoon(500);
  }

  toggle(paused) { return this.ctl((s) => s.togglePlay(), () => (paused ? Spotify.resume() : Spotify.pause())); }
  pause() { if (this.sdkActive) this.sdk?.pause(); }
  next() { return this.ctl((s) => s.nextTrack(), () => Spotify.next()); }
  prev() { return this.ctl((s) => s.previousTrack(), () => Spotify.previous()); }
  seek(ms) { return this.ctl((s) => s.seek(Math.round(ms)), () => Spotify.seek(ms)); }
  setVolume(v) {
    this.volume = v;
    if (!this.enabled) return;
    clearTimeout(this.volTimer);
    this.volTimer = setTimeout(() => this.ctl((s) => s.setVolume(v), () => Spotify.volume(v * 100)), 150);
  }
  shuffle(on) { return this.ctl(() => Spotify.shuffle(on), () => Spotify.shuffle(on)); }
  repeat(mode) { return this.ctl(() => Spotify.repeat(REPEAT[mode]), () => Spotify.repeat(REPEAT[mode])); }
}

/* ======================= Demo ======================= */
class DemoEngine {
  constructor(p) {
    this.p = p;
    this.synth = new DemoSynth();
    this.list = [];
    this.index = 0;
    this.track = null;
    this.paused = true;
    this.offset = 0;
    this.startedAt = 0;
    this.audioEl = null;
    this.repeat = 1;
    this.shuffleOn = false;
  }

  get duration() {
    if (this.audioEl && Number.isFinite(this.audioEl.duration)) return this.audioEl.duration * 1000;
    return this.track?.duration || 0;
  }

  pos() {
    if (this.audioEl) return this.audioEl.currentTime * 1000;
    return this.paused ? this.offset : this.offset + (performance.now() - this.startedAt);
  }

  play(track, list) {
    this.list = list.filter((t) => t.source === 'demo');
    this.index = Math.max(0, this.list.findIndex((t) => t.id === track.id));
    this.load(this.list[this.index] || track);
  }

  load(track) {
    this.track = track;
    this.offset = 0;
    this.startedAt = performance.now();
    this.paused = false;
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.src = ''; this.audioEl = null; }
    if (track.audio) {
      const a = new Audio();
      a.src = track.audio;
      a.volume = this.synth.volume;
      a.addEventListener('loadedmetadata', () => this.emit());
      a.addEventListener('ended', () => this.next(true));
      this.synth.attachElement(a);
      a.play().catch((e) => this.p.emit('error', `Could not play ${track.name}: ${e.message}`));
      this.audioEl = a;
    } else {
      this.synth.start(track);
    }
    AudioBus.internal = this.synth.analyser;
    AudioBus.bpm = track.bpm || 110;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.audioEl && !this.paused && this.duration && this.pos() >= this.duration) this.next(true);
    }, 250);
    this.emit();
  }

  emit() {
    if (!this.track) return;
    this.p._fromEngine(this, {
      track: this.track, position: this.pos(), duration: this.duration, paused: this.paused,
      shuffle: this.shuffleOn, repeat: this.repeat, device: this.audioEl ? 'Local audio' : 'Demo synth',
    });
  }

  toggle() {
    if (!this.track) return;
    if (this.paused) {
      this.paused = false;
      this.startedAt = performance.now();
      this.audioEl ? this.audioEl.play() : this.synth.resume();
    } else {
      this.offset = this.pos();
      this.paused = true;
      this.audioEl ? this.audioEl.pause() : this.synth.pause();
    }
    this.emit();
  }

  pause() { if (!this.paused) this.toggle(); }

  next(auto = false) {
    if (!this.list.length) return;
    if (auto && this.repeat === 2) return this.load(this.track);
    if (auto && this.repeat === 0 && this.index === this.list.length - 1 && !this.shuffleOn) {
      this.offset = 0; this.paused = true; this.synth.pause(); return this.emit();
    }
    this.index = this.shuffleOn
      ? Math.floor(Math.random() * this.list.length)
      : (this.index + 1) % this.list.length;
    this.load(this.list[this.index]);
  }

  prev() {
    if (!this.list.length) return;
    if (this.pos() > 3000) return this.seek(0);
    this.index = (this.index - 1 + this.list.length) % this.list.length;
    this.load(this.list[this.index]);
  }

  seek(ms) {
    ms = Math.max(0, Math.min(ms, this.duration - 250));
    if (this.audioEl) this.audioEl.currentTime = ms / 1000;
    this.offset = ms;
    this.startedAt = performance.now();
    this.emit();
  }

  setVolume(v) { this.synth.setVolume(v); if (this.audioEl) this.audioEl.volume = v; }
  shuffle(on) { this.shuffleOn = on; this.emit(); }
  repeatMode(m) { this.repeat = m; this.emit(); }
}

/* ======================= Facade ======================= */
export class Player extends Emitter {
  constructor() {
    super();
    this.spotify = new SpotifyEngine(this);
    this.demo = new DemoEngine(this);
    this.active = null;
    this.state = null;
    this.volume = Number(localStorage.getItem('aura.volume') ?? 0.7);
    this.spotify.volume = this.volume;
    this.demo.synth.volume = this.volume;
  }

  enableSpotify() { this.spotify.init(); if (!this.active) this.setActive(this.spotify); }

  setActive(engine) {
    if (this.active === engine) return;
    if (this.active) this.active.pause?.();
    this.active = engine;
    AudioBus.useInternal = engine === this.demo;
    this.emit('engine', engine === this.demo ? 'demo' : 'spotify');
  }

  _fromEngine(engine, s) {
    if (engine !== this.active) {
      // Follow Spotify again if something starts playing there while the demo is paused.
      if (engine === this.spotify && this.active === this.demo && this.demo.paused && s && !s.paused) this.setActive(this.spotify);
      else return;
    }
    this.state = s ? { ...s, at: performance.now() } : null;
    this.emit('state', this.state);
  }

  position() {
    const s = this.state;
    if (!s) return 0;
    if (this.active === this.demo) return this.demo.pos();
    return s.paused ? s.position : Math.min(s.duration || Infinity, s.position + (performance.now() - s.at));
  }

  async play(track, list, index) {
    const engine = track.source === 'demo' ? this.demo : this.spotify;
    this.setActive(engine);
    return engine.play(track, list, index);
  }

  _optimistic(patch) {
    if (!this.state) return;
    this.state = { ...this.state, position: this.position(), at: performance.now(), ...patch };
    this.emit('state', this.state);
  }

  toggle() {
    if (!this.active || !this.state) return;
    const paused = this.state.paused;
    if (this.active === this.demo) return this.demo.toggle();
    this._optimistic({ paused: !paused });
    return this.spotify.toggle(paused);
  }
  next() { this.active?.next(); }
  prev() { this.active?.prev(); }
  seek(ms) {
    if (!this.state) return;
    ms = Math.max(0, Math.min(ms, (this.state.duration || 0) - 500));
    if (this.active === this.spotify) this._optimistic({ position: ms });
    this.active.seek(ms);
  }
  setVolume(v) {
    this.volume = v;
    localStorage.setItem('aura.volume', v);
    this.spotify.setVolume(v);
    this.demo.setVolume(v);
  }
  setShuffle(on) { this.active === this.demo ? this.demo.shuffle(on) : this.spotify.shuffle(on); this._optimistic({ shuffle: on }); }
  cycleRepeat() {
    const m = ((this.state?.repeat ?? 0) + 1) % 3;
    this.active === this.demo ? this.demo.repeatMode(m) : this.spotify.repeat(m);
    this._optimistic({ repeat: m });
  }
}
