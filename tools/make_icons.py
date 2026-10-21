#!/usr/bin/env python3
"""Draws the app icons (an omamori on a red background) into icons/.

Uses only the Python standard library. Run from the project folder:
    python3 tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

RED = (184, 50, 42)
CREAM = (246, 232, 196)
DEEP_RED = (138, 36, 30)
GOLD = (226, 186, 92)


def rounded_rect(x, y, left, top, right, bottom, r):
    cx = min(max(x, left + r), right - r)
    cy = min(max(y, top + r), bottom - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r and left <= x <= right and top <= y <= bottom


def colour_at(x, y):
    """Colour at a point, with x and y from 0 to 1."""
    # Knot on top of the pouch
    if (x - 0.5) ** 2 + (y - 0.275) ** 2 <= 0.042 ** 2:
        return GOLD
    # Cord loop above the knot
    d = math.hypot(x - 0.5, y - 0.19)
    if 0.045 <= d <= 0.07 and y < 0.27:
        return GOLD
    # Pouch
    if rounded_rect(x, y, 0.29, 0.29, 0.71, 0.87, 0.07):
        # Embroidered panel with a "text" column
        if rounded_rect(x, y, 0.38, 0.40, 0.62, 0.78, 0.02):
            if 0.48 <= x <= 0.52 and 0.45 <= y <= 0.73:
                return GOLD
            return DEEP_RED
        return CREAM
    return RED


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
