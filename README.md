# Azan — prayer times from your own timetable

A self-contained web app (PWA) built as a replica of the mosque's own display
board — same arch, clock, adhan and iqamah columns, countdown and footer — with
the Azan played when the time arrives. Installs to an iPhone
or Android home screen and works offline. No account, no server, no tracking.

**Times are never calculated or fetched.** The app shows exactly what is in the
timetable you import — its accuracy is the accuracy of your table.

---

## 1. Run it on your phone

**Option A — GitHub Pages (recommended).** Static hosting over HTTPS, which is
what installability and offline mode require.

1. Push this folder to the repository.
2. The `azan-pages` workflow publishes `azan/` on every push to `main`. It runs
   `actions/configure-pages` with `enablement: true`, so it switches Pages on
   itself the first time — no repository setting to change by hand.
3. Open `https://<user>.github.io/<repo>/` on the phone.
4. iPhone: Share → **Add to Home Screen**. Android: menu → **Install app**.

On a public repository this makes the app publicly reachable at that URL. On a
private repository, Pages needs a paid plan.

**Option B — any static host.** Netlify Drop, Cloudflare Pages, Vercel: drag the
`azan/` folder in. Must be HTTPS.

**Option C — one self-contained file.**

```bash
python3 tools/build_standalone.py          # writes dist/azan-standalone.html
```

Everything is inlined — styles, script and the timetable — so the result runs
from a single file with no server and no fetches. Useful for hosts that take
one file, or for opening straight from disk. It has no service worker, so it
does not cache for offline use and does not install as a PWA; the multi-file
build above is the one to deploy properly.

**Option D — local, for testing only.**

```bash
cd azan && python3 -m http.server 8080
```

Open `http://localhost:8080`. Reaching it from a phone over your LAN IP works,
but browsers refuse to install or run a service worker over plain HTTP, so
offline mode and home-screen install will not work that way.

---

## 2. Load your timetable

Settings → **Timetable** → paste the table → **Import**. Or **Import file…** for
a `.csv`, `.tsv`, `.txt` or `.json`.

Imports **merge** into what is already loaded, so you can add one month at a
time until the year is complete.

The parser is deliberately tolerant. It accepts commas, tabs, or spaces, 24-hour
or am/pm times, two times per prayer (begins + jamaah), and reads a header row
when one is present:

```
Date,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha
1 Jan,06:29,08:06,12:06,14:00,16:02,17:32
2 Jan,06:29,08:06,12:07,14:01,16:03,17:33
```

Accepted date columns: `1`, `1 Jan`, `Jan 1`, `01/02` (DD/MM by default,
switchable to MM/DD), `2026-01-02`. Rows carrying only a day number use the
month picked in the importer and roll to the next month when the day number
resets, so a whole year can be pasted in one go. Month headings such as
`February` in the text switch the month too.

Times are resolved **per value, not per file**: an hour above 12 is taken as
24-hour, anything else from Dhuhr to Isha is taken as afternoon/evening. That is
what makes a printed row like `1:28 1:50 ... 21:55 10:00` read correctly when
one column is 24-hour and the rest are not.

Rows with 10–12 times are auto-detected as **begins + jamaah pairs**
(`Fajr b, Fajr j, Sunrise, Dhuhr b, Dhuhr j, …`). Force it either way with the
*Columns* dropdown. Check the Month tab after importing — that is the fastest
way to catch a misread column.

### Adding months to the shipped table

The bundled table is built from plain-text transcriptions of the printed sheets,
one file per month in `tools/tables/`. To add a month, copy the printed rows into
a new file and rebuild:

```
month: 2026-10
name: Shaheed Bilal Masjid
city: Dublin 15
tz: Europe/Dublin
jummah: 13:40, 14:40
note: Maghrib salah 5 min after azan

 1 | 18 Rabi' al-Akhir | 5:44 6:15 | 7:22 | 1:17 1:50 | 4:22 5:00 | 7:08 7:13 | 20:40 8:45
```

Row layout: `day | hijri | fajr begins jamaah | sunrise | dhuhr begins jamaah |
asr begins jamaah | maghrib begins jamaah | isha begins jamaah`. Times go in
exactly as printed — the builder resolves 12-hour values per prayer.

```bash
python3 tools/build_timetable.py
```

