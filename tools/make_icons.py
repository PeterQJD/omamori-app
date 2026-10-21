#!/usr/bin/env python3
"""Draws the app icons into icons/: a red omamori with the traditional
cut-off top corners, gold border and crest, on deep indigo. The colours
match the app's colour scheme in styles.css.

Uses only the Python standard library. Run from the project folder:
    python3 tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

INDIGO = (31, 42, 77)
RED = (184, 50, 42)
DARK_RED = (163, 43, 36)
GOLD = (226, 186, 92)

# Outline of the pouch, and the inside of its gold border
POUCH = [(0.28, 0.37), (0.40, 0.25), (0.60, 0.25), (0.72, 0.37), (0.72, 0.87), (0.28, 0.87)]
POUCH_INNER = [(0.305, 0.38), (0.41, 0.275), (0.59, 0.275), (0.695, 0.38), (0.695, 0.845), (0.305, 0.845)]
CREST = (0.5, 0.57)


def inside(x, y, points):
    result = False
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            result = not result
    return result


def colour_at(x, y):
    """Colour at a point, with x and y from 0 to 1."""
    # Cord loop above the pouch, and the knot where it meets the pouch
    d = math.hypot(x - 0.5, y - 0.165)
    if 0.028 <= d <= 0.05:
        return GOLD
    if 0.488 <= x <= 0.512 and 0.21 <= y <= 0.25:
        return GOLD
    if inside(x, y, POUCH):
        if not inside(x, y, POUCH_INNER):
            return GOLD
        # Crest: a ring with a dot in the middle
        c = math.hypot(x - CREST[0], y - CREST[1])
        if 0.085 <= c <= 0.11 or c <= 0.045:
            return GOLD
        # Faint diamond pattern, like woven brocade
        if (abs(((x - 0.5) * 18 + 100) % 1 - 0.5) + abs(((y - 0.25) * 18 + 100) % 1 - 0.5)) < 0.13:
            return DARK_RED
        return RED
    return INDIGO


def make_png(size, path):
    samples = 3  # 3x3 samples per pixel for smooth edges
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter type: none
        for px in range(size):
            r = g = b = 0
            for sy in range(samples):
                for sx in range(samples):
                    c = colour_at((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size)
                    r += c[0]; g += c[1]; b += c[2]
            n = samples * samples
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'icons'
    out.mkdir(exist_ok=True)
    for size in (180, 192, 512):
        make_png(size, out / f'icon-{size}.png')
        print('wrote', out / f'icon-{size}.png')
