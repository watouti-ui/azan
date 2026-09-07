"""Build data/timetable.json from the plain-text tables in tools/tables/.

Each file is one month, transcribed as printed. Add another month by adding
another file and re-running this script; existing months are kept.

Row layout (pipe-separated groups):
    day | hijri | fajr [jamaah] | sunrise | dhuhr [jamaah] | asr [jamaah] |
        maghrib [jamaah] | isha [jamaah]

Header lines before the rows:
    month:   YYYY-MM              (required)
    jummah:  13:40, 14:40         (optional, khutba times)
    note:    free text            (optional, repeatable)
    name:    mosque name           (optional)
    city:    town or area           (optional)
    tz:      IANA time zone       (optional, default Europe/London)

Usage:
    python3 tools/build_timetable.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLES = ROOT / "tools" / "tables"
OUT = ROOT / "data" / "timetable.json"

# Prayers whose 12-hour times are always afternoon/evening.
PM = {"dhuhr", "asr", "maghrib", "isha"}
ORDER = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"]

DEFAULT_TZ = "Europe/London"


def to_24h(raw: str, prayer: str) -> str:
    """Resolve one printed time. Hours above 12 are already 24-hour."""
    match = re.fullmatch(r"(\d{1,2})[:.](\d{2})\s*([ap])?\.?m?\.?", raw.strip(), re.I)
    if not match:
        raise ValueError(f"unreadable time {raw!r}")
    hour, minute = int(match.group(1)), int(match.group(2))
    meridiem = (match.group(3) or "").lower()
    if meridiem == "a":
        hour %= 12
    elif meridiem == "p":
        hour = hour % 12 + 12
    elif hour < 12 and prayer in PM:
        hour += 12
    if hour > 23 or minute > 59:
        raise ValueError(f"out-of-range time {raw!r}")
    return f"{hour:02d}:{minute:02d}"


def parse_file(path: Path):
    meta = {"notes": []}
    rows = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line and "|" not in line:
            key, _, value = line.partition(":")
            key, value = key.strip().lower(), value.strip()
            if key == "note":
                meta["notes"].append(value)
            elif key == "jummah":
                meta["jummah"] = [v.strip() for v in value.split(",") if v.strip()]
            elif key in ("month", "name", "city", "tz"):
                meta[key] = value
            else:
                raise ValueError(f"{path.name}:{lineno}: unknown header {key!r}")
            continue

        groups = [g.strip() for g in line.split("|")]
        if len(groups) != 8:
            raise ValueError(f"{path.name}:{lineno}: expected 8 groups, got {len(groups)}")
        day = int(groups[0])
        hijri = groups[1]
        begins, jamaah = {}, {}
        for prayer, group in zip(ORDER, groups[2:]):
            parts = group.split()
            begins[prayer] = to_24h(parts[0], prayer)
            if len(parts) > 1 and prayer != "sunrise":
                jamaah[prayer] = to_24h(parts[1], prayer)
        rows.append((day, hijri, begins, jamaah))

    if "month" not in meta:
        raise ValueError(f"{path.name}: missing 'month:' header")
    return meta, rows


def main() -> None:
    existing = {}
    if OUT.exists():
        previous = json.loads(OUT.read_text(encoding="utf-8"))
        if not previous.get("meta", {}).get("placeholder"):
            existing = previous.get("days", {})

    days = dict(existing)
    meta_out = {"timezone": DEFAULT_TZ}
    months = []

    for path in sorted(TABLES.glob("*.txt")):
        meta, rows = parse_file(path)
        year, month = meta["month"].split("-")
        months.append(meta["month"])
        if meta.get("name"):
            meta_out["name"] = meta["name"]
        if meta.get("city"):
            meta_out["city"] = meta["city"]
        if meta.get("tz"):
            meta_out["timezone"] = meta["tz"]
        if meta.get("jummah"):
            meta_out["jummah"] = meta["jummah"]
        if meta["notes"]:
            meta_out.setdefault("notes", [])
            for note in meta["notes"]:
                if note not in meta_out["notes"]:
                    meta_out["notes"].append(note)

        for day, hijri, begins, jamaah in rows:
            entry = dict(begins)
            if hijri:
                entry["hijri"] = hijri
            if jamaah:
                entry["jamaah"] = jamaah
            days[f"{int(month):02d}-{day:02d}"] = entry
        print(f"{path.name}: {len(rows)} days")

    meta_out.setdefault("name", "Masjid timetable")
    meta_out["jamaah"] = True
    meta_out["source"] = "printed timetable: " + ", ".join(months)
    meta_out["coverage"] = sorted({key[:2] for key in days})

    OUT.write_text(
        json.dumps({"meta": meta_out, "days": dict(sorted(days.items()))}, indent=1, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} with {len(days)} days")


if __name__ == "__main__":
    main()
