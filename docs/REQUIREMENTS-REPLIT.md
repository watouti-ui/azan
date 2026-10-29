# Shaheed Bilal Mosque — Replit build requirements
## A native iOS app, ready to submit to the App Store

**Spec version:** 1.0 · **Target:** React Native + Expo, built on Replit
**Companion document:** `docs/REQUIREMENTS.md` — the app's behaviour, screen by
screen and value by value. That document is the **source of truth for what the
app does**. This one is the source of truth for **how it gets built on Replit
and onto the App Store**, and it overrides the companion wherever the two
differ on mechanism.

Read R2 and R4 before writing any code. R4 in particular removes a dependency
that would otherwise fail on a reviewer's phone rather than in the simulator.

---

# R1. What is being built

A prayer-times app for **Shaheed Bilal Masjid, Dublin 15**, presented as a
replica of the mosque's physical display board, shipped as a **native iOS app**
on the App Store.

| | |
|---|---|
| Times | Transcribed from the mosque's printed timetable and **bundled in the app**. Nothing is calculated, nothing is fetched. |
| Offline | Fully functional with no network, from first launch, forever. |
| Alerts | Local notifications scheduled with the OS: they arrive with the app closed and the phone locked, with **no server**. |
| Account | None. No login, no analytics, no tracking, no personal data. |

## R1.1 What carries over from the companion spec, and what does not

| Companion section | In the Replit build |
|---|---|
| §3 data model, §7.1 `countdownTarget`, §7.2 `ishaDone`, §15 import parser | **Verbatim.** Pure TypeScript, no DOM, no platform calls. |
| §4 time engine, §5 Hijri | **Replaced** — see R4. The logic is identical; the `Intl` dependency is removed. |
| §6 the board | **Rewritten** in React Native — see R6. Same proportions, same colours, same rules; different primitives. |
| §8 month screen, §10 settings | Same content and behaviour, React Native controls — R7. |
| §9 alerts, §21 native alerts | **Replaced** by `expo-notifications` — R8. |
| §12 PWA / service worker, §13 push backend, §19–§20 Capacitor | **Not applicable.** Delete them from your mental model; this is not a WebView and there is no server. |
| §14 acceptance criteria | Still apply, plus R13. |

---

# R2. Replit's constraints — verified, not assumed

Checked against Replit's own documentation (October 2026). These shape the
whole build, so take them as fixed:

| | |
|---|---|
| App type | Choose **"Mobile app"** on the Replit home screen when creating the project. The stack is **React Native + Expo**. |
| Where you work | **replit.com, in the Project Editor.** Replit's docs are explicit that the Replit iOS app cannot create, preview, build or submit native mobile apps. |
| Builds | *"Replit and Expo manage the build process for you in the cloud."* No Mac and no Xcode needed. |
| **EAS is not available** | Replit's docs state plainly: *"EAS CLI and EAS Build are not supported on Replit."* **Do not write `eas.json`, do not run `eas build`, do not follow any Expo tutorial that uses the EAS CLI.** Use Replit's own publish flow. |
| Submission | Publish from the Project Editor → submit a build to **TestFlight** → promote it to the App Store in **App Store Connect**. Apple reviews before release. |
| Apple account | An **Apple Developer Program membership** is required for TestFlight and the App Store. |
| Previewing | iOS Simulator / Android Emulator streamed in the Project Editor (Core, Pro and Enterprise plans; **Firefox is not supported**), or on a real phone via **Expo Go** and a QR code. |
| Hardware features | Camera, haptics, **notifications** and location must be tested on a **real phone**, not the simulator. |
| Native changes | Changing app icons or permissions needs a **new store build** — they are not hot-reloaded. |
| Android | Internal Testing only; **publishing to Google Play is not supported yet.** iOS is the shippable target. |

## R2.1 The dependency rule — a hard constraint

Replit previews run in **Expo Go**, which supports **only modules included in
the Expo SDK**. Anything outside it needs an Expo *development build*, which
Replit's documentation does not cover.

**Therefore: every dependency must be part of the Expo SDK, or pure JavaScript
with no native code.** This is not a preference. A single package with its own
native module will build but will not run in Expo Go, and you will lose the
preview loop that makes Replit worth using.

### The complete allowlist

| Package | Why |
|---|---|
| `expo-notifications` | scheduled local alerts — the core of R8 |
| `react-native-svg` | the mat outline, the hatched background, the gold clock stroke (R6) |
| `expo-linear-gradient` | the active-row gradient and the progress bar |
| `@react-native-async-storage/async-storage` | settings, the fired-alert store |
| `react-native-safe-area-context` | notch and home-indicator insets |
| `expo-keep-awake` | the "keep screen awake" setting |
| `expo-audio` (or `expo-av` if your SDK predates it) | in-app azan playback |
| `expo-file-system` | storing a user-supplied azan file |
| `expo-document-picker` | choosing that file, and importing a timetable |
| `@react-native-picker/picker` | the per-prayer sound selects |

### Explicitly forbidden

- **Any date library** — no `date-fns`, `dayjs`, `luxon`, `moment`,
  `moment-timezone`, `react-native-localize`. R4 explains why none is needed.
- **Any navigation library** — three screens held in component state. No
  `expo-router`, no `react-navigation`.
- **Any UI kit** — no NativeBase, no Tamagui, no React Native Paper. The board
  is a replica of a physical object; a component library will fight it.
- **Any state library** — no Redux, no Zustand, no React Query.
- **Any analytics, crash reporter or ad SDK.** The privacy declaration in R12
  says "Data Not Collected" and that must stay true.

---

# R3. Project shape

```
assets/
  timetable.native.json     the data (R4) — bundled, never fetched
  adhan.wav                 notification sound (R9), added at build time
  icon.png  splash.png      1024x1024, no alpha
src/
  engine/
    time.ts                 local time from stored offsets — no Intl (R4)
    timetable.ts            day lookup, event building
    countdown.ts            countdownTarget, ishaDone — companion §7.1, §7.2
    format.ts               fmtTime, fmtDur
    parser.ts               timetable import — companion §15, verbatim
  notifications/
    schedule.ts             build + install the rolling window (R8)
    channels.ts             Android channels (R8.3)
  screens/
    Board.tsx  Month.tsx  Settings.tsx
  ui/
    Mat.tsx                 the mihrab outline in react-native-svg (R6.4)
    Clock.tsx               the gold stroked clock (R6.5)
    tokens.ts               colours and the clamp() helper (R6.2)
  storage.ts                AsyncStorage adapter
App.tsx
app.json
```

