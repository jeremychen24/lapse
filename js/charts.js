// Small SVG charts for the Stats screen (same approach as Nook's): one series each,
// so one color and no legend; thin bars with a rounded top, hairline grid, labels only
// on the values that matter, a tap target per bar (data-tip), and a screen-reader table.

import { fmtMinutes, fmtHour } from './timelog.js';

const W = 340;
const BAR = '#3987e5'; // blue, checked against the black surface with the dataviz validator
const DIM = '#3a3a3a';
const GRID = '#262626';
const INK = '#f2f2ee';
const MUTED = '#9a9a96';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Bar growing up from `base` with 4px rounded top corners and a square bottom.
function column(x, top, w, base, color) {
  const r = Math.min(4, (base - top) / 2, w / 2);
  return `<path fill="${color}" d="M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z"/>`;
}

const niceStep = (max) => [15, 30, 60, 120, 180, 240, 360, 480].find((step) => max / step <= 3) ?? 600;

function table(caption, head, rows) {
  return `<table class="sr-only"><caption>${esc(caption)}</caption><tr><th>${head[0]}</th><th>${head[1]}</th></tr>${rows
    .map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`)
    .join('')}</table>`;
}

// Minutes recorded per day, last seven days. Today and the best day get their value on top.
export function weekChart(days) {
  const H = 156;
  const left = 32;
  const top = 18;
  const base = 128;
  const max = Math.max(...days.map((d) => d.minutes), 1);
  const step = niceStep(max);
  const yMax = Math.ceil(max / step) * step;
  const y = (m) => base - (m / yMax) * (base - top);
  const band = (W - left) / days.length;
  const best = days.reduce((b, d, i) => (d.minutes > days[b].minutes ? i : b), 0);

  let svg = '';
  for (let m = 0; m <= yMax; m += step) {
    svg += `<line x1="${left}" x2="${W}" y1="${y(m)}" y2="${y(m)}" stroke="${GRID}" stroke-width="1"/>`;
    svg += `<text x="${left - 6}" y="${y(m) + 3.5}" text-anchor="end" font-size="10" fill="${MUTED}" class="num">${m ? fmtMinutes(m) : '0'}</text>`;
  }
  days.forEach((d, i) => {
    const cx = left + band * (i + 0.5);
    const isToday = i === days.length - 1;
    const name = isToday ? 'Today' : d.label;
    if (d.minutes > 0) svg += column(cx - 11, y(d.minutes), 22, base, BAR);
    if (d.minutes > 0 && (isToday || i === best)) {
      svg += `<text x="${cx}" y="${y(d.minutes) - 5}" text-anchor="middle" font-size="10" fill="${INK}" class="num">${fmtMinutes(d.minutes)}</text>`;
    }
    svg += `<text x="${cx}" y="${base + 16}" text-anchor="middle" font-size="11" fill="${isToday ? INK : MUTED}">${name}</text>`;
    svg += `<rect x="${cx - band / 2}" y="${top - 10}" width="${band}" height="${base - top + 10}" fill="transparent" data-tip="${name} · ${fmtMinutes(d.minutes)}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes recorded per day, last 7 days">${svg}</svg>${table(
    'Recorded per day, last 7 days',
    ['Day', 'Recorded'],
    days.map((d, i) => [i === days.length - 1 ? 'Today' : d.label, fmtMinutes(d.minutes)]),
  )}`;
}

// When you record across the day; the best hour is blue and the rest stay gray.
export function hourChart(hours, bestHour) {
  const H = 96;
  const top = 6;
  const base = 72;
  const band = W / 24;
  const max = Math.max(...hours, 1);
  let svg = `<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="${GRID}" stroke-width="1"/>`;
  hours.forEach((m, h) => {
    const cx = band * (h + 0.5);
    if (m > 0) svg += column(cx - 3.5, base - (m / max) * (base - top), 7, base, h === bestHour ? BAR : DIM);
    svg += `<rect x="${cx - band / 2}" y="0" width="${band}" height="${base + 4}" fill="transparent" data-tip="${fmtHour(h)} · ${fmtMinutes(m)}"/>`;
  });
  for (const h of [0, 6, 12, 18]) {
    svg += `<text x="${band * (h + 0.5)}" y="${base + 16}" text-anchor="middle" font-size="10" fill="${MUTED}">${fmtHour(h)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes recorded by time of day">${svg}</svg>${table(
    'Recorded by hour of day',
    ['Hour', 'Recorded'],
    hours.map((m, h) => [fmtHour(h), fmtMinutes(m)]).filter((_, h) => hours[h] > 0),
  )}`;
}
