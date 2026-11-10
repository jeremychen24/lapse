// Timelapse log: stats math and the Lapse → Nook copy-paste sync.
// This file lives in both Lapse and Nook. Keep the two copies identical.
//
// An entry is { id, segs: [[startMs, endMs], ...], frames, interval }.
// segs are wall-clock spans that were really recorded (pauses are gaps),
// so time is counted on the right day and hour even across midnight.
// Lapse also keeps recMs and a thumb on its own entries; those never sync.

export const SYNC_PREFIX = 'lapse-sync:1:';
const MIN = 60000;
const MAX_SEG = 48 * 3600000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Local midnight `back` days before the day of `ms` (calendar math, so DST is handled).
export function dayStart(ms, back = 0) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d.getTime();
}

function nextHour(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

// Cuts every recorded span at the boundaries and adds each piece to its bucket.
function split(entries, boundary, bucket, add) {
  for (const e of entries) {
    for (const [from, to] of e.segs) {
      let s = from;
      while (s < to) {
        const b = Math.min(to, boundary(s));
        add(bucket(s), b - s);
        s = b;
      }
    }
  }
}

export function msByDay(entries) {
  const days = new Map();
  split(entries, (ms) => dayStart(ms, -1), dayKey, (k, ms) => days.set(k, (days.get(k) ?? 0) + ms));
  return days;
}

export function minutesByHour(entries) {
  const hours = Array(24).fill(0);
  split(entries, nextHour, (ms) => new Date(ms).getHours(), (h, ms) => (hours[h] += ms / MIN));
  return hours.map(Math.round);
}

export const entryMs = (e) => e.segs.reduce((sum, [s, t]) => sum + (t - s), 0);
export const entryStart = (e) => e.segs[0]?.[0] ?? 0;

// Days in a row with at least a minute recorded. Still alive today if it ran through yesterday.
export function streakDays(byDay, now) {
  const has = (back) => (byDay.get(dayKey(dayStart(now, back))) ?? 0) >= MIN;
  let back = has(0) ? 0 : 1;
  let n = 0;
  while (has(back)) {
    n++;
    back++;
  }
  return n;
}

export function computeStats(entries, now = Date.now()) {
  const byDay = msByDay(entries);
  const days = [];
  for (let back = 6; back >= 0; back--) {
    const start = dayStart(now, back);
    days.push({ label: DAY_NAMES[new Date(start).getDay()], start, minutes: Math.round((byDay.get(dayKey(start)) ?? 0) / MIN) });
  }
  const hours = minutesByHour(entries);
  const best = Math.max(...hours);
  return {
    todayMin: days[6].minutes,
    weekMin: days.reduce((sum, d) => sum + d.minutes, 0),
    streak: streakDays(byDay, now),
    totalMin: Math.round(entries.reduce((sum, e) => sum + entryMs(e), 0) / MIN),
    sessions: entries.length,
    days,
    hours,
    bestHour: best > 0 ? hours.indexOf(best) : null,
  };
}

// ---------- sync ----------

export function encodeSync(entries) {
  return SYNC_PREFIX + JSON.stringify(entries.map(({ id, segs, frames, interval }) => ({ id, segs, frames, interval })));
}

const isTime = (n) => Number.isFinite(n) && n > 1e12 && n < 1e13;

function clean(e) {
  if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 64 || !Array.isArray(e.segs)) return null;
  const segs = e.segs
    .filter((p) => Array.isArray(p) && isTime(p[0]) && isTime(p[1]) && p[1] >= p[0] && p[1] - p[0] <= MAX_SEG)
    .map(([s, t]) => [s, t]);
  if (!segs.length) return null;
  return {
    id: e.id,
    segs,
    frames: Number.isInteger(e.frames) && e.frames >= 0 ? e.frames : 0,
    interval: Number.isFinite(e.interval) && e.interval > 0 ? e.interval : 0,
  };
}

// Returns clean entries, or null if the text isn't a Lapse code.
export function parseSync(text) {
  const t = String(text ?? '').trim();
  if (!t.startsWith(SYNC_PREFIX)) return null;
  try {
    const list = JSON.parse(t.slice(SYNC_PREFIX.length));
    return Array.isArray(list) ? list.slice(0, 5000).map(clean).filter(Boolean) : null;
  } catch {
    return null;
  }
}

// Adds new entries and replaces changed ones (a session can grow with "Keep recording").
// Sending the same code twice changes nothing.
export function mergeLog(existing, incoming) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  for (const e of incoming) {
    const old = byId.get(e.id);
    if (!old) added++;
    else if (JSON.stringify(old) !== JSON.stringify(e)) updated++;
    else continue;
    byId.set(e.id, e);
  }
  const list = [...byId.values()].sort((a, b) => entryStart(a) - entryStart(b));
  return { list, added, updated };
}

export const fmtMinutes = (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`);
export const fmtHour = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
