"""Reproducible offline conversion of a NASA SVS 4851 "Deep Star Maps 2020" OpenEXR star map to a web texture.

Usage:
    python -I scripts/assets/convert_starmap.py <starmap_2020_8k.exr> <out.jpg> [--width 8192] [--quality 88]

Source (not redistributed in this repository as EXR): https://svs.gsfc.nasa.gov/4851/
Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC.

What it does, and nothing else:
  * reads the combined celestial star map (plate carree, ICRF/J2000, centred on 0h right ascension,
    right ascension increasing to the LEFT; verified on the file against eight bright stars);
  * decodes ZIP scanline, half-float B/G/R OpenEXR with the standard library and numpy (no EXR package);
  * optionally reduces the width by an integer factor with a box average (energy preserving for point stars);
  * encodes the linear values with the sRGB transfer curve at unit gain. No exposure change, no sharpening,
    no added or removed stars. Exposure (Natural / Enhanced) is applied at run time.

It prints the input and output SHA-256 so the result can be recorded and reproduced.
Requires: Python 3, numpy, Pillow.
"""
import argparse
import hashlib
import struct
import zlib

import numpy as np
from PIL import Image

LINES_PER_BLOCK = 16
ZIP_COMPRESSION = 3


def read_exr(path):
    raw = open(path, 'rb').read()
    if raw[:4] != b'\x76\x2f\x31\x01':
        raise SystemExit('Not an OpenEXR file')
    position = 8
    attributes = {}
    while raw[position] != 0:
        name_end = raw.index(b'\0', position)
        type_end = raw.index(b'\0', name_end + 1)
        size = struct.unpack('<I', raw[type_end + 1:type_end + 5])[0]
        attributes[raw[position:name_end].decode()] = raw[type_end + 5:type_end + 5 + size]
        position = type_end + 5 + size
    position += 1
    if attributes['compression'][0] != ZIP_COMPRESSION:
        raise SystemExit('Only ZIP scanline compression is supported')
    # Channel list: name\0, int32 pixel type (1 = half), 4 bytes flags, int32 x and y sampling; ends with \0.
    channels = attributes['channels']
    names = []
    cursor = 0
    while channels[cursor] != 0:
        end = channels.index(b'\0', cursor)
        pixel_type, _, x_sampling, y_sampling = struct.unpack('<i4sii', channels[end + 1:end + 17])
        if pixel_type != 1 or x_sampling != 1 or y_sampling != 1:
            raise SystemExit('Only full-resolution half-float channels are supported')
        names.append(channels[cursor:end].decode())
        cursor = end + 17
    if names != ['B', 'G', 'R']:
        raise SystemExit(f'Expected half-float B, G, R channels, found {names}')
    x0, y0, x1, y1 = struct.unpack('<4i', attributes['dataWindow'])
    width, height = x1 - x0 + 1, y1 - y0 + 1
    blocks = (height + LINES_PER_BLOCK - 1) // LINES_PER_BLOCK
    offsets = struct.unpack(f'<{blocks}Q', raw[position:position + 8 * blocks])
    image = np.zeros((height, width, 3), np.float32)
    for offset in offsets:
        y, size = struct.unpack('<ii', raw[offset:offset + 8])
        lines = min(LINES_PER_BLOCK, y1 - y + 1)
        expected = lines * width * 3 * 2
        data = raw[offset + 8:offset + 8 + size]
        if size < expected:
            packed = np.frombuffer(zlib.decompress(data), np.uint8).astype(np.int64)
            packed = ((np.cumsum(packed - 128) + 128) & 255).astype(np.uint8)  # undo the byte-delta predictor
            half = (expected + 1) // 2
            interleaved = np.empty(expected, np.uint8)
            interleaved[0::2] = packed[:half]
            interleaved[1::2] = packed[half:]
            data = interleaved.tobytes()
        pixels = np.frombuffer(data, '<f2').reshape(lines, 3, width)  # channels are stored alphabetically: B, G, R
        row = y - y0
        image[row:row + lines, :, 0] = pixels[:, 2]
        image[row:row + lines, :, 1] = pixels[:, 1]
        image[row:row + lines, :, 2] = pixels[:, 0]
    return image


def srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)


def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--width', type=int, default=None, help='output width; must divide the source width')
    parser.add_argument('--quality', type=int, default=88)
    args = parser.parse_args()
    image = read_exr(args.source)
    height, width, _ = image.shape
    out_width = args.width or width
    if width % out_width:
        raise SystemExit('--width must divide the source width exactly')
    factor = width // out_width
    if factor > 1:
        image = image.reshape(height // factor, factor, out_width, factor, 3).mean(axis=(1, 3))
    encoded = (srgb(image) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(encoded).save(args.output, quality=args.quality, subsampling=0, optimize=True)
    print(f'source {args.source} {width}x{height} sha256 {sha256(args.source)}')
    print(f'linear range {float(image.min()):.6f}..{float(image.max()):.6f} median {float(np.median(image)):.6f}')
    print(f'output {args.output} {encoded.shape[1]}x{encoded.shape[0]} quality {args.quality} sha256 {sha256(args.output)}')


if __name__ == '__main__':
    main()
