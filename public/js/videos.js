/*
 * Track videos: a Spotify-Canvas-like video behind the now-playing view.
 *   - local:   a file from test-media/videos. Short clips loop like Canvas; long ones stay in sync with the song.
 *   - youtube: a muted music video kept in sync with playback via the YouTube IFrame API.
 * Assignments are stored per track; videos named after a song are matched automatically.
 */
import { loadMedia } from './demo.js';

const KEY = 'aura.trackVideos';
let map = {};
try { map = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { map = {}; }
const save = () => localStorage.setItem(KEY, JSON.stringify(map));

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function parseYouTube(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
    const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch { return null; }
}

export const TrackVideos = {
  get: (track) => (track ? map[track.id] || null : null),
  set(track, entry) { map[track.id] = { ...entry, at: Date.now() }; save(); },
  remove(track) { delete map[track.id]; save(); },
  setOffset(track, offset) { if (map[track.id]) { map[track.id].offset = offset; save(); } },

  async autoMatch(track) {
    const { videos } = await loadMedia();
    if (!videos.length) return null;
    const name = norm(track.name.replace(/\s*[([].*?[)\]]/g, ''));
    const image = norm(String(track.image || '').split('/').pop());
    const id = norm(track.id);
    const hit = videos.find((v) => {
      const n = norm(v.name);
      return n === id || (image && n === image) || (name.length > 2 && (n === name || n.startsWith(`${name} `) || n.endsWith(` ${name}`) || n.includes(` ${name} `)));
    });
    return hit ? { type: 'local', src: hit.url, name: hit.name, offset: 0, auto: true } : null;
  },

  async youtubeSearch(track, key) {
    const q = `${track.artistList?.[0] || track.artists} ${track.name} official video`;
    const url = `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
      part: 'snippet', type: 'video', maxResults: '1', videoEmbeddable: 'true', q, key,
    })}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `YouTube search failed (${r.status})`);
    const item = j.items?.[0];
    return item ? { type: 'youtube', src: item.id.videoId, name: item.snippet.title, offset: 0, auto: true } : null;
  },

  searchLink(track) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.artists} ${track.name} official video`)}`;
  },
};

/* ---------------- YouTube IFrame API ---------------- */
let ytPromise = null;
function loadYT() {
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytPromise = null; reject(new Error('Could not load YouTube')); };
    document.head.append(s);
  });
  return ytPromise;
}

const YT_ERRORS = { 2: 'invalid video id', 5: 'HTML5 player error', 100: 'video not found or private', 101: 'the owner doesn’t allow embedding', 150: 'the owner doesn’t allow embedding' };

export class VideoLayer {
  constructor({ video, ytHost, onError, onState }) {
    this.video = video;
    this.ytHost = ytHost;
    this.onError = onError;
    this.onState = onState;
    this.entry = null;
    this.yt = null;
    this.ytReady = false;
    this.lastSync = 0;
    video.addEventListener('error', () => { if (this.entry?.type === 'local') this.onError?.('That video file could not be played.'); });
  }

  get kind() { return this.entry?.type || null; }

  async show(entry, positionMs = 0) {
    if (!entry) return this.clear();
    if (this.entry && this.entry.type === entry.type && this.entry.src === entry.src) { this.entry = entry; return; }
    this.entry = entry;
    if (entry.type === 'local') {
      this.hideYT();
      this.video.src = entry.src;
      this.video.muted = true;
      this.video.loop = true;
      this.video.play().catch(() => {});
    } else if (entry.type === 'youtube') {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      await this.showYT(entry, positionMs);
    }
    this.onState?.(true);
  }

  async showYT(entry, positionMs) {
    let YT;
    try { YT = await loadYT(); } catch (e) { this.onError?.(e.message); return; }
    if (this.entry !== entry) return;
    const start = Math.max(0, Math.floor(positionMs / 1000 + (entry.offset || 0)));
    this.ytHost.hidden = false;
    if (this.yt && this.ytReady) {
      this.yt.loadVideoById({ videoId: entry.src, startSeconds: start });
      this.yt.mute();
      return;
    }
    this.ytHost.innerHTML = '<div id="yt-frame"></div>';
    this.ytReady = false;
    this.yt = new YT.Player('yt-frame', {
      videoId: entry.src,
      playerVars: {
        autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1,
        playsinline: 1, rel: 0, start, origin: location.origin,
      },
      events: {
        onReady: (e) => { this.ytReady = true; e.target.mute(); e.target.playVideo(); },
        onError: (e) => {
          this.onError?.(`YouTube video can’t play here: ${YT_ERRORS[e.data] || `error ${e.data}`}.`);
          this.clear();
        },
      },
    });
  }

  hideYT() {
    if (this.yt && this.ytReady) { try { this.yt.pauseVideo(); } catch { /* ignore */ } }
    this.ytHost.hidden = true;
  }

  clear() {
    this.entry = null;
    this.video.pause();
    if (this.video.getAttribute('src')) { this.video.removeAttribute('src'); this.video.load(); }
    this.hideYT();
    this.onState?.(false);
  }

  // Called from the render loop; keeps long videos aligned with the song.
  sync(positionMs, paused, now) {
    const e = this.entry;
    if (!e || now - this.lastSync < 250) return;
    this.lastSync = now;
    const target = positionMs / 1000 + (e.offset || 0);
    if (e.type === 'local') {
      const v = this.video;
      if (paused) { if (!v.paused) v.pause(); return; }
      if (v.paused) v.play().catch(() => {});
      const longVideo = Number.isFinite(v.duration) && v.duration > 45;
      v.loop = !longVideo;
      if (longVideo && target >= 0 && target < v.duration && Math.abs(v.currentTime - target) > 0.8) v.currentTime = target;
    } else if (e.type === 'youtube' && this.yt && this.ytReady) {
      const y = this.yt;
      const state = y.getPlayerState?.();
      if (paused) { if (state === 1) y.pauseVideo(); return; }
      if (state !== 1 && state !== 3) y.playVideo();
      const cur = y.getCurrentTime?.() || 0;
      if (target >= 0 && Math.abs(cur - target) > 1.2) y.seekTo(target, true);
    }
  }
}
