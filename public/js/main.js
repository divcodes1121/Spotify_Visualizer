// Aura — app controller: screens, library, immersive view, videos, settings panel, shortcuts.
import { $, $$, el, esc, icon, fmtTime, toast, debounce, clamp, imgUrl } from './ui.js';
import { Auth, REDIRECT_URI } from './auth.js';
import { Spotify } from './spotify.js';
import { Player } from './player.js';
import { analyzeUrl, paletteFromSource, paletteFromHex, applyPaletteCSS, edgesFromSource, edgesFromPalette } from './color.js';
import { LyricsView, loadLyrics } from './lyrics.js';
import { Visuals } from './visuals.js';
import { AudioBus } from './audio.js';
import { Settings, SCHEMA, PRESETS, FONTS, TABS } from './settings.js';
import { demoTracks, loadMedia } from './demo.js';
import { liquidGlass, setLiquidEnabled } from './glass.js';
import { TrackVideos, VideoLayer, parseYouTube } from './videos.js';

const player = new Player();
const S = {
  mode: null, view: null, viewKey: null, list: [], filtered: [], cache: {}, current: null, npOpen: false,
  loadToken: 0, lastSec: -1, dragging: false, bgFlip: false, lyricsEmpty: false, user: null, authWarned: false,
  context: null, upNext: null, upNextShown: false, videoEntry: null, tab: TABS[0],
};

const np = $('#np');
const ambientVideo = $('#bg-video');
const trackVideoEl = $('#track-video');
const visuals = new Visuals({ bg: $('#bg-canvas'), fx: $('#fx-canvas'), glow: $('#glow-canvas'), art: $('#np-art') });
const lyrics = new LyricsView($('#np-lyrics'), $('#lyrics-inner'), {
  onSeek: (ms) => player.seek(ms - Settings.get('lyricsOffset')),
});
window.__aura = { visuals, player, Settings }; // handy for debugging in DevTools
const videoLayer = new VideoLayer({
  video: trackVideoEl,
  ytHost: $('#yt-host'),
  onError: (msg) => toast(msg, 'error', 7000),
  onState: (active) => {
    np.classList.toggle('has-video', active);
    updateVideoBadge();
    if (!active) refreshPalette();
  },
});

/* =========================================================
   Palette
   ========================================================= */
// edges = Ambilight colors sampled around the cover/video border (falls back to palette colors)
function setPalette(p, edges = null) {
  applyPaletteCSS(p);
  visuals.setPalette(p);
  visuals.setEdges(edges || edgesFromPalette(p));
}

function fromSource(src, boost) {
  setPalette(paletteFromSource(src, boost), edgesFromSource(src, 8, boost));
}

async function refreshPalette() {
  const s = Settings.all();
  const boost = s.colorBoost / 100;
  const t = S.current;
  if (s.colorMode === 'custom') return setPalette(paletteFromHex(s.customAccent, boost));
  const vid = activeColorVideo();
  if (vid && s.videoColors && vid.readyState >= 2) {
    try { return fromSource(vid, boost); } catch { /* fall back to art */ }
  }
  if (!t?.image) return setPalette(paletteFromHex('#8b5cf6', boost));
  try {
    const { palette, edges } = await analyzeUrl(imgUrl(t.image), boost);
    if (S.current === t) setPalette(palette, edges);
  } catch {
    setPalette(paletteFromHex('#8b5cf6', boost));
  }
}

// The <video> whose frames drive the colors (a local track video, or the ambient background video).
function activeColorVideo() {
  if (np.classList.contains('has-video') && videoLayer.kind === 'local') return trackVideoEl;
  if (Settings.get('background') === 'video' && ambientVideo.getAttribute('src')) return ambientVideo;
  return null;
}

setInterval(() => {
  const st = Settings.all();
  if (!S.npOpen || st.colorMode !== 'auto' || !st.videoColors) return;
  const v = activeColorVideo();
  if (!v || v.readyState < 2 || v.paused) return;
  try { fromSource(v, st.colorBoost / 100); } catch { /* not ready */ }
}, 1200);

/* =========================================================
   Ambient background video (Background → Video)
   ========================================================= */
async function syncAmbientVideo() {
  const s = Settings.all();
  if (s.background !== 'video') {
    if (ambientVideo.getAttribute('src')) { ambientVideo.pause(); ambientVideo.removeAttribute('src'); ambientVideo.load(); }
    return;
  }
  let src = s.bgVideo;
  if (!src) src = (await loadMedia(true)).videos[0]?.url || '';
  if (!src) {
    toast('No videos yet — drop an .mp4 or .webm into test-media/videos, then choose it under Customize → Look.', 'info', 8000);
    return;
  }
  if (ambientVideo.getAttribute('src') !== src) ambientVideo.src = src;
  if (S.npOpen) ambientVideo.play().catch(() => {});
}

/* =========================================================
   Track videos (Canvas loops / YouTube music videos)
   ========================================================= */
async function resolveTrackVideo(t) {
  let entry = TrackVideos.get(t);
  if (!entry && Settings.get('autoMatchVideos')) entry = await TrackVideos.autoMatch(t);
  const key = Settings.get('ytKey');
  if (!entry && Settings.get('ytAuto') && key && t.source === 'spotify') {
    try {
      entry = await TrackVideos.youtubeSearch(t, key);
      TrackVideos.set(t, entry || { type: 'none', auto: true });
    } catch (e) {
      toast(e.message, 'error', 6000);
    }
  }
  if (S.current !== t) return;
  S.videoEntry = entry && entry.type !== 'none' ? entry : null;
  if (Settings.get('trackVideos') && S.videoEntry) videoLayer.show(S.videoEntry, player.position());
  else videoLayer.clear();
  updateVideoBadge();
  if (!$('#video-pop').hidden) refreshVideoPop();
}

