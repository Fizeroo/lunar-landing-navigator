"""Range-read and package a small, real PGDA90 LOLA south-polar DEM window."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[2]
SOURCE = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"
RADIUS_M = 1_737_400.0


def prepare(output: Path, window_size: int = 101) -> dict:
    if window_size < 3 or window_size > 259 or window_size % 2 != 1:
        raise ValueError("Window size must be an odd integer from 3 through 259")
    url = "/vsicurl/" + SOURCE
    with rasterio.open(url) as dem:
        if dem.driver != "GTiff" or dem.count != 1 or dem.dtypes[0] != "float32":
            raise ValueError("Unexpected PGDA90 GeoTIFF band format")
        if dem.crs is None or 'AUTHORITY["IAU","30135"]' not in dem.crs.to_wkt():
            raise ValueError("Expected IAU lunar south-polar stereographic CRS 30135")
        if not math.isclose(dem.transform.a, 80.0) or not math.isclose(dem.transform.e, -80.0):
            raise ValueError("Expected 80 metre square source pixels")
        # A real southern site near lon=0, not the singular pole pixel.
        x_site, y_site = transform(dem.crs.geodetic_crs, dem.crs, [0.0], [-89.0])
        row, col = dem.index(x_site[0], y_site[0])
        half = window_size // 2
        window = Window(col - half, row - half, window_size, window_size)
        values = dem.read(1, window=window, masked=False)
        if values.shape != (window_size, window_size):
            raise ValueError("Requested DEM window is outside source coverage")
        rows, cols = np.meshgrid(row - half + np.arange(window_size), col - half + np.arange(window_size), indexing="ij")
        x_centers = dem.transform.c + (cols + 0.5) * dem.transform.a
        y_centers = dem.transform.f + (rows + 0.5) * dem.transform.e
        lons, lats = transform(dem.crs, dem.crs.geodetic_crs,
                               np.asarray(x_centers).ravel().tolist(), np.asarray(y_centers).ravel().tolist())
        lons = np.asarray(lons).reshape(values.shape)
        lats = np.asarray(lats).reshape(values.shape)
        valid = np.isfinite(values)
        if not valid.all():
            # Keep unknown cells explicit; never fill or interpolate missing source values.
            pass
        heights = np.where(valid, values, 0.0).astype(np.float64)
        phi, lam = np.radians(lats), np.radians(lons)
        radius = RADIUS_M + heights
        xyz = np.stack((radius * np.cos(phi) * np.cos(lam),
                        radius * np.cos(phi) * np.sin(lam), radius * np.sin(phi)), axis=-1)
        # Cell chosen by the CRS inverse at the requested nominal coordinate.
        rr, cc = half, half
        if not valid[rr, cc]:
            raise ValueError("Vetted observer DEM cell is no-data")
        observer = {"latDeg": float(lats[rr, cc]), "lonDeg": float(lons[rr, cc]),
                    "groundHeightM": float(values[rr, cc]), "sourceRow": int(row), "sourceCol": int(col)}
        heights_list = [[float(v) if ok else None for v, ok in zip(row_v, row_valid)]
                        for row_v, row_valid in zip(values, valid)]
        positions = [[[float(c) for c in point] if ok else None for point, ok in zip(row_v, row_valid)]
                     for row_v, row_valid in zip(xyz, valid)]
        source_window = {"rowOff": int(row - half), "colOff": int(col - half),
                         "height": window_size, "width": window_size}
        patch = {
            "schemaVersion": 1,
            "id": "pgda90-ldem-80s-80m-southpolar-window-v1",
            "frame": "MOON_ME_DE440_ME421",
            "source": {
                "product": "NASA GSFC PGDA90 LDEM_80S_80MPP_ADJ.TIF",
                "url": SOURCE,
                "productPage": "https://pgda.gsfc.nasa.gov/products/90",
                "citation": "Barker, M.K., A New View of the Lunar South Pole from LOLA, NASA GSFC PGDA, Product 90.",
                "license": "Publicly available NASA planetary science data; retain source citation.",
                "sourceFrame": "MOON_ME_DE421",
                "frameAlignment": "Approximate alignment only: PGDA90 source is MOON_ME_DE421. This product is labeled MOON_ME_DE440_ME421 with the documented FK maximum angular difference 5.8204420784597e-7 rad (1.011 m at this radius, 1900-2051). No PA-to-ME rotation applied.",
                "frameApproximationMaxRad": 5.8204420784597e-7,
                "crsWkt": dem.crs.to_wkt(),
                "nativePixelSizeM": 80,
                "heightUnits": "m relative to the 1737400 m lunar reference sphere",
                "areaOrPoint": dem.tags().get("AREA_OR_POINT"),
                "bandDescription": dem.tags(1).get("long_name"),
                "sourceNodata": "NaN / _FillValue=nan",
                "sourceBytes": 189158392,
                "sourceRasterWidth": dem.width,
                "sourceRasterHeight": dem.height,
                "sourceGeoTransform": list(dem.transform)[:6],
                "sourceWindow": source_window,
                "windowHeightRangeM": [float(np.min(values[valid])), float(np.max(values[valid]))],
                "sampledPixelBytesSha256": hashlib.sha256(values.tobytes(order="C")).hexdigest(),
                "retrievedUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            },
            "referenceRadiusM": RADIUS_M,
            "observer": {"site": {"latDeg": observer["latDeg"], "lonDeg": observer["lonDeg"],
                                   "heightAboveReferenceSphereM": 0},
                         "groundHeightM": observer["groundHeightM"]},
            "grid": {"rows": window_size, "cols": window_size, "registration": "pixel-center",
                     "projection": "source south-polar stereographic; positions are already Moon-fixed metres",
                     "sourceWindow": source_window, "pixelSizeM": 80,
                     "heightsM": heights_list, "positionsM": positions,
                     "validCellCount": int(valid.sum()), "noDataCellCount": int((~valid).sum())},
        }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(patch, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "bytes": output.stat().st_size,
                      "rows": window_size, "cols": window_size, "validCells": int(valid.sum()),
                      "observer": observer}, indent=2))
    return patch


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/terrain-pgda90-southpolar.json")
    parser.add_argument("--window", type=int, default=101)
    args = parser.parse_args()
    prepare(args.output, args.window)