Keep `src/engine/` free of every React and Expo import. It is the part that is
already proven, it is the part worth unit-testing, and it is the part that must
not acquire a platform dependency.

---

# R4. Data — and the one thing that will break if you skip it

## R4.1 The problem

React Native runs on **Hermes**, which ships only a **subset** of the ECMA-402
`Intl` APIs. The companion spec's engine depends on two things that subset may
not cover:

1. `Intl.DateTimeFormat` with a **`timeZone`** option, used for every
   wall-clock-to-instant conversion and for DST correctness.
2. The **`islamic-umalqura`** calendar, used for the Hijri date.

**Status: insufficient data.** I could not confirm from Hermes's own
documentation that either works on both platforms, and there is indirect
evidence against the calendar — a V8 test notes that on Android
`islamic-umalqura` is available only for `ar` and `fa` locales. Hermes's Intl
coverage also differs between iOS and Android.

The failure mode is the bad kind: it works in the simulator, or on iOS but not
Android, or it silently returns the Gregorian date. You find out from a user.

## R4.2 The decision: precompute, depend on nothing

Every value that needs a full ICU is resolved **at build time**, on a machine
that has one, and shipped as plain numbers and strings. **The app then needs no
`Intl` at all** — it compares `Date.now()` to stored integers.

This is strictly better than testing Hermes and hoping: it removes a
device-dependent class of bug, it makes the times verifiable in CI, and it is
the same data the web app is already verified against.

The generator exists: **`tools/build_native_timetable.js`** in the companion
repository. It reads `data/timetable.json` and writes
**`data/timetable.native.json`** — copy that file to `assets/`.

## R4.3 Schema

```jsonc
{
  "meta": {
    "timezone": "Europe/Dublin",      // informational only; never parsed at runtime
    "name": "Shaheed Bilal Masjid",
    "city": "Dublin 15",
    "year": 2026,                     // the year the precomputed epochs belong to
    "jummahSummer": ["13:40","14:40"],
    "jummahWinter": ["12:30","13:20"],
    "notes": ["Maghrib salah 5 min after azan", "Isha salah 5 min after azan"],
    "jamaah": true,
    // Local-time offset segments: [fromEpochMs, offsetMinutes]. Everything the
    // app needs to turn Date.now() into Dublin wall-clock time, with no tz data.
    "utcOffsets": [[1788217200000, 60], [1792890000000, 0]]
  },
  "days": {
    "10-29": {
      "fajr": "05:31", "sunrise": "07:13", "dhuhr": "12:10",
      "asr": "14:33", "maghrib": "17:04", "isha": "18:40",
      "jamaah": { "fajr": "06:00", "dhuhr": "13:25", "asr": "15:30",
                  "maghrib": "17:09", "isha": "20:00" },
      "hijri": "17 Jumada al-Ula",            // as printed on the sheet
      "hijri2": { "d": 18, "m": 5, "label": "Jum1", "y": 1448 },  // computed Umm al-Qura
      "utc":       { "fajr": 1793251860000, "sunrise": 1793257980000, "dhuhr": 0, "asr": 0, "maghrib": 0, "isha": 0 },
      "jamaahUtc": { "fajr": 1793253600000, "dhuhr": 0, "asr": 0, "maghrib": 0, "isha": 0 },
      "dayStartUtc": 1793232000000           // the instant of local midnight
    }
  }
}
```

The wall-clock strings stay because they are what gets **displayed**; the
epochs are what gets **compared**. Never derive one from the other at runtime.

## R4.4 Using it — the whole time engine, with no Intl

```ts
import data from '../../assets/timetable.native.json';

const OFFSETS = data.meta.utcOffsets as [number, number][];

/** Minutes this zone is ahead of UTC at `ms`. */
export function offsetAt(ms: number): number {
  let off = OFFSETS[0][1];
  for (const [from, v] of OFFSETS) if (ms >= from) off = v;
  return off;
}

/** Dublin wall-clock fields for an instant — the Intl-free zoneParts(). */
export function localParts(ms: number) {
  const d = new Date(ms + offsetAt(ms) * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
           hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds() };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const todayKey = (ms = Date.now()) => {
  const p = localParts(ms);
  return pad(p.m) + '-' + pad(p.d);
};

/** Events for a day, straight from the precomputed epochs. */
export function eventsFor(key: string) {
  const e = (data.days as any)[key];
  if (!e) return [];
  return PRAYERS.flatMap(p => {
    if (!e.utc?.[p.key]) return [];
    const jam = e.jamaahUtc?.[p.key] ?? null;
    return [{
      key: p.key, name: p.name, sun: !!p.sun,
      text: e[p.key],                       // "12:09" — what is displayed
      at: e.utc[p.key],                     // exact instant, DST already applied
      jamaahText: e.jamaah?.[p.key] ?? null,
      jamaahAt: jam,
      date: `${data.meta.year}-${key}`,
    }];
  }).sort((a, b) => a.at - b.at);
}
```

`countdownTarget` and `ishaDone` (companion §7.1, §7.2) then work **unchanged**
— they only ever compare `at` and `jamaahAt` against `now`.

Per-prayer **offsets** from Settings shift the adhan only, as in the companion
spec: apply them to `at` as `at + offsetMinutes * 60000` and recompute the
displayed string from `localParts`, never to `jamaahAt`.

## R4.5 Hijri

Read `hijri2` and render `label` / `d` / `y` — `Rab2` **23** `1448`. No
calculation, no `Intl`, no calendar library.

The computed Umm al-Qura date runs **one day ahead of the date printed on the
mosque's sheet** (29 Oct 2026: computed `Jum1 18`, sheet `17 Jumada al-Ula`).
This is correct and intended — the requirement is to follow
hijri-calendar.com, which publishes Umm al-Qura. Do not "fix" it by preferring
the `hijri` string.

## R4.6 Seasonal Jummah, without a DST calculation

The companion spec detects summer time by comparing UTC offsets. Here it is
already a stored number:

```ts
const inSummerTime = (ms: number) => offsetAt(ms) !== 0;  // Dublin: +60 or 0
const jummahTimes = (ms: number) =>
  (inSummerTime(ms) ? data.meta.jummahSummer : data.meta.jummahWinter) ?? data.meta.jummah;
```

Summer **13:40 / 14:40**, winter **12:30 / 13:20**. Shown only on Fridays.
Determine the weekday from `localParts`, via
`new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() === 5`.

## R4.7 Verification already done

The generated file was checked and all of this passed:

- All **61 days**: every precomputed epoch round-trips to the printed
  wall-clock time, on the correct calendar day — **0 mismatches**.
