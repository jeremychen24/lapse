// Screens: boot → intro → ready → countdown → live (dark) → finishing → result
//          plus paused (interrupted) and recover (unfinished session on launch).

import * as L from './lapse.js';
import * as store from './store.js';
import { openCamera, closeCamera, cameraCount } from './camera.js';
import { keepAwake, wakeSupported } from './wake.js';
import { buildVideo, saveVideo } from './export.js';
import * as T from './timelog.js';
import { weekChart, hourChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const cam = $('cam');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { alpha: false });

// ?interval=0.2 speeds things up for testing.
const devInterval = Number(new URLSearchParams(location.search).get('interval')) || 0;

const prefs = { interval: 5, facing: 'user', ...readJSON('lapse.prefs') };
if (!L.INTERVALS.includes(prefs.interval)) prefs.interval = 5;

let stream = null;
let camToken = 0;
let session = null; // { id, w, h, interval, facing, recMs, frames, startedAt, segs: [[start, end], ...] }
let running = false;
let segStart = 0;
let shotTimer = 0;
let busy = false;
let countTimer = 0;
let darkTimer = 0;
let clockTimer = 0;
let wokeAt = 0;
let result = null; // { url, file, saved }

// ---------- small utilities ----------

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem('lapse.prefs', JSON.stringify(prefs)); } catch { /* private mode */ }
}
function getFlag(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function setFlag(key) {
  try { localStorage.setItem(key, '1'); } catch { /* private mode */ }
}
const current = () => document.body.dataset.screen;
function show(name) {
  if (name !== 'live') setDark(false);
  document.body.dataset.screen = name;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const uid = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
const lastSeg = () => session.segs[session.segs.length - 1];
const statsLine = () => `${L.formatClock(session.recMs)} · ${plural(session.frames, 'frame')}`;

// Tap once to arm, again within 3 s to confirm. Keeps destructive actions off a single tap.
function armed(btn, label, armedLabel, action, skip = () => false) {
  btn.textContent = label;
  btn.onclick = () => {
    if (skip() || btn.dataset.armed) {
      delete btn.dataset.armed;
      return action();
    }
    btn.dataset.armed = '1';
    btn.textContent = armedLabel;
    setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = label;
    }, 3000);
  };
}

// ---------- camera ----------

function videoReady() {
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      if (!cam.videoWidth) return;
      clearTimeout(timer);
      cam.removeEventListener('loadeddata', done);
      cam.removeEventListener('resize', done);
      resolve();
    };
    timer = setTimeout(() => {
      cam.removeEventListener('loadeddata', done);
      cam.removeEventListener('resize', done);
      resolve();
    }, 6000);
    cam.addEventListener('loadeddata', done);
    cam.addEventListener('resize', done);
    done();
  });
}

async function openStream(facing) {
  const token = ++camToken;
  closeCamera(stream);
  stream = null;
  const s = await openCamera(facing);
  if (token !== camToken) {
    closeCamera(s);
    throw Object.assign(new Error('stale'), { name: 'Stale' });
  }
  stream = s;
  cam.srcObject = s;
  cam.classList.toggle('mirror', facing === 'user');
  s.getVideoTracks().forEach((t) => t.addEventListener('ended', onCameraLost));
  cam.play().catch(() => {});
  await videoReady();
}

function dropStream() {
  camToken++;
  closeCamera(stream);
  stream = null;
  cam.srcObject = null;
}

function cameraMessage(e) {
  if (e.name === 'NotAllowedError') return 'Camera access is off. Allow it for this site, then try again.';
  if (e.name === 'NotFoundError') return 'No camera found.';
  if (e.name === 'NotSupportedError') return 'This browser can’t use the camera here.';
  return 'The camera didn’t start. Try again.';
}

function onCameraLost() {
  const s = current();
  if (s === 'live' || s === 'countdown') showPaused('The camera stopped.');
  else if (s === 'ready') showReady();
}

// ---------- intro / ready ----------

function showIntro(msg = '') {
  $('camMsg').textContent = msg;
  $('camMsg').hidden = !msg;
  $('startCam').textContent = msg ? 'Try again' : 'Start camera';
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('homeTip').hidden = !(ios && !standalone);
  show('intro');
}

async function showReady() {
  try {
    await openStream(prefs.facing);
  } catch (e) {
    if (e.name !== 'Stale') showIntro(cameraMessage(e));
    return;
  }
  setFlag('lapse.seen');
  renderReady();
  show('ready');
  cameraCount().then((n) => ($('flip').hidden = n < 2));
}

