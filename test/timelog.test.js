// This file lives in both Lapse and Nook, next to the shared timelog.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/timelog.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime(); // November 2026, local time
const entry = (id, ...segs) => ({ id, segs, frames: 10, interval: 5 });

test('a session past midnight counts on both days', () => {
  const byDay = T.msByDay([entry('a', [at(9, 23, 30), at(10, 0, 45)])]);
  assert.equal(byDay.get('2026-11-09'), 30 * 60000);
  assert.equal(byDay.get('2026-11-10'), 45 * 60000);
});

test('pauses are not counted', () => {
  const e = entry('a', [at(9, 9), at(9, 10)], [at(9, 11), at(9, 11, 30)]);
  assert.equal(T.entryMs(e), 90 * 60000);
});

test('minutes by hour split across the hour', () => {
  const hours = T.minutesByHour([entry('a', [at(9, 9, 40), at(9, 11, 10)])]);
  assert.equal(hours[9], 20);
  assert.equal(hours[10], 60);
  assert.equal(hours[11], 10);
});

test('computeStats: today, week, streak, total, best hour', () => {
  const log = [
    entry('a', [at(7, 14), at(7, 15)]),
    entry('b', [at(8, 14), at(8, 14, 30)]),
    entry('c', [at(9, 9), at(9, 9, 20)]),
    entry('old', [at(1, 14), at(1, 16)]),
  ];
  const s = T.computeStats(log, at(9, 20));
  assert.equal(s.todayMin, 20);
  assert.equal(s.weekMin, 110);
  assert.equal(s.streak, 3);
  assert.equal(s.totalMin, 230);
  assert.equal(s.sessions, 4);
  assert.equal(s.bestHour, 14);
  assert.equal(s.days.length, 7);
  assert.equal(s.days[6].minutes, 20);
});

test('streak survives a day with nothing yet today, and breaks after a gap', () => {
  const byDay = T.msByDay([entry('a', [at(7, 9), at(7, 10)]), entry('b', [at(8, 9), at(8, 10)])]);
  assert.equal(T.streakDays(byDay, at(9, 8)), 2);
  assert.equal(T.streakDays(byDay, at(10, 8)), 0);
});

test('sync round trip keeps only the shared fields', () => {
  const log = [{ ...entry('a', [at(9, 9), at(9, 10)]), recMs: 3600000, thumb: 'data:image/jpeg;base64,xyz' }];
  const code = T.encodeSync(log);
  assert.ok(code.startsWith(T.SYNC_PREFIX));
  assert.ok(!code.includes('thumb'));
  assert.deepEqual(T.parseSync(`  ${code}\n`), [entry('a', [at(9, 9), at(9, 10)])]);
});

test('parseSync rejects junk and drops bad entries', () => {
  assert.equal(T.parseSync('hello'), null);
  assert.equal(T.parseSync(`${T.SYNC_PREFIX}{not json`), null);
  assert.equal(T.parseSync(`${T.SYNC_PREFIX}{"a":1}`), null);
  const mixed = [
    entry('ok', [at(9, 9), at(9, 10)]),
    { id: 'backwards', segs: [[at(9, 10), at(9, 9)]] },
    { id: 'tiny-times', segs: [[5, 10]] },
    { id: 7, segs: [[at(9, 9), at(9, 10)]] },
  ];
  const out = T.parseSync(T.SYNC_PREFIX + JSON.stringify(mixed));
  assert.deepEqual(out.map((e) => e.id), ['ok']);
});

test('mergeLog adds, updates, and ignores repeats', () => {
  const a = entry('a', [at(9, 9), at(9, 10)]);
  const b = entry('b', [at(8, 9), at(8, 10)]);
  const first = T.mergeLog([], [a, b]);
  assert.equal(first.added, 2);
  assert.deepEqual(first.list.map((e) => e.id), ['b', 'a']);
  const again = T.mergeLog(first.list, [a, b]);
  assert.equal(again.added + again.updated, 0);
  const grown = { ...a, segs: [...a.segs, [at(9, 11), at(9, 12)]] };
  const third = T.mergeLog(again.list, [grown]);
  assert.equal(third.updated, 1);
  assert.equal(T.entryMs(third.list.find((e) => e.id === 'a')), 2 * 3600000);
});

test('formatting', () => {
  assert.equal(T.fmtMinutes(45), '45m');
  assert.equal(T.fmtMinutes(120), '2h');
  assert.equal(T.fmtMinutes(135), '2h 15m');
  assert.equal(T.fmtHour(0), '12 am');
  assert.equal(T.fmtHour(14), '2 pm');
});
