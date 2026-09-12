/* Azan — offline prayer-time app driven by an imported timetable.
   No times are calculated or fetched: what you import is what is shown. */
'use strict';

const APP_VERSION = '1.7.0';

const PRAYERS = [
  { k: 'fajr',    n: 'Fajr',    i: '🌙' },
  { k: 'sunrise', n: 'Sunrise', i: '🌅', sun: true },
  { k: 'dhuhr',   n: 'Dhuhr',   i: '☀️' },
  { k: 'asr',     n: 'Asr',     i: '🌇' },
  { k: 'maghrib', n: 'Maghrib', i: '🌆' },
  { k: 'isha',    n: 'Isha',    i: '🌌' }
];
const KEYS = PRAYERS.map(p => p.k);
const PM_KEYS = new Set(['dhuhr', 'asr', 'maghrib', 'isha']);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Umm al-Qura, which is what hijri-calendar.com publishes: it matches that
// site on 1, 7, 12 and 30 September 2026, including Rabi' al-Awwal ending at
// 29 days. Computed rather than transcribed, so future months need no entry.
const HIJRI_SHORT = ['Muh', 'Saf', 'Rab1', 'Rab2', 'Jum1', 'Jum2',
                     'Raj', 'Sha', 'Ram', 'Shw', 'Qad', 'Hij'];

// Older spellings, for the hijri strings carried in a timetable file.
const HIJRI_PATTERNS = [
  [/muharram/i, 'Muh'], [/safar/i, 'Saf'],
  [/rabi.*(akhir|thani|ii\b|2)/i, 'Rab2'], [/rabi/i, 'Rab1'],
  [/jumada.*(akhir|thani|ii\b|2)/i, 'Jum2'], [/jumada/i, 'Jum1'],
  [/rajab/i, 'Raj'], [/sha.?ban/i, 'Sha'], [/ramad/i, 'Ram'], [/shaww/i, 'Shw'],
  [/qa.?d/i, 'Qad'], [/hijj/i, 'Hij']
];

function hijriFromText(text) {
  if (!text) return null;
  const day = (String(text).match(/\d{1,2}/) || [''])[0];
  let month = String(text).replace(/\d+/g, '').trim();
  for (const [re, short] of HIJRI_PATTERNS) if (re.test(month)) { month = short; break; }
  return { day: day, month: month, year: '' };
}

function hijriParts(t) {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric'
    }).formatToParts(new Date(Date.UTC(t.y, t.m - 1, t.d, 12)))
      .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    const month = parseInt(parts.month, 10);
    const day = parseInt(parts.day, 10);
    if (!month || !day) throw new Error('no islamic calendar');
    return {
      day: String(day),
      month: HIJRI_SHORT[month - 1] || String(month),
      year: String(parts.year).replace(/\D/g, '')
    };
  } catch (e) {
    // No Umm al-Qura support: fall back to whatever the timetable carries.
    const entry = dayEntry(t.m, t.d);
    return entry ? hijriFromText(entry.hijri) : null;
  }
}