function renderReady() {
  const iv = devInterval || prefs.interval;
  $('interval').textContent = L.intervalLabel(iv);
  $('ratio').textContent = `1 hour → ${L.hourBecomes(iv)} of video`;
}

$('startCam').onclick = showReady;

$('interval').onclick = () => {
  prefs.interval = L.nextInterval(prefs.interval);
  savePrefs();
  renderReady();
};

$('flip').onclick = () => {
  prefs.facing = prefs.facing === 'user' ? 'environment' : 'user';
  savePrefs();
  showReady();
};

$('rec').onclick = async () => {
  if (!stream) return;
  const { w, h } = L.fitSize(cam.videoWidth || 1080, cam.videoHeight || 1920);
  session = {
    id: uid(),
    w, h,
    interval: devInterval || prefs.interval,
    facing: prefs.facing,
    recMs: 0,
    frames: 0,
    startedAt: Date.now(),
    segs: [],
  };
  try {
    await store.clearAll();
    await store.putMeta({ ...session });
  } catch { /* capture will retry the write */ }
  countdown();
};

// ---------- countdown ----------

function countdown() {
  let n = 3;
  $('count').textContent = n;
  $('awakeNote').hidden = wakeSupported();
  show('countdown');
  keepAwake(true);
  clearInterval(countTimer);
  countTimer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      $('count').textContent = n;
      return;
    }
    clearInterval(countTimer);
    show('live');
    beginSegment();
    setDark(true);
  }, 900);
}

$('countdown').onclick = () => {
  clearInterval(countTimer);
  if (session && session.frames === 0) {
    session = null;
    store.clearAll().catch(() => {});
    keepAwake(false);
    renderReady();
    show('ready');
  } else {
    showPaused();
  }
};

// ---------- recording ----------

function recordedMs() {
  if (!session) return 0;
  return session.recMs + (running ? performance.now() - segStart : 0);
}

function beginSegment() {
  running = true;
  segStart = performance.now();
  const now = Date.now();
  session.segs.push([now, now]);
  shoot();
}

async function shoot() {
  if (!running) return;
  clearTimeout(shotTimer);
  await capture();
  if (!running) return;
  const { delay } = L.nextShot(segStart, session.interval * 1000, performance.now());
  shotTimer = setTimeout(shoot, delay);
}

async function capture() {
  if (busy || cam.readyState < 2 || !cam.videoWidth) return;
  busy = true;
  try {
    const { w, h } = session;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    // Drawn un-mirrored, so text behind you reads the right way in the video.
    const r = L.coverRect(cam.videoWidth, cam.videoHeight, w, h);
    ctx.drawImage(cam, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!blob || !running) return;
    const buf = await blob.arrayBuffer();
    lastSeg()[1] = Date.now();
    await store.addFrame(buf, { ...session, frames: session.frames + 1, recMs: recordedMs() });
    session.frames += 1;
    if (!document.body.classList.contains('dark')) renderStats();
  } catch (e) {
    if (e?.name === 'QuotaExceededError') showPaused('Your phone’s storage is full. Finish to save what you have.');
  } finally {
    busy = false;
  }
}

function pauseRecording() {
  if (running) {
    session.recMs = recordedMs();
    lastSeg()[1] = Date.now();
    running = false;
  }
  clearTimeout(shotTimer);
  if (session) store.putMeta({ ...session }).catch(() => {});
}

function renderStats() {
  $('elapsed').textContent = L.formatClock(recordedMs());
  $('frames').textContent = plural(session.frames, 'frame');
}

// ---------- dark mode ----------

function setDark(on) {
  clearTimeout(darkTimer);
  clearInterval(clockTimer);
  document.body.classList.toggle('dark', on);
  if (on && !getFlag('lapse.hinted')) {
    $('darkHint').classList.add('show');
    setFlag('lapse.hinted');
  }
}

function wake() {
  setDark(false);
  wokeAt = performance.now();
  renderStats();
  clockTimer = setInterval(renderStats, 1000);
  darkTimer = setTimeout(() => setDark(true), 5000);
}

$('dark').onclick = wake;
$('live').onclick = (e) => {
  if (!e.target.closest('button')) setDark(true);
};
$('stop').onclick = () => {
  if (performance.now() - wokeAt < 600) return; // ignore a double-tap through the wake tap
  pauseRecording();
  finish();
};

