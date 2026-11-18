#!/usr/bin/env node
/*
 * Optional: builds test videos into ./test-media/videos using ffmpeg (if installed).
 *  - <song>.mp4  : 8-second vertical 9:16 "Canvas" loops made from the demo artwork.
 *                  Named like the demo images, so Aura auto-matches them to those songs.
 *  - ambient-aurora.mp4 : a 16:9 loop for Customize → Background → Ambient video.
 * Run:  npm run videos
 */
'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'test-media');
const IMG = path.join(ROOT, 'images');
const OUT = path.join(ROOT, 'videos');

if (spawnSync('ffmpeg', ['-version']).status !== 0) {
  console.log('\n  ffmpeg was not found. Install it (e.g. `winget install ffmpeg`) or drop your own .mp4/.webm files into test-media/videos.\n');
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

const run = (args, label) => {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  console.log(`  ✓ videos/${label}`);
};

// Seamless 8s loops: every motion is a sine with an 8-second period (240 frames at 30 fps).
const CANVAS_LOOPS = [
  { image: 'neon-tide', hue: 30, pan: 60, zoom: 0.08 },
  { image: 'midnight-drive', hue: 18, pan: 30, zoom: 0.1 },
  { image: 'ember', hue: 12, pan: 40, zoom: 0.12 },
  { image: 'lavender-haze', hue: 40, pan: 50, zoom: 0.07 },
];

for (const c of CANVAS_LOOPS) {
  const src = path.join(IMG, `${c.image}.png`);
  if (!fs.existsSync(src)) continue;
  const vf = [
    'scale=1600:1600',
    'crop=900:1600',
    `zoompan=z='1.12+${c.zoom}*sin(2*PI*on/240)':x='iw/2-(iw/zoom/2)+${c.pan}*sin(2*PI*on/240)':y='ih/2-(ih/zoom/2)+${c.pan / 2}*cos(2*PI*on/240)':d=1:s=720x1280:fps=30`,
    `hue=h='${c.hue}*sin(2*PI*t/8)':s='1.1+0.15*sin(2*PI*t/8)'`,
    'noise=alls=6:allf=t',
    'vignette=PI/5',
  ].join(',');
  run(['-loop', '1', '-i', src, '-vf', vf, '-t', '8', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(OUT, `${c.image}.mp4`)], `${c.image}.mp4  (Canvas loop)`);
}

run(['-f', 'lavfi', '-i',
  'gradients=s=1280x720:c0=0x2a0e61:c1=0xff4fa3:c2=0x23d5ab:c3=0x1b3a8c:x0=0:y0=0:x1=1280:y1=720:nb_colors=4:speed=0.012:duration=12:rate=30',
  '-vf', 'gblur=sigma=30,noise=alls=5:allf=t,eq=saturation=1.2',
  '-t', '12', '-c:v', 'libx264', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
  path.join(OUT, 'ambient-aurora.mp4')], 'ambient-aurora.mp4  (ambient background)');

console.log('\n  Test videos ready in ' + OUT + '\n');
