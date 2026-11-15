"""Reproducible offline derivative of a NASA Blue Marble Next Generation base map for the web.

Usage:
    python -I scripts/assets/convert_earth.py <world.topo.bathy.200401.3x5400x2700.jpg> <out.jpg> [--width 4096]

Source: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
Credit: NASA Earth Observatory (Blue Marble: Next Generation, Reto Stockli, NASA Goddard Space Flight Center).

Only a Lanczos resize to a 2:1 size and a JPEG re-encode. No colour change, no clouds added.
The source is plate carree with the left edge at 180 W and north at the top (checked below on land/ocean pixels).
Requires: Python 3, Pillow.
"""
import argparse
import hashlib

from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--width', type=int, default=4096)
    args = parser.parse_args()
    image = Image.open(args.source).convert('RGB')
    width, height = image.size
    if width != 2 * height:
        raise SystemExit('Expected a 2:1 global map')

    def pixel(lat, lon):  # assuming left edge 180 W, top 90 N
        return image.getpixel((int((lon + 180) / 360 * width) % width, int((90 - lat) / 180 * height)))

    checks = {'Sahara 23N 13E (bright sand)': pixel(23, 13), 'Pacific 0N 140W (ocean)': pixel(0, -140),
              'Greenland 75N 40W (ice)': pixel(75, -40), 'Amazon 3S 62W (forest)': pixel(-3, -62)}
    for name, value in checks.items():
        print(f'check {name}: rgb {value}')
    sand, ocean, ice, forest = checks.values()
    if not (sand[0] > 150 and sand[0] > sand[2] + 30 and ocean[2] > ocean[0] and min(ice) > 180 and forest[1] > forest[2]):
        raise SystemExit('Orientation check failed: the map is not left-edge 180 W / north-up as assumed')
    out = image.resize((args.width, args.width // 2), Image.LANCZOS)
    out.save(args.output, quality=90, subsampling=0, optimize=True)
    print(f'source {width}x{height} sha256 {sha256(args.source)}')
    print(f'output {out.size[0]}x{out.size[1]} quality 90 sha256 {sha256(args.output)}')


if __name__ == '__main__':
    main()
