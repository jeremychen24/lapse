// Screens: boot → intro → ready → countdown → live (dark) → finishing → result
//          plus paused (interrupted) and recover (unfinished session on launch).

import * as L from './lapse.js';
import * as store from './store.js';
import { openCamera, closeCamera, cameraCount } from './camera.js';
import { keepAwake, wakeSupported } from './wake.js';
import { buildVideo, saveVideo, pickConfig, LiveEncoder, muxChunks } from './export.js';
import * as T from './timelog.js';
import * as D from './dash.js';
import { weekChart, hourChart, monthHeatmap } from './charts.js';

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
// { id, fmt: 'h264', config, desc, thumb, w, h, interval, facing, recMs, frames, startedAt, segs: [[start, end], ...] }
let session = null;
let encoder = null; // LiveEncoder for the current recording, opened on the first shot
let writes = Promise.resolve(); // stored video pieces, in order
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
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
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
  let config;
  try {
    config = await pickConfig(w, h);
  } catch {
    $('ratio').textContent = 'This browser can’t record video. Update to iOS 16.4 or later.';
    return;
  }
  closeEncoder();
  session = {
    id: uid(),
    fmt: 'h264',
    config,
    desc: null,
    thumb: '',
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
    closeEncoder();
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

// Each shot goes straight into the video encoder; only the small encoded pieces are stored.
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
    if (!running) return;
    encoder ??= new LiveEncoder(session.config, onChunk);
    encoder.encode(canvas, session.frames);
    if (session.frames % THUMB_EVERY === 0) session.thumb = thumbFrom(canvas);
    lastSeg()[1] = Date.now();
    session.frames += 1;
    if (!document.body.classList.contains('dark')) renderStats();
  } catch (e) {
    console.error(e);
  } finally {
    busy = false;
  }
}

