# Shaheed Bilal Mosque — Prayer Times App
## End-to-end build requirements (for a Lovable rebuild)

**Version of this spec:** 2.0 · **Describes app version:** 2.1.0
**Reference implementation:** this repository (`azan/`) — vanilla HTML/CSS/JS PWA
**Live reference:** https://watouti-ui.github.io/azan/
**Delivery target:** installable **native iOS and Android apps** (see Part B)

This document is written to be pasted into Lovable (in sections) and to be
complete enough that the rebuild is behaviourally identical to the reference.
Every number, colour and rule below is taken from the working build, not from
design intent. Where a value looks arbitrary, it is load-bearing — it was
tuned against photographs of the mosque's physical display board.

## How this document is organised

| | | |
|---|---|---|
| **Part A** | §1–§18 | **The app.** Data, time engine, screens, exact layout, settings, parser, acceptance criteria. Built in Lovable. Reused unchanged whether the app ships as a web app or a native binary. |
| **Part B** | §19–§25 | **Native delivery.** How Part A becomes an App Store / Play Store binary, and the three things that genuinely change: alerts, audio, and how a new month's timetable reaches users. Done outside Lovable. |

**Read §19 first.** Lovable does not build native apps — confirmed against its
own documentation — and §19.4 names a precondition that must be checked before
any feature code is written. Getting that wrong is discovered late and costs a
rebuild.

**If you only want the web app**, Part A alone is complete and is what the
reference implementation already is. Stop at §18.

---

# PART A — THE APP

Everything in §1–§18 is the app itself, and is identical in the web build and
inside the native shell. Build it in Lovable; verify it against §14 before
going anywhere near Part B.

---

# 1. Product definition

## 1.1 What it is

A single-mosque prayer-times app for **Shaheed Bilal Masjid, Dublin 15**,
presented as a pixel-replica of the mosque's physical display board. It is
installable to a phone home screen and works offline.

## 1.2 Core principle — no calculation

**Prayer times are never computed.** They are read from a timetable
transcribed from the mosque's printed sheet. The app does not use a
calculation method, latitude/longitude, angles, or any remote prayer-time API.
Accuracy is the accuracy of the transcribed sheet.

This is a hard requirement. Any implementation that calculates times from
coordinates is wrong, even if the output looks close.

## 1.3 Two times per prayer

Every prayer carries two times:

| Term | Meaning | Column header |
|---|---|---|
| **Adhan** (begins) | the call to prayer | `ADHAN` |
| **Iqamah** (jamaah) | the congregation | `IQAMAH` |

Sunrise has only one time and no iqamah.

## 1.4 Non-goals

- No qibla compass, no tasbih, no Quran, no mosque finder, no multi-mosque support.
- No account, no login, no analytics, no tracking, no ads.
- No calculated times, no geolocation.
- No server-side component in Phase 1. Background alerts are an **option**,
  specified in full in §13, behind a feature flag that is off by default.

## 1.5 Audiences

1. The mosque's congregation — opens the app, reads today's times, wants a
   nudge at prayer time.
2. People who want the notification **without** the sound (this drove a
   specific requirement — see §9.1).

---

# 2. Target stack (Lovable)

Lovable scaffolds React + Vite + TypeScript + Tailwind + shadcn/ui. Build on
that, with these constraints.

**Before using this table, read §19.4.** The project must emit a **static,
client-only build** or the native shell in Part B cannot package it, and
Lovable's current default framework may not do that without configuration.

| Concern | Requirement |
|---|---|
| Framework | React 18 + TypeScript, Vite |
| Routing | **No router.** Three views toggled by local state (see §5). A router adds URL states that break the installed-app feel. |
| Styling | Tailwind, **plus one plain CSS file** for the board (`src/board.css`). The board's vertical rhythm is `clamp()`/`vh`-based and far more readable as CSS than as Tailwind arbitrary values. Import it once in the board component. |
| shadcn/ui | Use it for Settings controls only (Switch, Select, Input, Button, Sheet, Toast). **Do not** use it on the board — the board must not look like a component library. |
| State | React state + a small `useSettings()` hook over `localStorage`. No Redux, no Zustand, no React Query. |
| Engine code | Pure TypeScript modules with **zero React imports**: `src/engine/time.ts`, `hijri.ts`, `timetable.ts`, `countdown.ts`, `parser.ts`. These are unit-testable and must be tested (§14). |
| Dates | **No date library.** No `date-fns`, no `dayjs`, no `luxon`, no `moment`. Use `Intl.DateTimeFormat` only (see §4). Adding a date library will break DST handling in a way that is hard to see. |
| PWA | `vite-plugin-pwa` in `injectManifest` mode with a **custom service worker source** (§12). `generateSW` mode cannot carry the push handlers. |
| Dependencies | Keep it to React, Vite, Tailwind, shadcn primitives, `vite-plugin-pwa`. Nothing else. |

## 2.1 Lovable-specific warnings

- **The Lovable preview runs in an iframe.** `Notification.requestPermission()`,
  service-worker registration and `navigator.wakeLock` are unreliable or
  blocked there. All notification, PWA and install testing must be done on the
  published URL in a real browser tab, not in the preview pane.
- `100svh` is required (not `100vh`) or the board is cut off by mobile browser
  chrome. Tailwind: `h-[100svh]`.
- Do not let Tailwind Preflight reset the board away: the board sets its own
  explicit background, and every colour is painted explicitly because the board
  is a replica of a physical object. **There is no dark mode.** Set
  `color-scheme: light` and do not add a `dark:` variant anywhere.
- Lovable will want to add a header/nav shell. Refuse it — the board is the
  whole viewport (§6.1).

---

# 3. Data model

## 3.1 Timetable JSON

One file: `public/data/timetable.json`. Shape:

```jsonc
{
  "meta": {
    "timezone": "Europe/Dublin",      // IANA name. Required.
    "name": "Shaheed Bilal Masjid",   // shown in the footer
    "city": "Dublin 15",              // shown in the countdown label
    "hijriYear": 1448,                // fallback only; normally computed
    "jummahSummer": ["13:40", "14:40"],  // khutba times during DST
    "jummahWinter": ["12:30", "13:20"],  // khutba times outside DST
    "jummah": ["13:40", "14:40"],        // used when there is no seasonal pair
    "notes": [
      "Maghrib salah 5 min after azan",
      "Isha salah 5 min after azan"
    ],
    "jamaah": true,                   // true => render the IQAMAH column
    "source": "printed timetable: 2026-09, 2026-10",
    "coverage": ["09", "10"],         // months present, as MM strings
    "placeholder": false              // true => show the "sample" warning banner
  },
  "days": {
    "09-01": {                        // key is MM-DD — year-agnostic on purpose
      "fajr": "04:49",
      "sunrise": "06:30",
      "dhuhr": "13:28",
      "asr": "17:12",
      "maghrib": "20:21",
      "isha": "21:55",
      "hijri": "18 Rabi' al-Awwal",   // as printed; a display fallback only
      "jamaah": {
        "fajr": "05:30",
        "dhuhr": "13:50",
        "asr": "17:30",
        "maghrib": "20:26",
        "isha": "22:00"
      }
    }
  }
}
```

### Rules

- Day keys are `MM-DD`, **not** `YYYY-MM-DD`. The timetable is treated as
  repeating annually; the year is never matched. This is deliberate: a mosque
  sheet is reissued each year with near-identical times, and a year-keyed file
  would go blank on 1 January.
- All times are `HH:MM` 24-hour, zero-padded, in the mosque's local wall clock.
- `sunrise` must never appear in `jamaah`.
- A missing day renders as "No times" (§6.8), not as an error.
- 29 February falls back to the `02-28` entry if `02-29` is absent.
- `coverage` and `source` are informational; `coverage` drives the banner in
  §7.4 but can be recomputed from `days` keys.

## 3.2 Prayer identifiers

Fixed order, used for rendering and for column mapping:

```ts
const PRAYERS = [
  { key: 'fajr',    name: 'Fajr',    icon: '🌙' },
  { key: 'sunrise', name: 'Sunrise', icon: '🌅', sun: true },
  { key: 'dhuhr',   name: 'Dhuhr',   icon: '☀️' },
  { key: 'asr',     name: 'Asr',     icon: '🌇' },
  { key: 'maghrib', name: 'Maghrib', icon: '🌆' },
  { key: 'isha',    name: 'Isha',    icon: '🌌' },
] as const;

// Prayers whose 12-hour printed times are always afternoon/evening.
const PM_KEYS = new Set(['dhuhr', 'asr', 'maghrib', 'isha']);
```

`sun: true` marks Sunrise, which is treated differently in five places:
no iqamah cell, no sound badge, its adhan time renders in the ADHAN column
(not spanning), it defaults to `off` for sound, and it is skipped by the
iqamah-reminder alert.

## 3.3 Seed data — required

The rebuild must ship with the real 61 days: **September 2026 (30 days) and
October 2026 (31 days)**, copied verbatim from
`azan/data/timetable.json` in this repository. Do not re-transcribe and do not
regenerate: those days were verified row-by-row against the printed sheet and
two photographs of the mosque board, and October's PDF had 14 rows with
scrambled column positions that were resolved by constraint-solving.

Spot values to confirm the file loaded correctly:

| Date | Fajr | Sunrise | Dhuhr | Asr | Maghrib | Isha |
|---|---|---|---|---|---|---|
| 01 Sep | 04:49 / 05:30 | 06:30 | 13:28 / 13:50 | 17:12 / 17:30 | 20:21 / 20:26 | 21:55 / 22:00 |
| 08 Sep | 05:03 / 05:30 | 06:42 | 13:25 / 13:50 | 17:02 / 17:30 | 20:05 / 20:10 | 21:38 / 21:43 |
| 04 Oct | 05:49 / 06:15 | 07:27 | 13:16 / 13:50 | 16:17 / 17:00 | 19:01 / 19:06 | 20:33 / 20:38 |
| 24 Oct | 06:22 / 06:45 | 08:03 | 13:11 / 13:50 | 15:41 / 16:30 | 18:15 / 18:20 | 19:50 / 20:00 |
| 25 Oct | 05:24 / 06:00 | 07:05 | 12:11 / 13:25 | 14:39 / 15:30 | 17:13 / 17:18 | 18:48 / 20:00 |
| 31 Oct | 05:34 / 06:00 | 07:16 | 12:10 / 13:25 | 14:30 / 15:30 | 17:00 / 17:05 | 18:37 / 20:00 |

Note the 25 October discontinuity — that is the end of DST, and the sheet's
times from that day are already GMT. The app must not "correct" it.

## 3.4 Authoring source (optional but recommended)

The reference keeps human-editable monthly text files and a build script:

```
tools/tables/2026-09.txt     # one file per month, transcribed as printed
tools/tables/2026-10.txt
tools/build_timetable.py     # merges them into data/timetable.json
```

Row format, pipe-separated into exactly 8 groups:

```
day | hijri | fajr [iqamah] | sunrise | dhuhr [iqamah] | asr [iqamah] | maghrib [iqamah] | isha [iqamah]
```

Header lines before the rows (`key: value`, one per line):
`month:` (required, `YYYY-MM`), `name:`, `city:`, `tz:`, `hijri_year:`,
`jummah:`, `jummah_summer:`, `jummah_winter:` (comma-separated times),
`note:` (repeatable). Lines starting `#` are comments.

Example:

```
month: 2026-10
name: Shaheed Bilal Masjid
city: Dublin 15
tz: Europe/Dublin
hijri_year: 1448
jummah_summer: 13:40, 14:40
jummah_winter: 12:30, 13:20
note: Maghrib salah 5 min after azan
note: Isha salah 5 min after azan

 1 |  18 Rabi' al-Akhir |  5:44  6:15 |  7:22 |  1:17  1:50 |  4:22  5:00 |  7:08  7:13 |  8:40  8:45
```

Printed times are 12-hour with no meridiem. Resolve each **value**
independently: if the hour is > 12 it is already 24-hour; otherwise, for
`dhuhr`/`asr`/`maghrib`/`isha`, add 12. Never infer a single format for the
whole file — real sheets mix them within one row (Isha printed as `21:55`
while the rest of the row is 12-hour).

Reimplementing this script in Node/TS is fine. Keeping it in Python is fine
too; it is a build-time tool and never ships to the browser.

---

# 4. Time engine (`src/engine/time.ts`)

This is the part most likely to be got wrong. Read all of §4 before writing code.

## 4.1 Why not a date library

The app must render the mosque's **wall-clock** times in the mosque's time
zone, on a device that may be in any time zone, across a DST transition that
falls inside the shipped data. Naïve arithmetic (`midnight + minutes`) is one
hour wrong on 25 October. `Intl.DateTimeFormat` is the only dependency-free
primitive that knows the IANA rules the browser already ships.

## 4.2 Zone helpers — implement exactly

```ts
type Parts = { y:number; m:number; d:number; hh:number; mm:number; ss:number };

/** The timetable's zone, falling back to the device zone. */
function zoneName(meta?: Meta): string {
  const tz = meta?.timezone;
  if (tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch {} }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Wall-clock fields of `date` as seen in `tz`. hourCycle h23 => 00..23. */
function zoneParts(date: Date, tz: string): Parts {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce<Record<string,string>>((a, x) => (a[x.type] = x.value, a), {});
  return { y:+p.year, m:+p.month, d:+p.day, hh:+p.hour, mm:+p.minute, ss:+p.second };
}

/** Milliseconds that `tz` is ahead of UTC at `date`. */
function zoneOffsetMs(date: Date, tz: string): number {
  const p = zoneParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Epoch ms for a wall-clock time in `tz`. Two passes => DST-safe. */
function epochOf(y:number, m:number, d:number, hh:number, mm:number, tz:string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let ts = guess - zoneOffsetMs(new Date(guess), tz);
  ts = guess - zoneOffsetMs(new Date(ts), tz);   // second pass fixes the DST edge
  return ts;
}

function todayInZone(tz: string): Parts { return zoneParts(new Date(), tz); }

function addDays(t: Parts, n: number): Pick<Parts,'y'|'m'|'d'> {
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
```

**The two-pass `epochOf` is required.** A single pass is wrong for times near
a transition, because the offset is looked up at the wrong instant. The
`Math.floor(.../1000)*1000` in `zoneOffsetMs` discards sub-second noise so the
two passes converge.

## 4.3 Building the day's events

```ts
type Event = {
  key: string; name: string; icon: string; sun: boolean;
  minutes: number;        // minutes past midnight, adjusted (see §4.4)
  at: number;             // epoch ms of the adhan
  jamaah: number | null;  // minutes past midnight, unadjusted
  jamaahAt: number | null;// epoch ms of the iqamah
  date: string;           // 'YYYY-MM-DD' of the day it belongs to
};

function eventsFor(y:number, m:number, d:number): Event[] {
  const entry = dayEntry(m, d);          // timetable.days['MM-DD']
  if (!entry) return [];
  const tz = zoneName(meta), out: Event[] = [];
  for (const p of PRAYERS) {
    const mins = minutesFor(entry, p.key, 'begins');
    if (mins === null) continue;
    // Built from the wall-clock hour and minute, NOT midnight + minutes:
    // adding minutes to midnight is an hour out on a DST-change day.
    const hh = Math.floor(mins / 60), mi = ((mins % 60) + 60) % 60;
    const jam = minutesFor(entry, p.key, 'jamaah');
    out.push({
      key: p.key, name: p.name, icon: p.icon, sun: !!p.sun, minutes: mins,
      at: epochOf(y, m, d, hh, mi, tz),
      jamaah: jam,
      jamaahAt: jam === null ? null
        : epochOf(y, m, d, Math.floor(jam / 60), ((jam % 60) + 60) % 60, tz),
      date: `${y}-${pad(m)}-${pad(d)}`,
    });
  }
  return out.sort((a, b) => a.at - b.at);
}
```

The sort matters: on a DST-change day the printed order and the chronological
order can differ.

## 4.4 Per-prayer adjustments

```ts
function minutesFor(entry, key, which: 'begins'|'jamaah'): number | null {
  const src = which === 'jamaah' ? entry?.jamaah : entry;
  if (!src?.[key]) return null;
  const [h, m] = String(src[key]).split(':');
  const base = (+h) * 60 + (+m);
  return base + (which === 'jamaah' ? 0 : (settings.offsets[key] || 0));
}
```

**Adjustments apply to adhan times only.** Iqamah times are the mosque's
decision and must never shift. Range −60..+60 minutes per prayer.

## 4.5 Formatting

```ts
const pad = (n:number) => String(n).padStart(2, '0');
const mmdd = (m:number, d:number) => pad(m) + '-' + pad(d);

/** The board prints 24h with NO leading zero on the hour: 5:03, 13:25.
 *  padHour=true is for the month grid, where columns must line up. */
function fmtTime(minutes:number, padHour = false): string {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60), m = t % 60;
  if (settings.use24) return (padHour ? pad(h) : h) + ':' + pad(m);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + pad(m) + ' ' + ap;
}

/** Always hh:mm:ss, as on the board: 00:15:40. */
function fmtDur(ms:number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return pad(Math.floor(total / 3600)) + ':' +
         pad(Math.floor((total % 3600) / 60)) + ':' + pad(total % 60);
}
```

The leading-zero rule is not cosmetic — the physical board prints `5:03`, and
an earlier build showing `05:03` was rejected on comparison with the photos.

## 4.6 Summer time detection

