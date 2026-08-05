#!/usr/bin/env python3
"""Generates Chrome Web Store promo tiles into store-assets/:
  - promo-small-440x280.png  (required by the store listing)
  - promo-marquee-1400x560.png (optional, for featuring)
Brand language matches icons/: indigo->magenta diagonal gradient, white
checkmark mark, "Socialfix" wordmark. Re-run: python3 scripts/gen-promo.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "store-assets")
os.makedirs(OUT, exist_ok=True)

C1 = (99, 102, 241)   # indigo
C2 = (236, 72, 153)   # magenta

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]

def font(size):
    for p in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()

def gradient(w, h):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h)
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(C1, C2))
    return img

def checkmark(draw, cx, cy, s, width):
    a = (cx - 0.24 * s, cy + 0.02 * s)
    b = (cx - 0.06 * s, cy + 0.20 * s)
    c = (cx + 0.26 * s, cy - 0.18 * s)
    draw.line([a, b], fill="white", width=width)
    draw.line([b, c], fill="white", width=width)
    r = width / 2
    for p in (a, b, c):
        draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill="white")

def tile(w, h, name, title_px, tag_px, tagline):
    img = gradient(w, h)
    d = ImageDraw.Draw(img)
    mark_s = h * 0.52
    mark_cx = w * 0.22
    mark_cy = h * 0.44
    checkmark(d, mark_cx, mark_cy, mark_s, max(6, int(h * 0.045)))
    tf = font(title_px)
    d.text((w * 0.36, h * 0.30), "Socialfix", font=tf, fill="white", anchor="lm")
    gf = font(tag_px)
    d.text((w * 0.36, h * 0.30 + title_px * 0.95), tagline, font=gf,
           fill=(255, 255, 255, 230), anchor="lm")
    path = os.path.join(OUT, name)
    img.save(path)
    print("wrote", path)

tile(440, 280, "promo-small-440x280.png", 56, 20, "Clean up your feeds")
tile(1400, 560, "promo-marquee-1400x560.png", 150, 52, "Clean up your feeds")