- The offset segments reproduce Dublin wall time identically to full ICU,
  including **both sides of the DST fold** on 25 October (00:30Z and 01:30Z
  both read 01:30 local, which is correct — that hour happens twice).
- Hijri anchors match hijri-calendar.com: 1 Sep `Rab1 19`, 2 Oct `Rab2 21`,
  4 Oct `Rab2 23`, 12 Oct `Jum1 1`, 31 Oct `Jum1 20`.
- Detected DST transition: **2026-10-25T01:00:00Z**, i.e. 02:00 Irish Summer
  Time. Correct.

## R4.8 Adding a month

1. Transcribe the sheet into `tools/tables/YYYY-MM.txt` (companion §3.4).
2. `python3 tools/build_timetable.py` → `data/timetable.json`.
3. `node tools/build_native_timetable.js` → `data/timetable.native.json`.
4. Copy to `assets/`, bump `version` and `ios.buildNumber` (R11), submit.

**Because the data is bundled, a new month needs a new App Store build.** Add
months in batches — a full year at a time if the mosque publishes one — rather
than shipping monthly. Note the year field: the precomputed epochs are tied to
a specific year, unlike the web app's deliberately year-agnostic keys.

---

# R5. The rest of the engine

R4 covers time, the calendar and the data. What remains transfers from the
companion spec with no change of meaning:

| Piece | Source | Note |
|---|---|---|
| `PRAYERS` / `PM_KEYS` | companion §3.2 | Sunrise carries `sun: true` and is treated differently in five places |
| `countdownTarget(now)` | companion §7.1 | **verbatim** — iqamah window first, then the next event, Sunrise included |
| `ishaDone(now)` | companion §7.2 | the day flips at Isha's **iqamah**, not its adhan |
| `fmtTime`, `fmtDur` | companion §4.5 | 24-hour with **no leading zero on the hour** (`5:03`, `13:25`); `fmtDur` always `hh:mm:ss` |
| Per-prayer offsets | companion §4.4 | adhan only, −60…+60; **never** applied to iqamah |
| Import parser | companion §15 | verbatim; feeds the Settings import (R7.2) |

The board prints `5:03`, not `05:03`. It was rejected once for getting that
wrong against the photographs. The month grid is the exception and pads.

---

# R6. The board in React Native

This is the app's identity and the only part that is a genuine rewrite. Same
proportions, same colours, same rules — different primitives.

## R6.1 Non-negotiables, inherited from the companion spec

1. **The whole dashboard fits one screen. Nothing scrolls, ever.** A plain
   `View` with `flex: 1`. **Never a `ScrollView`.**
2. The table header (`PRAYER | ADHAN | IQAMAH`) sits at **26–30.5 % of screen
   height**. Verified web values: 26.4 % at 430×932, 30 % at 320×568.
3. The six rows share the remaining height equally — `flex: 1` each.
4. Transient strips (Jummah line, permission prompt) sit **below** the rows.
   Above them, they push the table down and break rule 2.
5. **Light only.** `userInterfaceStyle: "light"` in `app.json` (R11). The board
   is a replica of a painted object; there is no dark variant.

## R6.2 The scale helper — replacing `clamp()` and `vh`

CSS `clamp(min, min(vw, vh), max)` has no RN equivalent, so compute it:

```ts
import { useWindowDimensions } from 'react-native';

export function useScale() {
  const { width: w, height: h } = useWindowDimensions();
  const vw = (n: number) => (w * n) / 100;
  const vh = (n: number) => (h * n) / 100;
  const clamp = (lo: number, pref: number, hi: number) => Math.max(lo, Math.min(pref, hi));
  /** The companion spec's clamp(min, min(Xvw, Yvh), max). */
  const sz = (lo: number, vwN: number, vhN: number, hi: number) =>
    clamp(lo, Math.min(vw(vwN), vh(vhN)), hi);
  return { w, h, vw, vh, clamp, sz };
}
```

Two RN differences that will bite if ignored:

- **`letterSpacing` is in points, not em.** Every `em` value in the companion
  spec must be multiplied by its font size: `.04em` at 21 px → `0.84`.
  Express it as `letterSpacing: fontSize * 0.04`.
- **`fontVariant: ['tabular-nums']`** works on iOS; treat it as unavailable on
  Android. iOS is the shipping target, so use it on the time cells — but see
  R6.5 for the clock, where it cannot help.

## R6.3 Tokens — exact values

```ts
export const C = {
  sand:'#e7e0d2', sand2:'#efe9dd', arch:'#fbfaf7', archLine:'#c7c0b1',
  rowLine:'#e2ddd2', rowBg:'#fdfcf9',
  ink:'#1f2333', ink2:'#3d4152', inkSoft:'#7b7f90',
  gold:'#f6e2b4', gold2:'#b98d42',
  blue2:'#c3e6f7', blueInk:'#1272a6',
  cyan:'#35b6e8', cyanText:'#17a9e8', cyanStroke:'#0d82b8',
  matFill:'#f4f1e8', matPattern:'#e8e4d8', matStroke:'#bdb5a3', matInner:'#d2cbba',
  progressFrom:'#35b6e8', progressTo:'#7fd3f1', countdown:'#1596cf',
};
```

| Element | Value |
|---|---|
| Column width (`--col`) | `clamp(64, vw(20), 104)` — one width shared by ADHAN and IQAMAH so the grid never shifts |
| Date stack labels | `sz(10, 3, 1.6, 14)`, `C.ink2`, lineHeight ×1.18 |
| Date stack numeral | `sz(20, 6.4, 3.4, 34)`, weight `600`, `C.ink` |
| Masjid mark width | `sz(46, 13.5, 8, 82)`, centred, `top: clamp(16, vh(4.2), 42)` |
| Clock | `sz(42, 19, 11.4, 98)`, weight `700` — see R6.5 |
| Clock margin top | `clamp(16, vh(6.2), 60)` |
| Table header | `sz(10, 3.2, 1.6, 13)`, `C.inkSoft`, letterSpacing ×0.06, rules `1.1` of `rgba(42,46,61,.75)` top and bottom, `marginHorizontal: 17` |
| Prayer name | `sz(13, 4.2, 2.2, 21)`, weight **`300`**, uppercase, letterSpacing ×0.04 |
| Time cell | `sz(18, 5.8, 3, 31)`, weight **`300`**, `C.ink`, centred, tabular |
| Row gap | `clamp(2, vh(0.45), 5)`; list padding `clamp(3, vh(.6), 7)` / 15 / `clamp(8, vh(1.5), 18)` |
| Row | `flex: 1`, `borderRadius: 7`, `backgroundColor: C.rowBg`, `overflow: 'hidden'`, `paddingHorizontal: 8` |
| Countdown name | `sz(15, 4.6, 2.4, 24)`, weight `600`, uppercase |
| Countdown value | `sz(15, 4.8, 2.5, 25)`, weight `500`, `C.countdown`, tabular |
| Progress bar | height `clamp(4, vh(.7), 8)`, radius 4, track `rgba(190,180,158,.35)` |

