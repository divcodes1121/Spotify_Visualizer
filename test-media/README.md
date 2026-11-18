# test-media

Everything in this folder appears in Aura under **Test Media**, so you can try every visual without logging in to Spotify.

| Folder / file | What it does |
|---|---|
| `images/` | Album-art test images. Each one becomes a track. The palette, glow, mesh, and particles are taken from it. **Drop in any `.png/.jpg/.webp` to test it.** |
| `videos/` | Canvas-style loops (`.mp4/.webm`). A video named like a song plays behind it automatically (`neon-tide.mp4`, `midnight-drive.mp4`, `ember.mp4` and `lavender-haze.mp4` are included). You can also assign any video to any song with the 🎬 button. `ambient-aurora.mp4` is for **Customize → Look → Background → Ambient video**. The colors and LED lights follow the video live. |
| `audio/` | Your own audio files (`.mp3/.wav/.ogg/.m4a/.flac`). Each one becomes a track with a real audio-reactive visualizer. An image with the same name is used as its art. |
| `demo-tracks.json` | The 10 built-in demo tracks: name, artist, image, bpm/key for the built-in synth, and synced lyrics in LRC format. Edit it to try your own lyrics. |

Regenerate the built-in images and tracks at any time with:

```
npm run media
```

The lyrics in `demo-tracks.json` are original placeholder text written for testing.
