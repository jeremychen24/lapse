// Lapse-only dashboard numbers (month grid, weekly review, badges), built on timelog.js.
// timelog.js is shared with Nook word-for-word, so Lapse-only pieces live here.

import { msByDay, dayKey, entryMs, entryStart } from './timelog.js';

const MIN = 60000;

// Monday 00:00 of the week that `ms` falls in.
export function weekStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// Timelapses started on each day.
function startsByDay(entries) {
  const n = new Map();
  for (const e of entries) n.set(dayKey(entryStart(e)), (n.get(dayKey(entryStart(e))) ?? 0) + 1);
  return n;
}

// One month as weeks (Monday first) of days: { key, day, minutes, sessions, inMonth }.
export function monthGrid(entries, year, month) {
  const byDay = msByDay(entries);
  const starts = startsByDay(entries);
  const last = new Date(year, month + 1, 0);
  const d = new Date(year, month, 1);
  d.setDate(1 - ((d.getDay() + 6) % 7)); // back to Monday
  const weeks = [];
  while (d <= last) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const key = dayKey(d.getTime());
      week.push({ key, day: d.getDate(), minutes: Math.round((byDay.get(key) ?? 0) / MIN), sessions: starts.get(key) ?? 0, inMonth: d.getMonth() === month });
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// Last week (Monday to Sunday), with the week before for comparison.
export function weekReview(entries, now = Date.now()) {
  const thisWeek = weekStart(now);
  const lastWeek = weekStart(thisWeek - 1);
  const weekBefore = weekStart(lastWeek - 1);
  const byDay = msByDay(entries);
  const daysFrom = (start) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return { label: d.toLocaleDateString(undefined, { weekday: 'long' }), minutes: Math.round((byDay.get(dayKey(d.getTime())) ?? 0) / MIN) };
    });
  const days = daysFrom(lastWeek);
  const sum = (list) => list.reduce((s, d) => s + d.minutes, 0);
  const inWeek = entries.filter((e) => entryStart(e) >= lastWeek && entryStart(e) < thisWeek);
  const bestDay = days.reduce((best, d) => (d.minutes > best.minutes ? d : best), days[0]);
  return {
    start: lastWeek,
    end: thisWeek - 1,
    minutes: sum(days),
    before: sum(daysFrom(weekBefore)),
    sessions: inWeek.length,
    bestDay: bestDay.minutes ? bestDay : null,
    longest: Math.round(Math.max(0, ...inWeek.map(entryMs)) / MIN),
  };
}

// The most days in a row ever with at least a minute recorded.
export function longestStreak(byDay) {
  const days = [...byDay].filter(([, ms]) => ms >= MIN).map(([k]) => k).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of days) {
    const [y, m, d] = key.split('-').map(Number);
    run = prev === dayKey(new Date(y, m - 1, d - 1).getTime()) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}

// ---------- badges: kept once earned, no coins (Lapse has none) ----------

export const BADGES = [
  { id: 'first', icon: '🎬', name: 'First lapse', hint: 'Finish a timelapse', test: (c) => c.sessions >= 1 },
  { id: 'ten', icon: '⭐', name: 'Ten lapses', hint: 'Finish 10 timelapses', test: (c) => c.sessions >= 10 },
  { id: 'fifty', icon: '🌟', name: 'Fifty', hint: 'Finish 50 timelapses', test: (c) => c.sessions >= 50 },
  { id: 'hour', icon: '⏳', name: 'Hour club', hint: 'Record 1 hour in a day', test: (c) => c.bestDay >= 60 },
  { id: 'deep', icon: '🧠', name: 'Deep day', hint: 'Record 3 hours in a day', test: (c) => c.bestDay >= 180 },
  { id: 'marathon', icon: '🏃', name: 'Marathon', hint: 'Record 5 hours in a day', test: (c) => c.bestDay >= 300 },
  { id: 'long', icon: '🎞️', name: 'Long take', hint: 'One timelapse of 2 hours', test: (c) => c.longest >= 120 },
  { id: 'roll', icon: '🔥', name: 'On a roll', hint: 'Record 3 days in a row', test: (c) => c.streak >= 3 },
  { id: 'week', icon: '📅', name: 'Full week', hint: 'Record 7 days in a row', test: (c) => c.streak >= 7 },
  { id: 'month', icon: '🏆', name: 'Unstoppable', hint: 'Record 30 days in a row', test: (c) => c.streak >= 30 },
  { id: 'tenh', icon: '🕙', name: '10 hours', hint: 'Record 10 hours in total', test: (c) => c.total >= 600 },
  { id: 'hundred', icon: '💯', name: '100 hours', hint: 'Record 100 hours in total', test: (c) => c.total >= 6000 },
  { id: 'owl', icon: '🦉', name: 'Night owl', hint: 'Record past 11 PM', test: (c) => c.owl },
  { id: 'bird', icon: '🐦', name: 'Early bird', hint: 'Start before 7 AM', test: (c) => c.bird },
];

// Everything the badge goals look at.
export function badgeContext(entries) {
  const byDay = msByDay(entries);
  const late = (ms) => {
    const h = new Date(ms).getHours();
    return h >= 23 || h < 4;
  };
  return {
    sessions: entries.length,
    bestDay: Math.round(Math.max(0, ...byDay.values()) / MIN),
    longest: Math.round(Math.max(0, ...entries.map(entryMs)) / MIN),
    streak: longestStreak(byDay),
    total: Math.round(entries.reduce((s, e) => s + entryMs(e), 0) / MIN),
    owl: entries.some((e) => e.segs.some(([s, t]) => t - s >= MIN && (late(t) || late(s)))),
    bird: entries.some((e) => {
      const h = new Date(entryStart(e)).getHours();
      return h >= 4 && h < 7;
    }),
  };
}

// Returns { earned, fresh }: the updated map of badge id → when, and the newly earned badges.
export function checkBadges(entries, earned = {}, now = Date.now()) {
  const c = badgeContext(entries);
  const next = { ...earned };
  const fresh = [];
  for (const b of BADGES) {
    if (!next[b.id] && b.test(c)) {
      next[b.id] = now;
      fresh.push(b);
    }
  }
  return { earned: next, fresh };
}