**Prayer names and times are light (300), uppercase and widely spaced.** The
board is calm. Only the clock (700), the date numerals (600) and the countdown
name (600) are heavy. Do not let an agent "improve" this to 600 everywhere.

### Row states

```tsx
// passed — a deliberately light fade; .55 was tried and rejected as unreadable
passed:  { opacity: 0.88 }           // applied to the text, not the row
// current — the row the countdown is running towards (companion §6.6)
current: <LinearGradient colors={['#c4ebfa','#dcf4fd','#cfeffc']}
           locations={[0, 0.6, 1]} start={{x:0,y:0}} end={{x:1,y:0.2}} />
// plus an 8pt cyan cap on the left edge:
cap:     { position:'absolute', left:0, top:0, bottom:0, width:8,
           borderTopLeftRadius:7, borderBottomLeftRadius:7, backgroundColor: C.cyan }
// current text: color C.cyanText, weight '500'
//   textShadowColor:'rgba(255,255,255,.95)', textShadowOffset:{width:0,height:1}, textShadowRadius:0
```

`-webkit-text-stroke: .4px #0d82b8` on the active row has **no RN equivalent**.
Drop it — at `.4px` it only thickened the glyph slightly. Keep the text shadow,
which RN does support, and the cyan cap, which is what actually carries the
state. Do **not** try to fake a 0.4 px stroke with layered Text.

The row shadow (`0 1px 0 rgba(120,110,88,.07)`) is near-invisible: use iOS
`shadowColor/shadowOpacity/shadowRadius/shadowOffset` only, `elevation: 0` on
Android. It is not worth an Android shadow artefact.

## R6.4 The mat — `react-native-svg`

One continuous mihrab outline enclosing the clock **and** the whole timetable.
Its dome sits at the top, its walls run the full height, and it closes with
rounded corners under the last row. It is **not** a header arch, and it draws
**no line between the clock and the table**.

`DOME` and `matOutline(w, h, inset, domeH, radius)` from companion §6.3
transfer **verbatim** — they only build a path string, with no DOM involved.

```tsx
const domeH = Math.max(64, Math.min(w * 0.3, h * 0.42));
const outer = matOutline(w, h, 1, domeH,     16);
const inner = matOutline(w, h, 7, domeH - 6, 12);

<Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
  <Defs>
    <Pattern id="matfill" width={7} height={7} patternUnits="userSpaceOnUse">
      <Path d="M3.5 0 L7 3.5 L3.5 7 L0 3.5 Z" fill={C.matPattern} fillOpacity={0.5} />
    </Pattern>
  </Defs>
  <Path d={outer} fill={C.matFill} />
  <Path d={outer} fill="url(#matfill)" />
  <Path d={outer} fill="none" stroke={C.matStroke} strokeWidth={1.2} />
  <Path d={inner} fill="none" stroke={C.matInner} strokeWidth={1} />
</Svg>
```

- Size it from the **measured** mat container (`onLayout`), not from the window
  — the mat is inset from the screen edges.
- `viewBox` matches the pixel size exactly, so there is **no** aspect-ratio
  distortion and `preserveAspectRatio` must be left alone. The web build had a
  bug where the outline rendered 287 px wide in a 381 px box; measuring and
  matching the viewBox is what prevents it.
- Re-render on `onLayout` and on rotation. Orientation is locked to portrait
  (R11), so this is mostly the keyboard and the first layout pass.

## R6.5 The clock — the one element with no clean RN equivalent

`-webkit-text-stroke: 1.7px` over a gold fill is the clock's whole character,
and React Native `Text` cannot stroke glyphs. Use `react-native-svg`'s `Text`,
which can:

```tsx
<SvgText fill={C.gold} stroke={C.gold2} strokeWidth={1.7}
         fontSize={fs} fontWeight="700" textAnchor="middle">
```

**The catch:** SVG text has no `font-variant-numeric`, so proportional digits
make the string's width change every second and the centred clock shimmers.
Fix it by laying the clock out on a fixed grid — one `<SvgText>` per character
at a computed `x`, rather than one string:

```ts
const DIGIT = fs * 0.56;      // tune once on a device
const COLON = fs * 0.28;
const cells = text.split('').map(ch => ({ ch, w: ch === ':' ? COLON : DIGIT }));
const total = cells.reduce((s, c) => s + c.w, 0);
let x = (width - total) / 2;
// each cell: <SvgText x={x + c.w / 2} textAnchor="middle" ...>{c.ch}</SvgText>; x += c.w
```

Tune `DIGIT` and `COLON` once against a screenshot and freeze them. Accepting
the shimmer instead is not acceptable: the clock is the largest element on the
board and it ticks every second.

Also apply the drop shadow — SVG `<Text>` takes no `textShadow`, so render a
second text layer at `y + 1` in `rgba(140,110,52,.42)` **beneath** the main one.

## R6.6 The board background

Three stacked CSS layers (two diagonal hatches over a vertical gradient) become
one absolutely-positioned `Svg` behind everything:

```tsx
<Defs>
  <SvgLinearGradient id="base" x1="0" y1="0" x2="0" y2="1">
    <Stop offset="0"    stopColor="#e9e2d4" />
    <Stop offset="0.55" stopColor="#efe9dd" />
    <Stop offset="1"    stopColor="#e6dfd0" />
  </SvgLinearGradient>
  <Pattern id="h1" width={11} height={11} patternUnits="userSpaceOnUse"
           patternTransform="rotate(45)">
    <Rect width={2} height={11} fill="#ffffff" fillOpacity={0.35} />
  </Pattern>
  <Pattern id="h2" width={11} height={11} patternUnits="userSpaceOnUse"
           patternTransform="rotate(-45)">
    <Rect width={2} height={11} fill="rgb(190,180,158)" fillOpacity={0.16} />
  </Pattern>
</Defs>
<Rect width="100%" height="100%" fill="url(#base)" />
<Rect width="100%" height="100%" fill="url(#h1)" />
<Rect width="100%" height="100%" fill="url(#h2)" />
```