// ---------- interruptions ----------

function showPaused(note = '') {
  pauseRecording();
  clearInterval(countTimer);
  dropStream();
  keepAwake(false);
  $('pausedStats').textContent = statsLine();
  $('pausedNote').textContent = note || 'Recording pauses when you leave the app.';
  show('paused');
}

async function resume() {
  try {
    await openStream(session.facing);
  } catch (e) {
    if (e.name !== 'Stale') showPaused(cameraMessage(e));
    return;
  }
  countdown();
}

$('resume').onclick = resume;
$('pausedFinish').onclick = () => finish();

document.addEventListener('visibilitychange', () => {
  const s = current();
  if (document.hidden) {
    if (s === 'live' || s === 'countdown') showPaused();
    else if (s === 'ready') dropStream();
  } else if (s === 'ready' && !stream) {
    showReady();
  }
});

// ---------- finish / result ----------

function setProgress(p) {
  $('prog').style.width = `${Math.round(p * 100)}%`;
}

async function finish() {
  clearInterval(countTimer);
  dropStream();
  $('finishMsg').hidden = true;
  $('retry').hidden = true;
  $('bar').hidden = false;
  setProgress(0);
  show('finishing');
  keepAwake(true);
  try {
    const keys = await store.frameKeys();
    if (!keys.length) return void (await discard());
    const blob = await buildVideo({
      keys,
      getFrame: store.getFrame,
      width: session.w,
      height: session.h,
      onProgress: setProgress,
    });
    showResult(blob, keys.length);
    logSession(keys);
  } catch (e) {
    console.error(e);
    $('finishMsg').textContent =
      e.message === 'unsupported'
        ? 'This browser can’t make videos. Update to iOS 16.4 or later.'
        : 'Something went wrong making the video. Your shots are safe.';
    $('finishMsg').hidden = false;
    $('retry').hidden = false;
    $('bar').hidden = true;
  } finally {
    keepAwake(false);
  }
}

$('retry').onclick = () => finish();

function clearResult() {
  if (!result) return;
  URL.revokeObjectURL(result.url);
  result = null;
  $('out').removeAttribute('src');
  $('out').load();
}

function showResult(blob, frames) {
  clearResult();
  const url = URL.createObjectURL(blob);
  const file = new File([blob], L.fileName(session.startedAt), { type: 'video/mp4' });
  result = { url, file, saved: false };
  $('out').src = url;
  $('out').play().catch(() => {});
  $('summary').textContent = `${L.formatSpan(L.videoSeconds(frames))} video · ${L.formatSpan(session.recMs / 1000)} recorded`;
  $('save').textContent = 'Save video';
  armed($('new'), 'New', 'Tap again to discard', discard, () => result?.saved);
  show('result');
}

$('save').onclick = async () => {
  if (!result) return;
  const how = await saveVideo(result.file, result.url);
  if (how !== 'cancelled') {
    result.saved = true;
    $('save').textContent = 'Saved';
  }
};

// ---------- stats ----------

const MIN_LOG_MS = 60000; // shorter tries don't count
let logCache = [];

async function makeThumb(buf) {
  const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
  const size = 112;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const r = L.coverRect(bitmap.width, bitmap.height, size, size);
  c.getContext('2d').drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, size, size);
  bitmap.close();
  return c.toDataURL('image/jpeg', 0.7);
}

// One entry per session; finishing again after "Keep recording" updates it.
async function logSession(keys) {
  const segs = session.segs.filter(([s, e]) => e > s).map(([s, e]) => [s, e]);
  if (!segs.length || (session.recMs < MIN_LOG_MS && !devInterval)) return;
  const entry = { id: session.id, segs, frames: keys.length, interval: session.interval, recMs: Math.round(session.recMs), thumb: '' };
  try {
    entry.thumb = await makeThumb(await store.getFrame(keys[Math.floor(keys.length / 2)]));
  } catch { /* stats still work without a picture */ }
  await store.putLog(entry).catch(() => {});
}

async function openStats() {
  dropStream();
  try {
    logCache = await store.getLog();
  } catch {
    logCache = [];
  }
  logCache.sort((a, b) => T.entryStart(b) - T.entryStart(a));
  renderStatsScreen();
  show('stats');
  $('statsBody').scrollTop = 0;
}

