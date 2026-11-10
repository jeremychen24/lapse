import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/lapse.js';

test('nextShot lands on the grid and skips missed slots', () => {
  assert.deepEqual(L.nextShot(1000, 5000, 1000), { n: 1, delay: 5000 });
  assert.deepEqual(L.nextShot(1000, 5000, 5900), { n: 1, delay: 100 });
  // capture ran 12 s late: skip to slot 3 instead of firing twice
  assert.deepEqual(L.nextShot(0, 5000, 12000), { n: 3, delay: 3000 });
});

test('timestamps are monotonic and durations sum exactly', () => {
  let total = 0;
  for (let i = 0; i < 90; i++) {
    assert.ok(L.frameTimestamp(i + 1) > L.frameTimestamp(i));
    total += L.frameDuration(i);
  }
  assert.equal(total, L.frameTimestamp(90));
  assert.equal(L.frameTimestamp(30), 1e6);
});

test('fitSize caps the long side and keeps sides even', () => {
  assert.deepEqual(L.fitSize(1080, 1920), { w: 1080, h: 1920 });
  assert.deepEqual(L.fitSize(3024, 4032), { w: 1440, h: 1920 });
  assert.deepEqual(L.fitSize(641, 481), { w: 640, h: 480 });
});

test('coverRect crops to fill without stretching', () => {
  const r = L.coverRect(1920, 1080, 1080, 1920);
  assert.equal(r.sh, 1080);
  assert.ok(Math.abs(r.sw / r.sh - 1080 / 1920) < 1e-9);
  assert.ok(Math.abs(r.sx - (1920 - r.sw) / 2) < 1e-9);
});

test('codec level fits the frame size', () => {
  assert.equal(L.avcLevel(1280, 720), '1f');
  assert.equal(L.avcLevel(1080, 1920), '28');
  assert.equal(L.avcLevel(1440, 1920), '33');
  assert.deepEqual(L.codecCandidates(1080, 1920), ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']);
});

test('formatting', () => {
  assert.equal(L.formatClock(7000), '0:07');
  assert.equal(L.formatClock(724000), '12:04');
  assert.equal(L.formatClock(3729000), '1:02:09');
  assert.equal(L.formatSpan(0.4), '<1 s');
  assert.equal(L.formatSpan(24), '24 s');
  assert.equal(L.formatSpan(4800), '1 h 20 min');
  assert.equal(L.hourBecomes(5), '24 s');
  assert.equal(L.hourBecomes(2), '1 min');
  assert.equal(L.intervalLabel(60), 'Every 1 min');
  assert.equal(L.nextInterval(60), 2);
  assert.equal(L.nextInterval(5), 10);
});

test('fileName is sortable', () => {
  assert.equal(L.fileName(new Date(2026, 10, 9, 14, 5).getTime()), 'lapse-2026-11-09-1405.mp4');
});