```ts
/** True when the zone's offset on this day differs from mid-January's. */
function inSummerTime(t: {y:number;m:number;d:number}): boolean {
  const tz = zoneName(meta);
  const january  = zoneOffsetMs(new Date(Date.UTC(t.y, 0, 15, 12)), tz);
  const onTheDay = zoneOffsetMs(new Date(Date.UTC(t.y, t.m - 1, t.d, 12)), tz);
  return onTheDay !== january;
}
```

Mid-January is the reference because it is standard time in every northern
zone. Noon UTC avoids landing on a transition instant. This has **no
hard-coded transition dates** and keeps working in future years and other
zones.

## 4.7 Seasonal Jummah (khutba) times

```ts
function jummahTimes(meta: Meta, t: {y:number;m:number;d:number}): string[] | undefined {
  if (meta.jummahSummer || meta.jummahWinter) {
    return (inSummerTime(t) ? meta.jummahSummer : meta.jummahWinter) || meta.jummah;
  }
  return meta.jummah;
}
```

For this mosque: summer **13:40 / 14:40**, winter **12:30 / 13:20**.

---

# 5. Hijri date (`src/engine/hijri.ts`)

## 5.1 Requirement

The Hijri date must match **https://hijri-calendar.com/en/**. That site
publishes the **Umm al-Qura** calendar. The browser already has it.

```ts
const HIJRI_SHORT = ['Muh','Saf','Rab1','Rab2','Jum1','Jum2',
                     'Raj','Sha','Ram','Shw','Qad','Hij'];

function hijriParts(t: {y:number;m:number;d:number}) {
  try {
    const p = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric',
    }).formatToParts(new Date(Date.UTC(t.y, t.m - 1, t.d, 12)))
      .reduce<Record<string,string>>((a, x) => (a[x.type] = x.value, a), {});
    const month = parseInt(p.month, 10), day = parseInt(p.day, 10);
    if (!month || !day) throw new Error('no islamic calendar');
    return {
      day: String(day),
      month: HIJRI_SHORT[month - 1] ?? String(month),
      year: String(p.year).replace(/\D/g, ''),
    };
  } catch {
    // No Umm al-Qura support: fall back to the string in the timetable row.
    const entry = dayEntry(t.m, t.d);
    return entry ? hijriFromText(entry.hijri) : null;
  }
}
```

Notes:
- `timeZone: 'UTC'` with **noon** UTC. Any other hour risks tipping to the
  adjacent Gregorian day for some device zones.
- `calendar: 'islamic-umalqura'` as an option does **not** work reliably; the
  `-u-ca-` locale extension does. Use the locale form.
- Do **not** use `islamic`, `islamic-civil` or `islamic-tbla` — they differ by
  a day or two and will not match the published calendar.

## 5.2 Fallback parser

When Umm al-Qura is unavailable, parse the `hijri` string printed in the row
(e.g. `"18 Rabi' al-Awwal"`) into `{day, month}` using these patterns, in
order (first match wins — `rabi' al-akhir` must be tested before `rabi`):

```ts
const HIJRI_PATTERNS: [RegExp, string][] = [
  [/muharram/i,'Muh'], [/safar/i,'Saf'],
  [/rabi.*(akhir|thani|ii\b|2)/i,'Rab2'], [/rabi/i,'Rab1'],
  [/jumada.*(akhir|thani|ii\b|2)/i,'Jum2'], [/jumada/i,'Jum1'],
  [/rajab/i,'Raj'], [/sha.?ban/i,'Sha'], [/ramad/i,'Ram'], [/shaww/i,'Shw'],
  [/qa.?d/i,'Qad'], [/hijj/i,'Hij'],
];
```

## 5.3 Known and accepted divergence

The computed Umm al-Qura date runs **one day ahead** of the Hijri date printed
on the mosque's sheet throughout this period (1 Sep 2026: computed `Rab1 19`,
sheet `18 Rabi' al-Awwal`. 31 Oct 2026: computed `Jum1 20`, sheet
`19 Jumada al-Ula`). This is expected and correct per the
instruction to follow hijri-calendar.com. Do not "fix" it by preferring the
printed string.

Verification anchors (Umm al-Qura, confirmed against hijri-calendar.com):

| Gregorian | Hijri |
|---|---|
| 01 Sep 2026 | Rab1 19 1448 |
| 12 Sep 2026 | Rab2 1 1448 |
| 02 Oct 2026 | Rab2 21 1448 |
| 04 Oct 2026 | Rab2 23 1448 |
| 12 Oct 2026 | Jum1 1 1448 |
| 31 Oct 2026 | Jum1 20 1448 |

---

# 6. Screen 1 — The Board (primary view)

## 6.1 Hard layout constraints

1. **The whole dashboard fits in one viewport. No vertical scrolling. Ever.**
   `height: 100svh; overflow: hidden`. This was tested and signed off at
   320 / 375 / 390 / 430 px widths.
2. The prayer-table header row (`PRAYER | ADHAN | IQAMAH`) must sit at
   **26–30.5% of viewport height** from the top. Current build: 26.4% at
   430×932, 26.5% at 390×844. This is the single acceptance number for the
   header composition.
3. `max-width: 560px`, centred, so it does not stretch on a tablet.
4. The six prayer rows share the leftover height equally (`flex: 1 1 0` each),
   so the table always ends flush with the bottom of the mat.
5. Transient strips (sample-data warning, Jummah line, notification bar) sit
   **below** the rows, not above. Putting them above pushes the table down the
   screen and breaks constraint 2 whenever one appears.

## 6.2 DOM / component structure

```
<section id="v-today">
  <div class="board">                 height:100svh, flex column, overflow hidden
    <div class="mat">                 flex:1 1 auto, min-height:0, position:relative
      <svg class="matline">           position:absolute inset:0, z-index:0  (§6.3)
      <div class="crown">             flex:0 0 auto  — dates, mark, clock
        <div class="dates">
          <div class="dstack" id="todayDate">     Oct <b>4</b> 2026
          <div class="dstack right" id="todayHijri">  Rab2 <b>23</b> 1448
        <div class="mark">            centred masjid glyph (SVG)
        <div class="clock">           10:30:17
      <div class="thead">             PRAYER | ADHAN | IQAMAH
      <ul class="times">              6 × <li>
    </div>
    <div class="overlays">            flex:0 0 auto; display:none when empty
      <div class="banner sample">     hidden unless meta.placeholder
      <div class="jumline">           hidden unless Friday
      <div class="alertbar">          hidden when notifications granted
    </div>
    <div class="upnext">              DHUHR  01:45:58
    <div class="progress"><i/></div>
    <div class="foot">                Today @ Dublin ·  |  Shaheed Bilal Masjid  |  ☰
    <div class="soundrow"><button/></div>
  </div>
</section>
```

Every direct child of `.mat` except the SVG needs `position:relative; z-index:1`
so it paints above the mat artwork.

## 6.3 The mat (the single most distinctive element)

The arch is **one continuous mihrab-shaped mat** that encloses the clock *and*
the entire timetable. Its dome sits at the top, its two walls run the full
height, and it closes with rounded corners under the last prayer row. It is
not a decorative header arch, and it must not draw any line between the clock
and the table.

### Why it is generated in JavaScript

A static SVG with `preserveAspectRatio="none"` distorts the dome when the mat
is tall. The outline is therefore rebuilt in **real pixels** whenever the mat
resizes: the dome keeps a constant proportion of the mat's width while the
walls stretch to whatever height the timetable needs.

### Geometry — implement exactly

```ts
// Dome silhouette in a 100 × 41 box, scaled to the dome's pixel size.
const DOME: (string|number)[][] = [
  ['M', 2,41], ['C', 2,33, 4,27, 11,27], ['C', 17,27, 19,23, 21,18],
  ['C', 25,9, 38,4, 44,4], ['L', 50,0], ['L', 56,4],
  ['C', 62,4, 75,9, 79,18], ['C', 81,23, 83,27, 89,27], ['C', 96,27, 98,33, 98,41],
];

function matOutline(w:number, h:number, inset:number, domeH:number, radius:number): string {
  const sx = (w - inset * 2) / 100, sy = domeH / 41;
  const X = (x:number) => (inset + x * sx).toFixed(1);
  const Y = (y:number) => (inset + y * sy).toFixed(1);
  let d = '';
  for (const seg of DOME) {
    const [cmd, ...n] = seg as [string, ...number[]];
    d += ' ' + cmd;
    for (let i = 0; i < n.length; i += 2) d += ' ' + X(n[i]) + ' ' + Y(n[i+1]);
  }
  const right = +X(98), left = +X(2), bottom = h - inset;
  const r = Math.min(radius, (right - left) / 2);
  d += ` L ${right} ${bottom - r}`;
  d += ` A ${r} ${r} 0 0 1 ${right - r} ${bottom}`;
  d += ` L ${left + r} ${bottom}`;
  d += ` A ${r} ${r} 0 0 1 ${left} ${bottom - r} Z`;
  return d.trim();
}

function drawMat() {
  const mat = matRef.current, svg = svgRef.current;
  if (!mat || !svg) return;
  const w = mat.clientWidth, h = mat.clientHeight;
  if (!w || !h) return;
  const domeH = Math.max(64, Math.min(w * 0.3, h * 0.42));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const outer = matOutline(w, h, 1, domeH,     16);
  const inner = matOutline(w, h, 7, domeH - 6, 12);
  setPath('matShape',  outer);   // fill #f4f1e8
  setPath('matFill',   outer);   // fill url(#matfill) — the diamond pattern
  setPath('matStroke', outer);   // stroke #bdb5a3, 1.2
  setPath('matInner',  inner);   // stroke #d2cbba, 1
}
```

- `domeH = max(64, min(w*0.3, h*0.42))` — the dome is 30% of width, capped at
  42% of height, never below 64 px.
- Four paths over the same outline: solid fill, pattern fill, outer stroke,
  and an inset second stroke 6 px in. The double line reads as a woven border.
- The SVG does **not** set `preserveAspectRatio="none"` once the viewBox is in
  real pixels — the viewBox matches the element, so the default is correct.
- Both `width` and `height` must be set to `100%` **explicitly** in CSS. If
  either is left to `auto`, the viewBox ratio drives it and the mat ends up
  narrower than its box (an earlier bug: 287 px of outline in a 381 px box).

### Redraw triggers

`ResizeObserver` on `.mat` (primary), plus `window.resize`, plus
`orientationchange` with a 120 ms delay (iOS reports stale dimensions
immediately after rotation). In React: `useLayoutEffect` + a `ResizeObserver`,
and call it once after first paint.

### Pattern definition

```html
<defs>
  <pattern id="matfill" width="7" height="7" patternUnits="userSpaceOnUse">
    <path d="M3.5 0 L7 3.5 L3.5 7 L0 3.5 Z" fill="#e8e4d8" opacity=".5"/>
  </pattern>
</defs>
```

## 6.4 Colour tokens

Fixed palette — a replica of a physical board, so **not** theme-aware:

```css
:root{
  --sand:#e7e0d2;  --sand-2:#efe9dd;  --arch:#fbfaf7;  --arch-line:#c7c0b1;
  --row-a:#ffffff; --row-b:#eeebe4;   --row-line:#e2ddd2;
  --ink:#1f2333;   --ink-2:#3d4152;   --ink-soft:#7b7f90;
  --gold:#f6e2b4;  --gold-2:#b98d42;  --gold-line:#9d7f3f;
  --blue:#7fc8ea;  --blue-2:#c3e6f7;  --blue-ink:#1272a6; --blue-cap:#4aa9d6;
  --rule:#2a2e3d;
}
```

Board background — three stacked layers (two hatch patterns over a gradient),
which is what gives the board its woven-canvas look:

```css
background:
  repeating-linear-gradient( 45deg, rgba(255,255,255,.35) 0 2px, transparent 2px 11px),
  repeating-linear-gradient(-45deg, rgba(190,180,158,.16) 0 2px, transparent 2px 11px),
  linear-gradient(180deg,#e9e2d4,#efe9dd 55%,#e6dfd0);
```

## 6.5 Typography and vertical rhythm — exact values

Every size is `clamp(min, min(vw, vh), max)`. The `min(vw, vh)` term is
essential: a vw-only scale overflows a short viewport, and a vh-only scale
under-fills a wide one.

```css
.board{ --col: clamp(64px, 20vw, 104px); }   /* ADHAN and IQAMAH column width */

.crown{ padding: clamp(4px,1vh,12px) 14px clamp(9px,3.4vh,36px); }

.dstack{ font-size: clamp(10px, min(3vw,1.6vh), 14px); line-height:1.18;
         color:var(--ink-2); font-weight:400; min-width:46px; }
.dstack b{ display:block; font-size: clamp(20px, min(6.4vw,3.4vh), 34px);
           line-height:1.02; font-weight:600; color:var(--ink); margin:1px 0; }
.dstack.right{ text-align:right; }

.mark{ position:absolute; left:50%; transform:translateX(-50%);
       top: clamp(16px,4.2vh,42px);
       width: clamp(46px, min(13.5vw,8vh), 82px); }

.clock{ text-align:center; line-height:1.02;
        margin: clamp(16px,6.2vh,60px) 0 clamp(1px,.4vh,6px);
        font-size: clamp(42px, min(19vw,11.4vh), 98px);
        font-weight:700; letter-spacing:.004em; font-variant-numeric:tabular-nums;
        color:var(--gold);
        -webkit-text-stroke:1.7px var(--gold-2);
        text-shadow:0 1px 0 rgba(140,110,52,.42); }

.thead{ display:grid; grid-template-columns:1fr var(--col) var(--col);
        align-items:center; margin:0 17px; padding: clamp(3px,.7vh,8px) 6px;
        border-top:1.1px solid rgba(42,46,61,.75);
        border-bottom:1.1px solid rgba(42,46,61,.75);
        font-size: clamp(10px, min(3.2vw,1.6vh), 13px);
        color:var(--ink-soft); font-weight:400; letter-spacing:.06em; }
.thead .c2,.thead .c3{ text-align:center; }

ul.times{ list-style:none; margin:0; flex:1 1 auto; min-height:0;
          display:flex; flex-direction:column; gap: clamp(2px,.45vh,5px);
          padding: clamp(3px,.6vh,7px) 15px clamp(8px,1.5vh,18px); }

ul.times li{ position:relative; flex:1 1 0; min-height:0; display:grid;
             grid-template-columns:1fr var(--col) var(--col);
             align-items:center; padding:0 8px; border-radius:7px;
             overflow:hidden; background:#fdfcf9;
             box-shadow:0 1px 0 rgba(120,110,88,.07); }

.pname{ font-weight:300; letter-spacing:.04em; text-transform:uppercase;
        font-size: clamp(13px, min(4.2vw,2.2vh), 21px);
        min-width:0; padding-left: clamp(6px,2.2vw,14px); }
.t{ text-align:center; font-variant-numeric:tabular-nums;
    font-size: clamp(18px, min(5.8vw,3vh), 31px);
    font-weight:300; color:var(--ink); }
.t.none{ color:transparent; }
.snd{ display:none; }

.upnext{ display:flex; align-items:baseline; justify-content:center; gap:10px;
         padding: clamp(5px,1.1vh,12px) 14px clamp(3px,.6vh,7px); }
.upnext .n { font-size: clamp(15px, min(4.6vw,2.4vh), 24px); font-weight:600;
             letter-spacing:.05em; text-transform:uppercase; color:var(--ink); }
.upnext .cd{ font-size: clamp(15px, min(4.8vw,2.5vh), 25px); font-weight:500;
             font-variant-numeric:tabular-nums; color:#1596cf; }

.progress{ height: clamp(4px,.7vh,8px); margin:0 12px; border-radius:4px;
           background:rgba(190,180,158,.35); overflow:hidden; }
.progress i{ display:block; height:100%;
             background:linear-gradient(90deg,#35b6e8,#7fd3f1);
             width:0; transition:width .4s linear; }

.foot{ display:grid; grid-template-columns:1fr auto 1fr; align-items:center;
       gap:8px; padding: clamp(5px,1vh,11px) 14px clamp(3px,.7vh,8px);
       color:var(--ink-2); }
.foot .l{ justify-self:start; white-space:nowrap; overflow:hidden;
          text-overflow:ellipsis; font-size: clamp(10px, min(3vw,1.5vh), 13px); }
.foot .m{ justify-self:center; font-weight:400; color:var(--ink);
          font-size: clamp(11px, min(3.4vw,1.7vh), 15px);
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.foot .r{ justify-self:end; display:flex; align-items:center; }

.soundrow{ padding:0 12px clamp(5px,1.1vh,13px); }
.soundrow button{ width:100%; padding: clamp(6px,1.2vh,12px); border-radius:9px;
                  font-size: clamp(12px, min(3.6vw,1.7vh), 15px); font-weight:500;
                  background:#fff; border:1px solid var(--row-line); color:var(--ink); }
.soundrow button.muted{ background:#eaf4fb; border-color:#a8cfe6; color:var(--blue-ink); }
```

Typography intent, stated so it is not "improved" away: prayer names and times
are **light weight (300)**, uppercase, widely spaced — the board is calm, not
bold. Only the clock (700), the date numerals (600) and the countdown name
(600) are heavy.

## 6.6 Row states

Three mutually compatible states on each `<li>`:

| State | Condition | Styling |
|---|---|---|
| default | — | `background:#fdfcf9` |
| `.passed` | `event.at <= now` and the table is showing today | `opacity:.88` on the name and times **only** — a deliberately light fade. Earlier builds faded to .55 and were rejected as unreadable. |
| `.current` | `event.key === countdownTarget(now).key` and the table is showing today | cyan treatment below |