const copyBuffer = (b) => (b instanceof ArrayBuffer ? b.slice(0) : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

function onChunk(chunk, meta) {
  if (!session) return;
  const data = new ArrayBuffer(chunk.byteLength);
  chunk.copyTo(data);
  const desc = meta?.decoderConfig?.description;
  if (desc && !session.desc) session.desc = copyBuffer(desc);
  const piece = { ts: chunk.timestamp, dur: chunk.duration ?? 0, key: chunk.type === 'key', data };
  const snapshot = { ...session, recMs: recordedMs() };
  writes = writes
    .then(() => store.addChunk(piece, snapshot))
    .catch((e) => {
      if (e?.name === 'QuotaExceededError') showPaused('Your phone’s storage is full. Finish to save what you have.');
    });
}

function closeEncoder() {
  encoder?.close();
  encoder = null;
}

function pauseRecording() {
  if (running) {
    session.recMs = recordedMs();
    lastSeg()[1] = Date.now();
    running = false;
  }
  clearTimeout(shotTimer);
  encoder?.flush(); // push the last pieces to storage
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
    await encoder?.flush();
    closeEncoder();
    await writes;
    const h264 = session.fmt === 'h264';
    const keys = h264 ? await store.chunkKeys() : await store.frameKeys();
    if (!keys.length) return void (await discard());
    const size = { width: session.w, height: session.h, onProgress: setProgress };
    const blob = h264
      ? await muxChunks({ keys, getChunk: store.getChunk, codec: session.config.codec, description: session.desc, ...size })
      : await buildVideo({ keys, getFrame: store.getFrame, ...size });
    showResult(blob, keys.length);
    logSession(keys.length);
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
  $('more').hidden = false;
  armed($('new'), 'New', 'Tap again to discard', discard, () => result?.saved);
  show('result');
}

$('save').onclick = async () => {
  if (!result) return;
  const how = await saveVideo(result.file, result.url);
  if (how === 'cancelled') return;
  result.saved = true;
  $('save').textContent = 'Saved';
  // The video is on your phone now, so Lapse's copy goes (the video stays here until you leave).
  $('more').hidden = true;
  await writes;
  await store.clearAll().catch(() => {});
  $('summary').textContent = 'Saved. Lapse’s copy was deleted to free up space.';
};

// ---------- stats ----------

const MIN_LOG_MS = 60000; // shorter tries don't count
let logCache = [];

const THUMB_EVERY = 120; // refresh the stats thumbnail now and then (every 10 min at 5s)

function thumbFrom(source) {
  try {
    const size = 112;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const r = L.coverRect(source.width, source.height, size, size);
    c.getContext('2d').drawImage(source, r.sx, r.sy, r.sw, r.sh, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return '';
  }
}

// One entry per session; finishing again after "Keep recording" updates it.
async function logSession(frames) {
  const segs = session.segs.filter(([s, e]) => e > s).map(([s, e]) => [s, e]);
  if (!segs.length || (session.recMs < MIN_LOG_MS && !devInterval)) return;
  const entry = { id: session.id, segs, frames, interval: session.interval, recMs: Math.round(session.recMs), thumb: session.thumb || '' };
  await store.putLog(entry).catch(() => {});
  await loadLog();
  awardBadges();
}

async function loadLog() {
  try {
    logCache = await store.getLog();
  } catch {
    logCache = [];
  }
  logCache.sort((a, b) => T.entryStart(b) - T.entryStart(a));
}

// Badges are kept once earned, in localStorage as { id: when }.
function earnedBadges() {
  return readJSON('lapse.badges');
}
function awardBadges() {
  const { earned, fresh } = D.checkBadges(logCache, earnedBadges());
  if (!fresh.length) return;
  try { localStorage.setItem('lapse.badges', JSON.stringify(earned)); } catch { /* private mode */ }
  toast(fresh.length === 1 ? `${fresh[0].icon} New badge: ${fresh[0].name}` : `${fresh.map((b) => b.icon).join(' ')} ${fresh.length} new badges`);
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function openStats() {
  dropStream();
  await loadLog();
  awardBadges();
  renderStatsScreen();
  show('stats');
  $('statsBody').scrollTop = 0;
  // The first visit in a new week opens a look back at last week (like Nook).
  const thisWeek = D.weekStart(Date.now());
  if (hasLastWeek() && Number(readJSON('lapse.review').at || 0) < thisWeek) openReview();
}

// ---------- weekly review ----------

const hasLastWeek = () => D.weekReview(logCache).sessions > 0;
const fmtDay = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function openReview() {
  const r = D.weekReview(logCache);
  const diff = r.minutes - r.before;
  $('reviewDates').textContent = `${fmtDay(r.start)} – ${fmtDay(r.end)}`;
  $('reviewTotal').textContent = T.fmtMinutes(r.minutes);
  $('reviewDelta').textContent = !r.before
    ? 'recorded'
    : diff === 0 ? 'the same as the week before' : `${diff > 0 ? '+' : '−'}${T.fmtMinutes(Math.abs(diff))} on the week before`;
  const earned = earnedBadges();
  const badges = D.BADGES.filter((b) => earned[b.id] >= r.start && earned[b.id] <= r.end);
  const rows = [
    ['Timelapses', `${r.sessions}`],
    r.bestDay && ['Best day', `${r.bestDay.label} · ${T.fmtMinutes(r.bestDay.minutes)}`],
    r.longest && ['Longest', T.fmtMinutes(r.longest)],
    badges.length && ['Badges', badges.map((b) => b.icon).join(' ')],
  ].filter(Boolean);
  $('reviewList').innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('');
  $('reviewLine').textContent = !r.before
    ? 'A good start. Let’s build on it this week.'
    : diff >= 0 ? 'More than the week before. Keep it rolling.' : 'A slower week happens. Every session still counts.';
  $('review').hidden = false;
}

function closeReview() {
  $('review').hidden = true;
  try { localStorage.setItem('lapse.review', JSON.stringify({ at: Date.now() })); } catch { /* private mode */ }
}

$('reviewDone').onclick = closeReview;
$('review').onclick = (e) => {
  if (e.target === $('review')) closeReview();
};
$('reviewBtn').onclick = openReview;

function historyRow(e) {
  const start = new Date(T.entryStart(e));
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const thumb = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(e.thumb || '') ? `<img src="${e.thumb}" alt="">` : '<span class="ph"></span>';
  return `<li>${thumb}<div><b>${day} · ${time}</b><small>${L.formatSpan(T.entryMs(e) / 1000)} · ${L.formatSpan(L.videoSeconds(e.frames))} video</small></div></li>`;
}

let monthOffset = 0; // the heatmap's month: 0 is this month, -1 last month, …
const CHEVRON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

// Same order as Nook's Stats: tiles, month, last 7 days, time of day, badges, then history.
function renderStatsScreen() {
  const s = T.computeStats(logCache);
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const chart = (svg) => `<div class="chart">${svg}<div class="chart-tip" hidden></div></div>`;
  const tile = (label, value) => `<div class="tile"><span>${label}</span><b>${value}</b></div>`;
  const earned = earnedBadges();
  const empty = !logCache.length;
  $('reviewBtn').hidden = !hasLastWeek();
  $('statsBody').innerHTML = `
    <div class="tiles">
      ${tile('Today', T.fmtMinutes(s.todayMin))}
      ${tile('This week', T.fmtMinutes(s.weekMin))}
      ${tile('Streak', plural(s.streak, 'day'))}
      ${tile('Total', T.fmtMinutes(s.totalMin))}
    </div>
    <div class="row-head"><h2 class="sec">${monthLabel}</h2>
      <div class="chevs">
        <button class="icon-btn" data-month="-1" aria-label="Previous month">${CHEVRON('M15 6l-6 6 6 6')}</button>
        <button class="icon-btn" data-month="1" aria-label="Next month" ${monthOffset === 0 ? 'disabled' : ''}>${CHEVRON('M9 6l6 6-6 6')}</button>
      </div>
    </div>
    ${chart(monthHeatmap(D.monthGrid(logCache, month.getFullYear(), month.getMonth()), T.dayKey(Date.now()), monthLabel))}
    ${empty ? '<p class="empty">Finish a timelapse of a minute or more to see your stats.</p>' : `
      <h2 class="sec">Last 7 days</h2>
      ${chart(weekChart(s.days))}
      <h2 class="sec">Time of day</h2>
      ${chart(hourChart(s.hours, s.bestHour))}
      ${s.bestHour === null ? '' : `<p class="caption">You record the most around ${T.fmtHour(s.bestHour)}</p>`}`}
    <div class="row-head"><h2 class="sec">Badges</h2><span class="hint">${D.BADGES.filter((b) => earned[b.id]).length} of ${D.BADGES.length}</span></div>
    <div class="badges">${D.BADGES.map((b) => `
      <div class="badge${earned[b.id] ? ' on' : ''}">
        <span class="badge-icon" aria-hidden="true">${b.icon}</span>
        <b>${b.name}</b>
        <small>${b.hint}</small>
      </div>`).join('')}
    </div>
    ${empty ? '' : `
      <h2 class="sec">History</h2>
      <ul class="history">${logCache.slice(0, 50).map(historyRow).join('')}</ul>
      <div class="send">
        <button id="sendNook" class="pill">Send to Nook</button>
        <p class="hint">Copies your stats (no photos or video). Then in Nook, open Stats and tap Paste from Lapse.</p>
      </div>`}`;
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
  const step = e.target.closest('[data-month]');
  if (step && !step.disabled) {
    monthOffset = Math.min(0, monthOffset + Number(step.dataset.month));
    renderStatsScreen();
    return;
  }
  const btn = e.target.closest('#sendNook');
  if (!btn) return;
  const ok = await copyText(T.encodeSync(logCache)); // built before any await: iOS needs the tap
  btn.textContent = ok ? 'Copied · now paste in Nook' : 'Couldn’t copy';
  setTimeout(() => (btn.textContent = 'Send to Nook'), 3000);
});
// Tabs: Record (camera) and Stats. Leaving Record turns the camera off to save battery.
$('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]')?.dataset.tab;
  if (!tab || tab === current()) return;
  if (tab === 'stats') openStats();
  else showReady();
});

$('more').onclick = () => {
  clearResult();
  resume();
};

async function discard() {
  running = false;
  closeEncoder();
  session = null;
  clearResult();
  await writes; // let queued pieces land first, so nothing reappears after the wipe
  await store.clearAll().catch(() => {});
  await showReady();
}

// ---------- launch ----------

$('recoverFinish').onclick = () => finish();
$('recoverResume').onclick = resume;
armed($('recoverDiscard'), 'Discard', 'Tap again to discard', discard);

async function boot() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !local) {
    // When a new version takes over, reload once so it shows right away,
    // but never in the middle of a recording or before a video is saved.
    const hadOld = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadOld && ['boot', 'intro', 'ready', 'stats'].includes(current()) && $('review').hidden) location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  store.persist();
  try {
    const meta = await store.getMeta();
    if (meta) {
      const h264 = meta.fmt === 'h264';
      const n = h264 ? await store.chunkCount() : await store.frameCount();
      if (n > 0) {
        session = { ...meta, frames: n };
        session.id ??= uid();
        session.segs ??= [[session.startedAt, session.startedAt + Math.round(session.recMs)]];
        $('recoverStats').textContent = statsLine();
        $('recoverResume').hidden = !h264; // old photo-based sessions can be finished, not continued
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
