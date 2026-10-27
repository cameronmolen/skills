#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["fonttools[woff]"]
# ///
"""
Fill the __INTER__ / __GT__ placeholders in a preferred-style HTML draft with
base64 WOFF2 fonts, so the shipped file makes no external requests.

    uv run embed-fonts.py <draft.html> <out.html>

Fonts are fetched once from the CDN and cached. Under uv, both are
subset to Latin + common punctuation and Inter is pinned to weights 400-700
(~60KB of base64 in total). Run with plain python3 and fontTools missing, it
embeds the full fonts instead (~490KB) and says so.
"""
import base64
import io
import os
import sys
import urllib.request
from pathlib import Path

CDN = "https://d9lvjui2ux1xa.cloudfront.net/fonts/v3/"
FONTS = {"__INTER__": "Inter-VariableFont.woff2", "__GT__": "gt-ultra-median-bold.woff2"}
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "html-communication-fonts"
UNICODES = "U+0020-007E,U+00A0-00FF,U+00B7,U+2013-2014,U+2018-201D,U+2022,U+2026,U+2190-2193,U+2212,U+2264-2265"


def fetch(name: str) -> bytes:
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(CDN + name, timeout=30) as r:
            path.write_bytes(r.read())
    return path.read_bytes()


def subset(data: bytes, placeholder: str) -> bytes:
    from fontTools import subset as fts
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    font = TTFont(io.BytesIO(data))
    if placeholder == "__INTER__":
        font = instancer.instantiateVariableFont(font, {"wght": (400, 700), "slnt": 0})
    opts = fts.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "calt", "tnum"]
    sub = fts.Subsetter(opts)
    sub.populate(unicodes=fts.parse_unicodes(UNICODES))
    sub.subset(font)
    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue()


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip())
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    html = src.read_text()

    try:
        import fontTools  # noqa: F401
        shrink = True
    except ImportError:
        shrink = False
        print("fontTools not found: embedding full fonts (~490KB). Run with `uv run` to subset.", file=sys.stderr)

    for placeholder, name in FONTS.items():
        if placeholder not in html:
            sys.exit(f"{placeholder} not found in {src}")
        data = fetch(name)
        if shrink:
            data = subset(data, placeholder)
        html = html.replace(placeholder, base64.b64encode(data).decode())

    dst.write_text(html)
    print(f"{dst}: {dst.stat().st_size / 1024:.0f}KB")


if __name__ == "__main__":
    main()