function setTrackVideo(entry) {
  const t = S.current;
  if (!t) return;
  TrackVideos.set(t, entry || { type: 'none' });
  if (entry && !Settings.get('trackVideos')) Settings.set('trackVideos', true);
  resolveTrackVideo(t);
}

function updateVideoBadge() {
  const b = $('#np-video-badge');
  const e = S.videoEntry;
  const on = np.classList.contains('has-video') && e;
  b.hidden = !on;
  if (on) b.querySelector('span').textContent = e.type === 'youtube' ? 'Music video' : 'Canvas loop';
  $('#np-video').classList.toggle('on', !!on);
}

async function refreshVideoPop() {
  const t = S.current;
  const e = S.videoEntry;
  let status = !t ? 'Play a song first' : !e ? 'No video for this track yet'
    : e.type === 'local' ? `Playing ${e.name || 'local video'}${e.auto ? ' (matched by name)' : ''}`
      : `YouTube: ${e.name || e.src}${e.auto ? ' (found automatically)' : ''}`;
  if (e && !Settings.get('trackVideos')) status += ' · track videos are switched off';
  $('#vp-status').textContent = status;
  const m = await loadMedia(true);
  const box = $('#vp-local');
  box.replaceChildren();
  if (!m.videos.length) box.innerHTML = '<span class="none">Drop .mp4 / .webm loops into test-media/videos</span>';
  m.videos.forEach((v) => {
    const b = el('button', { class: e?.src === v.url ? 'active' : '', title: v.name }, v.name.replace(/\.[^.]+$/, ''));
    b.addEventListener('click', () => setTrackVideo({ type: 'local', src: v.url, name: v.name, offset: 0 }));
    box.append(b);
  });
  $('#vp-yt').value = e?.type === 'youtube' ? `https://youtu.be/${e.src}` : '';
  if (t) $('#vp-yt-open').href = TrackVideos.searchLink(t);
  $('#vp-hint').textContent = Settings.get('ytKey') ? ''
    : 'Tip: paste any YouTube link, or add a free YouTube Data API key in Customize → Video to find music videos automatically.';
  const off = e?.offset || 0;
  $('#vp-offset').value = off;
  $('#vp-offset-val').textContent = `${off > 0 ? '+' : ''}${off.toFixed(1)} s`;
}

function toggleVideoPop(force) {
  const pop = $('#video-pop');
  const show = force ?? pop.hidden;
  pop.hidden = !show;
  if (show) { np.classList.remove('idle'); refreshVideoPop(); }
}

/* =========================================================
   Settings → DOM
   ========================================================= */
function applySettings(changed = null) {
  const s = Settings.all();
  const r = document.documentElement.style;
  const has = (...keys) => !changed || changed.some((k) => keys.includes(k));

  np.dataset.layout = s.layout;
  np.dataset.art = s.artStyle;
  np.dataset.bg = s.background;
  const npClasses = {
    'lyrics-blur': s.lyricsBlur, 'lyrics-glow': s.lyricsGlow, 'word-sync': s.wordSync, 'art-glow': s.artGlow && !s.ambilight,
    ambi: s.ambilight,
    'art-reflect': s.artReflection, 'show-clock': s.showClock, 'show-device': s.showDevice, grain: s.grain, vignette: s.vignette,
  };
  for (const [k, v] of Object.entries(npClasses)) np.classList.toggle(k, !!v);
  ['fluid', 'spotify', 'karaoke', 'cinema'].forEach((st) => np.classList.toggle(`ly-${st}`, s.lyricsStyle === st));

  document.body.classList.toggle('no-aurora', !s.libraryAurora);
  ['liquid', 'frosted', 'clear'].forEach((g) => document.body.classList.toggle(`glass-${g}`, s.glassStyle === g));
  setLiquidEnabled(s.glassStyle === 'liquid');

  r.setProperty('--glass-blur', `${s.glassStyle === 'clear' ? Math.min(s.glassBlur, 8) : s.glassBlur}px`);
  r.setProperty('--glass-tint', (s.glassStyle === 'clear' ? s.glassTint * 0.4 : s.glassTint) / 100);
  r.setProperty('--spot', s.spotlight ? 1 : 0);
  r.setProperty('--blur', `${s.blur}px`);
  r.setProperty('--dim', s.bgDim / 100);
  r.setProperty('--sat', `${s.saturation}%`);
  r.setProperty('--mesh', s.meshOpacity / 100);
  r.setProperty('--video-dim', s.videoDim / 100);
  r.setProperty('--art-size', s.artSize / 100);
  r.setProperty('--ly-size', `${s.lyricsSize}px`);
  r.setProperty('--ly-weight', s.lyricsWeight);
  r.setProperty('--ly-spacing', s.lyricsSpacing / 100);
  r.setProperty('--ly-align', s.lyricsAlign);
  r.setProperty('--ly-justify', { left: 'flex-start', center: 'center', right: 'flex-end' }[s.lyricsAlign]);
  r.setProperty('--ly-origin', { left: 'left center', center: 'center center', right: 'right center' }[s.lyricsAlign]);
  r.setProperty('--ly-font', FONTS[s.lyricsFont] || FONTS.Inter);
  r.setProperty('--ui-font', FONTS[s.uiFont] || FONTS.Inter);

  lyrics.configure({ wordSync: s.wordSync, spring: s.lyricsSpring });
  visuals.configure(s);
  updateLyricsVisibility();
  $('#np-lyrics-btn').classList.toggle('on', s.showLyrics);
  if (!s.artTilt) ['--rx', '--ry'].forEach((p) => $('#np-art').style.removeProperty(p));
  if (!s.hideIdle) np.classList.remove('idle');

  if (has('libraryView')) applyLibraryView();
  if (has('background', 'bgVideo')) syncAmbientVideo();
  if (changed && has('colorMode', 'customAccent', 'colorBoost', 'background', 'videoColors')) refreshPalette();
  if (changed && has('trackVideos', 'autoMatchVideos', 'ytAuto', 'ytKey') && S.current) resolveTrackVideo(S.current);
  if (changed && changed.some((k) => k.startsWith('lyrics') || ['layout', 'artSize', 'showLyrics', 'wordSync'].includes(k))) {
    setTimeout(() => lyrics.recenter(), 650);
  }
  syncSettingsPanel();
}