```css
ul.times li.passed .pname,
ul.times li.passed .t{ opacity:.88; }

ul.times li.current{ background:linear-gradient(100deg,#c4ebfa,#dcf4fd 60%,#cfeffc); }
ul.times li.current:before{ content:""; position:absolute; left:0; top:0; bottom:0;
  width:8px; border-radius:7px 0 0 7px; background:#35b6e8; }
ul.times li.current .pname,
ul.times li.current .t{ color:#17a9e8; opacity:1; font-weight:500;
  -webkit-text-stroke:.4px #0d82b8;
  text-shadow:0 1px 0 rgba(255,255,255,.95); }
```

The 8 px cyan cap on the left edge and the thin darker text stroke are both
required — they are what makes the active row readable against its own pale
background.

**The highlight follows the countdown, not the clock.** It is the row the
countdown is running towards. A previous build highlighted "the last prayer
that passed", which left Fajr lit for eight hours. See §7.1.

## 6.7 Row content

```
| PRAYER NAME      |  adhan  |  iqamah |
```

- Sunrise renders **one** time cell, in the ADHAN column, and no iqamah cell.
- A prayer with no iqamah in the data renders an em dash in a `.t.none` cell
  (transparent colour — it holds the column width without printing anything).
- The IQAMAH column is rendered only when `meta.jamaah === true` **and** at
  least one event in the day has an iqamah.
- A per-prayer sound badge (`🔊` azan / `🔔` chime / `🔇` silent) is computed
  and placed in a `.snd` span, which is `display:none` in the current build.
  Keep the markup; it is the hook for a future per-row sound toggle.

## 6.8 Empty day

When the timetable has no entry for the shown date, the list renders a single
row:

> **No times** — This timetable does not cover 4 November. Add that month in
> Settings → Timetable.

## 6.9 Header content

- **Left stack:** `Oct` / **`4`** / `2026` — short month, big day, year.
  Markup: `MONTHS_SHORT[m-1] + '<b>' + d + '</b>' + y`.
- **Right stack:** `Rab2` / **`23`** / `1448` — same shape, Hijri.
- **Centre:** the masjid mark, absolutely positioned, overlapping both stacks.
- Both stacks always show **today's** date, even when the table below has
  flipped to tomorrow (§7.2). The board does this and so must the app.

## 6.10 The masjid mark

Inline SVG, `viewBox="0 0 100 116"`, single ink colour `#1f2333`:
- Two rows of seven 4×7 merlons (crenellations) at `y=33` and `y=100`,
  at `x = 24, 32, 40, 48, 56, 64, 72`.
- Outer wall: `rect x=22 y=40 w=56 h=60`, no fill, stroke-width 5.
- Inner wall: `rect x=31 y=49 w=38 h=42`, no fill, stroke-width 2.
- Mihrab niche: `path d="M40 91 L40 66 A10 10 0 0 1 60 66 L60 91 Z"`, filled.

## 6.11 Footer, countdown and controls

- `.upnext`: target name in caps + `hh:mm:ss` countdown.
- `.progress`: fills across the interval the countdown is running (§7.3).
- `.foot` left: `Today @ Dublin ·` or `Tomorrow @ Dublin ·`. The city comes
  from `meta.city` with a trailing number stripped (`Dublin 15` → `Dublin`),
  falling back to the last segment of the IANA zone.
- `.foot` centre: `meta.name`.
- `.foot` right: hamburger button (24×24 three-line icon) opening the menu sheet.
- `.soundrow`: full-width button, the **only** sound control on the board (§9.1).

---

# 7. Board behaviour / state machine

## 7.1 The countdown target — the heart of the app

This one function decides the countdown label, the countdown value, the
progress bar's interval, and which row is highlighted. Implement it exactly.

```ts
type Target = { label:string; at:number; key:string; from:number };

function countdownTarget(now:number): Target | null {
  const t = todayInZone(tz);
  const today = eventsFor(t.y, t.m, t.d);

  // 1. While a prayer's adhan has gone but its congregation has not, count
  //    down to that prayer's IQAMAH and keep that row highlighted.
  for (const e of today) {
    if (!e.sun && e.jamaahAt !== null && e.at <= now && now < e.jamaahAt) {
      return { label: e.name + ' Iqamah', at: e.jamaahAt, key: e.key, from: e.at };
    }
  }

  // 2. Otherwise the next event still to come — Sunrise included, because it
  //    is the end of Fajr's window and the board counts down to it too.
  let upcoming = today.filter(e => e.at > now);
  const previous = today.filter(e => e.at <= now);
  if (!upcoming.length) {
    const nx = addDays(t, 1);
    upcoming = eventsFor(nx.y, nx.m, nx.d).filter(e => e.at > now);
  }
  if (!upcoming.length) return null;

  const next = upcoming[0];
  // The progress bar starts at the previous event, or an hour back if the
  // day has not started yet.
  const from = previous.length ? previous[previous.length - 1].at : next.at - 3600000;
  return { label: next.name, at: next.at, key: next.key, from };
}
```

Resulting label forms: `FAJR`, `FAJR IQAMAH`, `SUNRISE`, `DHUHR`,
`DHUHR IQAMAH`, … (rendered uppercase).

## 7.2 Day flip

```ts
/** The board's day ends when the Isha CONGREGATION has been held, not when
 *  its adhan sounded — Isha keeps its row through the iqamah window. */
function ishaDone(now:number): boolean {
  const t = todayInZone(tz);
  const isha = eventsFor(t.y, t.m, t.d).find(e => e.key === 'isha');
  if (!isha) return false;
  return now >= (isha.jamaahAt ?? isha.at);
}
```

When `ishaDone(now)` is true:
- the prayer table shows **tomorrow's** times,
- **no row is highlighted** (matches the board),
- no row gets `.passed`,
- the footer label reads `Tomorrow @ …`,
- the date stacks still show **today**,
- the Jummah line is evaluated against **tomorrow's** weekday.

Flipping at Isha's *adhan* instead of its *iqamah* is a bug that was shipped
once: Isha lost its row five minutes early.

## 7.3 Progress bar

`width = clamp(0, 1, (now - target.from) / (target.at - target.from)) * 100%`,
printed to 2 decimal places, with `transition: width .4s linear`.

## 7.4 Banners and strips

| Element | Shown when | Content |
|---|---|---|
| `.banner.sample` | `meta.placeholder === true` | **Sample timetable — do not pray by these times.** Import the mosque's timetable in Settings → Timetable. |
| `.jumline` | shown date is a **Friday** and `jummahTimes()` returns times | `Jummah · first khutba 13:40 · second 14:40` |
| `.alertbar` | notification permission is **not** `granted` and not `unsupported` | text + a `Turn on` button (button hidden when permission is `denied`) |
| `.banner.info` (coverage) | on the **Monthly** screen, when 1–11 months are present | **Covers September, October only.** Other dates show as unavailable until the remaining months are added. |

`.overlays` has `flex: 0 0 auto` and `:empty { display:none }`, so an absent
strip costs no height.

## 7.5 The tick loop

`setInterval(tick, 1000)`, plus one immediate call.

```ts
function tick() {
  const now = Date.now();
  renderClock();                               // every second

  const t = todayInZone(tz);
  const dateKey = `${t.y}-${mmdd(t.m,t.d)}`;
  if (dateKey !== lastDate) {                  // midnight rollover
    lastDate = dateKey; viewMonth = null; lastNextId = ''; renderAll();
  }

  renderCountdown(now);                        // every second

  // Re-render the table when the countdown moves to another prayer — that is
  // also when the highlight must move — and once every 30s regardless.
  const target = countdownTarget(now);
  const nextId = target ? `${target.key}@${target.at}` : 'none';
  if (nextId !== lastNextId) { lastNextId = nextId; renderToday(); }
  else if (++tickCount % 30 === 0) renderToday();

  // Alert scan (see §9.4)
  for (const e of eventsFor(t.y, t.m, t.d)) {
    if (e.sun && settings.sound.sunrise === 'off') continue;
    if (within90s(now - e.at)) fire(e, 'at');
    if (settings.pre > 0 && within90s(now - (e.at - settings.pre * 60000))) fire(e, 'pre');
    if (settings.jam > 0 && e.jamaahAt !== null && !e.sun &&
        within90s(now - (e.jamaahAt - settings.jam * 60000))) fire(e, 'jam');
  }
}
const within90s = (d:number) => d >= 0 && d < 90000;
```

In React: one `useEffect` with the interval; keep `lastDate` / `lastNextId` /
`tickCount` in refs, not state, so the clock tick does not re-render the table
every second.

## 7.6 Visibility

On `visibilitychange` → `visible`: reset `lastDate` to `''`, re-render
everything, and re-apply the wake lock. A phone that was asleep for six hours
must come back correct immediately, not on the next tick boundary.

---

# 8. Screen 2 — Monthly timetable

Reached from the hamburger menu. A `.page` wrapper (max-width 560 px) with a
sticky top bar: a `‹ Board` back button and the title **Timetable**.

Contents:
1. Coverage banner (§7.4).
2. Month navigator: `‹` / `October 2026` / `›`. Free navigation into months
   with no data — those rows render em dashes.
3. Segmented control, **Adhan | Iqamah**, shown only when `meta.jamaah` is
   true. Default `Adhan`. Switching changes which of the two time sets the
   grid shows.
4. The grid: one row per day of the month, columns `Day | Faj | Sun | Dhu |
   Asr | Mag | Ish` (first three letters of each prayer name).
   - Day cell: `01 Thu` (zero-padded day, three-letter weekday).
   - Times use `fmtTime(mins, true)` — **zero-padded hour** here, so the
     columns align. This differs from the board on purpose.
   - Missing value → `—`.
   - Today's row: background `--blue-2`, text `--blue-ink`, bold.
   - Friday's **day cell only**: `--blue-ink`, bold.
   - Header cells: 10 px, uppercase, letter-spacing .06em, right-aligned
     except the first; bottom border `1px solid var(--rule)`.
   - Horizontal scroll container (`overflow-x:auto`) for narrow phones.
5. Note under the grid: *"Adhan times include your per-prayer adjustments from
   Settings. Iqamah times are shown exactly as the mosque publishes them."*

---

# 9. Notifications and sound

## 9.1 Separation — an explicit user requirement

> *"Some people want to keep the sound off but just show notifications — by
> showing sound off doesn't meet requirements though. Add to the bottom
> (enable sounds and disable sounds (if enabled)). Don't call it sound but
> notifications."*

Therefore:

1. **Notifications and sound are independent.** Muting sound must never
   suppress a notification.
2. The alert bar on the board is about **notifications only**. Its text is
   `Notifications are off`, or `Notifications are blocked in your browser
   settings` when permission is `denied`. It must never say "sound".
3. Sound is controlled by exactly one full-width button at the **bottom** of
   the board, whose label is the **action**, not the state:
   - sounds currently on → label reads **`Disable sounds`**
   - sounds currently off → label reads **`Enable sounds`** (and the button
     takes the `.muted` style: pale blue background, blue ink)
4. When muted, prayer times still raise a notification and still show the
   in-app banner; only audio is suppressed.

## 9.2 Permission flow

- Never request permission on load. Request only from a real user gesture:
  the board's `Turn on` button, or Settings → Alerts → `Enable`.
- After a `granted` result: toast `Notifications on`; on iOS-not-installed,
  also show the install explainer (§9.7).
- After a refusal: **never ask again.** Show an in-app banner —
  *"Allow notifications for this site in your browser settings, then reopen
  the app."* The browser will not re-prompt, so a second request is a dead
  button.
- Settings button label by state: `Enable` / `Enabled` (disabled) /
  `Blocked` (disabled). When blocked, the sub-label becomes *"Blocked in
  browser settings — allow notifications for this site to re-enable."*

### The gesture-swallowing bug — do not reintroduce

A document-level `pointerdown` handler unlocks audio on the first tap
anywhere. If it also hides the alert bar, the bar disappears **mid-gesture**,
the button moves out from under the finger, and the `click` that actually
requests permission never fires. Users reported "notifications never work".

The fix, which must be carried over:

```ts
document.addEventListener('pointerdown', function once(ev) {
  const onControl = (ev.target as Element)?.closest?.(
    '#audioBanner, #soundToggle, #notifBtn, #testBtn');
  if (onControl) return;                 // let the control's click land
  if (!audioReady) { unlockAudio(); updateAlerts(); }
  document.removeEventListener('pointerdown', once);
});
```

Second related bug: the permission prompt must be **reachable without
scrolling**. An earlier build put it 943 px down an 844 px viewport. The board
places it in `.overlays`, inside the single viewport, which satisfies this.

## 9.3 Raising a notification

Prefer the **service worker**: iOS has no page-level `Notification`
constructor, and a worker notification survives the page being hidden.

```ts
function notify(title:string, body:string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts: NotificationOptions = {
    body, icon:'icons/icon-192.png', badge:'icons/icon-192.png',
    tag:'azan', renotify:true, data:{ url:'./index.html' },
  };
  diag.lastAlert = `${title} at ${new Date().toLocaleTimeString()}`;
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, opts))
      .catch(err => {
        noteError('showNotification', err);
        try { new Notification(title, opts); } catch (e) { noteError('Notification', e); }
      });
  } else {
    try { new Notification(title, opts); } catch (e) { noteError('Notification', e); }
  }
}
```

## 9.4 Alert kinds, dedupe and copy

Three kinds, each with its own fire id `kind:date:prayerKey`:

| Kind | Trigger | Notification title | Body | Sound |
|---|---|---|---|---|
| `at` | adhan time | `Dhuhr` | `It is now 13:16 — time for Dhuhr.` | per-prayer mode: `azan` → play azan, `beep` → 3 chimes, `off` → silent |
| `pre` | `pre` minutes before adhan | `Dhuhr in 10 min` | `Dhuhr at 13:16` | 1 chime |
| `jam` | `jam` minutes before iqamah | `Dhuhr iqamah in 5 min` | `Iqamah at 13:50` | 2 chimes |

In-app banner copy differs slightly for `at`: `Dhuhr` / `It is now 13:16.`

Dedupe, three layers:
1. **Fire window:** a trigger fires only when `0 <= now - target < 90000`.
   90 s tolerates a sleeping tab resuming slightly late without double-firing.
2. **Per-day fired set** in `localStorage` under `azan.fired`:
   `{ date: 'YYYY-MM-DD', keys: string[] }`. Reset automatically when the date
   changes. `fire()` returns early if the id is present, and records it before
   doing anything else.
3. **Cross-tab:** a `BroadcastChannel('azan-alerts')` message `{fired: id}`;
   every other open copy marks the same id, so only one tab alerts. Wrap
   construction in try/catch — not every browser has it.

`sunrise` is skipped entirely when its sound mode is `off` (the default), and
is never eligible for a `jam` alert.

## 9.5 Audio

```
Priority: user-supplied file (IndexedDB) → bundled audio/azan.mp3 → Web Audio chime
```

- **No audio is bundled** with the app, for licensing reasons. The default is
  the synthesised chime. If `audio/azan.mp3` is present in the deployment it
  is detected by a `HEAD` request and used. In a single-file build, detection
  is skipped and the chime is used.
- **User file:** stored as a `Blob` in IndexedDB — database `azan-db`,
  version 1, object store `files`, key `azan`. Played via
  `URL.createObjectURL`. Revoke the previous URL on reload. The file never
  leaves the device.
- **Chime spec** (Web Audio, so it needs no asset):

```ts
function chime(times = 3) {
  const ctx = audioCtx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  for (let i = 0; i < times; i++) {
    const t0 = ctx.currentTime + i * 0.7;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t0);
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.12);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.62);
  }
}
```

- **Unlock:** mobile browsers refuse to play audio that was not started from a
  gesture. On the first tap: resume the `AudioContext`, play a 1-sample silent
  buffer, and separately play a muted `<audio>` element for ~60 ms, then pause
  it and unmute. Set `audioReady = true`. Without this, the first prayer of
  the session is silent.
- Turning sounds **on** via the bottom button also unlocks and plays a single
  confirmation chime, so the user knows it works. Turning sounds **off** stops
  any playback immediately.

## 9.6 Diagnostics panel (Settings)

Alert failures are silent by nature, so everything the path depends on is
recorded and displayed. A monospace block with exactly these lines:

```
Notification permission : granted | denied | default | unsupported
Installed to home screen: yes | no
Platform                : iOS | other
Service worker          : active and controlling this page | registered, not yet controlling | not registered | service workers not supported
Push subscription       : subscribed | none (no push backend configured) | push not supported here | unavailable
Sound                   : on | off (notifications only)
Audio unlocked          : yes | no — tap the page once
Next event              : Dhuhr Iqamah at 13:50
Last alert raised       : Dhuhr at 13:16:02 | none this session
Timetable               : 61 days
Version                 : 2.1.0
```

When the §13 option is built, two of these lines change wording and a third
is added — see §13.13.

Plus, when present, a `Recent errors:` section holding the **last 6** errors,
each prefixed with an `HH:MM:SS` timestamp. Errors are recorded by a
`noteError(where, err)` helper that unshifts and truncates to 6.

A one-line summary above it:
- permission not granted → `Notifications not allowed yet`
- iOS and not installed → `Allowed — but add to Home Screen for lock-screen alerts`
- otherwise → `Allowed — alerts fire while the app is open`

Two buttons: `Send test notification` (raises a real notification **and** the
in-app banner, then refreshes diagnostics) and `Why no lock-screen alerts?`
(the explainer in §9.7).

