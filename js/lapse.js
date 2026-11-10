// Pure helpers: no DOM, so they can be tested in Node.

export const FPS = 30;              // playback speed of the finished video
export const INTERVALS = [2, 5, 10, 30, 60]; // seconds between shots
export const KEY_EVERY = 60;        // keyframe every 2 s of video

// Drift-free scheduling: shots land on segStart + n * interval.
// If a shot ran late, skip ahead instead of bunching shots together.
export function nextShot(segStart, intervalMs, now) {
  const n = Math.floor((now - segStart) / intervalMs) + 1;
  return { n, delay: segStart + n * intervalMs - now };
}

// Microsecond timestamps for frame i at a fixed fps (WebCodecs units).
export const frameTimestamp = (i, fps = FPS) => Math.round((i * 1e6) / fps);
export const frameDuration = (i, fps = FPS) => frameTimestamp(i + 1, fps) - frameTimestamp(i, fps);
export const videoSeconds = (frames, fps = FPS) => frames / fps;

// Scale so the long side is at most maxLong, and keep both sides even (H.264 needs it).
export function fitSize(w, h, maxLong = 1920) {
  const s = Math.min(1, maxLong / Math.max(w, h));
  const even = (n) => Math.max(2, Math.floor((n * s) / 2) * 2);
  return { w: even(w), h: even(h) };
}

// Source crop that fills dw x dh without stretching (CSS object-fit: cover).
export function coverRect(sw, sh, dw, dh) {
  const s = Math.max(dw / sw, dh / sh);
  const w = dw / s;
  const h = dh / s;
  return { sx: (sw - w) / 2, sy: (sh - h) / 2, sw: w, sh: h };
}

// Lowest H.264 level that fits the frame size at 30 fps.
export function avcLevel(w, h) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  if (mbs <= 3600) return '1f'; // 3.1, up to 720p
  if (mbs <= 8192) return '28'; // 4.0, up to 1080p
  if (mbs <= 8704) return '2a'; // 4.2
  if (mbs <= 22080) return '33'; // 5.1
  return '34'; // 5.2
}

// High, then Main, then Constrained Baseline.
export function codecCandidates(w, h) {
  const level = avcLevel(w, h);
  return ['6400', '4d00', '42e0'].map((p) => `avc1.${p}${level}`);
}

export function bitrateFor(w, h, fps = FPS) {
  return Math.round(Math.min(12e6, Math.max(2e6, w * h * fps * 0.15)));
}

// 0:07, 12:04, 1:02:09
export function formatClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// 24 s, 3 min, 1 h 20 min
export function formatSpan(sec) {
  if (sec < 1) return '<1 s';
  if (sec < 59.5) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const hourBecomes = (intervalS, fps = FPS) => formatSpan(3600 / intervalS / fps);

export const intervalLabel = (s) => (s < 60 ? `Every ${s}s` : `Every ${s / 60} min`);

export function nextInterval(cur) {
  const i = INTERVALS.indexOf(cur);
  return INTERVALS[(i + 1) % INTERVALS.length];
}

export function fileName(startedAt) {
  const d = new Date(startedAt);
  const p = (n) => String(n).padStart(2, '0');
  return `lapse-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.mp4`;
}