This is what gives the board its woven-canvas look. A flat colour reads as a
different app.

## R6.7 Safe areas and the frame

```tsx
<SafeAreaProvider>
  <SafeAreaView style={{ flex: 1, backgroundColor: C.sand }} edges={['top','bottom']}>
    <View style={{ flex: 1, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
```

`maxWidth: 560` keeps the board from stretching on an iPad. Verify rule R6.1.2
(header at 26–30.5 %) on both a notched device and a short one — the inset
eats height and that is where the percentage drifts.

## R6.8 Content rules carried over

- **Sunrise** renders one time cell, in the ADHAN column, and no iqamah cell.
- A prayer with no iqamah shows an em dash in a transparent cell that still
  holds the column width.
- The IQAMAH column appears only when `meta.jamaah` is true and at least one
  event that day has an iqamah.
- **Date stacks always show today**, even after the table flips to tomorrow at
  Isha's iqamah.
- Footer: `Today @ Dublin ·` / `Tomorrow @ Dublin ·`, mosque name centred,
  menu button right. City is `meta.city` with a trailing number stripped
  (`Dublin 15` → `Dublin`).
- Empty day → one row reading **No times**, naming the date and pointing at
  Settings → Timetable.

---

# R7. The other two screens

Both are reached from a bottom-sheet menu on the footer's menu button. Three
screens held in component state — **no navigation library** (R2.1).

## R7.1 Monthly timetable — companion §8

Month navigator (`‹ October 2026 ›`), a segmented **Adhan | Iqamah** control
(shown only when `meta.jamaah`), and one row per day: `Day | Faj | Sun | Dhu |
Asr | Mag | Ish`. Day cell `01 Thu`. **Times here are zero-padded** so the
columns align — the opposite of the board, deliberately. Today's row takes
`C.blue2` with `C.blueInk` bold; Friday's day cell alone is `C.blueInk` bold.
Missing values render `—`.

This is the one screen that may scroll — a `FlatList` or `ScrollView` is
correct here. R6.1's no-scroll rule applies to the **board** only.

## R7.2 Settings — companion §10

Same sections and copy. Control mapping:

| Companion control | React Native |
|---|---|
| Sound per prayer (Azan / Chime / Silent) | `@react-native-picker/picker`, six rows |
| Adjustments, −60…+60 | `TextInput` `keyboardType="numbers-and-punctuation"`, clamped on blur |
| Pre-prayer / Iqamah reminder, 0–60 | `TextInput` `keyboardType="number-pad"`, clamped on blur |
| Keep screen awake | `Switch` → `expo-keep-awake` `activateKeepAwakeAsync` / `deactivateKeepAwake` |
| 24-hour clock | `Switch` |
| Notification permission | `Button` → R8.4 |
| Timetable import | `expo-document-picker` → the companion §15 parser |
| Azan audio file | `expo-document-picker` → `expo-file-system` |
| Reset to bundled | `Alert.alert` confirm |

Drop the web-only rows: no "Export JSON" (there is nowhere to download to), no
service-worker diagnostics, no push-subscription line.

---

# R8. Notifications — `expo-notifications`

Local notifications scheduled with the OS. They fire with the app **closed and
the phone locked**, with **no server**. This is the main reason the native app
is worth building.

## R8.1 Ordering — get this wrong and the prompt never appears

Three steps, in this order, and the order is load-bearing:

1. **Create the Android channels** (R8.3).
2. **Request permission** (R8.4). Expo's docs: on Android 13+ *"This prompt
   will not appear until at least one notification channel is created."*
3. **Request the exact-alarm permission** on Android (R8.5), then schedule.

## R8.2 Presenting while the app is open

```ts
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true,
    shouldPlaySound: !settings.muted, shouldSetBadge: false,
  }),
});
```

Scheduling alone does not present anything in the foreground — Expo's docs are
explicit that *"This does not mean that the notification will be presented when
it is triggered."* Without the handler, alerts appear to work on the lock
screen and silently do nothing while the user is looking at the board.

## R8.3 Android channels — one per sound

A channel's sound is fixed once created, so a user choosing between the adhan
and a chime needs **one channel per sound**, not one mutable channel:

```ts
await Notifications.setNotificationChannelAsync('adhan-v1', {
  name: 'Prayer times (adhan)', importance: Notifications.AndroidImportance.MAX,
  sound: 'adhan.wav', vibrationPattern: [0, 250, 250, 250], lockscreenVisibility: 1,
});
await Notifications.setNotificationChannelAsync('chime-v1', { /* sound: 'chime.wav' */ });
await Notifications.setNotificationChannelAsync('silent-v1', {
  name: 'Prayer times (silent)', importance: Notifications.AndroidImportance.DEFAULT,
});
```

If a bundled sound ever changes, **bump to `-v2`** and create a new channel;
the old one keeps the old sound on devices that already have it. Users may
override channel sounds in Android settings — that is their right, do not fight
it. `settings.muted` routes to `silent-v1`, which keeps the companion spec's
§9.1 rule: **muting removes the sound, never the notification.**

## R8.4 Permission

```ts
let perm = await Notifications.getPermissionsAsync();
if (perm.status !== 'granted') perm = await Notifications.requestPermissionsAsync();
const granted = perm.granted || perm.ios?.status === IosAuthorizationStatus.PROVISIONAL
             || perm.status === 'granted';
```

Expo's docs note the iOS result should be read from `ios.status` rather than
only the root `status`. iOS needs **no usage-description string** for
notifications.

Carry over the companion spec's §9.2 rules: **never request on launch** — only
from a real tap; and **never ask twice** — after a refusal, point at the OS
settings instead, because the system will not prompt again.

## R8.5 Exact alarms — Android, and not optional

Expo's docs: exact scheduling on Android 12+ requires `SCHEDULE_EXACT_ALARM`,
and *"Without this permission, scheduled notifications arrive at an approximate
time."* Android 14+ denies it by default on new installs.

An approximate prayer notification is a wrong one. So:

```ts
const exact = await Notifications.getExactAlarmPermissionsAsync();
if (!exact.granted) await Notifications.requestExactAlarmPermissionsAsync();
```

Surface the denied state in Settings rather than letting alerts drift silently.
iOS has no equivalent and needs nothing.

`RECEIVE_BOOT_COMPLETED` is added by Expo automatically, so **schedules survive
a reboot** — no re-scheduling on boot is needed.

## R8.6 The rolling window

iOS keeps only a bounded number of pending local notifications per app —
**widely documented as 64**, beyond which the soonest are kept and the rest
discarded silently. *Verify the number on a device before relying on more.*

