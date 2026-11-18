#!/usr/bin/env node
/*
 * Vercel build step: copies ./test-media into ./public/media and writes the same
 * listing the local server returns from /api/media (vercel.json rewrites /api/media to it).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'test-media');
const OUT = path.join(ROOT, 'public', 'media');
const EXT = {
  images: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']),
  videos: new Set(['.mp4', '.webm', '.mov', '.m4v']),
  audio: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']),
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const manifest = { images: [], videos: [], audio: [], tracks: [] };
for (const [folder, exts] of Object.entries(EXT)) {
  const dir = path.join(SRC, folder);
  if (!fs.existsSync(dir)) continue;
  fs.mkdirSync(path.join(OUT, folder), { recursive: true });
  for (const name of fs.readdirSync(dir).sort()) {
    if (!exts.has(path.extname(name).toLowerCase())) continue;
    fs.copyFileSync(path.join(dir, name), path.join(OUT, folder, name));
    manifest[folder].push({ name, url: `/media/${folder}/${encodeURIComponent(name)}` });
  }
}
try {
  manifest.tracks = JSON.parse(fs.readFileSync(path.join(SRC, 'demo-tracks.json'), 'utf8')).tracks || [];
} catch { /* optional */ }
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
console.log(`Copied test media: ${manifest.images.length} images, ${manifest.videos.length} videos, ${manifest.audio.length} audio, ${manifest.tracks.length} demo tracks`);
