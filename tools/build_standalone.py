"""Bundle the app into one self-contained HTML file.

Everything is inlined - styles, script and the timetable - so the result runs
from a single file with no server, no service worker and no fetches. Use it to
host the app somewhere that only accepts one file, or to open it straight from
disk. The multi-file version in this folder stays the primary build; it is the
one that installs as a PWA and works offline.

The output omits <!doctype>, <html>, <head> and <body> so it can also be
published as a Claude Artifact, which supplies that skeleton itself.

Usage:
    python3 tools/build_standalone.py [output.html]
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def extract(pattern: str, text: str, label: str) -> str:
    match = re.search(pattern, text, re.S | re.I)
    if not match:
        raise SystemExit(f"could not find {label} in index.html")
    return match.group(1)


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "azan-standalone.html"
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "app.js").read_text(encoding="utf-8")
    timetable = json.loads((ROOT / "data" / "timetable.json").read_text(encoding="utf-8"))

    # Name the file after the mosque it carries, so a published copy is
    # identifiable; fall back to the app's own title.
    title = extract(r"<title>(.*?)</title>", html, "<title>")
    mosque = (timetable.get("meta") or {}).get("name")
    if mosque:
        title = f"{mosque} {title}"

    style = extract(r"<style>(.*?)</style>", html, "<style>")
    body = extract(r"<body>(.*?)</body>", html, "<body>")
    body = re.sub(r'\s*<script src="app\.js"></script>', "", body)

    if "</script>" in script:
        raise SystemExit("app.js contains </script>; inlining would break the page")

    parts = [
        f"<title>{title}</title>",
        f"<style>{style}</style>",
        body.strip(),
        "<script>",
        "window.__AZAN_STANDALONE__ = true;",
        "window.__AZAN_TIMETABLE__ = " + json.dumps(timetable, ensure_ascii=False) + ";",
        script,
        "</script>",
        "",
    ]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(parts), encoding="utf-8")
    days = len(timetable.get("days", {}))
    print(f"wrote {out} ({out.stat().st_size:,} bytes, {days} days)")


if __name__ == "__main__":
    main()
