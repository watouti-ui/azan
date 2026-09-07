"""Generate the app icons (no third-party imaging library required).

Usage:
    python3 tools/make_icons.py
"""

import math
import struct
import zlib
from pathlib import Path

BG = (13, 21, 18)
RING = (18, 36, 28)
FG = (61, 220, 151)

OUT = Path(__file__).resolve().parent.parent / "icons"


def write_png(path: Path, size: int, pixels) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)                       # filter type 0
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


def crescent_icon(size: int, scale: float):
    """scale < 1 keeps the mark inside the maskable safe zone."""
    cx = cy = size / 2
    outer = size * 0.40 * scale             # outer disc of the crescent
    inner = size * 0.32 * scale             # cut-out disc
    dx = size * 0.11 * scale                # cut-out offset
    ring = size * 0.46                      # subtle background ring
    star_r = size * 0.045 * scale
    star_x, star_y = cx + size * 0.20 * scale, cy - size * 0.17 * scale

    def coverage(x, y):
        """4x supersampled alpha for the crescent + star."""
        hits = 0
        for ox, oy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
            px, py = x + ox, y + oy
            in_outer = (px - cx) ** 2 + (py - cy) ** 2 <= outer ** 2
            in_inner = (px - (cx + dx)) ** 2 + (py - cy) ** 2 <= inner ** 2
            in_star = (px - star_x) ** 2 + (py - star_y) ** 2 <= star_r ** 2
            if (in_outer and not in_inner) or in_star:
                hits += 1
        return hits / 4

    def pixel(x, y):
        base = RING if (x - cx) ** 2 + (y - cy) ** 2 <= ring ** 2 else BG
        a = coverage(x, y)
        if a == 0:
            return bytes(base)
        return bytes(round(base[i] + (FG[i] - base[i]) * a) for i in range(3))

    return pixel


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    write_png(OUT / "icon-192.png", 192, crescent_icon(192, 1.0))
    write_png(OUT / "icon-512.png", 512, crescent_icon(512, 1.0))
    write_png(OUT / "maskable-512.png", 512, crescent_icon(512, 0.72))
    for f in sorted(OUT.iterdir()):
        print(f.name, f.stat().st_size, "bytes")
