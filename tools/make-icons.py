#!/usr/bin/env python3
"""Generate the toolbar icons: one neutral set plus one per score band.

The toolbar icon is the at-a-glance signal, so each band gets a solid fill in
its Fenko threat-severity colour with the lens glyph knocked out in near-black.
At 16px that reads as a colour chip, which is the point.

    python3 tools/make-icons.py
"""

import math
import pathlib
import struct
import zlib

SIZES = (16, 32, 48, 128)

GLYPH = (13, 17, 23)  # --bg-primary dark, #0D1117

# Fenko threat-severity scale (dark variants), worst slop = worst severity.
BAND_FILLS = {
    "default": (245, 166, 35),    # Fennec Amber  #F5A623
    "clean": (63, 185, 80),       # Secure        #3FB950
    "light": (88, 166, 255),      # Low           #58A6FF
    "moderate": (210, 153, 34),   # Medium        #D29922
    "heavy": (219, 109, 40),      # High          #DB6D28
    "saturated": (248, 81, 73),   # Critical      #F85149
}

SAMPLES_PER_AXIS = 3  # supersampling grid for antialiasing


def coverage(size, fx, fy):
    """Return glyph coverage in [0,1] for the pixel at (fx, fy)."""
    lens_x, lens_y = size * 0.435, size * 0.415
    r_outer = size * 0.285
    r_inner = size * 0.175
    ring_hit = 0

    handle_x0, handle_y0 = lens_x + r_outer * 0.70, lens_y + r_outer * 0.70
    handle_x1, handle_y1 = size * 0.80, size * 0.80
    handle_half = max(0.9, size * 0.078)

    hits = 0
    step = 1.0 / SAMPLES_PER_AXIS

    for sy in range(SAMPLES_PER_AXIS):
        for sx in range(SAMPLES_PER_AXIS):
            x = fx + (sx + 0.5) * step
            y = fy + (sy + 0.5) * step

            distance = math.hypot(x - lens_x, y - lens_y)
            if r_inner <= distance <= r_outer:
                hits += 1
                continue

            vx, vy = handle_x1 - handle_x0, handle_y1 - handle_y0
            t = ((x - handle_x0) * vx + (y - handle_y0) * vy) / (vx * vx + vy * vy)
            if not 0.0 <= t <= 1.0:
                continue

            px, py = handle_x0 + t * vx, handle_y0 + t * vy
            if math.hypot(x - px, y - py) <= handle_half:
                hits += 1

    del ring_hit
    return hits / (SAMPLES_PER_AXIS * SAMPLES_PER_AXIS)


def rounded_alpha(size, fx, fy, radius):
    """Return square-corner coverage in [0,1] for the pixel at (fx, fy)."""
    hits = 0
    step = 1.0 / SAMPLES_PER_AXIS

    for sy in range(SAMPLES_PER_AXIS):
        for sx in range(SAMPLES_PER_AXIS):
            x = fx + (sx + 0.5) * step
            y = fy + (sy + 0.5) * step
            dx = max(radius - x, x - (size - radius), 0.0)
            dy = max(radius - y, y - (size - radius), 0.0)
            if dx * dx + dy * dy <= radius * radius:
                hits += 1

    return hits / (SAMPLES_PER_AXIS * SAMPLES_PER_AXIS)


def write_png(path, size, fill):
    radius = size * 0.235
    rows = []

    for y in range(size):
        row = bytearray(b"\x00")
        for x in range(size):
            alpha = rounded_alpha(size, x, y, radius)
            if alpha == 0.0:
                row += b"\x00\x00\x00\x00"
                continue

            glyph = coverage(size, x, y)
            pixel = tuple(
                round(fill[i] * (1.0 - glyph) + GLYPH[i] * glyph) for i in range(3)
            )
            row += bytes(pixel) + bytes([round(alpha * 255)])
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data))
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    root = pathlib.Path(__file__).resolve().parent.parent / "icons"

    for band, fill in BAND_FILLS.items():
        for size in SIZES:
            name = f"icon-{size}.png" if band == "default" else f"{band}-{size}.png"
            target = root / name if band == "default" else root / "band" / name
            write_png(target, size, fill)

    print(f"wrote {len(BAND_FILLS) * len(SIZES)} icons under {root}")


if __name__ == "__main__":
    main()