Six prayers × three kinds (`at`, `pre`, `jam`) is up to 18 a day, so the app
cannot "schedule the year". It schedules a window and tops it up.

```ts
const BUDGET = 60;   // under 64, leaving room for the top-up reminder

export async function rescheduleAll() {
  await Notifications.cancelAllScheduledNotificationsAsync();   // never incremental

  const now = Date.now();
  let day = todayKey(now), added = 0;
  for (let i = 0; i < 30 && added < BUDGET; i++) {
    for (const e of eventsFor(day)) {
      if (!prefs.prayers[e.key]) continue;
      const put = async (kind, at, title, body) => {
        if (at <= now || added >= BUDGET) return;
        await Notifications.scheduleNotificationAsync({
          content: { title, body, sound: soundFor(e.key),
                     data: { fireId: `${kind}:${e.date}:${e.key}`, key: e.key, kind } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE,
                     date: new Date(at), channelId: channelFor(e.key) },
        });
        added++;
      };
      await put('at', e.at, e.name, `It is now ${e.text} — time for ${e.name}.`);
      if (prefs.pre > 0 && !e.sun)
        await put('pre', e.at - prefs.pre * 60000,
                  `${e.name} in ${prefs.pre} min`, `${e.name} at ${e.text}`);
      if (prefs.jam > 0 && !e.sun && e.jamaahAt)
        await put('jam', e.jamaahAt - prefs.jam * 60000,
                  `${e.name} iqamah in ${prefs.jam} min`, `Iqamah at ${e.jamaahText}`);
    }
    day = nextKey(day);
  }
}
```

- A **date trigger** fires once at that instant; Expo's docs note `repeats` is
  ignored for it, which is what we want — each day's times differ.
- Cancel-all then reschedule. Never incremental: a missed cancel becomes a
  duplicate alert, and duplicates on a prayer app destroy trust fast.
- Alert copy is the companion spec's §9.4, word for word. Do not reword it.
- With all three kinds on, 60 slots is roughly **3–4 days**; with `at` only,
  about 10 days.

### Reschedule on

App start · app returning to the foreground · midnight rollover · any change to
sound-per-prayer, `pre`, `jam` or offsets · a timetable import · permission
newly granted · a notification firing. Debounce to one rebuild every ~2 s.

### The window runs out — say so, do not hide it

If the user never opens the app, the schedule empties after a few days. There
is no server to top it up (by design). Two mitigations:

1. Make the **last** scheduled item a top-up reminder: *"Open Shaheed Bilal
   Mosque to keep prayer alerts coming."* Budget one slot for it.
2. State it in Settings: *"About a week of alerts is scheduled at a time —
   open the app occasionally to keep them topped up."*

Show the window's end in Settings — `Scheduled: 57 alerts, through 2 Nov` —
so it is visible rather than a silent cliff.

## R8.7 Foreground dedupe

The OS owns the notification; the app owns the in-app banner and the audio.

```ts
Notifications.addNotificationReceivedListener(n => {
  const { fireId, key, kind } = n.request.content.data as any;
  if (alreadyFired(fireId)) return;
  markFired(fireId);                       // same store and id format as companion §9.4
  showInAppBanner(n.request.content.title, n.request.content.body);
  if (!settings.muted) playForKind(kind, key);
});
Notifications.addNotificationResponseReceivedListener(() => showScreen('board'));
```

The in-app tick must **not** raise its own notification — the OS already did.
It still shows the banner and plays audio.

---

# R9. Audio

## R9.1 Two paths, kept separate

| Path | When | Mechanism | Length |
|---|---|---|---|
| Notification sound | app closed or backgrounded | bundled file played by the OS | short — R9.3 |
| In-app playback | app open | `expo-audio` | full length |

## R9.2 Bundling the notification sound

Expo's config plugin copies the file into both native projects:

```json
["expo-notifications", {
  "icon": "./assets/notification-icon.png",
  "color": "#1f2333",
  "sounds": ["./assets/adhan.wav", "./assets/chime.wav"]
}]
```

Then reference it by **base filename only** — `sound: 'adhan.wav'`.

Two consequences worth stating plainly:

- **`.wav`** — use it on both platforms.
- **This does not work in Expo Go.** The sound is added at build time, so the
  Replit preview will play the default system sound. Custom sound can only be
  verified in a **TestFlight build on a real phone**. Do not spend an afternoon
  debugging it in the simulator.

## R9.3 The honest limit on iOS

An iOS notification sound is a short alert tone, not a media track — the
documented ceiling is around **30 seconds**, beyond which the system default
plays instead. *Verify the exact behaviour on a device.*

- **Achievable:** a ≤30 s adhan excerpt from a locked phone.
- **Not achievable:** a full 2–3 minute adhan from a closed app. The routes to
  it are a background-audio mode (likely rejected for this use) or the Critical
  Alerts entitlement (separate Apple approval, intended for health and safety).
  **Do not design around either.**

Say so in the app: *"The notification plays a short call to prayer. Open the
app to hear the full adhan."*

## R9.4 Silent mode

Expo's docs: sound *"will not be played when focus mode does not permit it or
silent mode is on."* There is no supported override. Keep the companion spec's
advice in the About screen: *"Alerts follow your phone's silent mode and Do Not
Disturb. For a guaranteed sound, set a clock alarm as well."*

## R9.5 Licensing

Ship **no** adhan recording until one is licensed — this is a store
distribution, so it matters more than it did on the web. Use a recording the
mosque owns or has written permission to distribute. Keep a short synthesised
chime as the shipped default so the app is complete and submittable with no
licensed audio at all.

A user-supplied file plays **in-app only** — iOS requires notification sounds
to be bundled at build time. State that on the audio screen.

---

# R10. Offline

The app is offline by construction: the timetable is a **bundled asset**
(`require('../assets/timetable.native.json')`), and v1 makes **no network
request at all**.

That makes most of the companion spec's §12 irrelevant — there is no service
worker, no cache strategy, no network timeout, because there is no network.
Two rules remain:

1. **No fetch on the boot path.** Not for the timetable, not for fonts, not for
   a "check for updates" call. If a future version adds a remote timetable, it
   must follow the companion spec's §25.2 pattern: bundled copy always present,
   remote validated before use, never blocking the first paint.
2. **Settings must survive.** `AsyncStorage`, wrapped in try/catch, with the
   same keys as the companion spec §11: `azan.settings`, `azan.timetable`,
   `azan.fired`. Merge stored settings over the defaults, including the nested
   `sound` and `offsets` objects, so a key added later is never `undefined`.

