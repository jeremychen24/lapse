"""Draws the app icons (ring with a gap + red dot) with no dependencies.

Run from the repo root:  python tools/make_icons.py
"""
import math
import pathlib
import struct
import zlib

BG = (11, 11, 11)
RING = (242, 242, 238)
RED = (255, 69, 58)
OUT = pathlib.Path(__file__).resolve().parent.parent / "icons"


def write_png(path, size, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    )


def coverage(d):
    """Signed distance (px, negative inside) to anti-aliased coverage."""
    return max(0.0, min(1.0, 0.5 - d))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def icon(size):
    c = size / 2
    ring_r = 0.30 * size
    half_w = 0.027 * size
    dot_r = 0.105 * size
    gap_mid = math.radians(-45)  # the gap sits at half past one
    gap_half = math.radians(18)
    ends = [(c + ring_r * math.cos(gap_mid + s * gap_half), c + ring_r * math.sin(gap_mid + s * gap_half)) for s in (-1, 1)]

    rows = []
    for y in range(size):
        row = []
        py = y + 0.5
        for x in range(size):
            px = x + 0.5
            dx, dy = px - c, py - c
            r = math.hypot(dx, dy)
            off = abs((math.atan2(dy, dx) - gap_mid + math.pi) % (2 * math.pi) - math.pi)
            if off > gap_half:
                d_ring = abs(r - ring_r) - half_w
            else:  # round caps at the ends of the arc
                d_ring = min(math.hypot(px - ex, py - ey) for ex, ey in ends) - half_w
            col = mix(BG, RING, coverage(d_ring))
            col = mix(col, RED, coverage(r - dot_r))
            row.extend(col)
        rows.append(row)
    return rows


def main():
    OUT.mkdir(exist_ok=True)
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180), ("favicon-32.png", 32)]:
        write_png(OUT / name, size, icon(size))
        print("wrote", name)


if __name__ == "__main__":
    main()