## 9.7 Background limits — must be stated in the UI, not hidden

A static web app **cannot** schedule an alarm while it is closed. State this
plainly in three places. (When the §13 option is built **and active**, two of
these strings change — see §13.13. Everywhere else, and in every other state,
the copy below stands exactly as written.)

1. **About** card: *"A web app cannot schedule alarms while it is closed. The
   Azan plays and notifications fire only while this app is open. For a
   guaranteed alarm with the screen off, use your phone's clock app alongside
   this one."*
2. A live line on the board's About section that changes with the mute state:
   - muted: *"Sounds are off — prayer times still show a notification. Turn
     sounds back on below to hear the Azan."*
   - unmuted: *"The Azan plays while this app is open. A closed app cannot
     play audio on a phone — keep a clock alarm as a backstop."*
3. The `Why no lock-screen alerts?` explainer, which is platform-aware:
   - iOS, not installed: *"On iPhone, alerts can only reach the lock screen
     once the app is added to the Home Screen: Share → Add to Home Screen,
     then open it from there and allow notifications."*
   - installed: *"Installed. Alerts still need a push server to arrive while
     the app is closed — that part is not set up yet, so alerts fire while the
     app is open."*
   - otherwise: *"Alerts fire while the app is open. Arriving with the app
     closed needs a push server, which is not set up yet."*

Platform detection:

```ts
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => !!((navigator as any).standalone ||
  window.matchMedia?.('(display-mode: standalone)').matches);
/** iOS only exposes Web Push to a site installed on the Home Screen. */
const pushBlockedByInstall = () => isIOS() && !isStandalone();
```

## 9.8 In-app banner

A fixed top banner (not a toast) used for every alert and for explainers:

```css
.inapp{ position:fixed; left:50%; transform:translateX(-50%); z-index:80;
  display:flex; align-items:center; gap:12px;
  top: calc(10px + env(safe-area-inset-top));
  width: min(520px, calc(100vw - 20px));
  background:var(--blue-2); border:1px solid #7cbfe0; border-radius:14px;
  padding:12px 14px; box-shadow:0 10px 30px rgba(30,50,70,.22); }
body.inner .inapp{ top: calc(62px + env(safe-area-inset-top)); }  /* clear the back button */
.topbar{ z-index:85; }
```

Title bold in `--blue-ink`, body 13 px in `--ink-2`, a `×` dismiss button.
Auto-hides after **15000 ms**. On the inner pages it drops to 62 px so it does
not cover the back button — that was a real reported bug.

Separately, a bottom **toast** for confirmations: `bottom: calc(112px +
env(safe-area-inset-bottom))`, dark `--ink` background, auto-hide 3200 ms.

---

# 10. Screen 3 — Settings

Same `.page` shell and sticky `‹ Board` top bar. Sections in this order, each
with an uppercase 11 px letter-spaced heading and a card body.

## 10.1 Sound per prayer
Six rows, one per prayer, each a select: **Azan | Chime | Silent**
(`azan` | `beep` | `off`). Row label is the prayer icon + name.
Changing a value saves immediately and re-renders the board (the hidden badge).

## 10.2 Adjustments (minutes)
Six number inputs, range **−60 … +60**, step 1. Clamped on change. Applies to
adhan times only. Saves immediately and re-renders everything.

## 10.3 Alerts
| Control | Type | Range / states | Notes |
|---|---|---|---|
| Background alerts | switch | 7 states | **Only when the §13 option is built and its feature flag is set.** Full state table and copy in §13.13. The row is absent, not disabled, when the flag is unset. |
| Notifications | button | Enable / Enabled / Blocked | §9.2. Sub-label: *"Shows a banner at prayer time while the app is running."* |
| Pre-prayer reminder | number | 0–60, 0 = off | *"Minutes before the adhan."* |
| Iqamah reminder | number | 0–60, 0 = off | *"Minutes before the congregation."* Row hidden when `meta.jamaah` is false. |
| Keep screen awake | switch | — | `navigator.wakeLock.request('screen')`; re-applied on visibility change; released when turned off. Fails silently where unsupported. |
| 24-hour clock | switch | default **on** | Off shows am/pm. Affects the board, the month grid and all alert copy. |

## 10.4 Notification diagnostics
Per §9.6.

## 10.5 Azan audio
- `Current` row showing one of:
  `Your audio file (stored on this device)` /
  `audio/azan.mp3 from the app folder` /
  `Built-in chime (no audio file added)`.
- Buttons: `Test` (unlocks, then plays after 120 ms),
  `Choose audio file…` (`accept="audio/*"` → IndexedDB),
  `Reset` (deletes the stored blob), `Stop playback`.
- Note: *"The file is stored on this device only. No audio is bundled with the
  app for licensing reasons — without one, a short chime is played."*

## 10.6 Timetable
- `Loaded` row: `Shaheed Bilal Masjid · printed timetable: 2026-09, 2026-10`,
  or `Bundled sample — replace it` when `meta.placeholder`.
- Pill: `61 days · jamaah`.
- A textarea for pasting a timetable (CSV / TSV / PDF-copied text / JSON).
- Three selects: default month (for rows that carry a day number only),
  columns (`Auto-detect` / `Adhan only` / `Adhan + iqamah`), numeric date
  order (`DD/MM` / `MM/DD`).
- Buttons: `Import`, `Import file…` (`.csv,.tsv,.txt,.json`),
  `Export JSON`, `Reset to bundled` (with a `confirm()`).
- An import log area reporting `Imported N days.` plus every warning.
- **Imports merge**, so a year can be built one month at a time. The merged
  result is written to `localStorage` under `azan.timetable` and takes
  precedence over the bundled file on every load.
- `Export JSON` must be hidden in a single-file/hosted-artifact build, because
  that host cannot hand the viewer a file — a dead button is worse than none.

## 10.7 Mosque
Three text inputs — Name, Area, Time zone (IANA; blank = device zone) — and a
`Save` button. The time zone is validated with
`new Intl.DateTimeFormat('en',{timeZone:tz})` inside a try/catch; on failure,
toast `Unknown time zone` and do not save.

## 10.8 About
The background-limits text (§9.7), the mosque's notes joined with ` · `
(*"Maghrib salah 5 min after azan · Isha salah 5 min after azan"*), the live
foreground note, and a `Version` pill.

## 10.9 Navigation

A bottom sheet menu (not a nav bar), opened by the footer hamburger:
two items — **Monthly timetable** and **Settings**, each with an icon — over a
scrim (`rgba(30,26,18,.28)`). Sheet: `border-radius:16px 16px 0 0`,
`max-width:560px`, `padding-bottom: calc(14px + env(safe-area-inset-bottom))`,
shadow `0 -8px 28px rgba(40,35,25,.18)`.

Switching views adds `body.inner` for any non-board view (§9.8) and scrolls to
top. Only one `.view` carries `.on` at a time.

---

# 11. Persistence

| Store | Key | Shape |
|---|---|---|
| localStorage | `azan.settings` | the settings object below |
| localStorage | `azan.timetable` | a full `{meta, days}` object — an imported timetable, which overrides the bundled file |
| localStorage | `azan.fired` | `{ date: 'YYYY-MM-DD', keys: string[] }` |
| localStorage | `azan.lastGood` | the last `{meta, days}` that loaded cleanly — the offline fallback of last resort (§12.3) |
| localStorage | `azan.push` | `{ endpoint, prefs, at }` — what was last registered with the alert server. **Only when the §13 option is built.** |
| IndexedDB | `azan-db` v1 → store `files` → key `azan` | the user's azan audio `Blob` |

Defaults:

```ts
const DEFAULT_SETTINGS = {
  sound:  { fajr:'azan', sunrise:'off', dhuhr:'azan', asr:'azan',
            maghrib:'azan', isha:'azan' },
  offsets:{ fajr:0, sunrise:0, dhuhr:0, asr:0, maghrib:0, isha:0 },
  use24: true, pre: 0, jam: 0, wake: false, muted: false,
};
```

Merge stored settings **shallowly over the defaults, and `sound`/`offsets`
nested objects over their defaults too**, so a new prayer key or a new setting
added in a later version does not come back `undefined` for existing users.

Every localStorage read and write goes through a try/catch wrapper — private
mode and blocked site data must degrade, not throw:

```ts
const LS = {
  get<T>(key:string, fallback:T): T {
    try { const raw = localStorage.getItem(key);
          return raw === null ? fallback : JSON.parse(raw) as T; }
    catch { return fallback; }
  },
  set(key:string, value:unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  del(key:string) { try { localStorage.removeItem(key); } catch {} },
};
```

---

# 12. PWA

## 12.1 Manifest

```json
{
  "name": "Shaheed Bilal Mosque",
  "short_name": "Shaheed Bilal",
  "description": "Prayer times for Shaheed Bilal Mosque, Dublin 15 — adhan and iqamah, as on the mosque board.",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#e9e5dc",
  "theme_color": "#e9e5dc",
  "icons": [
    { "src": "icons/icon-192.png",     "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png",     "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Relative paths (`./`) throughout, so the app works from a sub-path such as
`/azan/` on GitHub Pages. An absolute `start_url` will break it there.

Icons: the masjid mark from §6.10 on the sand background. The maskable variant
needs the mark at ~60% of the canvas so it survives a circular mask.

## 12.2 Service worker — offline strategy

Cache name carries the version: `azan-v2.2.0`. **Bump it on every release** or
clients keep the old build.

Precache list: `./`, `./index.html`, `./app.js` (or the hashed Vite bundles),
`./manifest.webmanifest`, `./data/timetable.json`, and the three icons. That is
the complete set — the app has **no external dependencies at all**: no CDN, no
Google Fonts, no analytics. Keep it that way; a single external stylesheet
would make the app's startup depend on someone else's uptime.

### Two strategies, split by what freshness is worth

| Requests | Strategy | Why |
|---|---|---|
| The static shell (`./`, `index.html`, `app.js`, manifest, icons) | **cache-first, revalidate in the background** | A cached copy is the right copy for this load. The shell cannot go stale *without the cache name changing with it*, and a new deploy lands through the worker-update path (§12.4), not through per-asset revalidation. |
| Everything else — above all `data/timetable.json` | **network-first, with a 1500 ms timeout** | A corrected timetable should land on *this* load, not the next one. The timeout is what stops a dead connection turning that preference into a stall. |

```js
const NET_TIMEOUT_MS = 1500;
const SHELL = ['/', '/index.html', '/app.js', '/manifest.webmanifest',
               '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];
const isShell = url => {
  const path = new URL(url).pathname;
  return SHELL.some(sfx => path === sfx || path.endsWith(sfx));
};

async function respond(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);

  const network = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});  // never cache a 404
    return res;
  });

  if (!cached) {
    try { const res = await network; if (res) return res; } catch (e) {}
    // Only a navigation falls back to the shell. Handing index.html to a
    // request for timetable.json just defers the failure to a JSON parse error.
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }

  if (isShell(req.url)) {                 // instant, refresh for next time
    event.waitUntil(network.catch(() => {}));
    return cached;
  }

  const raced = await Promise.race([      // network preferred, but bounded
    network.catch(() => null),
    new Promise(r => setTimeout(() => r(null), NET_TIMEOUT_MS)),
  ]);
  if (raced && raced.ok) return raced;
  event.waitUntil(network.catch(() => {}));
  return cached;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(respond(event));
});
```

### Why the timeout is not optional

**`fetch()` only rejects when a connection *fails*. A connection that is
present but dead — one bar of signal, a captive portal, a hung TCP socket —
never rejects, it hangs.** Plain network-first therefore waits on the browser's
own timeout before it ever reaches the cache fallback.

Measured on the reference build, with a warm cache and every request hanging:

| | Before | After |
|---|---|---|
| Fully offline, cold start | 55 ms (always worked) | **41–53 ms** |
| Live-but-dead connection | **never started** — >45 s, zero rows rendered | **1.6 s** to all six rows |

Fully offline was never the problem. The case *between* online and offline was,
and it is the one that actually happens to a phone inside a building.

`install` → `cache.addAll(ASSETS)` then `skipWaiting()` (and `skipWaiting()`
even on failure). `activate` → delete every cache whose name is not `CACHE`,
then `clients.claim()`.

Pure cache-first for *everything* was tried and rejected: users repeatedly saw
stale builds and had to clear site data. The split above keeps that fix — data
still prefers the network — while refusing to pay three sequential timeouts for
the shell.

## 12.3 Offline resilience in the app, not just the worker

The worker is not the only path to the timetable, so the app carries its own
guards:

1. **Boot never waits on the network.** The `data/timetable.json` fetch gets an
   `AbortController` deadline of 4000 ms. This covers the case the worker
   cannot: a first visit that goes offline before any worker has taken control,
   or a browser with service workers unavailable.
2. **Last-known-good copy.** Every timetable that loads cleanly is written to
   `azan.lastGood` (§11). If the fetch fails *and* the cache misses, the app
   falls back to that copy before it ever shows the sample-data placeholder.
   Showing real times from last week beats showing "do not pray by these times".
3. **A timetable is only accepted if it carries days.** An empty `{days:{}}`
   would render every date as "No times", which reads as data loss rather than
   a failed load. Guard with `usable(tt)`.
4. **Nothing optional may block the first paint.** In particular the probe for
   `audio/azan.mp3` is a **HEAD** request, and HEAD **bypasses the service
   worker entirely** (`req.method !== 'GET'` returns early), so it always goes
   to the network. In the reference build this single probe — for a file that
   does not even exist — hung `boot()` indefinitely on a dead connection, with
   everything else already cached. It now has its own 2500 ms deadline **and**
   is not awaited during boot:

```ts
// Deliberately not awaited: which azan sound is available has no bearing on
// the board, and probing for it must never be what stops the board drawing.
loadAzanAudio().catch(() => {});
```

Treat point 4 as the general rule: **anything on the boot path that touches the
network must have a deadline, and anything the board does not need must not be
on the boot path at all.**

## 12.4 Update strategy — all three parts are required

```ts
navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
  .then(reg => { reg.update().catch(() => {}); })
  .catch(() => {});

let reloading = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (reloading) return;
  reloading = true;
  location.reload();
});
```

1. `updateViaCache: 'none'` — stops the browser serving a **cached copy of the
   worker script itself**, which is what pins users to an old build.
2. An explicit `reg.update()` on every boot.
3. Auto-reload on `controllerchange`, guarded against a loop.

Without all three, "I still see the old version" recurs. This happened
repeatedly during development.

Skip service-worker registration entirely in a single-file build.

## 12.5 Push handlers

Include them now even though no backend exists — they are the app half of the
contract, and they are what the test path uses. If the §13 option is built,
the payload gains `kind` and `fireId` (§13.10) and the `push` handler also
messages open pages (§13.12); the handlers below are otherwise unchanged.

- `push`: parse `event.data.json()` with a text fallback; show a notification
  with `{title, body, icon, badge, tag: payload.tag ?? 'azan', renotify:true,
  timestamp: payload.at ?? Date.now(), data:{url, key, at}}`.
- `pushsubscriptionchange`: `clients.matchAll({includeUncontrolled:true})` and
  `postMessage({type:'pushsubscriptionchange'})` to every page so it can
  re-register.
- `message` with `{type:'show-notification', title, body, tag}`: raise it from
  the worker. This is the path that works on iOS, where page-level
  `Notification` construction is unavailable.
- `notificationclick`: close the notification, focus an existing window if one
  exists, else `clients.openWindow(data.url ?? './index.html')`.

---

# 13. Option: background alerts (lock-screen, app closed) — web only

> **If you are building the native app (Part B), skip this section.** §21
> delivers background alerts with **no server at all**, by scheduling them with
> the operating system. A push backend is then needed only for mosque
> *announcements* — see §21.9. Build §13 only for the web app, or as the
> optional backstop described in §21.5.

Everything in §1–§12 delivers alerts **only while the app is open**. This
section specifies the optional addition that makes alerts arrive with the app
closed and the screen off, **in a web app**.

It is a **feature-flagged option**, not a rewrite. With the flag unset the app
must behave byte-for-byte as Phase 1 — same screens, same controls, no dead
buttons, no network calls. Build Phase 1 first and ship it; add this when the
mosque wants it.

## 13.1 Why a server is unavoidable

A browser cannot wake a closed web app on a timer. `setTimeout`,
`setInterval`, Background Sync and Periodic Background Sync are all either
killed with the page or unavailable on iOS. The **only** mechanism that wakes
a service worker with the app closed is **Web Push**, and Web Push requires a
server holding a VAPID key to send the message.

So the choice is not "local scheduling vs server" — it is "server, or
foreground-only". There is no third option, and any implementation that claims
otherwise will fail silently on a real phone.

## 13.2 Scope of the option

| In scope | Out of scope |
|---|---|
| Notifications at adhan, pre-adhan and pre-iqamah, delivered with the app closed | Playing the Azan **audio** while closed — a service worker cannot play audio. Push shows a notification; the phone's own notification sound plays. |
| Per-device opt-in, per-device reminder offsets | Per-user accounts, login, profiles |
| iOS (installed to Home Screen), Android, desktop Chrome/Edge/Firefox | iOS Safari **not** installed to the Home Screen — the platform does not expose push there |
| Automatic cleanup of expired subscriptions | Any analytics or tracking |

State the audio limitation in the UI. A user who turns this on and expects the
Azan to sound from a locked phone will think it is broken.

## 13.3 Feature flag

Two environment variables. **Both** must be present and non-empty for any of
this to activate:

```
VITE_PUSH_API_URL=https://<project>.supabase.co/functions/v1
VITE_PUSH_VAPID_PUBLIC_KEY=BK...   # base64url, ~87 chars
```

```ts
export const PUSH_ENABLED =
  !!import.meta.env.VITE_PUSH_API_URL &&
  !!import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY;