**Acceptance:** install from TestFlight, enable Airplane Mode **before first
launch**, open the app. The board must render correctly. This is the single
strongest argument against an App Store reviewer treating it as a thin client.

---

# R11. `app.json`

```jsonc
{
  "expo": {
    "name": "Shaheed Bilal Mosque",
    "slug": "shaheed-bilal-mosque",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "light",          // no dark mode — the board is a replica
    "icon": "./assets/icon.png",            // 1024x1024, NO alpha channel
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#e9e5dc"          // the board's sand: no white flash
    },
    "ios": {
      "bundleIdentifier": "ie.shaheedbilal.prayer",   // PERMANENT — see R12.1
      "buildNumber": "1",
      "supportsTablet": true,
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false        // saves a question per submission
      }
    },
    "android": {
      "package": "ie.shaheedbilal.prayer",
      "adaptiveIcon": { "foregroundImage": "./assets/adaptive-icon.png",
                        "backgroundColor": "#e9e5dc" },
      "permissions": ["SCHEDULE_EXACT_ALARM", "POST_NOTIFICATIONS"]
    },
    "plugins": [
      ["expo-notifications", {
        "icon": "./assets/notification-icon.png",     // white on transparent
        "color": "#1f2333",
        "sounds": ["./assets/adhan.wav", "./assets/chime.wav"]
      }]
    ]
  }
}
```

Bump **both** `version` and `ios.buildNumber` on every submission — App Store
Connect rejects a duplicate build number. Icons and permissions are native
changes: Replit's docs note they need a **new store build**, not a hot reload.

---

# R12. App Store submission

## R12.1 Decide these before the first build

| | |
|---|---|
| **Apple Developer Program membership** | Required. Enrol early — verification can take days, and it is the most common cause of a stalled first submission. |
| **Bundle identifier** | `ie.shaheedbilal.prayer` is permanent. It cannot be changed after the first submission without shipping a different app. Agree it with the mosque first. |
| **Who owns the account** | If a volunteer submits under a personal Apple account, the mosque cannot take the app over later without republishing. An **Organization** account in the mosque's name is the right answer if they have the documentation for it. |
| **Written permission** | Get the mosque's written agreement before submitting an app that carries its name and publishes its timetable. Cheapest step now, most expensive to fix later. |

## R12.2 The flow

Per Replit's docs: **publish from the Project Editor → the build is submitted
to TestFlight → promote it to the App Store in App Store Connect.** Apple
reviews before release. No Mac, no Xcode, and **no EAS CLI** (R2).

Test the TestFlight build on a real iPhone before promoting. The simulator
cannot verify notifications, and notifications are the feature.

## R12.3 Store listing

| Field | Value |
|---|---|
| Name | Shaheed Bilal Mosque |
| Subtitle | Prayer times for Dublin 15 |
| Category | Reference (alternative: Lifestyle) |
| Age rating | 4+ |
| Price | Free |
| Support URL | required — a page the mosque controls, or the GitHub Pages site |
| Privacy policy URL | required even when nothing is collected; say so there explicitly |

**Description draft:**

> The prayer timetable for Shaheed Bilal Masjid, Dublin 15, in the format of
> the mosque's own display board.
>
> • Adhan and iqamah times for every prayer, exactly as the mosque publishes them
> • A live countdown to the next prayer and to the next congregation
> • Notifications at prayer time, on your lock screen, with the app closed
> • The Hijri date and Friday khutba times
> • Works completely offline — no account, no sign-in, no internet needed
>
> Times are transcribed from the mosque's printed timetable. Nothing is
> calculated from your location, and no personal data is collected.

**Keywords:** `prayer times, salah, namaz, adhan, iqamah, masjid, mosque,
Dublin, Ireland, islamic, hijri`

## R12.4 Privacy — and keeping it true

Declare **"Data Not Collected"** in App Store Connect's App Privacy section.
That is accurate only while R2.1's ban on analytics, crash reporters and ad
SDKs holds. If anything is added later, the declaration must change with it —
a false privacy declaration is a removal-grade problem, not a paperwork one.

`ITSAppUsesNonExemptEncryption: false` (R11) is correct for an app using no
non-standard cryptography; confirm it against the current questionnaire.

## R12.5 Screenshots

Required for the iPhone sizes Apple currently lists — generate from the Replit
simulator. Submit: the **board** (the main screen, ideally mid-afternoon so a
row is highlighted and the countdown is running), the **monthly timetable**,
and **Settings** showing the alerts section. Three is enough; the board is the
app.

## R12.6 Review notes — draft

> Shaheed Bilal Mosque is the prayer timetable for a single mosque in Dublin
> 15, built for its congregation.
>
> Prayer times are transcribed from the mosque's printed timetable and bundled
> in the app. Nothing is calculated from location and no network connection is
> required — the app is fully functional in Airplane Mode, including on first
> launch.
>
> The app schedules local notifications so prayer alerts arrive with the app
> closed and the device locked, and plays a short bundled call to prayer as the
> notification sound.
>
> There is no account, no sign-in and no personal data collection. Times are
> displayed for Dublin, Ireland.
>
> To test notifications: Settings → Alerts → enable notifications, then set
> "Pre-prayer reminder" to 1 minute to receive an alert without waiting for the
> next prayer time.

That last paragraph matters. A reviewer who cannot trigger the main feature
within a minute may conclude it does not work.

## R12.7 Guideline risk

Much lower than a WebView wrapper — this is a real React Native binary with
native scheduling and full offline operation, so **guideline 4.2 (minimum
functionality)** is not the live risk it would otherwise be. Lead with offline
and notifications in the review notes anyway (R12.6).

Religious content is unremarkable to App Review. The realistic rejections are
mundane: a missing privacy policy URL, a duplicate build number, screenshots
that do not match the build, or a reviewer who could not make a notification
fire.

---

# R13. Acceptance criteria

Everything in the companion spec §14 still applies. These are the additions,
and the ones that must be checked on **real hardware**.

## R13.1 No Intl dependency — grep for it

```bash
grep -rn "Intl\." src/ | grep -v "^src/.*\.test\."
```

**Must return nothing.** If anything in `src/` calls `Intl`, R4 has been
partially undone and the app will behave differently on someone else's phone.

## R13.2 Times

