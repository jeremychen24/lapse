import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/dash.js';
import { msByDay } from '../js/timelog.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime(); // November 2026; Nov 9 is a Monday
const entry = (id, ...segs) => ({ id, segs, frames: 10, interval: 5 });

test('weekStart is Monday midnight', () => {
  assert.equal(D.weekStart(at(11, 15)), at(9, 0));
  assert.equal(D.weekStart(at(15, 23)), at(9, 0)); // Sunday belongs to the week before it
});

test('monthGrid lays out weeks from Monday with minutes and starts', () => {
  const weeks = D.monthGrid([entry('a', [at(9, 9), at(9, 10, 30)]), entry('b', [at(9, 20), at(9, 20, 30)])], 2026, 10);
  assert.equal(weeks[0][0].key, '2026-10-26'); // Nov 1 2026 is a Sunday
  assert.equal(weeks[0][6].key, '2026-11-01');
  assert.ok(weeks.flat().every((d, i, all) => i === 0 || d.key > all[i - 1].key));
  const nov9 = weeks.flat().find((d) => d.key === '2026-11-09');
  assert.deepEqual([nov9.minutes, nov9.sessions, nov9.inMonth], [120, 2, true]);
  assert.equal(weeks.flat().find((d) => d.key === '2026-10-26').inMonth, false);
});

test('weekReview compares last week with the week before', () => {
  const log = [
    entry('a', [at(3, 9), at(3, 11)]), // Tue of last week (Nov 2–8)
    entry('b', [at(5, 9), at(5, 9, 30)]),
    entry('this-week', [at(9, 9), at(9, 10)]), // not part of last week
    entry('before', [new Date(2026, 9, 28, 9).getTime(), new Date(2026, 9, 28, 10).getTime()]), // Wed Oct 28
  ];
  const r = D.weekReview(log, at(10, 12));
  assert.equal(r.start, at(2, 0));
  assert.equal(r.minutes, 150);
  assert.equal(r.before, 60);
  assert.equal(r.sessions, 2);
  assert.equal(r.bestDay.minutes, 120);
  assert.equal(r.longest, 120);
});

test('longestStreak finds the best run, across a month boundary', () => {
  const byDay = msByDay([
    entry('a', [new Date(2026, 9, 30, 9).getTime(), new Date(2026, 9, 30, 10).getTime()]),
    entry('b', [new Date(2026, 9, 31, 9).getTime(), new Date(2026, 9, 31, 10).getTime()]),
    entry('c', [at(1, 9), at(1, 10)]),
    entry('d', [at(5, 9), at(5, 10)]),
    entry('tiny', [at(6, 9), at(6, 9, 0) + 30000]), // under a minute: doesn't count
  ]);
  assert.equal(D.longestStreak(byDay), 3);
});

test('badges unlock from the log and are kept once earned', () => {
  const log = [
    entry('a', [at(3, 5, 30), at(3, 7, 45)]), // early bird, 2h15 long take, hour club
    entry('b', [at(4, 23, 0), at(4, 23, 30)]), // night owl
    entry('c', [at(5, 9), at(5, 10)]), // 3 days in a row
  ];
  const first = D.checkBadges(log, {}, 111);
  const ids = first.fresh.map((b) => b.id).sort();
  assert.deepEqual(ids, ['bird', 'first', 'hour', 'long', 'owl', 'roll'].sort());
  assert.equal(first.earned.hour, 111);
  const again = D.checkBadges(log, first.earned, 222);
  assert.equal(again.fresh.length, 0);
  assert.equal(again.earned.hour, 111);
  // Kept even if the log shrinks later.
  assert.equal(D.checkBadges([], first.earned).earned.owl, 111);
});

test('badge ids are unique', () => {
  assert.equal(new Set(D.BADGES.map((b) => b.id)).size, D.BADGES.length);
});
