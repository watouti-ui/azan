/* Build data/timetable.native.json from data/timetable.json.
 *
 * React Native runs on Hermes, which ships only a subset of Intl. Neither
 * Intl.DateTimeFormat with a `timeZone` nor the islamic-umalqura calendar can
 * be relied on there, and both are load-bearing in the web app. Rather than
 * discover that on a reviewer's phone, every value that needs a full ICU is
 * resolved here, on a build machine that has one, and shipped as plain numbers.
 *
 * The native app then needs no Intl at all: it compares Date.now() to stored
 * epochs and reads stored strings.
 *
 * Usage: node tools/build_native_timetable.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'timetable.json');
const OUT = path.join(ROOT, 'data', 'timetable.native.json');

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const TZ = src.meta.timezone || 'Europe/Dublin';
const ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const HIJRI_SHORT = ['Muh','Saf','Rab1','Rab2','Jum1','Jum2','Raj','Sha','Ram','Shw','Qad','Hij'];

// ---- the same zoned arithmetic as the web app, run here instead of on device
function zoneParts(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { y:+p.year, m:+p.month, d:+p.day, hh:+p.hour, mm:+p.minute, ss:+p.second };
}
function zoneOffsetMs(date, tz) {
  const p = zoneParts(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(date.getTime() / 1000) * 1000;
}
function epochOf(y, m, d, hh, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mi, 0);
  let ts = guess - zoneOffsetMs(new Date(guess), tz);
  return guess - zoneOffsetMs(new Date(ts), tz);
}
function hijriOf(y, m, d) {
  const p = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
    timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric',
  }).formatToParts(new Date(Date.UTC(y, m - 1, d, 12)))
    .reduce((a, x) => (a[x.type] = x.value, a), {});
  const mi = parseInt(p.month, 10), day = parseInt(p.day, 10);
  if (!mi || !day) throw new Error('no islamic-umalqura calendar in this runtime');
  return { d: day, m: mi, label: HIJRI_SHORT[mi - 1], y: +String(p.year).replace(/\D/g, '') };
}

// The year every MM-DD key belongs to. The web app is deliberately year-agnostic;
// precomputed epochs cannot be, so the sheet's year is recorded explicitly.
const YEAR = Number((src.meta.source || '').match(/(\d{4})-\d{2}/)?.[1]) || new Date().getUTCFullYear();

const keys = Object.keys(src.days).sort();
const days = {};
for (const key of keys) {
  const e = src.days[key];
  const m = +key.slice(0, 2), d = +key.slice(3, 5);
  const toUtc = v => { const [hh, mi] = v.split(':').map(Number); return epochOf(YEAR, m, d, hh, mi, TZ); };
  const utc = {}, jamaahUtc = {};
  for (const p of ORDER) if (e[p]) utc[p] = toUtc(e[p]);
  for (const p of Object.keys(e.jamaah || {})) jamaahUtc[p] = toUtc(e.jamaah[p]);
  days[key] = Object.assign({}, e, {
    utc, jamaahUtc,
    dayStartUtc: epochOf(YEAR, m, d, 0, 0, TZ),
    hijri2: hijriOf(YEAR, m, d),      // computed Umm al-Qura, not the printed string
  });
}

// Offset segments across the covered range, so the device can turn Date.now()
// into Dublin wall-clock time without a timezone database. Two entries here:
// +60 through the summer, 0 once the clocks go back.
const first = days[keys[0]].dayStartUtc;
const last  = days[keys[keys.length - 1]].dayStartUtc + 36 * 3600e3;
const segments = [];
let prev = null;
for (let t = first; t <= last; t += 1800e3) {
  const off = zoneOffsetMs(new Date(t), TZ) / 60000;
  if (off !== prev) { segments.push([t === first ? first : t, off]); prev = off; }
}

const out = {
  meta: Object.assign({}, src.meta, {
    year: YEAR,
    utcOffsets: segments,
    generatedBy: 'tools/build_native_timetable.js',
    note: 'Precomputed for runtimes without full Intl (Hermes). All epochs are ms UTC.',
  }),
  days,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log(`wrote data/timetable.native.json — ${keys.length} days, year ${YEAR}`);
console.log('utc offset segments:', segments.map(([t, o]) => new Date(t).toISOString() + ' -> ' + o + 'min').join('  |  '));
