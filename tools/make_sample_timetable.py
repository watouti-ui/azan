"""Generate the bundled SAMPLE timetable for the Azan app.

The output is a placeholder so the app is usable before a real timetable is
imported. It uses the NOAA solar-position approximation with Muslim World
League angles (Fajr 18 deg, Isha 17 deg) and the Shafi'i Asr shadow factor.
It is accurate to a few minutes at best and is NOT a substitute for a
timetable from your own mosque or authority.

Usage:
    python3 tools/make_sample_timetable.py > data/timetable.json
"""

import datetime as dt
import json
import math
from zoneinfo import ZoneInfo

YEAR = 2026
LAT = 51.5074           # London
LON = -0.1278
TZ = "Europe/London"
NAME = "London (sample)"

FAJR_ANGLE = 18.0
ISHA_ANGLE = 17.0
ASR_SHADOW = 1          # 1 = Shafi'i/Maliki/Hanbali, 2 = Hanafi
DHUHR_PADDING_MIN = 1


def solar_terms(day_of_year: int):
    gamma = 2 * math.pi / 365 * (day_of_year - 1 + 0.5)
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )
    return eqtime, decl


def hour_angle(zenith_deg: float, decl: float) -> float:
    """Hour angle in degrees for a given zenith, or None if it never happens."""
    lat = math.radians(LAT)
    cos_ha = (
        math.cos(math.radians(zenith_deg)) / (math.cos(lat) * math.cos(decl))
        - math.tan(lat) * math.tan(decl)
    )
    if cos_ha < -1 or cos_ha > 1:
        return None
    return math.degrees(math.acos(cos_ha))


def asr_zenith(decl: float) -> float:
    lat = math.radians(LAT)
    altitude = math.atan(1 / (ASR_SHADOW + math.tan(abs(lat - decl))))
    return 90 - math.degrees(altitude)


def local_hhmm(date: dt.date, utc_minutes: float) -> str:
    moment = dt.datetime(date.year, date.month, date.day, tzinfo=dt.timezone.utc) + dt.timedelta(
        minutes=round(utc_minutes)
    )
    local = moment.astimezone(ZoneInfo(TZ))
    return f"{local.hour:02d}:{local.minute:02d}"


def build():
    days = {}
    date = dt.date(YEAR, 1, 1)
    while date.year == YEAR:
        eqtime, decl = solar_terms(date.timetuple().tm_yday)
        noon = 720 - 4 * LON - eqtime          # UTC minutes
        entry = {}

        def add(key, zenith, before):
            ha = hour_angle(zenith, decl)
            if ha is None:                      # sun never reaches the angle
                return
            entry[key] = local_hhmm(date, noon - 4 * ha if before else noon + 4 * ha)

        sun_ha = hour_angle(90.833, decl)
        add("fajr", 90 + FAJR_ANGLE, True)
        add("sunrise", 90.833, True)
        entry["dhuhr"] = local_hhmm(date, noon + DHUHR_PADDING_MIN)
        add("asr", asr_zenith(decl), False)
        add("maghrib", 90.833, False)
        add("isha", 90 + ISHA_ANGLE, False)

        # High-latitude summer: the sun never drops to the Fajr/Isha angle.
        # Fall back to the one-seventh-of-the-night approximation.
        if sun_ha is not None and ("fajr" not in entry or "isha" not in entry):
            sunrise_utc = noon - 4 * sun_ha
            sunset_utc = noon + 4 * sun_ha
            night = (sunrise_utc + 1440) - sunset_utc
            if "fajr" not in entry:
                entry["fajr"] = local_hhmm(date, sunrise_utc - night / 7)
            if "isha" not in entry:
                entry["isha"] = local_hhmm(date, sunset_utc + night / 7)
        entry = {k: entry[k] for k in ("fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha") if k in entry}

        days[f"{date.month:02d}-{date.day:02d}"] = entry
        date += dt.timedelta(days=1)
    return days


if __name__ == "__main__":
    print(
        json.dumps(
            {
                "meta": {
                    "name": NAME,
                    "timezone": TZ,
                    "placeholder": True,
                    "source": f"calculated sample, MWL {FAJR_ANGLE:.0f}/{ISHA_ANGLE:.0f}, generated for {YEAR}",
                    "note": "SAMPLE ONLY - replace with your own timetable.",
                },
                "days": build(),
            },
            indent=1,
        )
    )
