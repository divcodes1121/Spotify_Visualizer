# ✦ Aura — a visual player for your Spotify

Aura runs locally on your computer and shows your Spotify library: liked songs, playlists, recently played, top tracks and search. When you play a song it goes **fullscreen**, matches the whole screen to the album art's colors, shows **synced lyrics**, and animates color meshes, particles and a visualizer. Nearly everything can be customized.

No build step and no `npm install`. It only needs Node.js.

---

## Quick start

1. Install **Node.js 18+** from https://nodejs.org.
2. Start Aura:
   - **Windows:** double-click **`start.bat`**
   - **macOS / Linux:** run `./start.sh` or `npm start`
3. Aura opens as its own app window (Edge or Chrome app mode) at **http://127.0.0.1:8888**.
4. Click **"Try it with the test media"** to see everything without logging in, or connect Spotify (below).

> Open **http://127.0.0.1:8888/?demo&play=0** to jump straight into the immersive view with a test track.

## Connect your Spotify (about 2 minutes, once per person)

Each person uses their own free Spotify developer app. Anyone can run Aura this way without sharing secrets.

1. Go to https://developer.spotify.com/dashboard → **Create app**.
2. Set the **Redirect URI** to exactly `http://127.0.0.1:8888/callback` (Spotify no longer accepts `localhost`).
3. Under "Which API/SDKs are you planning to use", tick **Web API** and **Web Playback SDK**.
4. Copy the **Client ID**, paste it into Aura, and click **Connect Spotify**.

Login uses PKCE, so there is no client secret. Tokens are stored only in your browser's local storage.

**Spotify's 2026 Development Mode rules:**
- The app owner needs **Spotify Premium**.
- Up to **5 users** per app. Add friends under *User Management* in the dashboard, or have them create their own app.
- **Playing inside Aura** needs Premium (Web Playback SDK). With a **free** account, play music from the Spotify app on any device and Aura **follows along**, showing that track with the same visuals and lyrics.

## Features

