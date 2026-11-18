#!/usr/bin/env node
/*
 * Aura — local server for the Spotify visual player.
 * Zero dependencies. Serves the app on http://127.0.0.1:8888 and provides:
 *   /api/media   -> lists files in ./test-media (images, videos, audio) + demo tracks
 *   /api/lyrics  -> synced lyrics lookup via LRCLIB (cached in memory)
 *   /api/img     -> same-origin proxy for Spotify album art (needed for color extraction)
 *   /media/*     -> static files from ./test-media
 * Run with `node server.js --open` to also open it as a desktop app window.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, exec } = require('child_process');
const { findLyrics, fetchArt } = require('./lib/proxies');

const PORT = Number(process.env.PORT) || 8888;
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MEDIA_DIR = path.join(__dirname, 'test-media');
const ON_VERCEL = !!process.env.VERCEL;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.lrc': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

/* ---------- helpers ---------- */
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}
function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
}
function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}
async function listDir(dir, exts) {
  try {
    return (await fsp.readdir(dir)).filter((f) => exts.has(path.extname(f).toLowerCase())).sort();
  } catch { return []; }
}

async function serveFile(req, res, file) {
  let stat;
  try { stat = await fsp.stat(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  // Locally: always fresh. On Vercel: let the CDN cache files (each deployment gets its own cache).
  const cache = !ON_VERCEL ? 'no-cache'
    : file.startsWith(MEDIA_DIR) ? 'public, max-age=86400, s-maxage=604800'
      : 'public, max-age=0, s-maxage=86400, must-revalidate';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : stat.size - 1;
    if (m && !m[1] && m[2]) { start = stat.size - Number(m[2]); end = stat.size - 1; }
    end = Math.min(end, stat.size - 1);
    if (!m || start >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...base, 'Content-Length': stat.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------- /api/media ---------- */
async function handleMedia(res) {
  const list = async (sub, exts) =>
    (await listDir(path.join(MEDIA_DIR, sub), exts)).map((f) => ({ name: f, url: `/media/${sub}/${encodeURIComponent(f)}` }));
  let tracks = [];
  try {
    const json = JSON.parse(await fsp.readFile(path.join(MEDIA_DIR, 'demo-tracks.json'), 'utf8'));
    tracks = Array.isArray(json.tracks) ? json.tracks : [];
  } catch { /* no demo file is fine */ }
  sendJSON(res, 200, {
    images: await list('images', IMAGE_EXT),
    videos: await list('videos', VIDEO_EXT),
    audio: await list('audio', AUDIO_EXT),
    tracks,
  });
}

/* ---------- /api/lyrics (LRCLIB) and /api/img (album art) — shared with the Vercel functions ---------- */
async function handleLyrics(res, q) {
  const { status, body } = await findLyrics(Object.fromEntries(q));
  sendJSON(res, status, body);
}

async function handleImg(res, q) {
  const r = await fetchArt(q.get('url'));
  if (r.error) return send(res, r.status, r.error);
  res.writeHead(200, { 'Content-Type': r.type, 'Cache-Control': 'public, max-age=604800', 'Content-Length': r.buffer.length });
  res.end(r.buffer);
}

/* ---------- router ---------- */
const server = http.createServer(async (req, res) => {
  try {
    // Spotify only accepts 127.0.0.1 redirect URIs, and storage is per-origin, so normalise the host.
    const host = (req.headers.host || '').toLowerCase();
    if (host.startsWith('localhost')) {
      res.writeHead(302, { Location: ORIGIN + req.url });
      return res.end();
    }
    const url = new URL(req.url, ORIGIN);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'bad path'); }

    // /media/manifest.json is what vercel.json rewrites /api/media to, so answer both.
    if (pathname === '/api/media' || pathname === '/media/manifest.json') return handleMedia(res);
    if (pathname === '/api/lyrics') return handleLyrics(res, url.searchParams);
    if (pathname === '/api/img') return handleImg(res, url.searchParams);

    if (pathname.startsWith('/media/')) {
      const file = safeJoin(MEDIA_DIR, pathname.slice('/media'.length));
      if (file && (await serveFile(req, res, file))) return;
      return send(res, 404, 'not found');
    }

    const rel = pathname === '/' ? '/index.html' : pathname;
    const file = safeJoin(PUBLIC_DIR, rel);
    if (file && (await serveFile(req, res, file))) return;
    // SPA fallback (handles /callback after Spotify login)
    if (!path.extname(pathname)) return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    send(res, 404, 'not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'server error');
  }
});

/* ---------- open as a desktop app window ---------- */
function openApp(url) {
  const winCandidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  const args = [`--app=${url}`, '--start-maximized', '--autoplay-policy=no-user-gesture-required'];
  if (process.platform === 'win32') {
    const exe = winCandidates.find((p) => p && fs.existsSync(p));
    if (exe) return spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
    return exec(`start "" "${url}"`);
  }
  if (process.platform === 'darwin') {
    return exec(`open -na "Google Chrome" --args ${args.join(' ')}`, (err) => err && exec(`open "${url}"`));
  }
  exec(`google-chrome ${args.join(' ')} || chromium ${args.join(' ')} || xdg-open "${url}"`);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  Port ${PORT} is already in use — Aura is probably already running.`);
    console.log(`  Open ${ORIGIN} or set a different PORT (remember to update your Spotify redirect URI).\n`);
    if (process.argv.includes('--open')) openApp(ORIGIN);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log('\n  ✦ Aura is running');
  console.log(`  ➜ App:          ${ORIGIN}`);
  console.log(`  ➜ Redirect URI: ${ORIGIN}/callback   (add this in your Spotify app settings)`);
  console.log(`  ➜ Test media:   ${MEDIA_DIR}`);
  console.log('\n  Press Ctrl+C to stop.\n');
  if (process.argv.includes('--open')) openApp(ORIGIN);
});