function addDays(t, n) {
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

const ALIASES = {
  fajr: ['fajr','fajir','fejr','fadjr','subh','sobh','subuh','sahar','dawn'],
  sunrise: ['sunrise','sun rise','shurooq','shuruq','shurouq','shorooq','ishraq','syuruk','sunup'],
  dhuhr: ['dhuhr','duhr','zuhr','zohr','thuhr','luhr','dhur','zuhur','dhuhur','noon','midday'],
  asr: ['asr','assr','asar','ashr'],
  maghrib: ['maghrib','magrib','maghreb','magreb','maghrib','sunset','iftar'],
  isha: ['isha',"isha'a",'ishaa','ishā','esha','eshaa','isya','nightfall','ishaʼ']
};

/* ---------------------------------------------------------------- storage */

const LS = {
  get(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
  del(key) { try { localStorage.removeItem(key); } catch (e) {} }
};

const DEFAULT_SETTINGS = {
  sound: { fajr: 'azan', sunrise: 'off', dhuhr: 'azan', asr: 'azan', maghrib: 'azan', isha: 'azan' },
  offsets: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  use24: true, pre: 0, jam: 0, wake: false, muted: false
};

let settings = Object.assign({}, DEFAULT_SETTINGS, LS.get('azan.settings', {}));
settings.sound = Object.assign({}, DEFAULT_SETTINGS.sound, settings.sound);
settings.offsets = Object.assign({}, DEFAULT_SETTINGS.offsets, settings.offsets);

function saveSettings() { LS.set('azan.settings', settings); }

let timetable = null;      // { meta, days }
let bundled = null;        // bundled copy, for "reset"
let viewMonth = null;      // { y, m } for the month tab

/* --------------------------------------------------------------- timezone */

function zoneName() {
  const tz = timetable && timetable.meta && timetable.meta.timezone;
  if (tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch (e) {} }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function zoneParts(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return {
    y: +parts.year, m: +parts.month, d: +parts.day,
    hh: +parts.hour, mm: +parts.minute, ss: +parts.second
  };
}

function zoneOffsetMs(date, tz) {
  const p = zoneParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Epoch ms for a wall-clock time in the given zone (DST-safe).
function epochOf(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let ts = guess - zoneOffsetMs(new Date(guess), tz);
  ts = guess - zoneOffsetMs(new Date(ts), tz);
  return ts;
}

function todayInZone() { return zoneParts(new Date(), zoneName()); }

/* ------------------------------------------------------------ time format */

const pad = n => String(n).padStart(2, '0');
const mmdd = (m, d) => pad(m) + '-' + pad(d);

// The board prints 24-hour times with no leading zero on the hour: 5:03, 13:25.
// `padHour` is for the month grid, where the columns should line up.
function fmtTime(minutes, padHour) {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60), m = t % 60;
  if (settings.use24) return (padHour ? pad(h) : h) + ':' + pad(m);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + pad(m) + ' ' + ap;
}

// Always hh:mm:ss, as on the board (00:15:40).
function fmtDur(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return pad(Math.floor(total / 3600)) + ':' + pad(Math.floor(total % 3600 / 60)) + ':' + pad(total % 60);
}

/* ------------------------------------------------------------- timetable  */

function dayEntry(m, d) {
  if (!timetable || !timetable.days) return null;
  return timetable.days[mmdd(m, d)] || (m === 2 && d === 29 ? timetable.days['02-28'] : null) || null;
}

// Minutes past midnight. `which` is 'begins' (default) or 'jamaah'.
// Adjustments apply to begins times only: jamaah times are the mosque's.
function minutesFor(entry, key, which) {
  if (!entry) return null;
  const source = which === 'jamaah' ? entry.jamaah : entry;
  if (!source || !source[key]) return null;
  const parts = String(source[key]).split(':');
  const base = (+parts[0]) * 60 + (+parts[1]);
  return base + (which === 'jamaah' ? 0 : (settings.offsets[key] || 0));
}

function hasJamaah() {
  return !!(timetable && timetable.meta && timetable.meta.jamaah);
}

function eventsFor(y, m, d) {
  const entry = dayEntry(m, d), tz = zoneName(), out = [];
  if (!entry) return out;
  for (const p of PRAYERS) {
    const mins = minutesFor(entry, p.k);
    if (mins === null) continue;
    // Built from the wall-clock time itself, not midnight + minutes: adding
    // minutes to midnight would be an hour out on a DST-change day.
    const hh = Math.floor(mins / 60), mi = ((mins % 60) + 60) % 60;
    const jam = minutesFor(entry, p.k, 'jamaah');
    out.push({
      key: p.k, name: p.n, icon: p.i, sun: !!p.sun, minutes: mins,
      at: epochOf(y, m, d, hh, mi, tz),
      jamaah: jam,
      jamaahAt: jam === null ? null : epochOf(y, m, d, Math.floor(jam / 60), ((jam % 60) + 60) % 60, tz),
      date: y + '-' + mmdd(m, d)
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

function nextEvent(now) {
  const t = todayInZone();
  let list = eventsFor(t.y, t.m, t.d).filter(e => e.at > now);
  if (list.length) return list[0];
  const nx = new Date(Date.UTC(t.y, t.m - 1, t.d + 1));
  list = eventsFor(nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate()).filter(e => e.at > now);
  return list.length ? list[0] : null;
}

/* ------------------------------------------------------------ the parser  */

function aliasKey(token) {
  const t = String(token).toLowerCase().replace(/[^a-z' ]/g, '').trim();
  if (!t) return null;
  for (const key of KEYS) {
    for (const a of ALIASES[key]) {
      if (t === a || t.startsWith(a) || a.startsWith(t) && t.length >= 3) return key;
    }
  }
  return null;
}

const TIME_RE = /^(\d{1,2})[:.h](\d{2})\s*([ap])?m?\.?$/i;

function splitTokens(line) {
  const glued = line.replace(/(\d{1,2}[:.h]\d{2})\s*([ap])\.?\s*m\.?/gi, '$1$2m');
  const parts = /[,;\t|]/.test(glued) ? glued.split(/\s*[,;\t|]\s*/) : glued.split(/\s{1,}/);
  return parts.map(s => s.trim()).filter(Boolean);
}

function parseDatePart(tokens, ctx, order) {
  // Explode on whitespace first: a single cell often reads "Tue 1".
  const cleaned = tokens
    .join(' ').split(/\s+/)
    .map(t => t.replace(/[()]/g, '').trim())
    .filter(t => !/^(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(day|s|nes|rs)?\.?$/i.test(t))
    .filter(Boolean);
  const joined = cleaned.join(' ');
  let m;

  if ((m = joined.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)))
    return { m: +m[2], d: +m[3] };

  const named = joined.match(/([a-z]{3,})/i);
  if (named) {
    const idx = MONTHS.findIndex(x => x.toLowerCase().startsWith(named[1].toLowerCase().slice(0, 3)));
    const dayMatch = joined.match(/(\d{1,2})\s*(?:st|nd|rd|th)?/i);
    if (idx >= 0 && dayMatch) return { m: idx + 1, d: +dayMatch[1] };
    if (idx >= 0) return { monthOnly: idx + 1 };
  }

  if ((m = joined.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/))) {
    const a = +m[1], b = +m[2];
    if (order === 'mdy') return { m: a, d: b };
    return { m: b, d: a };
  }

  if ((m = joined.match(/^(\d{1,2})\s*(?:st|nd|rd|th)?$/i))) {
    let day = +m[1], month = ctx.month;
    if (ctx.prevDay !== null && day < ctx.prevDay) month = month % 12 + 1;   // rolled into next month
    return { m: month, d: day, rolled: true };
  }
  return null;
}

// Resolved per value, not per file: printed tables mix formats (Isha given as
// 21:55 while the rest of the row is 12-hour). An hour above 12 is already
// 24-hour; otherwise Dhuhr to Isha are afternoon/evening.
function normaliseTime(raw, key) {
  const m = String(raw).match(TIME_RE);
  if (!m) return null;
  let h = +m[1], mi = +m[2];
  const ap = m[3] ? m[3].toLowerCase() : null;
  if (mi > 59) return null;
  if (ap === 'a') h = h % 12;
  else if (ap === 'p') h = h % 12 + 12;
  else if (h < 12 && PM_KEYS.has(key)) h += 12;
  if (h > 23) return null;
  return pad(h) + ':' + pad(mi);
}

// Which prayer (and which of begins/jamaah) each time column holds.
function columnPlan(count, mode, headerKeys) {
  const pair = k => [{ key: k, which: 'begins' }, { key: k, which: 'jamaah' }];
  const paired = count >= 10 && count <= 12;
  const usePairs = mode === 'pairs' || (mode === 'auto' && paired);

  if (usePairs) {
    if (count >= 11) {
      const plan = [].concat(pair('fajr'), [{ key: 'sunrise', which: 'begins' }]);
      if (count >= 12) plan.push({ key: 'sunrise', which: 'skip' });
      return plan.concat(pair('dhuhr'), pair('asr'), pair('maghrib'), pair('isha'));
    }
    return [].concat(pair('fajr'), pair('dhuhr'), pair('asr'), pair('maghrib'), pair('isha'));
  }
  if (headerKeys && headerKeys.length === count) {
    return headerKeys.map(k => ({ key: k, which: 'begins' }));
  }
  const keys = count >= 6 ? KEYS.slice(0, 6) : ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  return keys.map(k => ({ key: k, which: 'begins' }));
}

function parseTimetable(text, opts) {
  const warnings = [];
  const trimmed = text.trim();

  if (trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed);
    const days = json.days || json;
    const out = {};
    for (const k of Object.keys(days)) {
      const norm = k.length === 5 ? k : (k.length === 10 ? k.slice(5) : null);
      if (!norm) { warnings.push('Skipped key "' + k + '"'); continue; }
      out[norm] = days[k];
    }
    const meta = json.meta || {};
    if (Object.keys(out).some(k => out[k] && out[k].jamaah)) meta.jamaah = true;
    return { days: out, meta, warnings, count: Object.keys(out).length };
  }

  const order = opts.dateOrder || 'dmy';
  const ctx = { month: opts.defaultMonth || 1, prevDay: null };
  const lines = trimmed.split(/\r?\n/);
  let columnOrder = null;
  const rows = [];
  let sawHourOver12 = false, sawMeridiem = false, skipped = 0;

  for (const line of lines) {
    const raw = line.trim();
    if (!raw || /^[-=_\s]+$/.test(raw)) continue;
    const tokens = splitTokens(raw);
    const times = [], words = [];
    for (const t of tokens) (TIME_RE.test(t) ? times : words).push(t);

    if (times.length === 0) {
      const mapped = words.map(aliasKey).filter(Boolean);
      if (mapped.length >= 3) {                       // header row
        const seen = [];
        for (const k of mapped) if (!seen.includes(k)) seen.push(k);
        columnOrder = seen;
        continue;
      }
      const dp = parseDatePart(words, ctx, order);
      if (dp && dp.monthOnly) { ctx.month = dp.monthOnly; ctx.prevDay = null; }
      continue;                                        // heading / noise
    }

    if (times.length < 5) { skipped++; continue; }

    const dp = parseDatePart(words, ctx, order);
    if (!dp || !dp.m || !dp.d) { skipped++; continue; }
    if (dp.rolled) { ctx.month = dp.m; }
    ctx.prevDay = dp.d;

    for (const t of times) {
      const mt = t.match(TIME_RE);
      if (!mt) continue;
      if (mt[3]) sawMeridiem = true;
      if (+mt[1] > 12) sawHourOver12 = true;
    }
    rows.push({ m: dp.m, d: dp.d, times });
  }

  if (!rows.length) throw new Error('No rows with at least 5 times were found.');

  if (!sawMeridiem && !sawHourOver12) warnings.push('No am/pm or 24-hour markers — Dhuhr to Isha read as afternoon/evening.');

  const widths = {};
  for (const row of rows) widths[row.times.length] = (widths[row.times.length] || 0) + 1;
  const commonWidth = +Object.keys(widths).sort((a, b) => widths[b] - widths[a])[0];
  const plan = columnPlan(commonWidth, opts.colMode || 'auto', columnOrder);
  const anyJamaah = plan.some(c => c.which === 'jamaah');

  const days = {};
  for (const row of rows) {
    const rowPlan = row.times.length === commonWidth
      ? plan : columnPlan(row.times.length, opts.colMode || 'auto', columnOrder);
    const entry = {}, jamaah = {};
    for (let i = 0; i < rowPlan.length && i < row.times.length; i++) {
      const col = rowPlan[i];
      if (col.which === 'skip') continue;
      const v = normaliseTime(row.times[i], col.key);
      if (!v) continue;
      if (col.which === 'jamaah') jamaah[col.key] = v; else entry[col.key] = v;
    }
    if (Object.keys(jamaah).length) entry.jamaah = jamaah;
    if (Object.keys(entry).length >= 4) days[mmdd(row.m, row.d)] = entry;
    else skipped++;
  }

  if (skipped) warnings.push(skipped + ' line(s) skipped (no usable date or times).');
  warnings.push(commonWidth + ' time columns per row, read as ' +
    (anyJamaah ? 'begins + jamaah pairs' : columnOrder ? columnOrder.join(', ') : 'the standard order') + '.');
  const count = Object.keys(days).length;
  const months = Object.keys(days).reduce((acc, k) => (acc[k.slice(0, 2)] = 1, acc), {});
  warnings.push(count + ' days across ' + Object.keys(months).length +
    ' month(s). Days with no entry show as unavailable.');
  return { days, meta: anyJamaah ? { jamaah: true } : null, warnings, count };
}

/* ---------------------------------------------------------------- audio   */

let audioCtx = null, audioReady = false, azanUrl = null, azanEl = null, azanSource = 'chime';

function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('azan-db', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbPut(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(val, key);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction('files', 'readonly').objectStore('files').get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDel(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(key);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

async function loadAzanAudio() {
  if (azanUrl) { URL.revokeObjectURL(azanUrl); azanUrl = null; }
  let blob = null;
  try { blob = await idbGet('azan'); } catch (e) {}
  if (blob) { azanSource = 'custom'; azanUrl = URL.createObjectURL(blob); }
  else if (window.__AZAN_STANDALONE__) { azanSource = 'chime'; }
  else {
    try {
      const r = await fetch('audio/azan.mp3', { method: 'HEAD' });
      if (r.ok) { azanSource = 'bundled'; azanUrl = 'audio/azan.mp3'; }
      else azanSource = 'chime';
    } catch (e) { azanSource = 'chime'; }
  }
  const el = document.getElementById('audioState');
  if (el) el.textContent = azanSource === 'custom' ? 'Your audio file (stored on this device)'
    : azanSource === 'bundled' ? 'audio/azan.mp3 from the app folder'
    : 'Built-in chime (no audio file added)';
}

function notifState() {
  return ('Notification' in window) ? Notification.permission : 'unsupported';
}

// Notifications and sound are separate: plenty of people want to be told a
// prayer has come in without the Azan playing out loud.
function updateAlerts() {
  const bar = document.getElementById('audioBanner');
  const btn = document.getElementById('soundToggle');
  if (!bar || !btn) return;
  const state = notifState();

  bar.hidden = (state === 'granted' || state === 'unsupported');
  document.getElementById('alertText').textContent = state === 'denied'
    ? 'Notifications are blocked in your browser settings'
    : 'Notifications are off';
  document.getElementById('unlockBtn').hidden = (state === 'denied');

  btn.textContent = settings.muted ? 'Enable sounds' : 'Disable sounds';
  btn.classList.toggle('muted', !!settings.muted);
}

async function armNotifications() {
  if (!('Notification' in window)) { toast('Notifications are not supported here'); return; }
  try { await Notification.requestPermission(); } catch (e) {}
  updateAlerts();
  renderSettings();
  toast(notifState() === 'granted' ? 'Notifications on' : 'Notifications not allowed');
}

function toggleSound() {
  settings.muted = !settings.muted;
  saveSettings();
  if (settings.muted) {
    stopAudio();
  } else {
    unlockAudio();   // the browser needs this gesture before it will ever play
    chime(1);        // and a short confirmation proves it works
  }
  updateAlerts();
  renderToday();
  renderSettings();
  toast(settings.muted ? 'Sounds off — notifications only' : 'Sounds on');
}

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.connect(audioCtx.destination); src.start(0);
  } catch (e) {}
  if (!azanEl) { azanEl = new Audio(); azanEl.preload = 'auto'; }
  azanEl.muted = true;
  const p = azanEl.play();
  if (p && p.catch) p.catch(() => {});
  setTimeout(() => { try { azanEl.pause(); azanEl.currentTime = 0; azanEl.muted = false; } catch (e) {} }, 60);
  audioReady = true;
}

function chime(times) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const n = times || 3;
    for (let i = 0; i < n; i++) {
      const t0 = audioCtx.currentTime + i * 0.7;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(660, t0);
      osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.12);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + 0.62);
    }
  } catch (e) {}
}

function playAzan() {
  if (!azanUrl) { chime(4); return; }
  if (!azanEl) { azanEl = new Audio(); }
  azanEl.muted = false;
  azanEl.src = azanUrl;
  azanEl.loop = false;
  const p = azanEl.play();
  if (p && p.catch) p.catch(() => chime(4));
}

function stopAudio() { if (azanEl) { try { azanEl.pause(); azanEl.currentTime = 0; } catch (e) {} } }

/* ---------------------------------------------------------------- alerts  */

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'azan', renotify: true };
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(r => r.showNotification(title, opts)).catch(() => {
      try { new Notification(title, opts); } catch (e) {}
    });
  } else { try { new Notification(title, opts); } catch (e) {} }
}

function firedStore() {
  const t = todayInZone();
  const key = t.y + '-' + mmdd(t.m, t.d);
  const store = LS.get('azan.fired', { date: '', keys: [] });
  if (store.date !== key) { store.date = key; store.keys = []; LS.set('azan.fired', store); }
  return store;
}

function markFired(id) {
  const store = firedStore();
  if (!store.keys.includes(id)) { store.keys.push(id); LS.set('azan.fired', store); }
}

function alreadyFired(id) { return firedStore().keys.includes(id); }

function fire(event, kind) {
  const id = kind + ':' + event.date + ':' + event.key;
  if (alreadyFired(id)) return;
  markFired(id);
  const mode = settings.muted ? 'off' : (settings.sound[event.key] || 'off');

  if (kind === 'pre') {
    notify(event.name + ' in ' + settings.pre + ' min', event.name + ' at ' + fmtTime(event.minutes));
    if (mode !== 'off') chime(1);
    toast(event.name + ' in ' + settings.pre + ' minutes');
    return;
  }
  if (kind === 'jam') {
    const mins = settings.jam;
    notify(event.name + ' iqamah in ' + mins + ' min', 'Iqamah at ' + fmtTime(event.jamaah));
    if (mode !== 'off') chime(2);
    toast(event.name + ' iqamah in ' + mins + ' minutes');
    return;
  }
  notify(event.name, 'It is now ' + fmtTime(event.minutes) + ' — time for ' + event.name + '.');
  toast(event.name + ' — ' + fmtTime(event.minutes));
  if (mode === 'azan') playAzan();
  else if (mode === 'beep') chime(3);
}

/* ------------------------------------------------------------- rendering  */

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function coveredMonths() {
  if (!timetable || !timetable.days) return [];
  const set = {};
  for (const k of Object.keys(timetable.days)) set[+k.slice(0, 2)] = 1;
  return Object.keys(set).map(Number).sort((a, b) => a - b);
}

function renderHeader() {
  const meta = (timetable && timetable.meta) || {};
  document.getElementById('locBox').textContent = meta.name || 'No mosque set';
  document.getElementById('sampleBanner').classList.toggle('show', !!meta.placeholder);
  document.getElementById('verPill').textContent = APP_VERSION;

  const months = coveredMonths();
  const cover = document.getElementById('coverBanner');
  if (meta.placeholder || months.length === 0 || months.length >= 12) {
    cover.classList.remove('show');
  } else {
    cover.innerHTML = '<b>Covers ' + months.map(m => MONTHS[m - 1]).join(', ') +
      ' only.</b><br>Other dates show as unavailable until the remaining months are added.';
    cover.classList.add('show');
  }
}

function renderToday() {
  const now = Date.now();
  const t = todayInZone();
  const meta = (timetable && timetable.meta) || {};
  const todayEvents = eventsFor(t.y, t.m, t.d);

  // Once Isha has been prayed the board switches the table to tomorrow.
  const showTomorrow = ishaDone(now);
  const shown = showTomorrow ? addDays(t, 1) : t;
  const events = showTomorrow ? eventsFor(shown.y, shown.m, shown.d) : todayEvents;

  document.getElementById('todayDate').innerHTML =
    MONTHS_SHORT[t.m - 1] + '<b>' + t.d + '</b>' + t.y;

  const hijri = hijriParts(t);
  document.getElementById('todayHijri').innerHTML = hijri
    ? hijri.month + '<b>' + hijri.day + '</b>' + (hijri.year || meta.hijriYear || '')
    : '';

  const list = document.getElementById('todayList');
  const showJamaah = hasJamaah() && events.some(e => e.jamaah !== null);

  if (!events.length) {
    list.innerHTML = '<li><div class="pname">No times<small>This timetable does not cover ' +
      shown.d + ' ' + MONTHS[shown.m - 1] + '. Add that month in Settings → Timetable.</small></div></li>';
  } else {
    // The highlighted row is whatever the countdown is running towards, so it
    // moves down the table through the day. Once the table has flipped to
    // tomorrow, nothing is highlighted — as on the board.
    const target = countdownTarget(now);
    const currentKey = showTomorrow || !target ? null : target.key;
    list.innerHTML = events.map((e, i) => {
      const cls = [!showTomorrow && e.at <= now ? 'passed' : '',
                   e.key === currentKey ? 'current' : ''].join(' ').trim();
      const mode = settings.sound[e.key];
      const badge = e.sun ? '' : (mode === 'azan' ? '🔊' : mode === 'beep' ? '🔔' : '🔇');
      const cells = e.sun
        ? '<span class="t wide">' + fmtTime(e.minutes) + '</span>'
        : '<span class="t">' + fmtTime(e.minutes) + '</span>' +
          (showJamaah
            ? '<span class="t' + (e.jamaah === null ? ' none' : '') + '">' +
              (e.jamaah === null ? '—' : fmtTime(e.jamaah)) + '</span>'
            : '');
      return '<li class="' + cls + '"><span class="pname">' + e.name + '</span>' +
        '<span class="snd">' + badge + '</span>' + cells + '</li>';
    }).join('');
  }

  renderCountdown(now);

  const jummahCard = document.getElementById('jummahCard');
  const weekday = new Date(Date.UTC(shown.y, shown.m - 1, shown.d)).getUTCDay();
  if (weekday === 5 && meta.jummah && meta.jummah.length) {
    const toMinutes = v => (+v.split(':')[0]) * 60 + (+v.split(':')[1]);
    document.getElementById('jum1').textContent = fmtTime(toMinutes(meta.jummah[0]));
    document.getElementById('jum2').textContent =
      meta.jummah[1] ? fmtTime(toMinutes(meta.jummah[1])) : '—';
    jummahCard.style.display = '';
  } else {
    jummahCard.style.display = 'none';
  }

  document.getElementById('mosqueNotes').textContent =
    (meta.notes && meta.notes.length) ? meta.notes.join(' · ') : '';
  document.getElementById('foregroundNote').textContent = settings.muted
    ? 'Sounds are off — prayer times still show a notification. Turn sounds back on below to hear the Azan.'
    : 'The Azan plays while this app is open. A closed app cannot play audio on a phone — keep a clock alarm as a backstop.';
}

// The board counts down to the adhan, then - once the adhan has passed and
// the congregation has not - to "<PRAYER> IQAMAH". The bar underneath fills
// across whichever interval is running.
function countdownTarget(now) {
  const t = todayInZone();
  const today = eventsFor(t.y, t.m, t.d);

  // While a prayer's adhan has gone but the congregation has not, the board
  // counts down to that prayer's iqamah and keeps it highlighted.
  for (const e of today) {
    if (!e.sun && e.jamaahAt !== null && e.at <= now && now < e.jamaahAt) {
      return { label: e.name + ' Iqamah', at: e.jamaahAt, key: e.key };
    }
  }

  // Otherwise it is the next prayer still to come. Sunrise is in the table but
  // is not a prayer, so it is never the target.
  let upcoming = today.filter(e => !e.sun && e.at > now);
  if (!upcoming.length) {
    const nx = addDays(t, 1);
    upcoming = eventsFor(nx.y, nx.m, nx.d).filter(e => !e.sun && e.at > now);
  }
  if (!upcoming.length) return null;
  const nxt = upcoming[0];
  return { label: nxt.name, at: nxt.at, key: nxt.key };
}

// The board's day ends when the Isha congregation has been held, not when its
// adhan sounded - Isha keeps its row through the iqamah window like the rest.
function ishaDone(now) {
  const t = todayInZone();
  const isha = eventsFor(t.y, t.m, t.d).find(e => e.key === 'isha');
  if (!isha) return false;
  return now >= (isha.jamaahAt === null ? isha.at : isha.jamaahAt);
}

function renderCountdown(now) {
  const meta = (timetable && timetable.meta) || {};
  const target = countdownTarget(now);
  document.getElementById('nextName').textContent = target ? target.label.toUpperCase() : '—';
  document.getElementById('countdown').textContent = target ? fmtDur(target.at - now) : '--:--:--';

  document.getElementById('cdLabel').textContent =
    (ishaDone(now) ? 'Tomorrow' : 'Today') + ' @ ' + (meta.city || zoneName().split('/').pop()).replace(/\s+\d+$/, '') + ' ·';
}

function renderClock() {
  const p = zoneParts(new Date(), zoneName());
  document.getElementById('clock').textContent =
    p.hh + ':' + pad(p.mm) + ':' + pad(p.ss);
}

let monthCol = 'begins';

function renderMonth() {
  const t = todayInZone();
  if (!viewMonth) viewMonth = { y: t.y, m: t.m };
  if (monthCol === 'jamaah' && !hasJamaah()) monthCol = 'begins';
  document.getElementById('monthSeg').style.display = hasJamaah() ? '' : 'none';
  document.getElementById('monthSeg').querySelectorAll('button')
    .forEach(b => b.classList.toggle('on', b.dataset.col === monthCol));
  document.getElementById('mLabel').textContent = MONTHS[viewMonth.m - 1] + ' ' + viewMonth.y;
  const dim = new Date(Date.UTC(viewMonth.y, viewMonth.m, 0)).getUTCDate();
  let html = '<tr><th>Day</th>' + PRAYERS.map(p => '<th>' + p.n.slice(0, 3) + '</th>').join('') + '</tr>';
  for (let d = 1; d <= dim; d++) {
    const entry = dayEntry(viewMonth.m, d);
    const wd = new Date(Date.UTC(viewMonth.y, viewMonth.m - 1, d)).getUTCDay();
    const isToday = viewMonth.y === t.y && viewMonth.m === t.m && d === t.d;
    const cls = [isToday ? 'today' : '', wd === 5 ? 'fri' : ''].join(' ').trim();
    html += '<tr class="' + cls + '"><td>' + pad(d) + ' ' + DAYS[wd].slice(0, 3) + '</td>' +
      PRAYERS.map(p => {
        const mins = minutesFor(entry, p.k, monthCol);
        return '<td>' + (mins === null ? '—' : fmtTime(mins, true)) + '</td>';
      }).join('') + '</tr>';
  }
  document.getElementById('monthTable').innerHTML = html;
}

function renderSettings() {
  const soundBox = document.getElementById('soundRows');
  soundBox.innerHTML = PRAYERS.map(p =>
    '<div class="row"><div class="k">' + p.i + ' ' + p.n + '</div>' +
    '<select data-sound="' + p.k + '">' +
      ['azan|Azan', 'beep|Chime', 'off|Silent'].map(o => {
        const [v, label] = o.split('|');
        return '<option value="' + v + '"' + (settings.sound[p.k] === v ? ' selected' : '') + '>' + label + '</option>';
      }).join('') +
    '</select></div>').join('');
  soundBox.querySelectorAll('select[data-sound]').forEach(sel => {
    sel.onchange = () => { settings.sound[sel.dataset.sound] = sel.value; saveSettings(); renderToday(); };
  });

  const offBox = document.getElementById('offsetRows');
  offBox.innerHTML = PRAYERS.map(p =>
    '<div class="row"><div class="k">' + p.n + '</div>' +
    '<input type="number" data-off="' + p.k + '" min="-60" max="60" step="1" value="' + (settings.offsets[p.k] || 0) + '"></div>'
  ).join('');
  offBox.querySelectorAll('input[data-off]').forEach(inp => {
    inp.onchange = () => {
      const v = Math.max(-60, Math.min(60, parseInt(inp.value, 10) || 0));
      inp.value = v; settings.offsets[inp.dataset.off] = v; saveSettings(); renderAll();
    };
  });

  document.getElementById('use24').checked = !!settings.use24;
  document.getElementById('preMins').value = settings.pre || 0;
  document.getElementById('jamMins').value = settings.jam || 0;
  document.getElementById('jamMins').closest('.row').style.display = hasJamaah() ? '' : 'none';
  document.getElementById('wakeLock').checked = !!settings.wake;

  const meta = (timetable && timetable.meta) || {};
  document.getElementById('metaName').value = meta.name || '';
  document.getElementById('metaCity').value = meta.city || '';
  document.getElementById('metaTz').value = meta.timezone || '';
  const dayCount = timetable && timetable.days ? Object.keys(timetable.days).length : 0;
  document.getElementById('ttDays').textContent =
    dayCount + ' days' + (hasJamaah() ? ' · jamaah' : '');
  document.getElementById('ttState').textContent = meta.placeholder
    ? 'Bundled sample — replace it'
    : (meta.name || 'Custom timetable') + (meta.source ? ' · ' + meta.source : '');

  const notifBtn = document.getElementById('notifBtn');
  const state = ('Notification' in window) ? Notification.permission : 'unsupported';
  notifBtn.textContent = state === 'granted' ? 'Enabled' : state === 'denied' ? 'Blocked' : 'Enable';
  notifBtn.disabled = state === 'granted' || state === 'unsupported';
  if (state === 'denied') document.getElementById('notifState').textContent =
    'Blocked in browser settings — allow notifications for this site to re-enable.';
}

function renderAll() { renderHeader(); renderToday(); renderMonth(); renderSettings(); }

/* ------------------------------------------------------------------ tick  */

let lastDate = '', lastNextId = '', tickCount = 0;

function tick() {
  const now = Date.now();
  renderClock();
  const t = todayInZone();
  const dateKey = t.y + '-' + mmdd(t.m, t.d);
  if (dateKey !== lastDate) { lastDate = dateKey; viewMonth = null; lastNextId = ''; renderAll(); }

  renderCountdown(now);

  // Redraw when the countdown moves to another prayer - that is also when the
  // highlight has to move - and once every 30s regardless.
  const target = countdownTarget(now);
  const nextId = target ? target.key + '@' + target.at : 'none';
  if (nextId !== lastNextId) { lastNextId = nextId; renderToday(); }
  else if (++tickCount % 30 === 0) renderToday();

  const events = eventsFor(t.y, t.m, t.d);
  for (const e of events) {
    if (e.sun && settings.sound.sunrise === 'off') continue;
    const delta = now - e.at;
    if (delta >= 0 && delta < 90000) fire(e, 'at');
    if (settings.pre > 0) {
      const preDelta = now - (e.at - settings.pre * 60000);
      if (preDelta >= 0 && preDelta < 90000) fire(e, 'pre');
    }
    if (settings.jam > 0 && e.jamaahAt !== null && !e.sun) {
      const jamDelta = now - (e.jamaahAt - settings.jam * 60000);
      if (jamDelta >= 0 && jamDelta < 90000) fire(e, 'jam');
    }
  }
}

/* ------------------------------------------------------------- wake lock  */

let wakeSentinel = null;
async function applyWakeLock() {
  if (settings.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
    try { wakeSentinel = await navigator.wakeLock.request('screen'); } catch (e) {}
  } else if (wakeSentinel) { try { await wakeSentinel.release(); } catch (e) {} wakeSentinel = null; }
}

/* ------------------------------------------------------------------ boot  */

async function loadTimetable() {
  const stored = LS.get('azan.timetable', null);
  if (window.__AZAN_TIMETABLE__) {
    bundled = window.__AZAN_TIMETABLE__;          // single-file build
  } else {
    try {
      const res = await fetch('data/timetable.json', { cache: 'no-cache' });
      if (res.ok) bundled = await res.json();
    } catch (e) {}
  }
  timetable = stored || bundled || { meta: { name: 'No timetable', placeholder: true }, days: {} };
  if (!timetable.days) timetable.days = {};
}

function applyImport(result, sourceLabel) {
  const previous = (timetable && timetable.meta) || {};
  const meta = Object.assign({}, previous, result.meta || {});
  const keepDays = previous.placeholder ? {} : (timetable && timetable.days) || {};
  delete meta.placeholder;
  meta.source = sourceLabel;
  meta.imported = new Date().toISOString().slice(0, 10);
  // Merge, so importing one month at a time builds up a full year.
  timetable = { meta, days: Object.assign({}, keepDays, result.days) };
  LS.set('azan.timetable', timetable);
  lastDate = ''; viewMonth = null;
  renderAll();
  document.getElementById('importLog').innerHTML =
    '<b>Imported ' + result.count + ' days.</b><br>' + result.warnings.join('<br>');
  toast('Imported ' + result.count + ' days');
}

function wire() {
  function closeMenu() {
    document.getElementById('menu').hidden = true;
    document.getElementById('scrim').hidden = true;
  }
  function showView(name) {
    closeMenu();
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + name));
    if (name === 'month') renderMonth();
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }
  document.getElementById('menuBtn').onclick = () => {
    const open = document.getElementById('menu').hidden;
    document.getElementById('menu').hidden = !open;
    document.getElementById('scrim').hidden = !open;
  };
  document.getElementById('scrim').onclick = closeMenu;
  document.querySelectorAll('#menu button').forEach(b => { b.onclick = () => showView(b.dataset.v); });
  document.querySelectorAll('.topbar button.back').forEach(b => { b.onclick = () => showView('today'); });

  document.getElementById('unlockBtn').onclick = armNotifications;
  document.getElementById('soundToggle').onclick = toggleSound;
  document.getElementById('testBtn').onclick = () => { unlockAudio(); setTimeout(playAzan, 120); };
  document.getElementById('stopBtn').onclick = stopAudio;

  document.getElementById('audioFile').onchange = async ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try { await idbPut('azan', file); await loadAzanAudio(); toast('Azan audio saved'); }
    catch (e) { toast('Could not store the file'); }
    ev.target.value = '';
  };
  document.getElementById('audioReset').onclick = async () => {
    try { await idbDel('azan'); } catch (e) {}
    await loadAzanAudio(); toast('Reset to default');
  };

  document.getElementById('use24').onchange = e => { settings.use24 = e.target.checked; saveSettings(); renderAll(); };
  document.getElementById('preMins').onchange = e => {
    settings.pre = Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0));
    e.target.value = settings.pre; saveSettings();
  };
  document.getElementById('jamMins').onchange = e => {
    settings.jam = Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0));
    e.target.value = settings.jam; saveSettings();
  };
  document.getElementById('wakeLock').onchange = e => { settings.wake = e.target.checked; saveSettings(); applyWakeLock(); };

  document.getElementById('notifBtn').onclick = async () => {
    if (!('Notification' in window)) { toast('Notifications are not supported here'); return; }
    const perm = await Notification.requestPermission();
    renderSettings();
    updateAlerts();
    if (perm === 'granted') notify('Azan notifications on', 'You will be alerted at prayer times while the app is open.');
  };

  document.getElementById('prevM').onclick = () => {
    viewMonth.m--; if (viewMonth.m < 1) { viewMonth.m = 12; viewMonth.y--; } renderMonth();
  };
  document.getElementById('nextM').onclick = () => {
    viewMonth.m++; if (viewMonth.m > 12) { viewMonth.m = 1; viewMonth.y++; } renderMonth();
  };

  document.getElementById('monthSeg').querySelectorAll('button').forEach(btn => {
    btn.onclick = () => { monthCol = btn.dataset.col; renderMonth(); };
  });

  const defMonth = document.getElementById('defMonth');
  defMonth.innerHTML = MONTHS.map((m, i) => '<option value="' + (i + 1) + '">' + m + '</option>').join('');
  defMonth.value = String(todayInZone().m);

  function runImport(text, label) {
    try {
      const result = parseTimetable(text, {
        defaultMonth: +document.getElementById('defMonth').value,
        dateOrder: document.getElementById('dateOrder').value,
        colMode: document.getElementById('colMode').value
      });
      applyImport(result, label);
    } catch (err) {
      document.getElementById('importLog').innerHTML = '<b style="color:#ff8f8f">Import failed:</b> ' + err.message;
      toast('Import failed');
    }
  }

  document.getElementById('importBtn').onclick = () => {
    const text = document.getElementById('importText').value;
    if (!text.trim()) { toast('Paste a timetable first'); return; }
    runImport(text, 'pasted');
  };
  document.getElementById('importFile').onchange = ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => runImport(String(reader.result), file.name);
    reader.readAsText(file);
    ev.target.value = '';
  };
  // A hosted single-file copy cannot hand the viewer a file, so the export
  // button is hidden there rather than left dead.
  if (window.__AZAN_STANDALONE__) document.getElementById('exportBtn').style.display = 'none';
  document.getElementById('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(timetable, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'timetable.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  document.getElementById('resetTT').onclick = () => {
    if (!confirm('Discard the imported timetable and go back to the bundled one?')) return;
    LS.del('azan.timetable');
    timetable = bundled || { meta: { name: 'No timetable', placeholder: true }, days: {} };
    lastDate = ''; viewMonth = null; renderAll(); toast('Reset to bundled timetable');
  };
  document.getElementById('saveMeta').onclick = () => {
    const name = document.getElementById('metaName').value.trim();
    const city = document.getElementById('metaCity').value.trim();
    const tz = document.getElementById('metaTz').value.trim();
    if (tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (e) { toast('Unknown time zone'); return; } }
    timetable.meta = Object.assign({}, timetable.meta,
      { name: name, city: city || undefined, timezone: tz || undefined });
    LS.set('azan.timetable', timetable);
    lastDate = ''; renderAll(); toast('Saved');
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { lastDate = ''; renderAll(); applyWakeLock(); }
  });
  // Any tap on the board also unlocks audio. Taps on the alert controls are
  // left alone: hiding the bar on pointerdown would pull the button out from
  // under the finger, and the click - which is what asks for notification
  // permission - would never land.
  document.addEventListener('pointerdown', function once(ev) {
    const onControl = ev.target && ev.target.closest &&
      ev.target.closest('#audioBanner, #soundToggle, #notifBtn, #testBtn');
    if (onControl) return;
    if (!audioReady) { unlockAudio(); updateAlerts(); }
    document.removeEventListener('pointerdown', once);
  });
}

(async function boot() {
  await loadTimetable();
  wire();
  await loadAzanAudio();
  renderAll();
  renderClock();
  updateAlerts();
  setInterval(tick, 1000);
  tick();
  applyWakeLock();
  if (!window.__AZAN_STANDALONE__ && 'serviceWorker' in navigator) {
    // updateViaCache:'none' stops the browser serving a cached worker, and the
    // reload below picks up a new one without anyone clearing site data.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => { reg.update().catch(() => {}); })
      .catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }
})();
