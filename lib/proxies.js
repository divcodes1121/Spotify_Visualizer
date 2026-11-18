'use strict';
/*
 * Shared proxy logic used by both the local server (server.js) and the Vercel functions (api/*.js):
 *   findLyrics()  → synced lyrics via LRCLIB
 *   fetchArt()    → album art from Spotify's CDN (same-origin copy so canvas can read pixels)
 */
const USER_AGENT = 'AuraPlayer/1.0 (open-source Spotify visualizer)';
const IMG_HOST_OK = /(^|\.)(scdn\.co|spotifycdn\.com)$/i;
const lyricsCache = new Map();

async function lrclib(endpoint, params) {
  const url = `https://lrclib.net/api/${endpoint}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(9000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`LRCLIB responded ${r.status}`);
  return r.json();
}
const pack = (h) => ({ synced: h.syncedLyrics || null, plain: h.plainLyrics || null, instrumental: !!h.instrumental, source: 'LRCLIB' });
const hasLyrics = (h) => h && (h.syncedLyrics || h.plainLyrics || h.instrumental);

function pickBest(list, duration) {
  if (!Array.isArray(list) || !list.length) return null;
  const scored = list
    .filter(hasLyrics)
    .map((h) => {
      const diff = duration && h.duration ? Math.abs(h.duration - duration) : 0;
      return { h, diff, score: (h.syncedLyrics ? 3 : 0) + (h.plainLyrics ? 1 : 0) - Math.min(diff / 4, 4) };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || (duration && best.diff > 20)) return null;
  return best.h;
}

async function searchLyrics({ track, artist, album, duration }) {
  const primaryArtist = artist.split(',')[0].trim();
  const cleanTrack = track
    .replace(/\s*[-–]\s*(\d{4}\s*)?(remaster(ed)?|live|mono|stereo|radio edit|single version|edit|version).*$/i, '')
    .replace(/\s*[([](feat|ft|with)\.?[^)\]]*[)\]]/i, '')
    .trim();
  if (duration) {
    const hit = await lrclib('get', { track_name: track, artist_name: primaryArtist, album_name: album, duration });
    if (hasLyrics(hit)) return pack(hit);
  }
  let best = pickBest(await lrclib('search', { track_name: cleanTrack, artist_name: primaryArtist }), duration);
  if (!best) best = pickBest(await lrclib('search', { q: `${cleanTrack} ${primaryArtist}` }), duration);
  return best ? pack(best) : { notFound: true };
}

// Returns { status, body } — never throws.
async function findLyrics(query) {
  const params = {
    track: String(query.track || ''),
    artist: String(query.artist || ''),
    album: String(query.album || ''),
    duration: Math.round(Number(query.duration) || 0),
  };
  if (!params.track) return { status: 400, body: { error: 'track is required' } };
  const key = JSON.stringify(params).toLowerCase();
  if (lyricsCache.has(key)) return { status: 200, body: lyricsCache.get(key), cacheable: true };
  try {
    const result = await searchLyrics(params);
    if (lyricsCache.size > 500) lyricsCache.clear();
    lyricsCache.set(key, result);
    return { status: 200, body: result, cacheable: true };
  } catch (e) {
    return { status: 200, body: { error: e.message } };
  }
}

// Returns { status, type, buffer } or { status, error }.
async function fetchArt(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return { status: 400, error: 'bad url' }; }
  if (u.protocol !== 'https:' || !IMG_HOST_OK.test(u.hostname)) return { status: 403, error: 'host not allowed' };
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { status: 502, error: `upstream ${r.status}` };
    return { status: 200, type: r.headers.get('content-type') || 'image/jpeg', buffer: Buffer.from(await r.arrayBuffer()) };
  } catch (e) {
    return { status: 502, error: e.message };
  }
}

module.exports = { findLyrics, fetchArt };
