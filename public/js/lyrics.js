/*
 * Lyrics: fetching (LRCLIB via the local server), LRC parsing (including enhanced
 * word-timed LRC), and an animated view with:
 *   - Apple-Music-style staggered spring scrolling (each line follows with a small delay)
 *   - word-by-word highlighting (real word timings when available, estimated otherwise)
 *   - breathing interlude dots during instrumental gaps
 */
import { el, esc } from './ui.js';

const cache = new Map();

/* ---------- spring easing (CSS linear() when supported) ---------- */
function springEasing(zeta = 0.74, omega = 10, n = 40) {
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    pts.push(i === n ? 1 : +v.toFixed(4));
  }
  return `linear(${pts.join(', ')})`;
}
const SPRING = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)')
  ? springEasing() : 'cubic-bezier(.2, .9, .25, 1.06)';
document.documentElement.style.setProperty('--ly-ease', SPRING);

/* ---------- parsing ---------- */
const TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TIME = /<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>([^<]*)/g;
const toMs = (m, s) => (Number(m) * 60 + parseFloat(String(s).replace(':', '.'))) * 1000;

export function parseLRC(text) {
  const out = [];
  let offset = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = Number(off[1]); continue; }
    const tags = [...raw.matchAll(TIME)];
    if (!tags.length) continue;
    const body = raw.replace(TIME, '').replace(/\[[^\]]*\]/g, '');
    let words = null;
    if (/<\d{1,3}:\d{1,2}/.test(body)) {
      words = [...body.matchAll(WORD_TIME)]
        .map((m) => ({ t: toMs(m[1], m[2]) - offset, text: m[3].trim() }))
        .filter((w) => w.text);
    }
    const line = (words ? words.map((w) => w.text).join(' ') : body).replace(/<[^>]*>/g, '').trim();
    for (const t of tags) {
      out.push({ time: Math.max(0, toMs(t[1], t[2]) - offset), text: line, words: words?.length ? words : null });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

export async function loadLyrics(track) {
  if (track.source === 'demo') {
    if (track.lrc) return { lines: parseLRC(track.lrc), synced: true, source: 'Test media' };
    return { instrumental: true };
  }
  if (cache.has(track.id)) return cache.get(track.id);
  const q = new URLSearchParams({
    track: track.name,
    artist: track.artistList?.[0] || track.artists || '',
    album: track.album || '',
    duration: Math.round((track.duration || 0) / 1000),
  });
  let res;
  try {
    const j = await (await fetch(`/api/lyrics?${q}`)).json();
    if (j.synced) res = { lines: parseLRC(j.synced), synced: true, source: j.source };
    else if (j.plain) res = { lines: j.plain.split(/\r?\n/).map((text) => ({ time: null, text })), synced: false, source: j.source };
    else if (j.instrumental) res = { instrumental: true };
    else if (j.error) res = { error: j.error };
    else res = { notFound: true };
  } catch (e) {
    res = { error: e.message };
  }
  if (!res.error) cache.set(track.id, res);
  return res;
}

/* ---------- view ---------- */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class LyricsView {
  constructor(root, inner, { onSeek } = {}) {
    this.root = root;
    this.inner = inner;
    this.lines = [];
    this.els = [];
    this.active = -1;
    this.synced = false;
    this.opts = { wordSync: true, spring: true };
    inner.addEventListener('click', (e) => {
      const line = e.target.closest('.ly');
      if (line && this.synced && line.dataset.t) onSeek?.(Number(line.dataset.t));
    });
    new ResizeObserver(() => this.layout(true)).observe(root);
  }

  configure(opts) {
    const changed = opts.wordSync !== this.opts.wordSync;
    this.opts = { ...this.opts, ...opts };
    if (changed && this.active >= 0) this.clearWords(this.active);
  }

  message(html) {
    this.lines = []; this.els = []; this.active = -1; this.synced = false;
    this.root.classList.add('empty');
    this.root.classList.remove('unsynced');
    this.inner.innerHTML = `<div class="ly-msg">${html}</div>`;
  }

  loading() { this.message('<span class="ly-dots"><i></i><i></i><i></i></span>'); }

  set(res) {
    if (res.instrumental) return this.message('♪ Instrumental');
    if (res.notFound) return this.message('No lyrics found for this track');
    if (res.error) return this.message('Lyrics unavailable right now');
    this.root.classList.remove('empty');
    this.root.classList.toggle('unsynced', !res.synced);
    this.synced = res.synced;
    this.active = -1;
    let lines = res.lines.map((l) => ({ ...l, gap: res.synced && !l.text }));
    if (res.synced && lines.length && lines[0].time > 3500) lines.unshift({ time: 0, text: '', gap: true });
    this.lines = lines;

    const frag = document.createDocumentFragment();
    this.els = lines.map((l) => {
      const d = el('div', { class: `ly${l.gap ? ' gap' : ''}`, 'data-t': l.time ?? undefined });
      if (l.gap) {
        d.innerHTML = '<span class="w dot"></span><span class="w dot"></span><span class="w dot"></span>';
      } else if (!res.synced) {
        d.textContent = l.text || ' ';
      } else {
        const tokens = l.words ? l.words.map((w) => w.text) : l.text.split(/\s+/).filter(Boolean);
        tokens.forEach((tok, i) => {
          if (i) d.append(' ');
          d.append(el('span', { class: 'w' }, tok));
        });
      }
      d._words = [...d.querySelectorAll('.w')];
      frag.append(d);
      return d;
    });
    this.credit = el('div', { class: 'ly-credit', html: `Lyrics · ${esc(res.source || '')}` });
    frag.append(this.credit);
    this.inner.replaceChildren(frag);
    this.root.scrollTop = 0;
    if (this.synced) {
      this.computeTimings();
      this.setActive(-1, true);
    }
  }

  // Start/end time of every word: real timings from enhanced LRC, otherwise spread by word length.
  computeTimings() {
    const L = this.lines;
    L.forEach((l, i) => {
      const start = l.time;
      const next = L[i + 1]?.time ?? start + 5000;
      const dur = Math.max(300, Math.min(next - start, 12000));
      const words = this.els[i]._words;
      if (l.words && l.words.length === words.length) {
        l.wt = l.words.map((w, k) => [w.t, l.words[k + 1]?.t ?? Math.min(next, w.t + 1200)]);
        return;
      }
      const span = l.gap ? dur * 0.95 : dur * 0.86;
      const weights = words.map((w) => (l.gap ? 1 : w.textContent.length + 1.6));
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      let acc = start;
      l.wt = weights.map((w) => {
        const s = acc;
        acc += (w / total) * span;
        return [s, acc];
      });
    });
  }

  update(pos) {
    if (!this.synced || !this.lines.length) return;
    let lo = 0, hi = this.lines.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.lines[mid].time <= pos) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx !== this.active) this.setActive(idx);
    if (idx < 0) return;
    const line = this.lines[idx];
    const elx = this.els[idx];
    if (line.gap || this.opts.wordSync) {
      const words = elx._words;
      for (let k = 0; k < words.length; k++) {
        const [s, e] = line.wt[k];
        const p = clamp01((pos - s) / Math.max(1, e - s));
        const w = words[k];
        if (Math.abs((w._p ?? -1) - p) > 0.004) {
          w._p = p;
          w.style.setProperty('--wp', p.toFixed(3));
          w.classList.toggle('singing', p > 0 && p < 1);
        }
      }
    }
    // line-level progress (used by line fill when word sync is off)
    const [s0] = line.wt[0] || [line.time];
    const eN = line.wt[line.wt.length - 1]?.[1] ?? line.time + 3000;
    elx.style.setProperty('--p', clamp01((pos - s0) / Math.max(1, eN - s0)).toFixed(3));
  }

  clearWords(i) {
    const e = this.els[i];
    if (!e) return;
    e.style.removeProperty('--p');
    e._words.forEach((w) => { w._p = undefined; w.style.removeProperty('--wp'); w.classList.remove('singing'); });
  }

  setActive(i, instant = false) {
    if (i === this.active && !instant) return;
    const prev = this.active;
    if (prev >= 0) {
      this.els[prev]?.classList.remove('active');
      this.clearWords(prev);
    }
    this.active = i;
    const spring = this.opts.spring && !instant;
    const forward = i >= prev;
    this.els.forEach((e, j) => {
      const d = j - i;
      e.dataset.d = i < 0 ? Math.min(j + 1, 6) : Math.min(Math.abs(d), 6);
      e.classList.toggle('past', j < i);
      e.classList.toggle('next', j === i + 1);
      // Wave: lines below the new active line follow one after another.
      const order = forward ? d + 1 : -d + 1;
      e.style.transitionDelay = spring && order > 0 ? `${Math.min(order, 9) * 48}ms` : '0ms';
    });
    this.els[i]?.classList.add('active');
    this.layout(instant);
  }

  layout(instant = false) {
    if (!this.synced || !this.els.length) return;
    const target = this.els[Math.max(0, this.active)];
    if (!target) return;
    const anchor = this.root.clientHeight * 0.38;
    const shift = anchor - (target.offsetTop + target.offsetHeight / 2);
    if (instant) this.root.classList.add('instant');
    for (const e of this.els) e.style.translate = `0 ${shift.toFixed(1)}px`;
    if (this.credit) this.credit.style.translate = `0 ${shift.toFixed(1)}px`;
    if (instant) {
      void this.root.offsetHeight;
      requestAnimationFrame(() => this.root.classList.remove('instant'));
    }
  }

  recenter() { this.layout(true); }
}