function historyRow(e) {
  const start = new Date(T.entryStart(e));
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const thumb = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(e.thumb || '') ? `<img src="${e.thumb}" alt="">` : '<span class="ph"></span>';
  return `<li>${thumb}<div><b>${day} · ${time}</b><small>${L.formatSpan(T.entryMs(e) / 1000)} · ${L.formatSpan(L.videoSeconds(e.frames))} video</small></div></li>`;
}

function renderStatsScreen() {
  const body = $('statsBody');
  if (!logCache.length) {
    body.innerHTML = '<p class="empty">Finish a timelapse of a minute or more and your stats show up here.</p>';
    return;
  }
  const s = T.computeStats(logCache);
  const chart = (svg) => `<div class="chart">${svg}<div class="chart-tip" hidden></div></div>`;
  const tile = (label, value) => `<div class="tile"><span>${label}</span><b>${value}</b></div>`;
  body.innerHTML = `
    <div class="tiles">
      ${tile('Today', T.fmtMinutes(s.todayMin))}
      ${tile('This week', T.fmtMinutes(s.weekMin))}
      ${tile('Streak', plural(s.streak, 'day'))}
      ${tile('Total', T.fmtMinutes(s.totalMin))}
    </div>
    <h2 class="sec">Last 7 days</h2>
    ${chart(weekChart(s.days))}
    <h2 class="sec">Time of day</h2>
    ${chart(hourChart(s.hours, s.bestHour))}
    ${s.bestHour === null ? '' : `<p class="caption">You record the most around ${T.fmtHour(s.bestHour)}</p>`}
    <h2 class="sec">History</h2>
    <ul class="history">${logCache.slice(0, 50).map(historyRow).join('')}</ul>
    <div class="send">
      <button id="sendNook" class="pill">Send to Nook</button>
      <p class="hint">Copies your stats (no photos or video). Then in Nook, open Stats and tap Paste from Lapse.</p>
    </div>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall back to the old way */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* no clipboard */ }
  ta.remove();
  return ok;
}

// Tooltips: hover on a computer, tap on a phone. Every value is also in the hidden tables.
function showTip(e) {
  const target = e.target.closest('[data-tip]');
  const box = e.target.closest('.chart');
  document.querySelectorAll('.chart-tip').forEach((t) => {
    if (!box || !box.contains(t)) t.hidden = true;
  });
  if (!target || !box) return;
  const tip = box.querySelector('.chart-tip');
  const r = target.getBoundingClientRect();
  const frame = box.getBoundingClientRect();
  tip.textContent = target.dataset.tip;
  tip.style.left = `${Math.min(Math.max(r.left + r.width / 2 - frame.left, 40), frame.width - 40)}px`;
  tip.style.top = `${r.top - frame.top + 8}px`;
  tip.hidden = false;
}

$('statsBody').addEventListener('pointerover', showTip);
$('statsBody').addEventListener('pointerdown', showTip);
$('statsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('#sendNook');
  if (!btn) return;
  const ok = await copyText(T.encodeSync(logCache)); // built before any await: iOS needs the tap
  btn.textContent = ok ? 'Copied · now paste in Nook' : 'Couldn’t copy';
  setTimeout(() => (btn.textContent = 'Send to Nook'), 3000);
});
$('statsBtn').onclick = openStats;
$('statsClose').onclick = showReady;

$('more').onclick = () => {
  clearResult();
  resume();
};

async function discard() {
  running = false;
  session = null;
  clearResult();
  await store.clearAll().catch(() => {});
  await showReady();
}

// ---------- launch ----------

$('recoverFinish').onclick = () => finish();
$('recoverResume').onclick = resume;
armed($('recoverDiscard'), 'Discard', 'Tap again to discard', discard);

async function boot() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !local) navigator.serviceWorker.register('./sw.js').catch(() => {});
  store.persist();
  try {
    const meta = await store.getMeta();
    if (meta) {
      const n = await store.frameCount();
      if (n > 0) {
        session = { ...meta, frames: n };
        session.id ??= uid();
        session.segs ??= [[session.startedAt, session.startedAt + Math.round(session.recMs)]];
        $('recoverStats').textContent = statsLine();
        show('recover');
        return;
      }
      await store.clearAll();
    }
  } catch { /* no storage: still usable for this visit */ }
  if (getFlag('lapse.seen')) showReady();
  else showIntro();
}

boot();
