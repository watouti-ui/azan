# Shaheed Bilal Mosque — Prayer Times App
## End-to-end build requirements (for a Lovable rebuild)

**Version of this spec:** 1.0 · **Describes app version:** 2.1.0
**Reference implementation:** this repository (`azan/`) — vanilla HTML/CSS/JS PWA
**Live reference:** https://watouti-ui.github.io/azan/

This document is written to be pasted into Lovable (in sections) and to be
complete enough that the rebuild is behaviourally identical to the reference.
Every number, colour and rule below is taken from the working build, not from
design intent. Where a value looks arbitrary, it is load-bearing — it was
tuned against photographs of the mosque's physical display board.

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
- No server-side component in Phase 1 (see §13 for the optional push backend).

## 1.5 Audiences

1. The mosque's congregation — opens the app, reads today's times, wants a
   nudge at prayer time.
2. People who want the notification **without** the sound (this drove a
   specific requirement — see §9.1).

---

# 2. Target stack (Lovable)

Lovable scaffolds React + Vite + TypeScript + Tailwind + shadcn/ui. Build on
that, with these constraints:

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
plainly in three places:

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

## 12.2 Service worker

Cache name carries the version: `azan-v2.1.0`. **Bump it on every release** or
clients keep the old build.

Precache list: `./`, `./index.html`, `./app.js` (or the hashed Vite bundles),
`./manifest.webmanifest`, `./data/timetable.json`, and the three icons.

Strategy — **network-first with a cache fallback**:

```js
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
```

Cache-first was tried and rejected: users repeatedly saw stale builds and had
to clear site data. For an app whose entire value is correct times, a stale
cache is a correctness bug.

`install` → `cache.addAll(ASSETS)` then `skipWaiting()` (and `skipWaiting()`
even on failure). `activate` → delete every cache whose name is not `CACHE`,
then `clients.claim()`.

## 12.3 Update strategy — all three parts are required

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

## 12.4 Push handlers

Include them now even though no backend exists — they are the app half of the
contract, and they are what the test path uses.

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

# 13. Phase 2 (optional) — real background alerts

Everything above delivers alerts **only while the app is open**. Lock-screen
alerts with the app closed require a push server. Scope, if it is wanted:

1. Generate a VAPID key pair.
2. `reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey })`
   and POST the subscription to the backend.
3. Backend (Supabase Edge Function + `pg_cron`, or a Cloudflare Worker +
   Durable Object / Cron Trigger — both have adequate free tiers): hold the
   timetable, and for each subscription send a Web Push at each prayer time in
   `Europe/Dublin`.
4. Payload: `{title, body, tag, at, key, url}` — the `push` handler in §12.4
   already consumes this shape.
5. iOS requires the app to be installed to the Home Screen before it will
   expose Web Push at all (§9.7).

If Lovable's Supabase integration is used, this is the natural home for it.
It is **out of scope for Phase 1** and nothing in Phases 1 depends on it.

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

## 14.6 Data validation (CI)

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

| Step | Ask for | Verify before moving on |
|---|---|---|
| 1 | Project shell: Vite + React + TS + Tailwind, `color-scheme: light`, no dark mode, no router, a single full-viewport `100svh` page with `overflow:hidden`. | Nothing scrolls; no shadcn chrome on the page. |
| 2 | `src/engine/time.ts` with §4.2–4.6 verbatim, plus unit tests for `epochOf` across 25 Oct 2026 and for `inSummerTime` on 9 Oct vs 30 Oct. | Tests green. |
| 3 | `src/engine/hijri.ts` (§5) with tests against the six anchors in §5.3. | Tests green. |
| 4 | Drop in `public/data/timetable.json` (the real 61 days) and `src/engine/timetable.ts` (`dayEntry`, `minutesFor`, `eventsFor`, `hasJamaah`). | §14.6 validator passes. |
| 5 | `src/engine/countdown.ts` (§7.1, §7.2) with the §14.5 sweep as a test. | Sweep green. |
| 6 | The board: structure (§6.2) and `board.css` (§6.4, §6.5) — static, no behaviour. | §14.3 layout numbers hit at all four widths. |
| 7 | The mat SVG generator (§6.3) with its ResizeObserver. | Rendered SVG width == container width; dome undistorted at 320 px and 430 px. |
| 8 | Wire the tick loop (§7.5), row states (§6.6), countdown, progress, footer, day flip. | §14.1 and §14.2 values reproduce under a clock override. |
| 9 | Monthly timetable screen (§8) and the bottom-sheet menu (§10.9). | Today's row highlighted; Friday day-cells blue; Adhan/Iqamah toggle works. |
| 10 | Settings screen (§10) and persistence (§11). | Reload keeps every setting; offsets move adhan only. |
| 11 | Notifications, sound, dedupe, in-app banner, diagnostics (§9). | §14.4, all seven cases — **on a published URL, not the preview iframe**. |
| 12 | PWA: manifest, icons, custom service worker, update strategy (§12). | Installs to a phone home screen; a redeploy is picked up without clearing site data. |

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

---

# 17. Known limitations (state these to users, do not hide them)

1. **No background alerts.** Alerts fire only while the app is open. A closed
   web app cannot schedule an alarm or play audio. §13 is the fix.
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
