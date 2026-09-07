"""Generate the app icons: the masjid mark from the mosque's display board.

Pure Python - no imaging library needed. The mark is a peaked roof over a
double-framed square holding an arched mihrab niche, with a band of merlons
above and below.

Usage:
    python3 tools/make_icons.py
"""

import struct
import zlib
from pathlib import Path

PAPER = (233, 229, 220)      # cream ground, as on the board
INK = (35, 38, 63)           # deep navy of the mark

OUT = Path(__file__).resolve().parent.parent / "icons"

# Geometry in fractions of the icon box, so it scales to any size.
ROOF_APEX = (0.500, 0.095)
ROOF_LEFT = (0.075, 0.360)
ROOF_RIGHT = (0.925, 0.360)
ROOF_W = 0.016

FRAME_X0, FRAME_X1 = 0.270, 0.730
FRAME_Y0, FRAME_Y1 = 0.375, 0.720
FRAME_W = 0.040
INNER_INSET = 0.062
INNER_W = 0.017

NICHE_X0, NICHE_X1 = 0.420, 0.580
NICHE_BOTTOM = 0.672
NICHE_SHOULDER = 0.572       # where the arch springs from

BAND_TOP = (0.325, 0.371)
BAND_BOTTOM = (0.724, 0.770)
MERLONS = 7
BAND_X0, BAND_X1 = 0.300, 0.700


def in_band(x, y, band):
    y0, y1 = band
    if not (y0 <= y <= y1):
        return False
    if not (BAND_X0 <= x <= BAND_X1):
        return False
    span = (BAND_X1 - BAND_X0) / (MERLONS * 2 - 1)
    index = int((x - BAND_X0) / span)
    return index % 2 == 0


def near_segment(px, py, a, b, width):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0 if length2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length2))
    cx, cy = ax + t * dx, ay + t * dy
    return (px - cx) ** 2 + (py - cy) ** 2 <= (width / 2) ** 2


def ring(x, y, x0, y0, x1, y1, width):
    """True inside a rectangular outline of the given stroke width."""
    outside = not (x0 - width / 2 <= x <= x1 + width / 2 and y0 - width / 2 <= y <= y1 + width / 2)
    if outside:
        return False
    return not (x0 + width / 2 < x < x1 - width / 2 and y0 + width / 2 < y < y1 - width / 2)


def is_ink(x, y):
    if near_segment(x, y, ROOF_LEFT, ROOF_APEX, ROOF_W):
        return True
    if near_segment(x, y, ROOF_APEX, ROOF_RIGHT, ROOF_W):
        return True
    if in_band(x, y, BAND_TOP) or in_band(x, y, BAND_BOTTOM):
        return True
    if ring(x, y, FRAME_X0, FRAME_Y0, FRAME_X1, FRAME_Y1, FRAME_W):
        return True
    if ring(x, y,
            FRAME_X0 + INNER_INSET, FRAME_Y0 + INNER_INSET,
            FRAME_X1 - INNER_INSET, FRAME_Y1 - INNER_INSET, INNER_W):
        return True

    # The niche: a rectangle below the springing, a half-round arch above it.
    radius = (NICHE_X1 - NICHE_X0) / 2
    cx = (NICHE_X0 + NICHE_X1) / 2
    if NICHE_X0 <= x <= NICHE_X1 and NICHE_SHOULDER <= y <= NICHE_BOTTOM:
        return True
    if y < NICHE_SHOULDER and (x - cx) ** 2 + (y - NICHE_SHOULDER) ** 2 <= radius ** 2:
        return True
    return False


def render(size: int, scale: float):
    """scale < 1 pulls the mark into the maskable safe zone."""
    def pixel(px, py):
        hits = 0
        for ox, oy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
            x = ((px + ox) / size - 0.5) / scale + 0.5
            y = ((py + oy) / size - 0.5) / scale + 0.5
            if is_ink(x, y):
                hits += 1
        a = hits / 4
        if a == 0:
            return bytes(PAPER)
        return bytes(round(PAPER[i] + (INK[i] - PAPER[i]) * a) for i in range(3))
    return pixel


def write_png(path: Path, size: int, pixels) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixels(x, y))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    write_png(OUT / "icon-192.png", 192, render(192, 0.94))
    write_png(OUT / "icon-512.png", 512, render(512, 0.94))
    write_png(OUT / "maskable-512.png", 512, render(512, 0.68))
    for f in sorted(OUT.iterdir()):
        print(f.name, f"{f.stat().st_size:,} bytes")