```

When `PUSH_ENABLED` is false:
- the Settings → Alerts "Background alerts" row is **not rendered** (not
  rendered disabled — absent);
- the diagnostics line reads `none (no push backend configured)`;
- `explainBackground()` uses the Phase 1 copy (§9.7);
- no request is made to any origin but the app's own.

The public VAPID key is public by design — it is sent to every client. The
**private** key lives only in server secrets and must never reach the bundle.

## 13.4 Architecture

Recommended: **Supabase**, because Lovable integrates it directly.

```
┌─────────────┐   register/unregister    ┌──────────────────────┐
│  PWA client │ ───────────────────────► │ Edge: subscriptions  │
│  (service   │                          └──────────┬───────────┘
│   worker)   │                                     │
│             │                          ┌──────────▼───────────┐
│             │                          │ Postgres             │
│             │                          │  push_subscriptions  │
│             │                          │  prayer_days         │
│             │                          │  push_log            │
│             │                          │  push_config         │
│             │                          └──────────┬───────────┘
│             │                                     │ every minute
│             │        Web Push (VAPID)   ┌──────────▼───────────┐
│             │ ◄──────────────────────── │ Edge: dispatch-alerts│
└─────────────┘        via push service   └──────────────────────┘
                                                    ▲
                                          pg_cron ──┘  '* * * * *'
```

Cloudflare Workers + Cron Triggers + D1 is an equivalent alternative. The
contracts below (§13.6–§13.9) are host-agnostic; only the deployment differs.

### Cost at this scale
A once-a-minute cron is ~44,640 invocations in a 31-day month. At the time of
writing that sits inside both Supabase's and Cloudflare's free function
allowances with room to spare, and a single-mosque congregation (hundreds of
devices, low thousands at most) adds little on top. **Check both providers'
current limits before committing** — they change, and this spec should not be
trusted on a billing question. Push delivery itself is free: it goes through
the browser vendors' own push services.

If the per-minute cron is ever the constraint, the dispatcher can run every
5 minutes and widen its due window to 5 minutes — at the cost of alerts that
are up to 5 minutes late, which for a prayer notification is not acceptable.
Per-minute is the right cadence; budget for it.

## 13.5 Database schema

```sql
-- One row per device/browser that opted in.
create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text not null unique,          -- the device identifier
  p256dh      text not null,                 -- subscription keys
  auth        text not null,
  prefs       jsonb not null default '{}',   -- see §13.7
  tz          text,                          -- device zone, diagnostics only
  user_agent  text,
  enabled     boolean not null default true,
  failures    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_sent_at timestamptz
);

-- The timetable, server-side. Mirrors azan/data/timetable.json exactly.
create table prayer_days (
  md       text primary key,                 -- 'MM-DD'
  fajr     text not null, sunrise text not null, dhuhr text not null,
  asr      text not null, maghrib text not null, isha  text not null,
  jamaah   jsonb not null default '{}'       -- {"fajr":"06:15", ...}
);

-- Dedupe + observability. One row per (device, alert) actually attempted.
create table push_log (
  subscription_id uuid not null references push_subscriptions(id) on delete cascade,
  fire_id         text not null,             -- 'at:2026-10-16:dhuhr'
  sent_at         timestamptz not null default now(),
  status          int,                       -- HTTP status from the push service
  error           text,
  primary key (subscription_id, fire_id)
);

create index push_log_sent_at_idx on push_log (sent_at);

-- Single-row config.
create table push_config (
  id        int primary key default 1 check (id = 1),
  timezone  text not null default 'Europe/Dublin',
  mosque    text not null default 'Shaheed Bilal Masjid',
  data_hash text                             -- sha256 of the seeded timetable
);
```

**Row Level Security:** enable RLS on every table and grant **no** anon
policies. All access goes through Edge Functions using the service-role key.
A client must never be able to read the subscription table — the endpoints in
it are device identifiers.

Retention: delete `push_log` rows older than 30 days on a nightly cron. They
exist for dedupe and debugging, not history.

## 13.6 Seeding the server timetable — and proving it matches

The server must send times identical to the ones the app displays. A drift
between the two is a silent correctness bug of exactly the kind this app
exists to avoid.

1. A seeding script reads `azan/data/timetable.json` and upserts every day
   into `prayer_days`, then writes `push_config.data_hash` = SHA-256 of the
   canonical JSON of `days` (keys sorted, no whitespace).
2. The client computes the same hash over its own loaded `days` at boot
   (cheap: do it once, cache in memory).
3. `GET /functions/v1/timetable-hash` returns `{ data_hash, days }`.
4. The diagnostics panel gains a line:

```
Server timetable        : matches (61 days) | MISMATCH — server 59 days, app 61
```

5. On mismatch the client shows a warning banner in Settings:
   *"The alert server has a different timetable from this app. Background
   alerts may fire at the wrong times until it is updated."*

Re-run the seeding script every time `timetable.json` changes. Make it part of
the release checklist alongside bumping the service-worker cache name.

## 13.7 Per-device preferences

The server decides what to send, so it needs the subset of settings that
affects scheduling. Nothing else is sent.

```jsonc
{
  "prayers": { "fajr":true, "sunrise":false, "dhuhr":true,
               "asr":true, "maghrib":true, "isha":true },
  "pre": 10,        // minutes before adhan, 0 = off   (mirrors settings.pre)
  "jam": 5          // minutes before iqamah, 0 = off  (mirrors settings.jam)
}
```

- `prayers[key]` is true when that prayer's sound mode is **not** `off`, OR
  when the user has background alerts on and wants the notification regardless
  of sound. Resolve this explicitly: **`prayers[key] = true` unless the user
  has silenced that prayer entirely.** Sound mode `beep` and `azan` both mean
  "notify me"; only `off` means "do not".
- `settings.muted` is **not** sent. Muting is a local audio decision (§9.1)
  and must never suppress a notification.
- The client PUTs prefs on change, debounced 2 s, and on every boot where
  they differ from the last-sent copy (keep a `azan.push` record of what was
  sent, so an offline change is retried later).

## 13.8 Client flow

```ts
async function enableBackgroundAlerts(): Promise<PushState> {
  if (!PUSH_ENABLED) return 'unavailable';
  if (pushBlockedByInstall()) return 'needs-install';       // iOS, not installed
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();     // user gesture
    if (perm !== 'granted') return 'needs-permission';
  }
  const reg = await navigator.serviceWorker.ready;
  if (!reg.pushManager) return 'unsupported';

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,                                   // required by Chrome
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  await fetch(`${PUSH_API}/register-subscription`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      prefs: currentPushPrefs(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: navigator.userAgent,
    }),
  });

  LS.set('azan.push', { endpoint: sub.endpoint, prefs: currentPushPrefs(),
                        at: new Date().toISOString() });
  return 'active';
}

async function disableBackgroundAlerts() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await fetch(`${PUSH_API}/unregister-subscription`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});                    // unsubscribe locally even if offline
    await sub.unsubscribe();
  }
  LS.del('azan.push');
}
```

`urlBase64ToUint8Array` is the standard VAPID key conversion — base64url to
base64, pad to a multiple of 4, `atob`, then byte-by-byte into a `Uint8Array`.
Passing the raw string instead will throw `InvalidCharacterError`.

### Subscription rotation
The service worker already relays `pushsubscriptionchange` to open pages
(§12.5). On receiving that message the page must re-subscribe and re-register,
then replace `azan.push`. Browsers rotate subscriptions without warning; an
app that ignores this stops receiving alerts weeks later with no error.

## 13.9 Server dispatch logic

Runs every minute. Must mirror the client's rules exactly (§7.1, §9.4).

```
1.  now        := current instant
    zone       := push_config.timezone              -- 'Europe/Dublin'
    local      := now in zone (y, m, d, hh, mm)
    today      := prayer_days['MM-DD'] for local    -- skip run if absent
    yesterday  := prayer_days for local - 1 day     -- for a late-night window

2.  Build the day's events exactly as §4.3 does, resolving each wall-clock
    time to an instant with the same two-pass zone arithmetic. Do NOT add
    minutes to midnight.

3.  For each enabled subscription, for each event, for each kind:
      at   -> due_at = event.at
      pre  -> due_at = event.at      - prefs.pre * 60s   (skip if pre  = 0)
      jam  -> due_at = event.jamaahAt - prefs.jam * 60s  (skip if jam = 0
                                                          or no iqamah
                                                          or event is sunrise)
    Skip the event entirely when prefs.prayers[event.key] is false.
    Skip 'sunrise' for kinds 'pre' and 'jam'.

4.  Due window:  now - 90s <= due_at <= now
    The 90 s window matches the client and tolerates a late cron run. A run
    that is more than 90 s late skips that alert rather than sending it stale
    — a prayer notification two minutes late is worse than none.

5.  fire_id := kind || ':' || local date (YYYY-MM-DD) || ':' || event.key
    Insert into push_log with ON CONFLICT DO NOTHING. If zero rows were
    inserted, this alert already went to this device — skip it.
    The insert IS the lock: it makes overlapping cron runs safe.

6.  Send the Web Push with the payload in §13.10.

7.  Record the result (§13.11).
```

**Scaling note.** The per-subscription loop is O(devices × events). At a few
thousand devices that is a few tens of thousands of cheap comparisons per
minute — fine. If it ever matters, group subscriptions by their distinct
`(pre, jam, prayers)` tuple, compute due events once per group, and fan out.

**Library note.** Web Push needs VAPID JWT signing plus AES128GCM payload
encryption — do not hand-roll it. In a Deno edge function, a Web Crypto-native
library (e.g. `jsr:@negrel/webpush`) is the safer choice; `npm:web-push` is
written against Node's `crypto` and relies on the runtime's Node compatibility
layer. **Verify whichever you pick actually sends to a real device before
building on it** — this is the step most likely to need adjustment, and a
silent failure here looks exactly like "push doesn't work on my phone".

## 13.10 Payload contract

Extends the shape in §12.5. The `push` handler there already consumes
`title`, `body`, `tag`, `at`, `key` and `url`; add `kind` and `fireId`.

```jsonc
{
  "title": "Dhuhr",
  "body":  "It is now 13:16 — time for Dhuhr.",
  "tag":   "azan",            // same tag => a newer alert REPLACES an older one
  "kind":  "at",              // 'at' | 'pre' | 'jam'
  "key":   "dhuhr",
  "at":    1792152960000,     // epoch ms of the event
  "fireId":"at:2026-10-16:dhuhr",
  "url":   "./index.html"
}
```

Copy must match the in-app alerts in §9.4 word for word, so a user who sees
both does not read them as two different events:

| kind | title | body |
|---|---|---|
| `at` | `Dhuhr` | `It is now 13:16 — time for Dhuhr.` |
| `pre` | `Dhuhr in 10 min` | `Dhuhr at 13:16` |
| `jam` | `Dhuhr iqamah in 5 min` | `Iqamah at 13:50` |

Times are formatted server-side in the mosque's zone, 24-hour, no leading zero
on the hour — `13:16`, `5:49` (§4.5). The server does not know the device's
`use24` setting; 24-hour matches the board and is the documented default.

## 13.11 Failure handling

| Push service response | Action |
|---|---|
| `201` / `200` | reset `failures` to 0, set `last_sent_at` |
| `404` / `410 Gone` | **delete the subscription row** — the device uninstalled or the endpoint expired. This is normal, not an error. |
| `429 Too Many Requests` | honour `Retry-After`; do not count as a failure |
| `413 Payload Too Large` | log and drop; the payload is a bug, not a transient fault |
| other `4xx` | increment `failures`, log the body |
| `5xx` / network | increment `failures`, leave the `push_log` row so it is not retried stale |

Set `enabled = false` after **10** consecutive failures, and keep the row for
diagnosis rather than deleting it. Expose a count of disabled subscriptions
somewhere you will actually look — a quietly emptying subscriber table is the
failure mode you will not notice.

## 13.12 Avoiding double alerts when the app is open

With push active, both the server and the open page can alert for the same
event. Resolve it with one rule: **when push is active, push owns the
notification; the page owns the audio and the in-app banner.**

Service worker (`push` handler, in addition to §12.5):

```js
// Tell any open page what just arrived so it can play audio and
// mark the alert as handled.
event.waitUntil((async () => {
  await self.registration.showNotification(title, opts);
  const list = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  for (const c of list) c.postMessage({ type:'push-alert', ...payload });
})());
```

Page:

```ts
navigator.serviceWorker.addEventListener('message', ev => {
  if (ev.data?.type !== 'push-alert') return;
  const { fireId, key, kind } = ev.data;
  if (alreadyFired(fireId)) return;
  markFired(fireId);                      // also broadcast, per §9.4
  showInApp(ev.data.title, ev.data.body); // banner
  if (!settings.muted) playForKind(kind, key);   // audio only
});
```

And in the local tick (§7.5): when `pushActive` is true, `fire()` must **skip
its `notify()` call** and do only the banner and audio. Everything else —
the 90 s window, the `azan.fired` store, the BroadcastChannel dedupe — is
unchanged, and the shared `fireId` format is what makes the two paths
interlock.

Belt and braces: the shared `tag: 'azan'` means a duplicate notification
*replaces* rather than stacks, so a mistake here degrades to one visible
notification rather than two.

## 13.13 UI changes

### Settings → Alerts, new first row

| | |
|---|---|
| Label | **Background alerts** |
| Sub-label | *"Notifications reach your lock screen with the app closed. The Azan audio still needs the app open."* |
| Control | switch |

Switch states and what each shows:

| State | Switch | Sub-label replacement |
|---|---|---|
| `unavailable` | row absent | — |
| `needs-permission` | off | *"Allow notifications first."* |
| `needs-install` (iOS, not installed) | off, disabled | *"Add the app to your Home Screen first: Share → Add to Home Screen, then open it from there."* |
| `unsupported` | off, disabled | *"This browser does not support background alerts."* |
| `subscribing` | off, spinner | *"Registering…"* |
| `active` | on | *"On — registered 16 Oct."* |
| `error` | off | *"Could not register. Try again, or check your connection."* |

Turning it **off** unsubscribes and deletes the server row. Do not leave an
orphaned subscription — the server will keep sending to a device whose user
asked it to stop.

### Diagnostics (§9.6), two lines change and one is added

```
Push subscription       : active since 16 Oct | none | needs Home Screen install | not supported here
Server timetable        : matches (61 days) | MISMATCH — server 59 days, app 61
Last push received      : Dhuhr at 13:16:04 | none this session
```

### Background-limits copy (§9.7) becomes conditional

Replace the three Phase 1 strings when `pushActive` is true:

- About card: *"Notifications reach your lock screen with the app closed.
  The Azan audio plays only while the app is open — a closed web app cannot
  play sound. Keep a clock alarm if you rely on hearing it."*
- `Why no lock-screen alerts?` → relabel the button **`About background
  alerts`**, body: *"Background alerts are on. Notifications arrive with the
  app closed; audio needs the app open."*

Leave the Phase 1 copy exactly as written for every other state. The honesty
of that copy is a feature — it is why users trusted the app enough to report
the real bugs.

## 13.14 Privacy

Say this plainly in the About card when the option is on:

> *"Turning on background alerts stores one anonymous device token on the
> mosque's alert server, so it can send the notification. No name, email,
> phone number or location is stored, and there is no account. Turning the
> switch off deletes it."*

And honour it:
- store only `endpoint`, `p256dh`, `auth`, `prefs`, `tz`, `user_agent`;
- **no IP logging** beyond whatever the platform does by default;
- delete on unsubscribe and on `410 Gone`;
- RLS closed to anon (§13.5), service-role key server-side only;
- no third-party analytics anywhere in the function.

The `endpoint` is a stable device identifier. Treat it as personal data even
though it carries no name.

## 13.15 Acceptance criteria

Must be tested on a **real phone**, from the **published URL**, with the app
**fully closed** (swiped away, not backgrounded). Nothing in this section can
be verified in a preview iframe or a desktop emulator.

1. **Flag off:** with either env var unset, the Settings row is absent,
   diagnostics reads `none (no push backend configured)`, and a network trace
   shows no request to any other origin.
2. **Android, app closed:** a notification arrives within 60 s of the adhan
   minute, on the lock screen, with the correct prayer name and time.
3. **iOS, installed to Home Screen, app closed:** same.
4. **iOS, not installed:** the row is disabled with the install sub-label, and
   no subscribe attempt is made.
5. **No double alert:** with the app open and in the foreground, exactly one
   notification and one in-app banner per event (§13.12).
6. **Dedupe across devices:** two devices both registered → each gets exactly
   one notification; one device's `push_log` row does not suppress the other's.
7. **Cron restart:** kill and restart the cron mid-day → no duplicate alerts
   for events already sent (the `push_log` unique key holds).
8. **Late run:** delay the dispatcher by 3 minutes → the missed alert is
   **not** sent (outside the 90 s window) and is logged as skipped.
9. **Expiry:** revoke a subscription in the browser → the next send returns
   `410` and the row is deleted.
10. **Rotation:** force `pushsubscriptionchange` → the client re-registers and
    the old endpoint stops receiving.
11. **Timetable match:** change one time in the server table → diagnostics
    shows `MISMATCH` and the Settings warning appears.
12. **Opt-out:** turn the switch off → the server row is gone and no further
    notifications arrive.
13. **DST:** with the clock set to 25 October, alerts fire at the winter times
    (Dhuhr 12:11, not 13:11) — the server's zone arithmetic is correct.
14. **Unchanged Phase 1:** the whole of §14 still passes with the flag on.

## 13.16 Release checklist for this option

- [ ] VAPID keys generated; private key in server secrets only; public key in
      the client env var
- [ ] RLS enabled on all four tables, no anon policies
- [ ] `prayer_days` seeded from the current `timetable.json`; `data_hash`
      written; client reports `matches`
- [ ] Cron scheduled `* * * * *`; log-retention cron scheduled nightly
- [ ] Push send verified end-to-end to a real device (§13.9 library note)
- [ ] §13.15 cases 1–14 pass
- [ ] Privacy copy present in the About card
- [ ] Runbook written: how to re-seed after a new month, and where to look
      when a user says alerts stopped

---

# 14. Acceptance criteria

Test with a clock-override harness (Playwright `page.clock.install` /
`setSystemTime` / `fastForward`), timezone forced to `Europe/Dublin`.

## 14.1 Board against the physical board (verified photographs)

**8 September 2026, 05:14:19** — matched a photograph of the mosque board:
```
rows   : Fajr 5:03 5:30 | Sunrise 6:42 | Dhuhr 13:25 13:50 |
         Asr 17:02 17:30 | Maghrib 20:05 20:10 | Isha 21:38 21:43
