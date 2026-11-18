// Thin wrapper around the Spotify Web API, limited to endpoints available to
// Development Mode apps after the 2026 changes (playlists use /items, search max 10).
import { Auth } from './auth.js';

const API = 'https://api.spotify.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', query, body } = {}, attempt = 0) {
  const token = await Auth.getToken();
  const url = (path.startsWith('http') ? path : API + path) + (query ? `?${new URLSearchParams(query)}` : '');
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 2) {
    const wait = Math.min(Number(res.headers.get('Retry-After')) || 2, 20);
    await sleep(wait * 1000);
    return api(path, { method, query, body }, attempt + 1);
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || res.statusText || `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, reason: data?.error?.reason });
  }
  return data;
}

function bestImage(images = [], min = 0) {
  if (!images?.length) return '';
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  if (!min) return sorted[0].url;
  return [...sorted].reverse().find((i) => (i.width || 0) >= min)?.url || sorted[0].url;
}

export function normalizeTrack(t) {
  if (!t || !t.uri || t.type === 'episode' && !t.name) return null;
  const artistList = (t.artists || t.show && [t.show] || []).map((a) => a.name).filter(Boolean);
  const images = t.album?.images || t.images || t.show?.images;
  return {
    id: t.id || t.uri,
    uri: t.uri,
    name: t.name || 'Unknown',
    artists: artistList.join(', ') || 'Unknown artist',
    artistList,
    album: t.album?.name || t.show?.name || '',
    image: bestImage(images),
    thumb: bestImage(images, 64),
    cover: bestImage(images, 250),
    duration: t.duration_ms || 0,
    playable: !t.is_local,
    source: 'spotify',
  };
}

const tracksFrom = (items, pick) => items.map(pick).map(normalizeTrack).filter(Boolean);

// Pages through a list endpoint. onPage(newItems, total) lets the UI render progressively.
async function collect(path, { limit = 50, max = 10000, query = {}, map = (x) => x, onPage } = {}) {
  let url = path, q = { limit, ...query }, out = [];
  while (url && out.length < max) {
    const page = await api(url, { query: q });
    const items = map(page.items || []);
    out = out.concat(items);
    onPage?.(items, page.total ?? out.length, out);
    url = page.next;
    q = undefined;
  }
  return out;
}

export const Spotify = {
  api,
  me: () => api('/me'),

  likedTracks: (onPage) =>
    collect('/me/tracks', { map: (items) => tracksFrom(items, (i) => i.track), onPage }),

  playlists: () => collect('/me/playlists', { max: 500 }),

  playlistTracks: (id, onPage) =>
    collect(`/playlists/${id}/items`, {
      query: { additional_types: 'track,episode' },
      map: (items) => tracksFrom(items, (i) => i.item || i.track),
      onPage,
    }),

  recent: async () => {
    const r = await api('/me/player/recently-played', { query: { limit: 50 } });
    const seen = new Set();
    return tracksFrom(r?.items || [], (i) => i.track).filter((t) => !seen.has(t.id) && seen.add(t.id));
  },

  topTracks: async (range = 'medium_term') => {
    const r = await api('/me/top/tracks', { query: { limit: 50, time_range: range } });
    return tracksFrom(r?.items || [], (i) => i);
  },

  search: async (q) => {
    const r = await api('/search', { query: { q, type: 'track', limit: 10 } });
    return tracksFrom(r?.tracks?.items || [], (i) => i);
  },

  // ---- player ----
  queue: async () => {
    const r = await api('/me/player/queue');
    return (r?.queue || []).map(normalizeTrack).filter(Boolean);
  },
  playbackState: () => api('/me/player', { query: { additional_types: 'track,episode' } }),
  play: (deviceId, body) => api('/me/player/play', { method: 'PUT', query: deviceId ? { device_id: deviceId } : undefined, body }),
  pause: () => api('/me/player/pause', { method: 'PUT' }),
  resume: () => api('/me/player/play', { method: 'PUT' }),
  next: () => api('/me/player/next', { method: 'POST' }),
  previous: () => api('/me/player/previous', { method: 'POST' }),
  seek: (ms) => api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(ms) } }),
  volume: (pct) => api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(pct) } }),
  shuffle: (on) => api('/me/player/shuffle', { method: 'PUT', query: { state: on } }),
  repeat: (mode) => api('/me/player/repeat', { method: 'PUT', query: { state: mode } }),
};