function updateLyricsVisibility() {
  const s = Settings.all();
  np.classList.toggle('lyrics-off', !s.showLyrics || (S.lyricsEmpty && s.layout !== 'lyrics' && s.lyricsStyle !== 'cinema'));
}

/* =========================================================
   Settings panel
   ========================================================= */
function buildSettingsPanel() {
  const presets = $('#presets');
  for (const name of Object.keys(PRESETS)) {
    presets.append(el('button', { onclick: () => { Settings.applyPreset(name); toast(`Preset: ${name}`, 'success', 2000); } }, name));
  }
  const tabs = $('#settings-tabs');
  TABS.forEach((name) => tabs.append(el('button', { 'data-tab': name, onclick: () => showTab(name) }, name)));

  const body = $('#settings-body');
  for (const section of SCHEMA) {
    const sec = el('div', { class: 'sec', 'data-tab': section.tab });
    sec.append(el('h4', {}, section.title));
    for (const item of section.items) {
      const id = `set-${item.key}`;
      const field = el('div', { class: `field ${item.type}`, 'data-key': item.key });
      const label = el('label', { for: id }, item.label);
      let control;
      if (item.type === 'toggle') {
        control = el('input', { type: 'checkbox', class: 'switch', id });
        control.addEventListener('change', () => Settings.set(item.key, control.checked));
        field.append(label, control);
      } else if (item.type === 'range') {
        control = el('input', { type: 'range', id, min: item.min, max: item.max, step: item.step });
        control.addEventListener('input', () => Settings.set(item.key, Number(control.value)));
        field.append(label, el('span', { class: 'val' }), control);
      } else if (item.type === 'select') {
        control = el('select', { id });
        if (Array.isArray(item.options)) item.options.forEach((o) => control.append(el('option', { value: o.value }, o.label)));
        control.addEventListener('change', () => Settings.set(item.key, control.value));
        field.append(label, control);
      } else if (item.type === 'color') {
        control = el('input', { type: 'color', id });
        control.addEventListener('input', debounce(() => Settings.set(item.key, control.value), 60));
        field.append(label, control);
      } else if (item.type === 'text') {
        control = el('input', { type: /key/i.test(item.key) ? 'password' : 'text', id, class: 'glass-input', placeholder: item.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
        control.addEventListener('change', () => Settings.set(item.key, control.value.trim()));
        field.append(label, control);
      }
      field._item = item;
      field._control = control;
      sec.append(field);
    }
    body.append(sec);
  }
  showTab(S.tab);
}

function showTab(name) {
  S.tab = name;
  $$('#settings-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('#settings-body .sec').forEach((s) => { s.hidden = s.dataset.tab !== name; });
  $('#settings-body').scrollTop = 0;
}

async function fillVideoOptions() {
  const select = $('#set-bgVideo');
  if (!select) return;
  const m = await loadMedia(true);
  select.replaceChildren(el('option', { value: '' }, m.videos.length ? 'First video in folder' : 'No videos in test-media/videos'));
  m.videos.forEach((v) => select.append(el('option', { value: v.url }, v.name)));
  select.value = Settings.get('bgVideo');
}

function syncSettingsPanel() {
  const s = Settings.all();
  for (const field of $$('#settings-body .field')) {
    const { _item: item, _control: c } = field;
    const v = s[item.key];
    if (item.type === 'toggle') c.checked = !!v;
    else if (document.activeElement !== c) c.value = v;
    if (item.type === 'range') field.querySelector('.val').textContent = `${v}${item.unit || ''}`;
    field.hidden = item.when ? !item.when(s) : false;
  }
}

function openSettings() {
  $('#settings').classList.add('open');
  $('#settings').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('show');
  np.classList.remove('idle');
  toggleVideoPop(false);
  fillVideoOptions();
}
function closeSettings() {
  $('#settings').classList.remove('open');
  $('#settings').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('show');
}
const toggleSettings = () => ($('#settings').classList.contains('open') ? closeSettings() : openSettings());

/* =========================================================
   Library views
   ========================================================= */
const VIEWS = {
  liked: { eyebrow: 'Collection', title: 'Liked Songs', icon: 'heart', load: (onPage) => Spotify.likedTracks(onPage) },
  recent: { eyebrow: 'History', title: 'Recently Played', icon: 'clock', nocache: true, load: () => Spotify.recent() },
  top: { eyebrow: 'Your favourites · last 6 months', title: 'Top Tracks', icon: 'star', load: () => Spotify.topTracks() },
  demo: { eyebrow: 'Local folder · test-media', title: 'Test Media', icon: 'image', nocache: true, load: () => demoTracks() },
};

function setHero(def) {
  $('#hero-eyebrow').textContent = def.eyebrow;
  $('#hero-title').textContent = def.title;
  const art = $('#hero-art');
  if (def.image) { art.style.backgroundImage = `url("${def.image}")`; art.innerHTML = ''; }
  else { art.style.backgroundImage = ''; art.innerHTML = icon(def.icon || 'music'); }
}

function describe(list) {
  const total = list.reduce((a, t) => a + (t.duration || 0), 0);
  const h = Math.floor(total / 3600000), m = Math.round((total % 3600000) / 60000);
  return `${list.length} song${list.length === 1 ? '' : 's'}${total ? ` · ${h ? `${h} hr ` : ''}${m} min` : ''}`;
}

async function openView(key, extra = {}) {
  const token = ++S.loadToken;
  let def = VIEWS[key];
  if (key === 'playlist') {
    def = { eyebrow: `Playlist${extra.owner ? ` · ${extra.owner}` : ''}`, title: extra.name, image: extra.image, load: (onPage) => Spotify.playlistTracks(extra.id, onPage) };
  } else if (key === 'search') {
    def = { eyebrow: 'Spotify search · top 10', title: `“${extra.q}”`, icon: 'search', nocache: true, load: () => Spotify.search(extra.q) };
  }
  S.view = key === 'playlist' ? `pl:${extra.id}` : key;
  S.viewKey = key;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === key));
  $$('#playlist-nav button').forEach((b) => b.classList.toggle('active', key === 'playlist' && b.dataset.id === extra.id));
  setHero(def);
  if (key !== 'search') $('#search').value = '';
  $('#content').scrollTop = 0;

  if (!def.nocache && S.cache[S.view]) return setList(S.cache[S.view], def);
  renderSkeleton();
  $('#hero-sub').textContent = 'Loading…';
  let progressive = false;
  try {
    const tracks = await def.load((items, total, all) => {
      if (token !== S.loadToken) return;
      if (all.length === items.length) setList(all, def);
      else { progressive = true; S.list = all; if (!$('#search').value) { S.filtered = all; appendItems(items, all.length - items.length); } }
      $('#hero-sub').textContent = `Loading ${all.length} of ${total}…`;
    });
    if (token !== S.loadToken) return;
    if (!def.nocache) S.cache[S.view] = tracks;
    if (key === 'demo' && tracks[0]) setHero({ ...def, image: tracks[0].image });
    if (progressive && !$('#search').value) { S.list = tracks; S.filtered = tracks; $('#hero-sub').textContent = describe(tracks); }
    else setList(tracks, def);
  } catch (e) {
    if (token !== S.loadToken) return;
    renderError(e);
  }
}

function setList(tracks, def) {
  S.list = tracks;
  applyFilter();
  $('#hero-sub').textContent = describe(tracks);
  if (!tracks.length) renderEmpty(def);
}

const isGrid = () => Settings.get('libraryView') === 'grid';

function rowHTML(t, i) {
  const art = t.thumb ? `<img loading="lazy" src="${esc(t.thumb)}" alt="">` : '<span class="ph"></span>';
  return `<div class="row${t.id === S.current?.id ? ' playing' : ''}" data-i="${i}" data-id="${esc(t.id)}">
    <span class="idx"><span class="num">${i + 1}</span>${icon('play', 'play-hover')}<span class="eq"><i></i><i></i><i></i></span></span>
    <span class="t">${art}<span class="tt"><span class="name">${esc(t.name)}</span><span class="artist">${esc(t.artists)}</span></span></span>
    <span class="album">${esc(t.album)}</span>
    <span class="dur">${t.duration ? fmtTime(t.duration) : ''}</span>
  </div>`;
}

function cardHTML(t, i) {
  const src = t.cover || t.image || t.thumb;
  return `<div class="gcard${t.id === S.current?.id ? ' playing' : ''}" data-i="${i}" data-id="${esc(t.id)}">
    <div class="gart">${src ? `<img loading="lazy" src="${esc(src)}" alt="">` : ''}<span class="fab">${icon('play')}</span></div>
    <div class="gname">${esc(t.name)}</div><div class="gartist">${esc(t.artists)}</div>
  </div>`;
}

function renderList(list) {
  const tpl = isGrid() ? cardHTML : rowHTML;
  $('#track-list').innerHTML = list.map(tpl).join('');
}
function appendItems(items, start) {
  const tpl = isGrid() ? cardHTML : rowHTML;
  $('#track-list').insertAdjacentHTML('beforeend', items.map((t, i) => tpl(t, start + i)).join(''));
}
function applyLibraryView() {
  const grid = isGrid();
  $('#track-list').classList.toggle('grid', grid);
  $('#content').classList.toggle('grid-view', grid);
  $$('#view-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.lv === (grid ? 'grid' : 'list')));
  if (S.filtered.length) renderList(S.filtered);
}
function renderSkeleton() {
  const row = '<div class="row skeleton"><span></span><span class="t"><span class="ph"></span><span class="tt" style="width:60%"><span class="bar"></span><span class="bar" style="width:60%"></span></span></span><span class="bar" style="width:50%"></span><span></span></div>';
  $('#track-list').classList.remove('grid');
  $('#track-list').innerHTML = row.repeat(10);
}
function renderEmpty() {
  const msg = {
    demo: '<b>No test media found</b>Run <code>npm run media</code> or drop images into <code>test-media/images</code>.',
    liked: '<b>No liked songs yet</b>Like some songs in Spotify and they will show up here.',
    playlist: '<b>No tracks to show</b>Spotify only lets development-mode apps read the tracks of playlists you own or collaborate on.',
    search: '<b>No results</b>Try a different search.',
  }[S.viewKey] || '<b>Nothing here yet</b>';
  $('#track-list').classList.remove('grid');
  $('#track-list').innerHTML = `<div class="list-empty">${msg}</div>`;
}
function renderError(e) {
  const hint = e.status === 403
    ? 'Spotify blocked this request. Make sure your account is added under <b>User Management</b> in your Spotify developer app (development mode allows 5 users), and that the app owner has Premium.'
    : e.status === 429 ? 'Spotify rate limit reached — wait a minute and try again.' : esc(e.message);
  $('#track-list').classList.remove('grid');
  $('#track-list').innerHTML = `<div class="list-empty"><b>Couldn’t load this list</b>${hint}</div>`;
  $('#hero-sub').textContent = '';
}

const applyFilter = () => {
  const q = $('#search').value.trim().toLowerCase();
  S.filtered = q ? S.list.filter((t) => `${t.name} ${t.artists} ${t.album}`.toLowerCase().includes(q)) : S.list;
  $('#track-list').classList.toggle('grid', isGrid());
  renderList(S.filtered);
};

async function loadPlaylists() {
  const nav = $('#playlist-nav');
  try {
    const lists = await Spotify.playlists();
    nav.replaceChildren(...lists.filter(Boolean).map((p) => {
      const img = p.images?.length ? p.images[p.images.length - 1].url : '';
      const big = p.images?.[0]?.url || img;
      const b = el('button', { 'data-id': p.id, title: p.name, html: `${img ? `<img loading="lazy" src="${esc(img)}" alt="">` : '<span class="ph"></span>'}<span>${esc(p.name)}</span>` });
      b.addEventListener('click', () => openView('playlist', { id: p.id, name: p.name, image: big, owner: p.owner?.display_name }));
      return b;
    }));
  } catch (e) {
    nav.innerHTML = `<div class="nav-label" style="text-transform:none;letter-spacing:0">Couldn’t load playlists (${esc(e.message)})</div>`;
  }
}

/* =========================================================
   Playback
   ========================================================= */
function playFrom(list, i) {
  const t = list[i];
  if (!t) return;
  S.context = list;
  if (Settings.get('openOnPlay')) openNowPlaying(); // inside the click → fullscreen allowed
  player.play(t, list, i).catch((e) => toast(e.message, 'error', 8000));
}

function onTrackChange(t) {
  S.current = t;
  $('#np-title').textContent = t.name;
  $('#np-artist').textContent = t.artists;
  $('#np-album').textContent = t.album || '';
  const meta = $('#np-meta');
  meta.classList.remove('swap');
  void meta.offsetWidth;
  meta.classList.add('swap');

  const img = $('#np-art-img');
  if (img.getAttribute('src') !== t.image) {
    img.classList.add('loading');
    img.onload = () => img.classList.remove('loading');
    img.src = t.image || '';
  }
  $('#mini-art').src = t.thumb || t.image || '';
  $('#mini-title').textContent = t.name;
  $('#mini-artist').textContent = t.artists;
  document.title = `${t.name} · ${t.artists} — Aura`;

  const a = $('#bg-art-a'), b = $('#bg-art-b');
  const [show, hide] = S.bgFlip ? [a, b] : [b, a];
  S.bgFlip = !S.bgFlip;
  const pre = new Image();
  pre.onload = pre.onerror = () => {
    if (S.current !== t) return;
    show.style.backgroundImage = t.image ? `url("${t.image}")` : '';
    show.classList.add('show');
    hide.classList.remove('show');
  };
  pre.src = t.image || '';
  visuals.setArt(imgUrl(t.image));

  $$('#track-list .playing').forEach((r) => r.classList.remove('playing'));
  $$(`#track-list [data-id="${CSS.escape(t.id)}"]`).forEach((r) => r.classList.add('playing'));

  refreshPalette();
  resolveTrackVideo(t);
  refreshUpNext(t);
  S.lyricsEmpty = false;
  updateLyricsVisibility();
  lyrics.loading();
  loadLyrics(t).then((res) => {
    if (S.current !== t) return;
    lyrics.set(res);
    S.lyricsEmpty = !!(res.instrumental || res.notFound || res.error);
    updateLyricsVisibility();
    const note = res.instrumental ? ' · instrumental' : res.notFound ? ' · no lyrics found' : '';
    $('#np-album').textContent = (t.album || '') + note;
  });
}

async function refreshUpNext(t) {
  S.upNext = null;
  if (player.active === player.demo) {
    const d = player.demo;
    if (d.list.length > 1 && !d.shuffleOn) S.upNext = d.list[(d.index + 1) % d.list.length];
  } else {
    try { S.upNext = (await Spotify.queue())[0] || null; } catch { /* fall back to the list we started from */ }
    if (!S.upNext && S.context) {
      const i = S.context.findIndex((x) => x.id === t.id);
      if (i >= 0) S.upNext = S.context[i + 1] || null;
    }
  }
  if (S.current !== t) return;
  const n = S.upNext;
  $('#up-next').hidden = !n;
  if (n) {
    $('#un-art').src = n.thumb || n.image || '';
    $('#un-title').textContent = n.name;
    $('#un-artist').textContent = n.artists;
  }
}

player.on('state', (s) => {
  if (!s?.track) return;
  if (s.track.id !== S.current?.id) onTrackChange(s.track);
  document.body.classList.toggle('paused', s.paused);
  np.classList.toggle('paused', s.paused);
  $$('[data-act=toggle]').forEach((b) => { b.innerHTML = icon(s.paused ? 'play' : 'pause'); });
  $$('[data-act=shuffle]').forEach((b) => b.classList.toggle('on', !!s.shuffle));
  $$('[data-act=repeat]').forEach((b) => { b.classList.toggle('on', s.repeat > 0); b.classList.toggle('rep-one', s.repeat === 2); });
  $('#np-device span').textContent = s.device || '';
  $('#mini').hidden = false;
  S.lastSec = -1;
  updateAudioBadge();
});
player.on('engine', () => updateAudioBadge());
player.on('error', (m) => toast(m, 'error', 7000));
player.on('info', (m) => toast(m, 'info', 9000));
player.on('authproblem', (e) => handleAuthProblem(e));

function handleAuthProblem(e) {
  if (S.authWarned) return;
  S.authWarned = true;
  if (e.status === 401) {
    toast('Your Spotify session expired — please connect again.', 'error', 8000);
    Auth.logout();
    showConnect();
  } else if (e.status === 403) {
    toast('Spotify blocked this account. Add it under User Management in your Spotify developer app (max 5 users in development mode).', 'error', 12000);
  } else {
    toast(e.message, 'error');
  }
}

/* =========================================================
   Immersive view
   ========================================================= */
function openNowPlaying() {
  if (!S.npOpen) {
    S.npOpen = true;
    np.hidden = false;
    document.body.classList.add('np-open');
    visuals.resize();
    requestAnimationFrame(() => lyrics.recenter());
    if (Settings.get('background') === 'video') ambientVideo.play().catch(() => {});
    bumpIdle();
  }
  if (Settings.get('autoFullscreen') && !document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}
function closeNowPlaying() {
  if (!S.npOpen) return;
  S.npOpen = false;
  np.hidden = true;
  document.body.classList.remove('np-open');
  ambientVideo.pause();
  toggleVideoPop(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
  $('#np-fs').innerHTML = icon(document.fullscreenElement ? 'min' : 'max');
  setTimeout(() => { visuals.resize(); lyrics.recenter(); }, 120);
});

let idleTimer = null;
function bumpIdle() {
  np.classList.remove('idle');
  clearTimeout(idleTimer);
  if (!Settings.get('hideIdle')) return;
  idleTimer = setTimeout(() => {
    if (S.npOpen && !$('#settings').classList.contains('open') && $('#video-pop').hidden
      && !np.querySelector('.np-controls:hover, .np-top:hover, .up-next:hover')) {
      np.classList.add('idle');
    }
  }, 2800);
}
np.addEventListener('pointermove', (e) => {
  bumpIdle();
  const art = $('#np-art');
  const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
  if (Settings.get('artTilt')) {
    art.style.setProperty('--rx', `${nx * 16}deg`);
    art.style.setProperty('--ry', `${-ny * 16}deg`);
  }
  art.style.setProperty('--sx', `${50 + nx * 90}%`);
  art.style.setProperty('--sy', `${50 + ny * 90}%`);
});

// Cursor light on glass panels
let spotEl = null;
document.addEventListener('pointermove', (e) => {
  if (!Settings.get('spotlight')) return;
  const g = e.target.closest?.('.glass-strong');
  if (spotEl && spotEl !== g) { spotEl.style.removeProperty('--lx'); spotEl.style.removeProperty('--ly'); }
  spotEl = g;
  if (!g) return;
  const r = g.getBoundingClientRect();
  g.style.setProperty('--lx', `${e.clientX - r.left}px`);
  g.style.setProperty('--ly', `${e.clientY - r.top}px`);
}, { passive: true });

const VIZ_ORDER = ['bars', 'mirror', 'wave', 'circle', 'dots', 'off'];
const BG_ORDER = ['room', 'fluid', 'canvas', 'color', 'art-mesh', 'art', 'mesh', 'solid', 'video'];
const LY_ORDER = ['fluid', 'spotify', 'karaoke', 'cinema'];
const LED_ORDER = ['flow', 'mirror', 'chase', 'breathe', 'rainbow', 'off'];
function cycle(key, order, label) {
  const next = order[(order.indexOf(Settings.get(key)) + 1) % order.length];
  Settings.set(key, next);
  toast(`${label}: ${next}`, 'info', 1600);
}

function updateAudioBadge() {
  $('#np-audio-src span').textContent = AudioBus.label;
  $('#np-capture').classList.toggle('on', !!AudioBus.capture);
}
AudioBus.onchange = updateAudioBadge;

async function toggleCapture() {
  if (AudioBus.capture) {
    AudioBus.stopCapture();
    toast('Stopped listening to system audio.', 'info', 2500);
  } else {
    try {
      await AudioBus.captureSystem();
      toast('Visualizer now reacts to your real system audio ✦', 'success', 4000);
    } catch (e) {
      if (e.name !== 'NotAllowedError') toast(e.message, 'error', 8000);
    }
  }
  updateAudioBadge();
}

/* =========================================================
   Render loop
   ========================================================= */
function loop(now) {
  requestAnimationFrame(loop);
  const s = player.state;
  const t = now / 1000;
  if (!s) { if (S.npOpen) visuals.frame(t, false); return; }
  const pos = player.position();
  const dur = s.duration || 0;
  if (!S.dragging) {
    const pct = dur ? clamp(pos / dur) * 100 : 0;
    for (const p of $$('[data-seek]')) p.style.setProperty('--w', `${pct}%`);
  }
  const sec = Math.floor(pos / 1000);
  if (sec !== S.lastSec) {
    S.lastSec = sec;
    $$('.t-cur').forEach((e) => { e.textContent = fmtTime(pos); });
    $$('.t-dur').forEach((e) => { e.textContent = fmtTime(dur); });
    const showNext = Settings.get('upNext') && !!S.upNext && dur > 0 && dur - pos < 20000 && dur - pos > 600;
    if (showNext !== S.upNextShown) { S.upNextShown = showNext; $('#up-next').classList.toggle('show', showNext); }
  }
  if (S.npOpen) {
    lyrics.update(pos + Settings.get('lyricsOffset'));
    visuals.frame(t, !s.paused);
    videoLayer.sync(pos, s.paused, now);
  }
}

function wireSeekBars() {
  for (const bar of $$('[data-seek]')) {
    let ratio = 0;
    const at = (e) => { const r = bar.getBoundingClientRect(); ratio = clamp((e.clientX - r.left) / r.width); bar.style.setProperty('--w', `${ratio * 100}%`); };
    bar.addEventListener('pointerdown', (e) => {
      if (!player.state) return;
      S.dragging = true;
      bar.setPointerCapture(e.pointerId);
      at(e);
    });
    bar.addEventListener('pointermove', (e) => { if (S.dragging) at(e); });
    const end = () => {
      if (!S.dragging) return;
      S.dragging = false;
      player.seek(ratio * (player.state?.duration || 0));
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }
}

/* =========================================================
   Screens
   ========================================================= */
function showConnect() {
  $('#library').hidden = true;
  closeNowPlaying();
  $('#connect').hidden = false;
  $('#redirect-uri').textContent = REDIRECT_URI;
  $('#client-id').value = Auth.getClientId();
}

async function startDemo() {
  S.mode = 'demo';
  localStorage.setItem('aura.mode', 'demo');
  document.body.classList.add('mode-demo');
  $('#connect').hidden = true;
  $('#library').hidden = false;
  $('#user-chip').innerHTML = '<span class="ph" title="Demo mode">✦</span>';
  $('#search').placeholder = 'Filter test media…';
  await openView('demo');
}

async function startSpotify() {
  S.mode = 'spotify';
  localStorage.setItem('aura.mode', 'spotify');
  document.body.classList.remove('mode-demo');
  $('#connect').hidden = true;
  $('#library').hidden = false;
  player.enableSpotify();
  openView('liked');
  loadPlaylists();
  try {
    const me = (S.user = await Spotify.me());
    const avatar = me.images?.[0]?.url;
    $('#user-chip').innerHTML = `${avatar ? `<img src="${esc(avatar)}" alt="">` : `<span class="ph">${esc((me.display_name || '?')[0])}</span>`}<span>${esc(me.display_name || me.id)}</span>`;
  } catch (e) {
    handleAuthProblem(e);
  }
}

/* =========================================================
   Event wiring
   ========================================================= */
function wire() {
  // connect screen
  $('#btn-copy-redirect').addEventListener('click', () => {
    navigator.clipboard.writeText(REDIRECT_URI).then(() => toast('Redirect URI copied', 'success', 2000));
  });
  $('#btn-connect').addEventListener('click', () => {
    const id = $('#client-id').value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) return toast('That doesn’t look like a Spotify Client ID (32 letters/numbers).', 'error');
    Auth.setClientId(id);
    Auth.login().catch((e) => toast(e.message, 'error'));
  });
  $('#client-id').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-connect').click(); });
  $('#btn-demo').addEventListener('click', () => startDemo());
  $('#btn-connect-side').addEventListener('click', () => { localStorage.removeItem('aura.mode'); showConnect(); });
  $('#btn-logout').addEventListener('click', () => {
    Auth.logout();
    localStorage.removeItem('aura.mode');
    location.href = '/';
  });

  // library
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) openView(b.dataset.view); });
  $('#search').addEventListener('input', debounce(applyFilter, 120));
  $('#search').addEventListener('keydown', (e) => {
    const q = e.target.value.trim();
    if (e.key === 'Enter' && q && S.mode === 'spotify') openView('search', { q });
  });
  $('#track-list').addEventListener('click', (e) => {
    const item = e.target.closest('.row, .gcard');
    if (item && !item.classList.contains('skeleton')) playFrom(S.filtered, Number(item.dataset.i));
  });
  $('#view-toggle').addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (b) Settings.set('libraryView', b.dataset.lv); });
  $('#content').addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', $('#content').scrollTop > 8), { passive: true });
  $('#btn-play-all').addEventListener('click', () => playFrom(S.filtered, 0));
  $('#btn-shuffle-all').addEventListener('click', () => {
    if (!S.filtered.length) return;
    playFrom(S.filtered, Math.floor(Math.random() * S.filtered.length));
    setTimeout(() => player.setShuffle(true), 1200);
  });
  $('#mini-open').addEventListener('click', openNowPlaying);
  $('#mini-immersive').addEventListener('click', openNowPlaying);

  // transport buttons (dock + immersive)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'toggle') player.toggle();
    else if (act === 'next') player.next();
    else if (act === 'prev') player.prev();
    else if (act === 'shuffle') player.setShuffle(!player.state?.shuffle);
    else if (act === 'repeat') player.cycleRepeat();
  });
  wireSeekBars();
  const vol = $('#volume');
  vol.value = player.volume;
  vol.addEventListener('input', () => player.setVolume(Number(vol.value)));
  $('#up-next').addEventListener('click', () => player.next());

  // immersive top bar
  $('#np-close').addEventListener('click', closeNowPlaying);
  $('#np-fs').addEventListener('click', toggleFullscreen);
  $('#np-settings').addEventListener('click', toggleSettings);
  $('#np-lyrics-btn').addEventListener('click', () => Settings.set('showLyrics', !Settings.get('showLyrics')));
  $('#np-viz').addEventListener('click', () => cycle('visualizer', VIZ_ORDER, 'Visualizer'));
  $('#np-capture').addEventListener('click', toggleCapture);
  $('#np-audio-src').addEventListener('click', toggleCapture);
  $('#np-video').addEventListener('click', () => toggleVideoPop());
  $('#np-video-badge').addEventListener('click', () => toggleVideoPop(true));

  // video popover
  $('#vp-close').addEventListener('click', () => toggleVideoPop(false));
  $('#vp-yt-apply').addEventListener('click', () => {
    const id = parseYouTube($('#vp-yt').value);
    if (!id) return toast('That doesn’t look like a YouTube link.', 'error');
    setTrackVideo({ type: 'youtube', src: id, name: 'YouTube video', offset: 0 });
  });
  $('#vp-yt').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#vp-yt-apply').click(); });
  $('#vp-yt-find').addEventListener('click', async () => {
    const t = S.current;
    if (!t) return;
    const key = Settings.get('ytKey');
    if (!key) {
      toast('Add a free YouTube Data API key in Customize → Video first, or use “Search YouTube” and paste a link.', 'info', 8000);
      return;
    }
    try {
      const entry = await TrackVideos.youtubeSearch(t, key);
      if (!entry) return toast('No embeddable music video found.', 'info');
      setTrackVideo(entry);
      toast(`Found: ${entry.name}`, 'success', 3000);
    } catch (err) { toast(err.message, 'error', 7000); }
  });
  $('#vp-offset').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('#vp-offset-val').textContent = `${v > 0 ? '+' : ''}${v.toFixed(1)} s`;
    if (S.current && S.videoEntry) {
      S.videoEntry.offset = v;
      if (TrackVideos.get(S.current)) TrackVideos.setOffset(S.current, v);
      else TrackVideos.set(S.current, { ...S.videoEntry });
    }
  });
  $('#vp-remove').addEventListener('click', () => { setTrackVideo(null); toast('Video removed for this track', 'info', 2000); });

  // settings drawer
  $('#btn-settings-lib').addEventListener('click', toggleSettings);
  $('#settings-close').addEventListener('click', closeSettings);
  $('#scrim').addEventListener('click', closeSettings);
  $('#settings-reset').addEventListener('click', () => { Settings.reset(); toast('Settings reset', 'info', 2000); });
  $('#settings-export').addEventListener('click', () => {
    const data = { ...Settings.all(), ytKey: '' };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'aura-settings.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#settings-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { const d = JSON.parse(await file.text()); delete d.ytKey; Settings.patch(d); toast('Settings imported', 'success', 2000); }
    catch { toast('That file isn’t a valid Aura settings file.', 'error'); }
    e.target.value = '';
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || !S.mode) return;
    const k = e.key.toLowerCase();
    const handled = {
      ' ': () => player.toggle(),
      arrowright: () => player.seek(player.position() + 10000),
      arrowleft: () => player.seek(player.position() - 10000),
      arrowup: () => { const v = clamp(player.volume + 0.05); player.setVolume(v); $('#volume').value = v; },
      arrowdown: () => { const v = clamp(player.volume - 0.05); player.setVolume(v); $('#volume').value = v; },
      n: () => player.next(),
      p: () => player.prev(),
      f: () => toggleFullscreen(),
      i: () => (S.npOpen ? closeNowPlaying() : openNowPlaying()),
      l: () => Settings.set('showLyrics', !Settings.get('showLyrics')),
      v: () => cycle('visualizer', VIZ_ORDER, 'Visualizer'),
      b: () => cycle('background', BG_ORDER, 'Background'),
      y: () => cycle('lyricsStyle', LY_ORDER, 'Lyrics style'),
      e: () => cycle('edgeLights', LED_ORDER, 'LED strip'),
      a: () => { Settings.set('ambilight', !Settings.get('ambilight')); toast(`Ambilight ${Settings.get('ambilight') ? 'on' : 'off'}`, 'info', 1400); },
      s: () => toggleSettings(),
      escape: () => {
        if ($('#settings').classList.contains('open')) closeSettings();
        else if (!$('#video-pop').hidden) toggleVideoPop(false);
        else if (S.npOpen && !document.fullscreenElement) closeNowPlaying();
      },
    }[k];
    if (!handled) return;
    e.preventDefault();
    handled();
    if (S.npOpen) bumpIdle();
  });

  // clock
  const clock = () => { $('#np-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  clock();
  setInterval(clock, 5000);
}

/* =========================================================
   Boot
   ========================================================= */
async function boot() {
  Settings.load();
  buildSettingsPanel();
  Settings.subscribe((changed) => applySettings(changed));
  // Liquid glass refraction on the floating glass surfaces
  liquidGlass($('#mini'), { bezel: 24, scale: 54 });
  liquidGlass($('#np-dock'), { bezel: 22, scale: 50 });
  liquidGlass($('#np-actions'), { bezel: 16, scale: 36 });
  liquidGlass($('#np-close'), { bezel: 14, scale: 30 });
  liquidGlass($('#up-next'), { bezel: 22, scale: 46 });
  liquidGlass($('#video-pop'), { bezel: 26, scale: 46 });
  liquidGlass($('#settings'), { bezel: 28, scale: 44 });
  liquidGlass($('.connect-card'), { bezel: 30, scale: 50 });
  applySettings();
  setPalette(paletteFromHex('#8b5cf6'));
  wire();
  visuals.resize();
  updateAudioBadge();
  requestAnimationFrame(loop);

  const params = new URLSearchParams(location.search);
  try {
    if (await Auth.handleCallback()) toast('Connected to Spotify ✦', 'success', 3000);
  } catch (e) {
    toast(e.message, 'error', 9000);
  }

  // ?demo opens the test media directly; ?demo&play=N also starts track N (handy for testing)
  if (params.has('demo')) {
    await startDemo();
    if (params.has('play')) playFrom(S.filtered, Number(params.get('play')) || 0);
    if (params.has('settings')) openSettings();
    return;
  }
  if (Auth.isLoggedIn()) startSpotify();
  else if (localStorage.getItem('aura.mode') === 'demo') startDemo();
  else showConnect();
}

boot();
