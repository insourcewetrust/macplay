#!/usr/bin/env python3
"""Dessine l'icône du lanceur : une cible de fléchettes, en PNG, sans dépendance."""

import math
import struct
import sys
import zlib

BG = (14, 17, 22, 255)          # fond de l'appli
BLACK = (26, 26, 26, 255)
CREAM = (242, 229, 200, 255)
RED = (210, 35, 42, 255)
GREEN = (23, 146, 74, 255)

# rayons relatifs d'une vraie cible (bull 6.35 mm … double 170 mm)
# le bull est agrandi par rapport à une vraie cible : à 48 dp dans le lanceur,
# les proportions exactes le rendraient invisible
R_BULL = 14.0 / 170
R_25 = 26.0 / 170
R_TRIPLE_IN = 99.0 / 170
R_TRIPLE_OUT = 107.0 / 170
R_DOUBLE_IN = 162.0 / 170
R_DOUBLE_OUT = 1.0


def sector_index(angle):
    """Indice du secteur pour un angle en radians mesuré depuis le haut, sens horaire."""
    deg = math.degrees(angle) % 360.0
    return int(((deg + 9.0) % 360.0) // 18.0)


def pixel(x, y, size, board_radius, cx, cy):
    dx, dy = x - cx, y - cy
    dist = math.hypot(dx, dy)
    r = dist / board_radius
    if r > R_DOUBLE_OUT:
        return BG
    if r < R_BULL:
        return RED
    if r < R_25:
        return GREEN

    idx = sector_index(math.atan2(dx, -dy))
    dark = idx % 2 == 0  # le 20 est noir, on alterne ensuite

    if r < R_TRIPLE_IN or (R_TRIPLE_OUT <= r < R_DOUBLE_IN):
        return BLACK if dark else CREAM
    return GREEN if dark else RED  # anneaux triple et double


def render(size):
    board_radius = size * 0.42  # marge pour le masque rond/squircle du lanceur
    cx = cy = (size - 1) / 2.0
    rows = []
    aa = 2  # suréchantillonnage : les fils métalliques restent nets
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(aa):
                for sx in range(aa):
                    px = pixel(x + (sx + 0.5) / aa, y + (sy + 0.5) / aa,
                               size, board_radius, cx, cy)
                    for i in range(4):
                        acc[i] += px[i]
            row.extend(bytes(v // (aa * aa) for v in acc))
        rows.append(bytes(row))
    return rows


def write_png(path, size):
    rows = render(size)
    raw = b''.join(b'\x00' + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as fh:
        fh.write(png)
    print(f'icône {size}×{size} → {path}')


if __name__ == '__main__':
    write_png(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 432)