It rewrites `data/timetable.json`, keeping months already present.

### The JSON format

```json
{
  "meta": {
    "name": "Shaheed Bilal Masjid",
    "city": "Dublin 15",
    "timezone": "Europe/Dublin",
    "jamaah": true,
    "jummah": ["13:40", "14:40"],
    "notes": ["Maghrib salah 5 min after azan"]
  },
  "days": {
    "09-01": {
      "fajr": "04:49", "sunrise": "06:30", "dhuhr": "13:28",
      "asr": "17:12", "maghrib": "20:21", "isha": "21:55",
      "hijri": "18 Rabi' al-Awwal",
      "jamaah": { "fajr": "05:30", "dhuhr": "13:50", "asr": "17:30", "maghrib": "20:26", "isha": "22:00" }
    }
  }
}
```

Keys are `MM-DD`, times are 24-hour `HH:MM` local wall-clock. `sunrise`,
`hijri` and `jamaah` are optional. `29 February` falls back to `02-28` when
absent. An imported timetable overrides the bundled file until you press
**Reset to bundled**.

`meta.timezone` (an IANA name) makes the app use that zone regardless of where
the phone is. Leave it blank to follow the device.

---

## 3. The Azan sound

No audio file ships with the app — recordings are licensed material. Until you
add one, a short chime plays.

- **Per device:** Settings → Azan audio → *Choose audio file…*. Stored locally
  in the browser (IndexedDB), never uploaded.
- **For everyone:** drop an `azan.mp3` into `azan/audio/`, add it to the `ASSETS`
  list in `sw.js`, and bump the `CACHE` version.

Phones block audio until the user has interacted with the page: tap **Enable
sound** once after opening the app.

---

## 4. What it does and does not do

Works:

- Today's six times in **begins** and **jamaah** columns, next-prayer countdown,
  current prayer highlighted, Hijri date from the timetable
- Jummah khutba times shown on Fridays; mosque notes shown under the list
- Follows the board's conventions: 24-hour times with no leading zero, the
  countdown switching to "<PRAYER> IQAMAH" once the adhan has passed, the table
  switching to tomorrow after Isha, and the "Today @ ..." footer
- The board's Hijri date runs one day ahead of the Hijri column on the printed
  sheet, so the app shows the next day's entry to match it
- Full month table, any month, switchable between begins and jamaah
- Azan or chime per prayer, individually settable
- Per-prayer adjustment of −60 to +60 minutes (begins times only — jamaah times
  are the mosque's and are never shifted)
- Optional reminder N minutes before each prayer, and N minutes before jamaah
- Notifications, keep-screen-awake, 12/24-hour clock
- Offline after first load; timetable and settings persist on the device

Does not work — a browser limitation, not a bug:

- **No alarms while the app is closed.** Web apps cannot schedule audio or
  notifications for a future time in the background. The Azan fires only while
  the app is open (on Android, a recently backgrounded tab often still fires;
  on iOS it generally does not). For a guaranteed wake-up, set your phone's
  clock alarm alongside this app.
- No Qibla compass, Hijri date, or jamaah times.

---

## 5. Files

| Path | Purpose |
| --- | --- |
| `index.html` | Markup and styling |
| `app.js` | All logic: timetable, parser, scheduler, audio, UI |
| `sw.js` | Service worker (offline cache) |
| `manifest.webmanifest` | Install metadata |
| `data/timetable.json` | Bundled timetable (built from `tools/tables/`) |
| `audio/` | Optional `azan.mp3` |
| `tools/tables/*.txt` | Printed timetables, one file per month |
| `tools/build_timetable.py` | Builds `data/timetable.json` from those files |
| `tools/make_sample_timetable.py` | Generates a calculated sample table instead |
| `tools/build_standalone.py` | Bundles everything into one HTML file |
| `tools/make_icons.py` | Regenerates the icons |

The bundled table currently holds **September 2026 only** for Shaheed Bilal
Masjid, Dublin 15, transcribed from the printed sheet (begins + jamaah, Hijri
dates, Jummah khutba at 13:40 / 14:40). A banner in the app names the months
covered. `tools/make_sample_timetable.py`
still exists to generate a calculated London sample if you ever need a stand-in;
it marks its output `placeholder` so the app shows a red warning.