countdown: FAJR IQAMAH  00:15:39
footer : Today @ Dublin ·   Shaheed Bilal Masjid
highlight: Fajr row (inside its iqamah window)
```

**7 September 2026, 22:02:09** — matched a second photograph:
```
rows   : (same as above — the table has flipped to the 8th)
countdown: FAJR  07:00:50
footer : Tomorrow @ Dublin ·
highlight: none (Isha congregation has been held)
```

## 14.2 October and the DST boundary

| When | Expected |
|---|---|
| 4 Oct 10:30 | `Oct 4 2026` / `Rab2 23 1448`; rows 5:49 6:15 / 7:27 / 13:16 13:50 / 16:17 17:00 / 19:01 19:06 / 20:33 20:38; next `DHUHR 01:45:58` |
| 9 Oct (Friday) | Jummah line `first khutba 13:40 · second 14:40` |
| 24 Oct | Fajr 6:22 / 6:45 … Isha 19:50 / 20:00 |
| 25 Oct (clocks back) | Fajr 5:24 / 6:00; Dhuhr 12:11 / 13:25; Isha 18:48 / 20:00 |
| 30 Oct (Friday) | Jummah line `first khutba 12:30 · second 13:20` ← seasonal switch |
| 2 Oct | Hijri `Rab2 21 1448` |
| 31 Oct | Hijri `Jum1 20 1448` |
| 4 Nov | prayer list shows the "No times" row; Monthly shows em dashes |

The 9 Oct → 30 Oct khutba change is the single test that proves §4.6 and §4.7
work. If both Fridays show the same times, `inSummerTime` is wrong.

## 14.3 Layout

| Viewport | Requirement |
|---|---|
| 320×568 | no vertical scroll; all six rows visible; nothing clipped |
| 375×667 | no vertical scroll |
| 390×844 | no vertical scroll; `.thead` top at **26.5%** of 844 px |
| 430×932 | no vertical scroll; `.thead` top at **26.4%** of 932 px |

Assert programmatically:
`document.documentElement.scrollHeight <= window.innerHeight` and
`.thead.getBoundingClientRect().top / innerHeight` within `0.26 … 0.305`.

Also assert the mat SVG's rendered width equals its container's width (the
287-vs-381 px bug), and that no stroked line crosses between the clock and the
table header.

## 14.4 Alerts

1. At an adhan minute with permission granted: exactly **one** notification
   and **one** in-app banner.
2. With `muted = true`: notification still raised, **no** audio.
3. Two tabs open: exactly one notification total (BroadcastChannel dedupe).
4. Reload immediately after an alert: it does **not** fire again (`azan.fired`).
5. Tap the `Turn on` button: `Notification.requestPermission` is actually
   called — i.e. the gesture is not swallowed (§9.2).
6. `pre = 10`: an alert at adhan − 10 min titled `Dhuhr in 10 min`.
7. `jam = 5`: an alert at iqamah − 5 min titled `Dhuhr iqamah in 5 min`.

## 14.5 Highlight sweep

Step a full simulated day minute by minute and assert:
- exactly 0 or 1 row carries `.current` at all times;
- `.current` moves monotonically down the table;
- it never sits on a row whose adhan **and** iqamah have both passed;
- after Isha's iqamah: 0 rows `.current`, table shows tomorrow, footer reads
  `Tomorrow`;
- the countdown is never negative and never jumps backwards.

## 14.6 Offline

Offline is a correctness requirement here, not a nicety: the app's whole job is
to be readable in a building with no signal. Test all five, and test 3 and 4
specifically — they are the ones that fail while 1 and 2 pass.

| # | Scenario | Requirement |
|---|---|---|
| 1 | Load once online, then reload with the network **off** | Board renders with the correct times for the date; no page errors; the sample-data banner does **not** appear |
| 2 | **Cold start** offline — a brand-new tab, network off, worker already installed | Board renders in well under a second; rows byte-identical to the online render; day count still 61 |
| 3 | **Live-but-dead connection** — every request hangs rather than failing | Board shows all six rows within ~2 s. This is the realistic phone case and the one plain network-first fails: `fetch` never rejects, so the cache fallback never runs |
| 4 | Dead connection with **no bundled `audio/azan.mp3`** | Board still renders. A HEAD probe bypasses the service worker, so an optional audio check must never be awaited on the boot path (§12.3) |
| 5 | Online, `data/timetable.json` changed on the server | The **new** value appears on the next reload — the offline work must not have cost data freshness |

Automate 1–3 with Playwright: `context.setOffline(true)` for 1 and 2, and for 3
a route handler that delays rather than aborts:

```js
await ctx.route('**/*', async route => {
  await new Promise(r => setTimeout(r, 60000));   // hang, do not fail
  route.abort();
});
```

Prime the worker in a throwaway page before each test page, or the worker claims
clients mid-test and the app's own `controllerchange` reload (§12.4 — correct
behaviour) destroys the execution context under the assertions.

Reference-build results: offline cold start **41–53 ms**; dead connection
**1.6 s** (was: never started, >45 s with zero rows).

## 14.7 Data validation (CI)

A script that fails the build when, for every day in the timetable:
- the key matches `^\d{2}-\d{2}$` and every time matches `^[0-2]\d:[0-5]\d$`;
- `fajr < sunrise < dhuhr < asr < maghrib < isha` in minutes;
- every iqamah gap is `0 … 120` minutes after its adhan;
- day-to-day drift is sane **compared in UTC**, so the DST change is not a
  false alarm.

Current data passes: `61 days checked, issues: 0`.

---

# 15. Parser specification (Settings → Timetable import)

Needed so the mosque can add future months without a developer. Implement in
`src/engine/parser.ts`.

## 15.1 Accepted input
JSON (a `{meta, days}` object or a bare days map), CSV, TSV, pipe-separated,
or whitespace-separated text pasted from a PDF or a web page.

## 15.2 Tokenising
```ts
const TIME_RE = /^(\d{1,2})[:.h](\d{2})\s*([ap])?m?\.?$/i;

function splitTokens(line: string): string[] {
  // Glue "1:28 p.m." into one token first.
  const glued = line.replace(/(\d{1,2}[:.h]\d{2})\s*([ap])\.?\s*m\.?/gi, '$1$2m');
  const parts = /[,;\t|]/.test(glued) ? glued.split(/\s*[,;\t|]\s*/) : glued.split(/\s+/);
  return parts.map(s => s.trim()).filter(Boolean);
}
```
Split each line into time tokens and word tokens. A line with **no** times and
≥ 3 recognisable prayer names is a header row and sets the column order. A
line with fewer than 5 times is skipped. Lines of only `-=_` are skipped.

## 15.3 Prayer-name aliases
```ts
const ALIASES = {
  fajr:    ['fajr','fajir','fejr','fadjr','subh','sobh','subuh','sahar','dawn'],
  sunrise: ['sunrise','sun rise','shurooq','shuruq','shurouq','shorooq','ishraq','syuruk','sunup'],
  dhuhr:   ['dhuhr','duhr','zuhr','zohr','thuhr','luhr','dhur','zuhur','dhuhur','noon','midday'],
  asr:     ['asr','assr','asar','ashr'],
  maghrib: ['maghrib','magrib','maghreb','magreb','sunset','iftar'],
  isha:    ['isha',"isha'a",'ishaa','ishā','esha','eshaa','isya','nightfall','ishaʼ'],
};
```
Match on a lower-cased token stripped to `[a-z' ]`: accept an exact match, a
`startsWith` either way, requiring ≥ 3 characters for the reverse direction.

## 15.4 Dates
Strip weekday words (`Mon`…`Sun`, with suffixes) and parentheses, then try, in
order: `YYYY-MM-DD`; a named month plus a day number; `D/M` or `M/D` per the
`dateOrder` option; a bare day number. A bare day number uses the default
month, and **rolls to the next month when it is lower than the previous row's
day** — which is how a sheet that spans a month boundary parses correctly.

## 15.5 Columns
```ts
function columnPlan(count:number, mode:'auto'|'begins'|'pairs', headerKeys?:string[]) {
  const pair = (k:string) => [{key:k,which:'begins'},{key:k,which:'jamaah'}];
  const paired = count >= 10 && count <= 12;
  if (mode === 'pairs' || (mode === 'auto' && paired)) {
    if (count >= 11) {
      const plan = [...pair('fajr'), {key:'sunrise',which:'begins'}];
      if (count >= 12) plan.push({key:'sunrise',which:'skip'});
      return [...plan, ...pair('dhuhr'), ...pair('asr'), ...pair('maghrib'), ...pair('isha')];
    }
    return [...pair('fajr'), ...pair('dhuhr'), ...pair('asr'), ...pair('maghrib'), ...pair('isha')];
  }
  if (headerKeys?.length === count) return headerKeys.map(k => ({key:k, which:'begins'}));
  const keys = count >= 6 ? KEYS.slice(0,6) : ['fajr','dhuhr','asr','maghrib','isha'];
  return keys.map(k => ({key:k, which:'begins'}));
}
```
The plan is chosen from the **most common** time-column count across all rows;
a row with a different count gets its own plan.

## 15.6 Time resolution
Per §3.4 — resolved **per value**: `am`/`pm` wins; else hour > 12 means it is
already 24-hour; else `dhuhr`/`asr`/`maghrib`/`isha` get +12. Reject hour > 23
or minute > 59.

## 15.7 Output and reporting
Keep a day only when it yields ≥ 4 times. Set `meta.jamaah = true` if any
column mapped to `jamaah`. Report, in the import log:
- `Imported N days.`
- `No am/pm or 24-hour markers — Dhuhr to Isha read as afternoon/evening.` (when neither was seen)
- `N line(s) skipped (no usable date or times).`
- `N time columns per row, read as begins + jamaah pairs.` (or the header order)
- `N days across M month(s). Days with no entry show as unavailable.`

Set `meta.source` to the file name or `pasted`, and `meta.imported` to today's
ISO date. Delete `meta.placeholder` on a successful import.

---

# 16. Build order for Lovable

Lovable works best in small, verifiable steps. Do not ask it for the whole app
in one prompt — the board layout and the time engine will both come back
approximately right and approximately wrong.

**Step 0, before any of this: §19.4.** Confirm the project emits a static,
client-only build. Everything below is wasted if it cannot be packaged.

| Step | Ask for | Verify before moving on |
|---|---|---|
| 1 | Project shell: Vite + React + TS + Tailwind, `color-scheme: light`, no dark mode, no router, a single full-viewport `100svh` page with `overflow:hidden`. | Nothing scrolls; no shadcn chrome on the page. |
| 2 | `src/engine/time.ts` with §4.2–4.6 verbatim, plus unit tests for `epochOf` across 25 Oct 2026 and for `inSummerTime` on 9 Oct vs 30 Oct. | Tests green. |
| 3 | `src/engine/hijri.ts` (§5) with tests against the six anchors in §5.3. | Tests green. |
| 4 | Drop in `public/data/timetable.json` (the real 61 days) and `src/engine/timetable.ts` (`dayEntry`, `minutesFor`, `eventsFor`, `hasJamaah`). | §14.7 validator passes. |
| 5 | `src/engine/countdown.ts` (§7.1, §7.2) with the §14.5 sweep as a test. | Sweep green. |
| 6 | The board: structure (§6.2) and `board.css` (§6.4, §6.5) — static, no behaviour. | §14.3 layout numbers hit at all four widths. |
| 7 | The mat SVG generator (§6.3) with its ResizeObserver. | Rendered SVG width == container width; dome undistorted at 320 px and 430 px. |
| 8 | Wire the tick loop (§7.5), row states (§6.6), countdown, progress, footer, day flip. | §14.1 and §14.2 values reproduce under a clock override. |
| 9 | Monthly timetable screen (§8) and the bottom-sheet menu (§10.9). | Today's row highlighted; Friday day-cells blue; Adhan/Iqamah toggle works. |
| 10 | Settings screen (§10) and persistence (§11). | Reload keeps every setting; offsets move adhan only. |
| 11 | Notifications, sound, dedupe, in-app banner, diagnostics (§9). | §14.4, all seven cases — **on a published URL, not the preview iframe**. |
| 12 | PWA: manifest, icons, custom service worker, update strategy (§12). | Installs to a phone home screen; a redeploy is picked up without clearing site data. |
| 12b | Offline: the shell/data strategy split (§12.2) and the app-side guards (§12.3). | **§14.6, all five cases.** Case 3 (hanging connection) is the one that fails while everything else passes. |

**Stop here and ship.** Steps 1–12 are the whole product for a mosque that is
content with foreground alerts, and everything above is verifiable without a
backend. Only continue if background alerts are actually wanted.

| Step | Ask for | Verify before moving on |
|---|---|---|
| 13 | The feature flag and the client subscribe/unsubscribe flow (§13.3, §13.8) with the Settings row and all seven states (§13.13), against a **stub** endpoint. | With the flag unset the row is absent and no external request is made; with it set, every state renders correctly. |
| 14 | Supabase: the four tables with RLS closed to anon (§13.5), the register/unregister Edge Functions, and the timetable seeding script plus the hash check (§13.6). | Diagnostics reports `Server timetable: matches (61 days)`; anon cannot read `push_subscriptions`. |
| 15 | The `dispatch-alerts` function (§13.9), the payload (§13.10), failure handling (§13.11), and the `* * * * *` cron. | A real notification arrives on a real phone with the app closed. Do this before anything else in step 15 is considered done. |
| 16 | Double-alert resolution (§13.12), the conditional UI copy and privacy text (§13.13, §13.14). | §13.15 cases 1–14, plus the whole of §14 still passing with the flag on. |

## 16.1 Prompt-level instructions worth repeating to Lovable

- "Do not add a date library. Use `Intl.DateTimeFormat` only."
- "Do not calculate prayer times. Read them from `timetable.json`."
- "Do not add dark mode or `dark:` variants. The palette is fixed."
- "Do not add a page header or nav bar. The board is the entire viewport."
- "Do not make the page scrollable. `height:100svh; overflow:hidden`."
- "Keep prayer names and times at font-weight 300. Do not bolden them."
- "Keep `clamp()` and `vh` units as written. Do not convert them to fixed px
  or to Tailwind spacing tokens."
- "The mat is one continuous outline enclosing the clock and the whole table.
  Do not split it into a header arch plus a table border."
- "Do not add a backend, Supabase, or push notifications unless I ask for
  §13. Phase 1 makes no network request to any origin but its own."
- "Background alerts are behind a feature flag. With the flag unset, the
  Settings row must be absent — not disabled, not a placeholder."

## 16.2 Native build order (Part B, outside Lovable)

Steps 13–16 above are the **web** push option and are **not needed** for the
native app (§21). Going native instead, after step 12:

| Step | Do | Verify before moving on |
|---|---|---|
| N1 | Confirm the static client-only build; set Vite `base: './'` (§19.4). | `dist/index.html` opens from `file://` with no 404s and no server entry point. |
| N2 | `cap init` + add both platforms; `capacitor.config.ts` per §20.2; agree the bundle id with the mosque. | Both projects build and launch to the board, offline, with aeroplane mode on. |
| N3 | Swap storage to Preferences/Filesystem (§20.5) and disable the service worker natively (§20.6). | Settings survive a force-quit; no `controllerchange` reload loop. |
| N4 | Platform integration: safe areas, status bar, splash, back button, lifecycle, no overscroll (§23). | §14.3 layout checks pass on a notched device and a short device. |
| N5 | Local notifications: channels, permissions, the schedule builder and the rolling window (§21.2–§21.7). | A notification arrives on a **real, force-closed** device, both platforms. Nothing else in N5 counts until this does. |
| N6 | Bundle the notification sounds into both platform folders; add the build check (§22.2). | The adhan excerpt plays from a locked phone — not the system default, which is what a misnamed file silently gives you. |
| N7 | Foreground dedupe (§21.10) and the native diagnostics lines (§21.8). | App open at an adhan minute: exactly one notification, one banner, audio once. |
| N8 | Remote timetable with bundled fallback and validation (§25.2). | A hosted revision bump reaches the device, is validated, re-renders, and reschedules alerts. |
| N9 | Store assets, declarations, review notes (§24); the mosque's written permission (§24.4). | §24.5 checklist complete. |

N5 is where the real work is. N1 is where the project gets derailed if skipped.

---

# 17. Known limitations (state these to users, do not hide them)

1. **No background alerts in the web app.** Alerts fire only while the app is
   open. A closed web app cannot schedule an alarm or play audio. Two fixes,
   and they are not equivalent: §13 adds a push server (web); **§21 schedules
   them natively with no server at all, and plays a bundled call to prayer as
   the notification sound** — which is the main reason to ship the native app.
   Even natively, the *full-length* adhan from a locked phone stays out of
   reach on iOS (§22.3).
2. **Coverage is finite.** The app ships September and October 2026. Other
   dates show "No times" until the months are added. The coverage banner says
   so explicitly.
3. **Hijri runs one day ahead of the printed sheet** for part of this period.
   This is correct per the requirement to follow hijri-calendar.com
   (Umm al-Qura). §5.3.
4. **No azan audio is bundled** (licensing). The default is a synthesised
   chime; a user can supply their own file, stored only on their device.
5. **iOS needs Home Screen installation** before notifications reach the lock
   screen at all, and even then §13 is required for a closed app.
6. **Times are only as good as the transcription.** The app is a faithful
   reader of a printed sheet, not an authority.

---

# 18. Reference files in this repository

| Path | What it is |
|---|---|
| `azan/index.html` | full markup + CSS of all three screens |
| `azan/app.js` | the whole engine and UI logic (~1,300 lines) |
| `azan/sw.js` | service worker, incl. the push handlers |
| `azan/manifest.webmanifest` | PWA manifest |
| `azan/data/timetable.json` | **the 61-day dataset — copy this** |
| `azan/tools/tables/2026-09.txt`, `2026-10.txt` | human-editable monthly sources |
| `azan/tools/build_timetable.py` | text tables → `timetable.json` |
| `azan/tools/build_standalone.py` | inlines everything into one HTML file |
| `azan/tools/make_icons.py` | generates the three PNG icons |
| `azan/docs/REQUIREMENTS.md` | this document |

When in doubt about a behaviour this document does not cover, the reference
implementation is authoritative — read it rather than guessing.
---

# PART B — NATIVE APP (iOS / Android)

Part A (§1–§18) specifies the app itself: its data, its engine, its screens,
its exact layout. **All of it is reused unchanged in the native app.** Part B
specifies only the delivery layer — how that same app becomes an installable
iOS/Android binary, and the three things that genuinely change when it does:
alerts, audio, and how a new month's timetable reaches users.

---

# 19. Delivery target: native app

## 19.1 What Lovable can and cannot do — verified, not assumed

Checked against Lovable's own documentation (October 2026):

| Claim | Status |
|---|---|
| Lovable builds native iOS/Android apps | **No.** Lovable's FAQ states it does not produce native apps and does not generate React Native projects. |
| Lovable can publish to the App Store / Google Play | **No.** The publish docs state: *"Lovable has no built-in flow that packages and submits your project to the App Store or Google Play."* |
| Lovable's own recommended native route | **Capacitor, built outside Lovable.** The publish docs say to *"wrap your published URL in a native shell with"* Capacitor, and name this as the right path *"when you need native device APIs"* such as push notifications. |
| Capacitor plugins work in a Lovable-published app | **No.** Lovable's npm docs state Capacitor native plugins install without error but do not function in the published app, because published apps run in a browser. They work **only** in the native build. |
| The "Lovable mobile app" | Irrelevant here — it is an app for *building* Lovable projects from a phone. It *"does not turn your project into a native app for end users."* |

**Conclusion.** The route is: **Lovable builds the web/UI layer → Capacitor
wraps it into native iOS and Android projects → you build and submit those
outside Lovable.** This is not a workaround; it is the path Lovable's own
documentation points to.

## 19.2 What this means practically

| | |
|---|---|
| Done in Lovable | Everything in Part A: screens, layout, engine, data, parser, settings |
| Done outside Lovable | Capacitor install and config, native plugin wiring (§21–§23), Xcode and Android Studio builds, store submission (§24) |
| You will need | A **Mac with Xcode** for iOS (no way around this), **Android Studio** for Android, an **Apple Developer account** (annual fee) and a **Google Play developer account** (one-off fee). Verify current prices — they change. |

Lovable does the part that is most of the work. The native shell is a
well-trodden, mostly mechanical step; the parts that need real thought are
§21 (scheduling) and §24 (review risk).

## 19.3 Bundled build, not a URL wrapper — non-negotiable

Capacitor can run in two modes. The choice is not stylistic:

| | Remote URL (`server.url`) | **Bundled static build** |
|---|---|---|
| How | the WebView loads your live site | `dist/` is copied into the app |
| Offline | **broken** — a blank WebView with no signal | works fully |
| App Store risk | high — reads as "just a website" under Apple guideline 4.2 | low |
| Code updates | instant | needs a release, or OTA (§25.4) |

**Use the bundled build.** Offline operation is a core requirement of this app
— a prayer timetable that fails in a basement or on aeroplane mode is not fit
for purpose — and a thin URL wrapper is the single most common cause of App
Store rejection for apps of this kind. Lovable's docs phrase the Capacitor
route as wrapping "your published URL"; do not take that literally here.

## 19.4 Precondition: the project must produce a static client-only build

Capacitor copies a folder of static files. So `npm run build` must emit a
self-contained client bundle with no server runtime.

**This needs checking before anything else.** Lovable's changelog states that
apps *"created from May 13, 2026"* use **TanStack Start**; projects created
before that are **React + Vite**. TanStack Start is server-rendering-capable,
and an SSR build does not drop into Capacitor.

Do this first, before writing any feature code:

1. Ask Lovable for a **React + Vite single-page app**, explicitly, in the
   first prompt — or confirm the project it created can emit a static,
   client-only build.
2. Run the production build and inspect the output. You need a folder
   (`dist/`) containing `index.html` plus assets, and **no** server entry
   point, no `.output/server`, no Node handler.
3. If the build is server-rendered: configure the framework for SPA / static
   output and prerender the single route, or export the project to GitHub and
   point Capacitor at a plain Vite SPA build of the same source.
4. Confirm the built `index.html` opens correctly from `file://`. Capacitor
   serves from a local scheme, so **every asset path must be relative** —
   an absolute `/assets/...` will 404 in the native shell. Set Vite's
   `base: './'`.

If this step is skipped the first Capacitor build will show a white screen,
and the cause is not obvious from inside the native tooling.

**One source for the TanStack Start default is Lovable's own changelog; the
claim that it complicates Capacitor is from a third-party guide. Verify
against the project in front of you rather than trusting either.**

## 19.5 The alternative, stated fairly

If you are willing to drop Lovable for the UI, **Expo / React Native** builds
a genuinely native app with no WebView, and has first-class local
notifications. What carries over and what does not:

| Part A section | Reusable in Expo? |
|---|---|
| §3 data model, §4 time engine, §5 Hijri, §7.1–§7.2 countdown, §15 parser | **Yes, verbatim.** They are pure TypeScript with no DOM dependency — this is why Part A insists on that separation. |
| §6 board layout and CSS | **No.** Rewrite in React Native styles; the `clamp()`/`vh` rhythm has no direct equivalent and the mat SVG needs `react-native-svg`. |
| §8, §10 screens | Rewrite, same content and behaviour. |
| §12 PWA | Not applicable. |

That is roughly a week of layout work to redo something that already looks
right. **Recommendation: Capacitor.** The board is the app's whole identity
and it is already pixel-correct in CSS; wrapping it keeps that for free and
still gives real native notifications (§21). Revisit Expo only if the WebView
proves too slow — on a board that re-renders once a second, it will not.

---

# 20. Native shell setup

## 20.1 Install and initialise

Run outside Lovable, in a checkout of the exported repository:

```bash
npm i @capacitor/core @capacitor/cli
npx cap init "Shaheed Bilal Mosque" ie.shaheedbilal.prayer --web-dir dist
npm i @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
```

The bundle id (`ie.shaheedbilal.prayer`) is **permanent** — it cannot be
changed after the first store submission without shipping a new app. Agree it
with the mosque before the first `cap init`.

## 20.2 `capacitor.config.ts`

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ie.shaheedbilal.prayer',
  appName: 'Shaheed Bilal Mosque',
  webDir: 'dist',
  // NO `server.url` — the build is bundled (§19.3).
  ios:     { contentInset: 'never', backgroundColor: '#e9e5dc' },
  android: { backgroundColor: '#e9e5dc', allowMixedContent: false },
  plugins: {
    SplashScreen: {
      backgroundColor: '#e9e5dc',
      showSpinner: false,
      launchAutoHide: false,        // hidden by the app once the board is drawn
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_masjid',  // Android status-bar icon, white on transparent
      iconColor: '#1f2333',
      sound: 'adhan.wav',           // see §22 — and the Android caveat in §21.6
    },
  },
};
export default config;
```

`backgroundColor` is set in three places (both platforms and the splash) to the
board's sand `#e9e5dc`, so there is never a white flash between splash and
board.