| | |
|---|---|
| **Ambilight & LED lights** | The cover glows onto a dark "wall" using colors sampled from each of its edges, like an Ambilight TV. An LED strip around the screen edge has 5 effects: **Flow** (cover colors travel around the corners), **Mirror** (each screen edge matches the cover edge), **Chase** (light comets), **Breathe** (pulses with the beat), and **Spectrum** (rainbow). Speed, brightness, thickness and glow are all adjustable |
| **Liquid glass UI** | Apple-style liquid glass with real edge refraction (SVG displacement maps in Chromium), specular rims, and a light that follows the cursor. Choose liquid, frosted or clear glass, with blur and tint sliders |
| **Library** | Liked Songs, Recently Played, Top Tracks, Playlists, and search, in **list or grid view**. The whole app is tinted by an aurora in the current song's colors. A floating glass player dock sits at the bottom |
| **Lyrics** | Synced lyrics from [LRCLIB](https://lrclib.net) with **word-by-word highlighting**, Apple-Music-style **staggered spring scrolling**, depth blur, breathing dots during instrumental breaks, and click-to-seek. 4 styles: **Fluid**, **Spotify** (flat album color with dark upcoming lines), **Karaoke**, **Cinema** subtitles. 10 fonts |
| **Videos (like Spotify Canvas)** | Per-track looping videos from `test-media/videos` (auto-matched by song name), or a **YouTube music video** kept in sync with the song (paste a link, or add a free API key for automatic search). The screen colors follow the video |
| **Backgrounds** | Dark room (default, made for the lights), Fluid album art, Canvas motion art (Ken Burns + light sweep), album color, blurred art, color mesh, gradient, or an ambient video |
| **Visualizer & art** | Bars, mirrored, wave, ring around the art, dot matrix. Art can be rounded, square, circle, **spinning vinyl** or hidden, with 3D tilt, glossy shine and an optional reflection |
| **Presets** | Ambilight, LED Party, Fluid, Spotify, Canvas, Neon, Editorial, Vinyl Lounge, Karaoke, Cinema, Retro. Settings can be exported and imported as JSON |

### Keyboard shortcuts
`Space` play/pause · `←/→` seek 10s · `↑/↓` volume · `N/P` next/prev · `F` fullscreen · `I` immersive view · `L` lyrics · `Y` lyrics style · `E` LED effect · `A` ambilight on/off · `V` visualizer · `B` background · `S` settings · `Esc` close

### About Spotify Canvas videos
Spotify doesn't offer Canvas videos through its public API. The only access is through internal endpoints using your browser's login cookie, which breaks Spotify's terms and stops working often. Aura gives you the same look in supported ways: your own loops (any `.mp4`/`.webm` named after the song, or assigned with the 🎬 button), or synced YouTube music videos.

### About audio reactivity
Spotify streams are DRM-protected, so a web app can't read their audio directly. Aura offers three options:
- **Simulated** (default for Spotify): a tempo-locked procedural spectrum.
- **Live audio**: demo tracks and your own files in `test-media/audio` are analysed for real.
- **System audio**: click the 🖥 button in the immersive view, choose *Entire screen*, and turn on **Share system audio**. The visualizer then reacts to what you actually hear.

## Test media

`test-media/` comes with 10 generated artworks and demo tracks with original synced lyrics. A built-in synth plays them, so you can test everything offline. Drop in your own files:

- `test-media/images/*.png|jpg|webp`: each image becomes a track. Use these to test color matching.
- `test-media/videos/*.mp4|webm`: Canvas-style loops. A file named like a song (e.g. `neon-tide.mp4`, or `Blinding Lights.mp4` for a Spotify song) plays behind that song automatically. 4 vertical loops plus an ambient 16:9 loop are included. Regenerate them with `npm run videos` (needs ffmpeg).
- `test-media/audio/*.mp3|wav|ogg|m4a|flac`: real songs with a real audio-reactive visualizer.
- `test-media/demo-tracks.json`: edit names and lyrics (LRC format).

Regenerate the built-in set with `npm run media`.

## Deploy to Vercel (optional)

Aura also runs as a website. `vercel.json` handles everything:
- The lyrics and album-art proxies run as serverless functions (`api/`).
- `test-media` is copied into the site at build time.

1. Import this repo at https://vercel.com/new and click **Deploy**. No settings or environment variables are needed.
2. In your Spotify app dashboard, add a second Redirect URI: `https://<your-project>.vercel.app/callback`.

The Spotify Development Mode limits still apply (Premium owner, 5 users). Each visitor can also use their own Client ID.

## Project layout

```
server.js                  local server (static files, LRCLIB lyrics proxy, album-art proxy, media listing)
lib/proxies.js             lyrics + album-art proxy logic shared by server.js and the Vercel functions
api/                       Vercel serverless functions (lyrics.js, img.js)
vercel.json                Vercel config (build step, rewrites, caching)
start.bat / start.sh       launchers (open an app-mode window in Edge/Chrome)
tools/generate-test-media.js   creates test-media images + demo tracks (no dependencies)
tools/generate-test-videos.js  creates Canvas-style test loops with ffmpeg (optional)
public/
  index.html               app shell + icon sprite
  css/app.css              all styling (palette lives in animated CSS variables)
  js/main.js               app controller: screens, library, immersive view, settings, shortcuts
  js/auth.js               Spotify PKCE login + token refresh
  js/spotify.js            Web API wrapper (2026 dev-mode compatible endpoints)
  js/player.js             Web Playback SDK + follow-other-device + demo engine
  js/color.js              palette extraction
  js/lyrics.js             LRC parsing + animated lyrics view
  js/visuals.js            Ambilight + LED strip, fluid art, color mesh, particles, visualizers (canvas)
  js/glass.js              liquid-glass refraction (generated displacement maps)
  js/videos.js             per-track videos: local loops + synced YouTube
  js/audio.js              audio analysis bus (simulated / live / system capture)
  js/demo.js               test-media tracks + generative synth
  js/settings.js           every option, presets, persistence
```

## Troubleshooting

- **"INVALID_CLIENT: Invalid redirect URI"**: the dashboard URI must be exactly `http://127.0.0.1:8888/callback`.
- **403 / "user not registered"**: add the Spotify account's email under *User Management* in your developer app.
- **Nothing plays when I click a song**: in-app playback needs Premium. Otherwise start the song in Spotify and Aura follows it.
- **Port 8888 is busy**: run with `PORT=9000` (`set PORT=9000` on Windows) and update the redirect URI to match.
- **Lyrics missing**: LRCLIB is community-run, so not every song has synced lyrics. Use the *Timing offset* slider if lyrics are early or late.
