# -*- coding: utf-8 -*-
"""Build Houdini Bet brand PNGs/favicons from Analytics Logo JPG (exact colors)."""
from __future__ import annotations

import base64
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / "public"
BRAND = ROOT / "brand"
SRC = BRAND / "_src" / "ws_Houdini-Bet Analytics Logo-ec08bf3e-8496-44ba-bffe-e45cd107ab5c.jpg"
DARK = (10, 10, 10, 255)
LIGHT = (255, 255, 255, 255)


def load_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def is_bg_gray(r: int, g: int, b: int) -> bool:
    """Damero: grises claros / off-white (no rojo, no negro logo)."""
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn > 20:
        return False
    # pure white kept for logo fills unless edge-flood decides otherwise
    if r >= 253 and g >= 253 and b >= 253:
        return False
    return 150 <= mx <= 252


def remove_checker(im: Image.Image) -> Image.Image:
    out = im.copy()
    px = out.load()
    w, h = out.size

    # Sample corners: dark-ready assets use solid near-black plate (not checker).
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    dark_plate = sum(1 for r, g, b, a in corners if a > 200 and max(r, g, b) <= 28) >= 3

    # Pass 1: kill obvious checker cells (light sources only)
    if not dark_plate:
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if is_bg_gray(r, g, b):
                    px[x, y] = (0, 0, 0, 0)

    # Pass 2: flood from edges through soft background
    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    def soft_bg(r: int, g: int, b: int, a: int) -> bool:
        if a < 30:
            return True
        mx, mn = max(r, g, b), min(r, g, b)
        if dark_plate:
            # Edge-connected near-black plate → transparent (keep red/white/grey art)
            if mx - mn > 18:
                return False
            return mx <= 28
        if mx - mn > 22:
            return False
        # edge-connected light / near-white fringe
        return mx >= 170

    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
            continue
        seen[y][x] = True
        r, g, b, a = px[x, y]
        if not soft_bg(r, g, b, a):
            continue
        # Don't eat interior pure-white logo (pitch / beard) — only if mostly surrounded by opaque logo
        if (not dark_plate) and r >= 250 and g >= 250 and b >= 250 and a > 200:
            dark_n = 0
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    rr, gg, bb, aa = px[nx, ny]
                    if aa > 200 and max(rr, gg, bb) < 90:
                        dark_n += 1
            if dark_n >= 1:
                continue
        # Don't eat wizard hat/cloak blacks that are interior (non-edge flood already stops)
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            q.append((nx, ny))

    # Despeckle alpha
    alpha = out.split()[-1].filter(ImageFilter.MedianFilter(3))
    out.putalpha(alpha)
    return out


def trim_alpha(im: Image.Image, pad: int = 8) -> Image.Image:
    bbox = im.split()[-1].getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(im.width, r + pad)
    b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def fit_width(im: Image.Image, width: int) -> Image.Image:
    w, h = im.size
    nh = max(1, round(h * (width / w)))
    return im.resize((width, nh), Image.Resampling.LANCZOS)


def on_canvas(im: Image.Image, size: int, bg: tuple[int, int, int, int] | None = None) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg if bg else (0, 0, 0, 0))
    margin = int(size * 0.08)
    max_side = size - 2 * margin
    w, h = im.size
    scale = min(max_side / w, max_side / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    a = im.split()[-1]
    bbox = a.getbbox()
    print(f"wrote {path.name} {im.size} bbox={bbox} bytes={path.stat().st_size}")


def write_icon_svg(mark_path: Path, out_svg: Path) -> None:
    b64 = base64.b64encode(mark_path.read_bytes()).decode("ascii")
    out_svg.write_text(
        f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Houdini Bet">
  <rect width="512" height="512" fill="#0A0A0A"/>
  <image width="512" height="512" href="data:image/png;base64,{b64}" xlink:href="data:image/png;base64,{b64}" preserveAspectRatio="xMidYMid meet"/>
</svg>
''',
        encoding="utf-8",
    )
    print("wrote", out_svg.name)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"SOURCE MISSING: {SRC}")
    raw = load_rgba(SRC)
    print("source", raw.size)

    # Exact colors — no black→white recolor
    clean = remove_checker(raw)
    clean = trim_alpha(clean, pad=10)
    print("clean", clean.size, "bbox", clean.split()[-1].getbbox())

    logo = fit_width(clean, 800)
    save(logo, BRAND / "houdini-bet-logo.png")

    logo512 = on_canvas(clean, 512, bg=None)
    save(logo512, BRAND / "houdini-bet-logo-512.png")

    for name, size in (
        ("favicon-32.png", 32),
        ("favicon-48.png", 48),
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("apple-touch-icon.png", 180),
    ):
        save(on_canvas(clean, size, bg=DARK), ROOT / name)

    write_icon_svg(BRAND / "houdini-bet-logo-512.png", ROOT / "icon.svg")

    # QA previews: lockup on dark (needs CSS light pad in UI) + on light
    preview_dark = Image.new("RGBA", (logo.width + 48, logo.height + 48), DARK)
    preview_dark.alpha_composite(logo, (24, 24))
    save(preview_dark, BRAND / "_src" / "preview-on-dark.png")

    preview_light = Image.new("RGBA", (logo.width + 48, logo.height + 48), LIGHT)
    preview_light.alpha_composite(logo, (24, 24))
    save(preview_light, BRAND / "_src" / "preview-on-light.png")

    # WhatsApp / OG share plates: solid black, logo TAL CUAL (no alpha flood).
    # Use the raw dark JPG so black plate stays opaque — WA hates transparent lockups.
    share_src = raw.copy()
    share_lockup = fit_width(share_src, 900)

    def paste_centered(canvas: Image.Image, im: Image.Image) -> None:
        x = (canvas.width - im.width) // 2
        y = (canvas.height - im.height) // 2
        if im.mode != "RGBA":
            im = im.convert("RGBA")
        canvas.alpha_composite(im, (x, y))

    og = Image.new("RGBA", (1200, 630), DARK)
    paste_centered(og, share_lockup)
    save(og, BRAND / "og-share.png")

    og512 = on_canvas(clean, 512, bg=DARK)
    save(og512, BRAND / "og-share-512.png")
    print("DONE (exact colors, no recolor_for_dark; og-share black plate)")


if __name__ == "__main__":
    main()