## 20.3 Plugins

| Plugin | Why |
|---|---|
| `@capacitor/local-notifications` | **the core of §21** — scheduled alerts with no server |
| `@capacitor/app` | resume/pause events (§23.5), Android back button (§23.4) |
| `@capacitor/splash-screen` | controlled hide once the board has drawn |
| `@capacitor/status-bar` | style the status bar over the sand background |
| `@capacitor/preferences` | native key-value store; **replaces `localStorage`** (§20.5) |
| `@capacitor/filesystem` | stores the user's azan audio file (replaces IndexedDB) |
| `@capacitor-community/keep-awake` | replaces the Web `wakeLock` (§23.3) |
| `@capacitor/push-notifications` | **only** if §13 is also built, for announcements |

Keep the list this short. Every plugin is a native dependency, a permission
prompt risk and a store-review question.

## 20.4 Build pipeline

```bash
npm run build          # must emit a static dist/ (§19.4)
npx cap sync           # copies dist/ into both native projects, updates plugins
npx cap open ios       # then Archive in Xcode
npx cap open android   # then Generate Signed Bundle in Android Studio
```

`npx cap sync` after **every** web change. Forgetting it means the native app
silently runs the previous build — the native equivalent of the stale-cache
problem that §12.4 exists to prevent.

Keep three version numbers in step on every release, and say so in the release
checklist: `APP_VERSION` in the web code, `CFBundleShortVersionString` +
`CFBundleVersion` on iOS, `versionName` + `versionCode` on Android.

## 20.5 Storage: swap the web APIs for native ones

A WebView's `localStorage` can be cleared by the OS under storage pressure.
Settings and an imported timetable must not evaporate.

| Part A (§11) | Native replacement |
|---|---|
| `localStorage` `azan.settings`, `azan.timetable`, `azan.fired`, `azan.push` | `@capacitor/preferences` under the same keys |
| IndexedDB `azan-db` → `files` → `azan` | `@capacitor/filesystem`, `Directory.Data`, `azan-custom.wav` |

Write one storage adapter with the Part A interface (`get`/`set`/`del`) and
pick the implementation at runtime by `Capacitor.isNativePlatform()`. Part A's
code then needs no changes, and the same bundle still runs as a web app.

The try/catch discipline in §11 stays: native calls are async and can still fail.

## 20.6 Turn the service worker off in the native shell

Do **not** register the service worker when running natively. A WebView
serving from a local scheme with a network-first service worker in front of it
produces double caching, pointless network attempts offline, and a
`controllerchange` reload loop from §12.4.

```ts
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  /* the whole of §12.4 */
}
```

The PWA path (§12) stays intact for the web build, which should keep being
published alongside the native apps — it is how people try the app before
installing, and how desktop users read the board.

---

# 21. Native alerts — real background alerts, no server

**This is the reason to go native.** Part A could only alert while the app was
open, and §13 needed a push server to do better. A native app schedules
notifications with the operating system, so they fire with the app closed,
the phone locked, and **no backend at all**.

§13 is therefore no longer needed for prayer alerts. It remains useful only
for mosque *announcements* (§21.9).

## 21.1 What changes and what does not

| | Part A (web) | Native |
|---|---|---|
| Alert with app closed | impossible | **yes** |
| Needs a server | yes (§13) | **no** |
| Notification sound | system default | **bundled adhan excerpt** (§22) |
| Full-length adhan from a locked phone | impossible | still constrained — see §22.3 |
| Alert copy, timing rules, offsets, dedupe ids | §9.4 | **unchanged** |

Everything about *when* to alert and *what it says* is already specified in
§9.4 and must not be redesigned. Only the mechanism changes.

## 21.2 Scheduling model

The OS holds a set of pending notifications. The app's job is to keep that set
correct, and to re-derive it whenever anything it depends on changes.

```ts
import { LocalNotifications } from '@capacitor/local-notifications';

/** Deterministic integer id, so rescheduling is idempotent rather than additive. */
function notifId(dateISO: string, key: string, kind: 'at'|'pre'|'jam'): number {
  const dayNo  = Number(dateISO.slice(5,7)) * 100 + Number(dateISO.slice(8,10)); // MMDD
  const keyNo  = ['fajr','sunrise','dhuhr','asr','maghrib','isha'].indexOf(key); // 0..5
  const kindNo = { at:0, pre:1, jam:2 }[kind];
  return dayNo * 100 + keyNo * 10 + kindNo;        // e.g. 16 Oct, dhuhr, at -> 1016_20
}

async function rescheduleAll() {
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications });
  }
  const list = buildSchedule(Date.now());           // §21.3
  if (list.length) await LocalNotifications.schedule({ notifications: list });
  await recordScheduleDiagnostics(list);            // §21.8
}
```

Cancel-then-reschedule, never incremental. Deterministic ids make a missed
cancel harmless rather than a duplicate alert.

## 21.3 The rolling window — and the iOS cap

Up to **18 notifications per day** are possible (6 prayers × `at`/`pre`/`jam`).
iOS keeps only a bounded number of pending local notifications per app — widely
documented as **64**, after which the soonest are kept and the rest discarded
silently. *Treat 64 as the working budget and verify it on a device before
relying on a larger number.* Android has no comparable documented limit but
should not be loaded with thousands either.

So the app cannot "schedule the year". It schedules a window and tops it up.

```ts
const BUDGET = 60;                 // under 64, leaving room for §21.5

function buildSchedule(now: number): LocalNotificationSchema[] {
  const out: LocalNotificationSchema[] = [];
  const tz = zoneName(meta);
  let day = todayInZone(tz);

  for (let i = 0; i < 30 && out.length < BUDGET; i++) {
    for (const e of eventsFor(day.y, day.m, day.d)) {        // §4.3, unchanged
      if (!prefs.prayers[e.key]) continue;
      const add = (kind: 'at'|'pre'|'jam', at: number, title: string, body: string) => {
        if (at <= now || out.length >= BUDGET) return;
        out.push({
          id: notifId(e.date, e.key, kind),
          title, body,
          channelId: channelFor(e.key),                      // §21.6
          schedule: { at: new Date(at), allowWhileIdle: true },
          extra: { key: e.key, kind, fireId: `${kind}:${e.date}:${e.key}` },
        });
      };
      add('at', e.at, e.name, `It is now ${fmtTime(e.minutes)} — time for ${e.name}.`);
      if (prefs.pre > 0 && !e.sun)
        add('pre', e.at - prefs.pre * 60000,
            `${e.name} in ${prefs.pre} min`, `${e.name} at ${fmtTime(e.minutes)}`);
      if (prefs.jam > 0 && !e.sun && e.jamaahAt !== null)
        add('jam', e.jamaahAt - prefs.jam * 60000,
            `${e.name} iqamah in ${prefs.jam} min`, `Iqamah at ${fmtTime(e.jamaah!)}`);
    }
    day = addDays(day, 1);
  }
  return out;
}
```

Notes that matter:
- Events are built by **§4.3 unchanged** — same two-pass zone arithmetic, so the
  25 October transition is handled identically to the board.
- `fireId` in `extra` is the **same format as §9.4**, which is what lets the
  foreground path and the OS path interlock (§21.7).
- `allowWhileIdle: true` lets the notification fire in Android Doze. Capacitor's
  docs note these *"can only fire once per 9 minutes, per app"* — fine here,
  since prayers are never 9 minutes apart, but it is why `pre` and `jam`
  offsets must not be set to values that collide with an adjacent `at`.
- With all three kinds on, 60 slots is roughly **3–4 days** of cover. With
  `at` only, about 10 days. State this in the UI (§21.5).

## 21.4 When to reschedule

Rebuild the schedule on every one of these:

| Trigger | Why |
|---|---|
| App start | the baseline |
| `App` resume (`appStateChange` → active) | tops the window up every time the user opens the app |
| Midnight rollover in the tick loop (§7.5) | the day changed |
| Any change to sound-per-prayer, `pre`, `jam`, or offsets | the schedule depends on them |
| A timetable import (§10.6) or remote update (§25) | the times themselves changed |
| Notification permission newly granted | nothing could be scheduled before |
| Device reboot | Android clears alarms; re-schedule on next launch |
| A notification firing | consumes a slot — top up |

Debounce to one rebuild per ~2 s so a user dragging an offset input does not
thrash the OS.

## 21.5 The window-expiry problem — state it, mitigate it