| When | Expected |
|---|---|
| 8 Sep 05:14:19 Dublin | rows `5:03 5:30 / 6:42 / 13:25 13:50 / 17:02 17:30 / 20:05 20:10 / 21:38 21:43`; countdown `FAJR IQAMAH 00:15:39`; footer `Today`; Fajr row highlighted |
| 7 Sep 22:02:09 Dublin | same rows (table has flipped to the 8th); `FAJR 07:00:51`; footer `Tomorrow`; **no** row highlighted |
| 29 Oct | `Jum1 18 1448` — not the sheet's `17 Jumada al-Ula` (R4.5) |
| 25 Oct (clocks back) | Dhuhr `12:11 / 13:25`, Isha `18:48 / 20:00` |
| Friday 9 Oct vs Friday 30 Oct | khutba `13:40 / 14:40` vs `12:30 / 13:20` — proves R4.6 |
| 1 Nov | "No times" row; month grid shows em dashes |

## R13.3 Offline

Airplane Mode **before first launch** of a TestFlight install → board renders
correctly. Then force-quit, still in Airplane Mode, reopen → still correct.

## R13.4 Notifications — real device only

1. Permission is requested only after a tap, never on launch.
2. With the app **force-quit** (swiped away, not backgrounded), a notification
   arrives on the lock screen at the adhan minute, with the right prayer name
   and time.
3. With `muted` on: the notification still arrives, **without** sound.
4. App open at the adhan minute: exactly **one** notification and **one**
   in-app banner, audio once.
5. Changing a reminder offset reschedules — `Scheduled: N through <date>`
   updates.
6. Android: exact-alarm permission denied → Settings says so rather than
   drifting silently.
7. Reboot the phone → scheduled alerts still fire (`RECEIVE_BOOT_COMPLETED`).
8. The bundled adhan plays as the notification sound — **TestFlight build
   only**, never Expo Go (R9.2).

## R13.5 Layout

Header row at **26–30.5 %** of screen height, with no scrolling, on:
a small device (SE-class), a notched device, and a Pro Max-class device.
The mat SVG's rendered width must equal its measured container width.

## R13.6 Data

Re-run the companion spec's §14.7 validator against `timetable.json`, and the
round-trip check against `timetable.native.json`: every precomputed epoch must
map back to its printed wall-clock time on the correct day. Both currently
report **61 days, 0 issues**.

---

# R14. Build order for Replit Agent

Replit's Agent does better with small, verifiable steps than with one large
prompt. The board and the notification schedule will both come back
approximately right from a single ask.

| Step | Ask for | Verify before moving on |
|---|---|---|
| 1 | A **Mobile app** project (React Native + Expo). No navigation library, no UI kit, no date library. A single screen filling the viewport, light mode only, portrait locked. | Previews in Expo Go on a real phone. |
| 2 | Add `assets/timetable.native.json` and `src/engine/time.ts` per **R4.4** — `offsetAt`, `localParts`, `todayKey`, `eventsFor`. | Unit tests: 25 Oct resolves to the winter times; `grep Intl src/` is empty (R13.1). |
| 3 | `countdown.ts` and `format.ts` — companion §7.1, §7.2, §4.5 verbatim. | A simulated day: the highlight moves down, never two rows at once, countdown never negative. |
| 4 | The board's **structure and tokens** (R6.2, R6.3) — flat colours, no SVG yet. | Header at 26–30.5 %, nothing scrolls, six equal rows, on three device sizes. |
| 5 | The **mat** in `react-native-svg` (R6.4). | Dome undistorted on a small and a large device; SVG width equals container width. |
| 6 | The **clock** (R6.5) and the **hatched background** (R6.6). | The clock does not shimmer as the seconds tick. |
| 7 | The tick loop, row states, countdown, progress bar, day flip at Isha's iqamah. | **R13.2**, all six rows. |
| 8 | Month screen and Settings (R7), `AsyncStorage` persistence (R10). | Settings survive a force-quit; offsets move adhan only. |
| 9 | Notifications (R8) — **channels, then permission, then exact alarms, then schedule**. | **R13.4 on a real phone.** Nothing else in step 9 counts until a notification arrives with the app force-quit. |
| 10 | `app.json`, icons, splash, the sound config plugin (R11, R9.2). | Icon and splash correct in a TestFlight build; no white flash on launch. |
| 11 | Store listing, privacy declaration, screenshots, review notes (R12). | R12 complete; mosque's written permission on file. |

Step 9 is where the real work is. Step 2 is where the project gets quietly
derailed if R4 is skipped.

## R14.1 Instructions worth repeating to the Agent

- "Do not add a date library. The timetable carries precomputed UTC epochs."
- "Do not call `Intl` anywhere in `src/`."
- "Do not calculate prayer times. Read them from the bundled JSON."
- "Do not add dark mode. The palette is fixed and light."
- "Do not make the board scrollable, and do not wrap it in a ScrollView."
- "Keep prayer names and times at `fontWeight: '300'`. Do not bolden them."
- "Only use packages that are part of the Expo SDK."
- "Do not write `eas.json` or use the EAS CLI — Replit does not support them."
- "Do not add analytics, crash reporting or any SDK that collects data."

---

# R15. Known limits — state them, do not hide them

1. **The full adhan cannot play from a locked phone on iOS** (R9.3). A ≤30 s
   excerpt can. Say so in the app.
2. **Alerts are scheduled a few days ahead**, not indefinitely (R8.6). There is
   no server, by design. Opening the app tops them up.
3. **A new month needs a new App Store build** (R4.8), because the data is
   bundled. Batch months; do not ship monthly.
4. **Sound obeys silent mode and Do Not Disturb** (R9.4). No override exists.
   Keep the clock-alarm advice.
5. **The Hijri date runs a day ahead of the printed sheet** (R4.5). Correct,
   per the requirement to follow hijri-calendar.com.
6. **Android cannot be published from Replit yet** — Internal Testing only.
   iOS is the shippable target.
7. **Custom notification sound is invisible in Expo Go** (R9.2). Verify in
   TestFlight, not in the preview.
8. **Times are only as good as the transcription.** The app is a faithful
   reader of a printed sheet, not an authority.

---

# R16. Source files in the companion repository

| Path | What it is |
|---|---|
| `azan/docs/REQUIREMENTS.md` | the full behaviour spec — §3, §7, §15 transfer verbatim |
| `azan/data/timetable.json` | the 61-day dataset, verified against the printed sheet |
| **`azan/data/timetable.native.json`** | **the precomputed file this build uses — copy to `assets/`** |
| `azan/tools/build_native_timetable.js` | regenerates it (R4.8) |
| `azan/tools/build_timetable.py` | monthly text tables → `timetable.json` |
| `azan/tools/tables/*.txt` | the human-editable monthly transcriptions |
| `azan/index.html`, `azan/app.js` | the working web implementation — authoritative when this document is silent |