If the user never opens the app, the schedule runs out. After ~3–4 days of
silence, alerts stop. This is the one real weakness of the local-notification
approach and it must not be glossed over.

Three mitigations, in order of value:

1. **The last scheduled notification is a top-up reminder.** Schedule one
   extra notification at the end of the window: *"Open Shaheed Bilal Mosque to
   keep prayer alerts coming."* Opening the app rebuilds the window. Cheap,
   reliable, no server. Budget one slot for it.
2. **Background refresh.** iOS `BGAppRefreshTask` / Android `WorkManager`, via
   a background-task plugin, to rebuild the schedule without the user. iOS
   grants these at its own discretion and **may never run them** on a rarely
   used app — treat it as a bonus, never as the mechanism.
3. **Remote push as a backstop** (§13). A silent push wakes the app to
   reschedule, giving an unbounded window. Only worth the server if 1 and 2
   prove insufficient in practice.

Ship with 1 and 2. Measure before adding 3.

Also state it plainly in the UI, replacing the §9.7 web copy:

> *"Alerts are scheduled on your phone, so they arrive with the app closed.
> About a week's worth is scheduled at a time — open the app occasionally to
> keep them topped up."*

## 21.6 Android notification channels — a one-way door

From Capacitor's docs: on Android 8+ the top-level `sound` is not the
mechanism — *"use channelId of a channel configured with the desired sound"* —
and a channel's sound *"can't be changed unless the app is uninstalled."*

That is a trap. If channel sound is immutable and the user can choose between
the adhan and a chime, you cannot mutate one channel; you must **create one
channel per sound and route the notification to the right channel.**

```ts
await LocalNotifications.createChannel({
  id: 'adhan-v1', name: 'Prayer times (adhan)', importance: 5,
  sound: 'adhan.wav', visibility: 1, vibration: true,
});
await LocalNotifications.createChannel({
  id: 'chime-v1', name: 'Prayer times (chime)', importance: 5,
  sound: 'chime.wav', visibility: 1, vibration: true,
});
await LocalNotifications.createChannel({
  id: 'silent-v1', name: 'Prayer times (silent)', importance: 3,
  vibration: false,
});

const channelFor = (key: string) =>
  settings.muted ? 'silent-v1'
  : ({ azan: 'adhan-v1', beep: 'chime-v1', off: 'silent-v1' } as const)[settings.sound[key]];
```

- Capacitor's docs note channels with importance ≥ 3 should have a sound;
  importance 5 is what puts the alert on the lock screen with sound.
- The `-v1` suffix is deliberate. **If you ever change a bundled sound file,
  bump to `-v2`** and create the new channel — the old channel keeps the old
  sound forever on devices that already have it. Users can also override
  channel sound in Android settings, and that is their right; do not fight it.
- `settings.muted` routes to the silent channel. This keeps §9.1's rule intact
  natively: **muting kills the sound, never the notification.**

## 21.7 Permissions

```ts
let p = await LocalNotifications.checkPermissions();
if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
```

- **Android 13+** requires the `POST_NOTIFICATIONS` runtime permission.
  Capacitor's `schedule()` requests it if not already granted, but request it
  explicitly from a user gesture so the prompt is expected — §9.2's rule about
  never asking on load still applies.
- **Android 12+** needs `SCHEDULE_EXACT_ALARM` in the manifest for exact
  timing, and the user can switch exact alarms off in app settings.
- **Android 14** offers `USE_EXACT_ALARM`, which needs no user prompt but is
  reserved for apps where exact alarms are central to the purpose. A prayer-time
  app is a textbook case — a notification five minutes late is useless — so
  declare it, and be ready to justify it in the Play Console (§24.3).
- Detect when exact alarms have been denied and say so in diagnostics rather
  than letting alerts drift silently.

Permission states map onto the existing §9.2 copy; keep the wording, drop the
browser-settings phrasing in favour of the OS app settings.

## 21.8 Diagnostics (§9.6) gains native lines

```
Notification permission : granted | denied | prompt
Exact alarms (Android)  : allowed | denied by user | n/a
Scheduled notifications : 57 pending, through 19 Oct 14:40
Next scheduled          : Dhuhr at 13:16 (today)
Channels                : adhan-v1, chime-v1, silent-v1
Last notification fired : Dhuhr at 13:16:02 | none recorded
Native platform         : ios 18.2 | android 15
Web/native storage      : Preferences (native)
```

`Scheduled notifications … through <date>` is the single most useful line: it
makes the §21.5 window visible instead of a silent cliff.

## 21.9 Where §13 still earns its place

Local notifications cannot deliver something the app did not already know. Keep
§13's push server **only** if the mosque wants:
- ad-hoc announcements (Eid timings, a funeral prayer, a closure);
- an immediate timetable correction pushed to every device;
- the unbounded-window backstop in §21.5.

If so, §13's schema, failure handling and privacy rules apply as written, with
`@capacitor/push-notifications` in place of the Web Push subscription, and
**prayer alerts still scheduled locally** — never both, or every alert arrives
twice. §13.12's single rule generalises: whichever path owns the notification,
the other stays silent.

## 21.10 Foreground dedupe

With the OS scheduling notifications, the in-app tick (§7.5) must not also
raise them. When running natively:

- `fire()` **skips `notify()`** entirely — the OS already did it;
- it still shows the in-app banner (§9.8) and plays audio (§9.5);
- `azan.fired` and the `fireId` format stay exactly as specified, so an alert
  handled by the OS is not re-handled by the page.

Register a `localNotificationReceived` listener to mark the `fireId` fired and
show the banner when the app is open; and `localNotificationActionPerformed`
to bring the board to the front when the user taps the notification.

---

# 22. Native audio

## 22.1 Two separate audio paths — do not conflate them

| Path | When | Mechanism | Length |
|---|---|---|---|
| **Notification sound** | app closed or backgrounded | a file bundled in the app, played by the OS | short — see §22.3 |
| **In-app playback** | app open | the existing §9.5 code, unchanged | full length |

Part A's §9.5 priority chain (user file → bundled file → chime) stays exactly
as written for the in-app path. §22 adds only the notification sound.

## 22.2 Bundling the files

Per Capacitor's docs: on iOS *"the sound file must be in the app bundle"*; on
Android *"the file should be in res/raw folder"*; the filename must include its
extension; and if the file is missing or misnamed, **the default system sound
plays silently instead** — a failure mode that looks like "the adhan doesn't
work".

```
ios/App/App/adhan.wav          and  chime.wav      (added to the Xcode target)
android/app/src/main/res/raw/adhan.wav   chime.wav
```

Capacitor's docs recommend **`.wav`** as the format supported on both
platforms. Use it; do not ship an mp3 and hope.

Add a build check that fails if either file is missing from either platform
folder. This is the single easiest thing to get silently wrong.

## 22.3 The honest limit on iOS

A notification sound on iOS is a short alert tone, not a media track — the
documented ceiling is around **30 seconds**, beyond which the default sound is
used instead. *Verify the exact behaviour on a device before committing to a
file length.*

So:

- **Achievable:** a ≤30 s adhan excerpt as the notification sound, from a
  locked phone, both platforms.
- **Not reliably achievable:** a full 2–3 minute adhan from a closed app on
  iOS. The routes to it are a background-audio mode (which Apple is likely to
  reject for a notification use-case) or the Critical Alerts entitlement
  (which requires a separate Apple approval and is intended for health and
  safety apps). **Do not design around either.**
- **Android** is more permissive, but channel-sound length is still
  constrained in practice. Use the same excerpt on both for consistency.

State this in the UI rather than letting users discover it:

> *"The notification plays a short call to prayer. Open the app to hear the
> full adhan."*

This is a real improvement on Part A, where a closed app produced no sound at
all — but it is not "the full adhan plays from your pocket", and promising
that will produce complaints.

## 22.4 Silent mode and Do Not Disturb

A notification sound obeys the ringer switch and Do Not Disturb on both
platforms. There is no supported way to override this short of iOS Critical
Alerts (§22.3). Say so in the About card:

> *"Alerts follow your phone's silent mode and Do Not Disturb settings. For a
> guaranteed sound, set a clock alarm as well."*

The clock-alarm advice from §9.7 stays. It was honest in Part A and it is
still honest here.

## 22.5 Licensing

The app still ships **no** adhan recording until one is licensed —
§9.5's reasoning is unchanged, and it now matters more because a store binary
is a distribution. Options: a recording the mosque owns or has written
permission to distribute, or a clearly-licensed recording with attribution.
Keep the synthesised chime (§9.5) as the shipped default and the fallback, so
the app is complete and submittable with no licensed audio at all.

## 22.6 The user's own file

`@capacitor/filesystem` replaces IndexedDB (§20.5). A user-chosen file plays
**in-app only** — it cannot become the notification sound, because iOS and
Android both require notification sounds to be bundled at build time. Say this
on the Azan audio card:

> *"Your own file plays while the app is open. Notification sounds are built
> into the app and cannot be changed."*

---

# 23. Native platform integration

## 23.1 Safe areas and the status bar

The board already pads with `env(safe-area-inset-*)` (§6), which is why it
needs no layout change natively. Add:

- `ios: { contentInset: 'never' }` (§20.2), so the WebView does not add its own
  inset on top of the CSS.
- `StatusBar.setStyle({ style: Style.Dark })` — dark *content* on the light
  sand background — and on Android `setBackgroundColor({ color: '#e9e5dc' })`.
- Verify on a notched device and on a device with a home indicator that
  §14.3's "no vertical scroll" still holds. The board is `100svh`; in a
  WebView that resolves to the WebView's height, which is what you want.

## 23.2 Splash screen

`launchAutoHide: false`, and hide it from the app once the board has actually
drawn — after `drawMat()` has run and the first `renderToday()` has completed:

```ts
await SplashScreen.hide({ fadeOutDuration: 150 });
```

Hiding on a timer instead shows a half-painted board. The splash is sand
`#e9e5dc` with the masjid mark (§6.10) centred, so the transition to the board
is invisible.

## 23.3 Keep awake

Replace the Web `navigator.wakeLock` path (§10.3) with
`@capacitor-community/keep-awake`: `keepAwake()` when the setting is on and the
app is active, `allowSleep()` when it is off or the app is backgrounded. The
setting, its label and its sub-label stay as specified.

## 23.4 Android hardware back button

Without handling, back exits the app from any screen. Wire it to mirror the UI:

```ts
App.addListener('backButton', () => {
  if (menuOpen)        closeMenu();
  else if (view !== 'today') showView('today');
  else                 App.exitApp();
});
```

## 23.5 App lifecycle

`App.addListener('appStateChange', ({ isActive }) => …)` replaces
`visibilitychange` (§7.6). On becoming active: reset `lastDate`, re-render
everything, re-apply keep-awake, **and rebuild the notification schedule**
(§21.4). On becoming inactive: `allowSleep()`.

## 23.6 Gestures the board must not have

- Disable overscroll/bounce — a board that rubber-bands looks broken.
  `ios: { contentInset: 'never' }` plus `overscroll-behavior: none` on `body`.
- No pull-to-refresh.
- Lock orientation to **portrait** in both native projects (the manifest
  already declares it for the web build).
- Disable text selection and the long-press callout on the board
  (`-webkit-touch-callout: none`, `user-select: none`), while leaving the
  Settings inputs selectable.

---

# 24. Store submission

## 24.1 Apple guideline 4.2 — the main review risk

Apple rejects apps that are a repackaged website with no native value. A
Capacitor app is a WebView, so this is the realistic rejection risk. What
mitigates it, in descending order of weight:

1. **Bundled, fully offline** (§19.3) — not a URL loaded at runtime.
2. **Native notifications** (§21) — scheduled with the OS, working with the
   app closed. This is a genuine native capability and the strongest argument.
3. **Native sound** (§22), keep-awake, splash, back-button handling.
4. A purpose that is clearly an app, not a web page: a single mosque's
   timetable, consulted daily, offline, with alerts.

Put points 1–3 in the **review notes** explicitly rather than hoping the
reviewer finds them.

## 24.2 Review notes — draft

> Shaheed Bilal Mosque is the prayer timetable for a single mosque in Dublin
> 15, built for its congregation. Prayer times are transcribed from the
> mosque's printed timetable and bundled in the app; nothing is calculated and
> no network connection is required — the app is fully functional offline.
>
> The app schedules local notifications with the OS so that prayer alerts
> arrive with the app closed and the device locked, plays a bundled call to
> prayer as the notification sound, and keeps the screen awake while the board
> is displayed.
>
> No account, no login, and no personal data is collected. Times are displayed
> for Dublin, Ireland (Europe/Dublin).

## 24.3 Declarations and metadata

| Item | Value |
|---|---|
| Category | Reference, or Lifestyle |
| Age rating | 4+ / Everyone |
| Apple privacy ("App Privacy") | **Data Not Collected** — true as long as §13 is not built. If it is, declare the push token under *Identifiers → Device ID*, used for *App Functionality*, not linked to identity, not used for tracking. |
| Play Data safety | same answer, same caveat |
| Permissions declared | notifications; `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` |
| Play Console exact-alarm justification | *"The app's core function is notifying users at exact prayer times taken from a published mosque timetable. A late notification does not serve the purpose."* Expect this to be reviewed. |
| Encryption export (Apple) | no non-standard cryptography; the usual exemption applies — confirm against the current questionnaire |
| Screenshots | the board on each required device size; plus the monthly timetable and settings |
| Icon | §6.10 masjid mark on sand; iOS needs no alpha channel |

## 24.4 Permission before you publish

**Get the mosque's written agreement** before submitting an app that carries
its name, publishes its timetable and appears to speak for it. Also agree who
owns the developer account and the bundle id — if a volunteer submits under a
personal account, the mosque cannot take it over later without republishing.

This is the step most likely to be skipped and most expensive to fix.

## 24.5 Pre-submission checklist

- [ ] Static client-only build verified (§19.4); app opens with no network
- [ ] `npx cap sync` run against the current web build
- [ ] Versions aligned across web / iOS / Android (§20.4)
- [ ] Sound files present in **both** platform folders (§22.2)
- [ ] Notification permission prompt appears only from a user gesture
- [ ] Alert verified on a real device with the app force-closed, both platforms
- [ ] §14 (all of it) still passes inside the native WebView
- [ ] §14.3 layout checks pass on a notched device and a short device
- [ ] Back button, orientation lock, no overscroll (§23)
- [ ] Review notes and privacy declarations filled (§24.2, §24.3)
- [ ] Mosque's written permission on file (§24.4)

---

# 25. Shipping a new month without a store release

## 25.1 The problem

The app bundles 61 days (September–October 2026). November must reach users
without waiting on app review, and without asking a congregation to update
manually. Store review takes days and cannot be relied on for a date-driven
release.

## 25.2 Remote timetable with bundled fallback — the recommended answer

```
bundled timetable.json   (always present, always valid, works offline forever)
        ↓ overridden by
cached remote timetable  (fetched when possible, validated before use)
        ↓ overridden by
user-imported timetable  (§10.6, unchanged — the manual escape hatch)
```

Implementation:

1. Host `timetable.json` at a stable URL — the same GitHub Pages deployment
   that serves the web app already does this.
2. Add `meta.revision` (an integer) and `meta.updated` (ISO date) to the file.
3. On app start, and at most once a day, fetch it with a short timeout.
   **Never block the board on this** — the board renders from the bundled or
   cached copy immediately.
4. **Validate before accepting**, using §14.7's rules exactly: key format,
   time format, prayer ordering, iqamah gaps within 0–120 minutes. A malformed
   or truncated download must be discarded, not displayed. A prayer app that
   renders corrupt times is worse than one that is out of date.
5. Accept only if `revision` is **higher** than the stored copy. Persist to
   `@capacitor/preferences`.
6. On acceptance: re-render, **rebuild the notification schedule** (§21.4),
   and show a toast — *"Timetable updated to November 2026."*
7. Surface the state in Settings → Timetable: `Bundled · 61 days` or
   `Updated 2 Nov 2026 · 91 days · revision 3`.

This keeps a store release for code changes only, which is where it belongs.

## 25.3 What not to do

- Do not fetch times at render time. The app must work with no network, and a
  timetable that varies by connectivity is not trustworthy.
- Do not drop the bundled copy. A fresh install on a plane must still work.
- Do not accept a remote file without validation, and do not let a remote file
  shrink coverage — a smaller day count than the bundled file means something
  is wrong upstream.

## 25.4 OTA code updates — optional, with caveats

Capacitor supports over-the-air updates of the web bundle through third-party
services (Capgo, Capawesome Cloud, Ionic Appflow). These are **commercial
products from vendors who also publish the tutorials recommending them** —
weigh accordingly.

They are worth considering only if you expect frequent UI fixes. Apple permits
JavaScript updates that do not change the app's purpose, but an OTA pipeline
is another dependency, another cost, and another thing to debug. For an app
whose data changes monthly and whose UI is finished, **§25.2 covers the real
need and OTA is not required.**

## 25.5 Monthly release routine

When the mosque issues a new sheet:

1. Transcribe it into `tools/tables/YYYY-MM.txt` (§3.4).
2. Run the build script; bump `meta.revision`.
3. Run the §14.7 validator — it must report 0 issues.
4. Spot-check the new month against the printed sheet, including the first and
   last day and any clock change.
5. Deploy the JSON. Devices pick it up within a day (§25.2) and reschedule
   their alerts automatically.
6. Only if code changed: bump versions, `npx cap sync`, rebuild, resubmit.

Steps 1–5 need no store involvement at all. That is the point.
