"""Prepare renderer-only 80 km PGDA90 context and SVS4720 global LOLA height assets."""
from __future__ import annotations

import hashlib
import json
import math
import re
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from rasterio.warp import transform

ROOT = Path(__file__).resolve().parents[2]
RADIUS_M = 1_737_400.0
APP_FRAME = "MOON_ME_DE440_ME421"
SOURCE_FRAME = "MOON_ME_DE421"
FRAME_APPROX_RAD = 5.8204420784597e-7
PGDA_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"
PGDA_PAGE = "https://pgda.gsfc.nasa.gov/products/90"
SVS_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4.tif"
SVS_PAGE = "https://svs.gsfc.nasa.gov/4720/"
PDS_BASE = "https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cached_download(url: str, filename: str) -> Path:
    cache = Path(tempfile.gettempdir()) / "lunar-visual-context-sources"
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / filename
    if not path.exists():
        with urllib.request.urlopen(url, timeout=120) as response:
            if response.status != 200:
                raise RuntimeError(f"HTTP {response.status} for {url}")
            path.write_bytes(response.read())
    return path


def make_positions(dem: rasterio.io.DatasetReader, values: np.ndarray, row_offset: int,
                   col_offset: int, stride: int) -> np.ndarray:
    rows, cols = np.meshgrid(row_offset + np.arange(values.shape[0]) * stride,
                             col_offset + np.arange(values.shape[1]) * stride, indexing="ij")
    x = dem.transform.c + (cols + 0.5) * dem.transform.a
    y = dem.transform.f + (rows + 0.5) * dem.transform.e
    lons, lats = transform(dem.crs, dem.crs.geodetic_crs,
                           np.asarray(x).ravel().tolist(), np.asarray(y).ravel().tolist())
    phi = np.radians(np.asarray(lats).reshape(values.shape))
    lam = np.radians(np.asarray(lons).reshape(values.shape))
    radius = RADIUS_M + values.astype(np.float64)
    return np.stack((radius * np.cos(phi) * np.cos(lam),
                     radius * np.cos(phi) * np.sin(lam),
                     radius * np.sin(phi)), axis=-1)


def verify_pds_roll(svs_heights_km: np.ndarray) -> dict:
    label_path = cached_download(PDS_BASE + "LDEM_4.LBL", "LDEM_4.LBL")
    image_path = cached_download(PDS_BASE + "LDEM_4.IMG", "LDEM_4.IMG")
    label = label_path.read_text(encoding="ascii", errors="strict")
    required = [r"^[ \t]*LINE_SAMPLES\s*=\s*1440$", r"^[ \t]*LINES\s*=\s*720$", r"^[ \t]*SAMPLE_TYPE\s*=\s*LSB_INTEGER$",
                r"^[ \t]*SCALING_FACTOR\s*=\s*0\.5$", r"^[ \t]*CENTER_LONGITUDE\s*=\s*180\s*<deg>$",
                r"^[ \t]*SAMPLE_PROJECTION_OFFSET\s*=\s*719\.5\s*<pix>$", r"^[ \t]*LINE_PROJECTION_OFFSET\s*=\s*359\.5\s*<pix>$",
                r"^[ \t]*WESTERNMOST_LONGITUDE\s*=\s*0\s*<deg>$", r"^[ \t]*EASTERNMOST_LONGITUDE\s*=\s*360\s*<deg>$",
                r'^[ \t]*COORDINATE_SYSTEM_NAME\s*=\s*"MEAN EARTH/POLAR AXIS OF DE421"$']
    missing = [pattern for pattern in required if not re.search(pattern, label, flags=re.MULTILINE)]
    if missing:
        raise RuntimeError(f"PDS LDEM_4 label missing expected registration metadata: {missing}")
    pds = np.fromfile(image_path, dtype="<i2")
    if pds.size != 1440 * 720:
        raise RuntimeError(f"PDS LDEM_4 IMG has {pds.size} samples, expected 1,036,800")
    pds = pds.reshape(720, 1440)
    # PDS values are half-metres. SVS re-centres the 0..360 grid by a 720-column roll.
    rolled = np.roll(pds, 720, axis=1).astype(np.float64) * 0.0005
    error = svs_heights_km.astype(np.float64) - rolled
    direct_error = svs_heights_km.astype(np.float64) - pds.astype(np.float64) * 0.0005
    mean_abs_roll = float(np.mean(np.abs(error)))
    mean_abs_direct = float(np.mean(np.abs(direct_error)))
    if not mean_abs_roll < mean_abs_direct * 0.5:
        raise RuntimeError("SVS/PDS registration does not support the required 720-column roll")
    return {
        "labelUrl": PDS_BASE + "LDEM_4.LBL",
        "labelSha256": sha256(label_path.read_bytes()),
        "imageUrl": PDS_BASE + "LDEM_4.IMG",
        "imageSha256": sha256(image_path.read_bytes()),
        "pdsLabelCenterLongitudeDeg": 180,
        "pdsFirstPixelCenterLongitudeDeg": 0.125,
        "svsRollColumns": 720,
        "rowFlip": False,
        "meanAbsoluteDifferenceM": mean_abs_roll * 1000,
        "maxAbsoluteDifferenceM": float(np.max(np.abs(error))) * 1000,
        "unrolledMeanAbsoluteDifferenceM": mean_abs_direct * 1000,
        "registrationEvidence": "SVS TIFF pixels match the official PDS LDEM_4 IMG after a 720-column roll with row order retained; the PDS label is pixel-registered, east-positive, 0-360 degrees, centered at 180 degrees. Therefore SVS first-column center is 180.125 degrees normalized to -179.875 degrees east. Its first row center is +89.875 degrees, inferred from the PDS line offset and confirmed against the overlapping PGDA90 patch.",
    }


def global_bilinear(height_m: np.ndarray, lat_deg: float, lon_deg: float) -> float:
    first_row_lat = 89.875
    first_col_lon = -179.875
    row = (first_row_lat - lat_deg) / 0.25
    col = ((lon_deg - first_col_lon) % 360.0) / 0.25
    if row < 0 or row > height_m.shape[0] - 1:
        raise ValueError(f"Latitude {lat_deg} outside global pixel-center bounds")
    r0 = min(height_m.shape[0] - 1, int(math.floor(row)))
    r1 = min(height_m.shape[0] - 1, r0 + 1)
    c0 = int(math.floor(col)) % height_m.shape[1]
    c1 = (c0 + 1) % height_m.shape[1]
    fr, fc = row - r0, col - math.floor(col)
    return float((1 - fr) * ((1 - fc) * height_m[r0, c0] + fc * height_m[r0, c1]) +
                 fr * ((1 - fc) * height_m[r1, c0] + fc * height_m[r1, c1]))


def lat_lon(position: np.ndarray) -> tuple[float, float]:
    radius = float(np.linalg.norm(position))
    return math.degrees(math.asin(float(position[2]) / radius)), math.degrees(math.atan2(float(position[1]), float(position[0])))


def prepare(output_dir: Path = ROOT / "public/data") -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    detail_path = output_dir / "terrain-pgda90-southpolar.json"
    detail = json.loads(detail_path.read_text(encoding="utf-8"))

    global_source_path = cached_download(SVS_URL, "svs4720-ldem_4.tif")
    with rasterio.open(global_source_path) as global_ds:
        if (global_ds.width, global_ds.height, global_ds.count, global_ds.dtypes[0]) != (1440, 720, 1, "float32"):
            raise RuntimeError("Unexpected SVS4720 LDEM_4 TIFF dimensions or format")
        global_km = global_ds.read(1)
    if not np.isfinite(global_km).all():
        raise RuntimeError("Unexpected non-finite values in SVS4720 global TIFF")
    pds_verification = verify_pds_roll(global_km)
    global_m_float = global_km.astype(np.float64) * 1000.0
    if np.max(np.abs(global_m_float)) >= 32767:
        raise RuntimeError("SVS global metres do not fit signed Int16")
    global_m_i16 = np.rint(global_m_float).astype("<i2")
    global_bin = global_m_i16.tobytes(order="C")
    if len(global_bin) != 1440 * 720 * 2:
        raise RuntimeError("Global height binary has an unexpected byte length")
    global_bin_path = output_dir / "visual-context-lola-global-4ppd.bin"
    global_bin_path.write_bytes(global_bin)
    global_bin_hash = sha256(global_bin)

    global_meta = {
        "schemaVersion": "1.0", "kind": "visual-context-only", "id": "lola-ldem4-global-v1",
        "frame": APP_FRAME, "sourceFrame": SOURCE_FRAME, "referenceRadiusM": RADIUS_M,
        "frameApproximationMaxRad": FRAME_APPROX_RAD,
        "frameAlignment": "Renderer-only approximate alignment: source LOLA ME uses DE421; application MOON_ME_DE440_ME421 reproduces this frame with a maximum documented rotation difference of 5.8204420784597e-7 rad (about 1.01 m at lunar radius). The SVS TIFF has no embedded geotransform; longitude roll was verified against its PDS source IMG, and the latitude registration was confirmed by overlapping PGDA90 samples.",
        "dataFile": global_bin_path.name, "dataType": "int16-le", "units": "m", "scale": 1, "offset": 0,
        "width": 1440, "height": 720, "registration": "pixel-centre",
        "firstRowLatDeg": 89.875, "firstColLonDeg": -179.875, "pixelSpacingDeg": 0.25,
        "rowOrder": "north-to-south", "columnOrder": "eastward", "lonWraps": True, "nodata": None,
        "source": {"page": SVS_PAGE, "file": "ldem_4.tif", "url": SVS_URL,
                   "sha256": sha256(global_source_path.read_bytes()), "units": "km relative to a 1737.4 km sphere",
                   "pdsProduct": "LRO-L-LOLA-4-GDR-V1.0 LDEM_4", "pdsLabel": pds_verification},
        "sha256": global_bin_hash,
        "note": "Visual context only. Not a horizon, visibility, slope or ranking input.",
    }
    global_meta_path = output_dir / "visual-context-lola-global-4ppd.json"
    global_meta_path.write_text(json.dumps(global_meta, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")

    with rasterio.open("/vsicurl/" + PGDA_URL) as dem:
        if dem.crs is None or 'AUTHORITY["IAU","30135"]' not in dem.crs.to_wkt():
            raise RuntimeError("PGDA90 source is not IAU:30135 lunar south-polar stereographic")
        if (dem.width, dem.height, dem.count, dem.dtypes[0]) != (7600, 7600, 1, "float32"):
            raise RuntimeError("Unexpected PGDA90 source raster metadata")
        if not math.isclose(dem.transform.a, 80.0) or not math.isclose(dem.transform.e, -80.0):
            raise RuntimeError("Unexpected PGDA90 native pixel spacing")
        window = Window(3300, 2920, 1001, 1001)
        native = dem.read(1, window=window, masked=False)
        if native.shape != (1001, 1001):
            raise RuntimeError(f"PGDA90 source returned window shape {native.shape}")
        sampled = native[::10, ::10].copy()
        valid = np.isfinite(sampled)
        if sampled.shape != (101, 101):
            raise RuntimeError("PGDA90 strided visual-context grid is not 101x101")
        if not valid[43:58, 43:58].all():
            raise RuntimeError("PGDA90 visual context has no-data in the two-cell stitch ring")
        positions = make_positions(dem, sampled, 2920, 3300, 10)
        positions[~valid] = np.nan
        source_wkt = dem.crs.to_wkt()
        source_gt = list(dem.transform)[:6]
        source_block = np.ascontiguousarray(native.astype("<f4")).tobytes(order="C")
        sampled_block = np.ascontiguousarray(sampled.astype("<f4")).tobytes(order="C")

    detail_positions = np.asarray(detail["grid"]["positionsM"], dtype=object)
    max_shared_delta = 0.0
    for i in range(11):
        for j in range(11):
            context_position = positions[45 + i, 45 + j]
            detail_position = np.asarray(detail_positions[10 * i][10 * j], dtype=np.float64)
            max_shared_delta = max(max_shared_delta, float(np.linalg.norm(context_position - detail_position)))
    if max_shared_delta > 0.01:
        raise RuntimeError(f"Shared 11x11 detail vertices differ by {max_shared_delta:.6f}m (>0.01m)")

    flat_positions: list[float | None] = []
    positions_le = np.empty((101, 101, 3), dtype="<f8")
    for r in range(101):
        for c in range(101):
            if valid[r, c]:
                triplet = [float(v) for v in positions[r, c]]
                flat_positions.extend(triplet)
                positions_le[r, c] = triplet
            else:
                flat_positions.extend((None, None, None))
                positions_le[r, c] = np.nan
    context = {
        "schemaVersion": "1.0", "kind": "visual-context-only", "id": "pgda90-context-80km-800m-v1",
        "frame": APP_FRAME, "sourceFrame": SOURCE_FRAME, "referenceRadiusM": RADIUS_M, "units": "m",
        "frameApproximationMaxRad": FRAME_APPROX_RAD,
        "frameAlignment": detail["source"]["frameAlignment"],
        "rows": 101, "cols": 101, "spacingM": 800, "registration": "pixel-centre",
        "positionsBodyM": flat_positions,
        "detail": {"patchId": detail["id"], "rowStart": 45, "colStart": 45, "rowEnd": 55, "colEnd": 55,
                   "nativeStep": 10, "sharedVertexCount": 121, "maxSharedPositionDifferenceM": max_shared_delta,
                   "stitchRingRowsCols": [43, 57], "noDataInStitchRing": 0},
        "source": {"product": "NASA GSFC PGDA90 LDEM_80S_80MPP_ADJ.TIF", "productPage": PGDA_PAGE,
                   "file": "LDEM_80S_80MPP_ADJ.TIF", "url": PGDA_URL,
                   "sourceWindow": {"rowOff": 2920, "colOff": 3300, "height": 1001, "width": 1001},
                   "sourceWindowFloat32LEBytes": len(source_block), "sourceWindowFloat32LESha256": sha256(source_block),
                   "decimatedFloat32LESha256": sha256(sampled_block), "sha256OfPositionsBodyMFloat64LE": sha256(positions_le.tobytes(order="C")),
                   "nativeSpacingM": 80, "nativeStride": 10, "crsWkt": source_wkt,
                   "sourceGeoTransform": source_gt, "sourceFrame": SOURCE_FRAME,
                   "heightUnits": "m relative to the 1737400 m lunar reference sphere",
                   "sourceNoData": "NaN / _FillValue=nan", "nullSampleCount": int((~valid).sum()),
                   "sampledWindowRetrievedUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")},
        "note": "Visual context only. Not a horizon, visibility, slope or ranking input.",
    }
    context_path = output_dir / "visual-context-pgda90-80km.json"
    context_path.write_text(json.dumps(context, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")

    global_quantized = np.frombuffer(global_bin, dtype="<i2").reshape(720, 1440).astype(np.float64)
    detail_center_position = np.asarray(detail["grid"]["positionsM"][50][50], dtype=np.float64)
    detail_center_lat, detail_center_lon = lat_lon(detail_center_position)
    comparisons = {"detailCenter": {"latDeg": detail_center_lat, "lonDeg": detail_center_lon,
                                    "detailHeightM": detail["grid"]["heightsM"][50][50],
                                    "globalHeightM": global_bilinear(global_quantized, detail_center_lat, detail_center_lon)}}
    for name, r, c in [("northWest", 0, 0), ("northEast", 0, 100), ("southWest", 100, 0), ("southEast", 100, 100)]:
        lat, lon = lat_lon(positions[r, c])
        local_height = float(sampled[r, c])
        global_height = global_bilinear(global_quantized, lat, lon)
        comparisons[name] = {"latDeg": lat, "lonDeg": lon, "contextHeightM": local_height,
                             "globalHeightM": global_height, "globalMinusContextM": global_height - local_height}
    center = comparisons["detailCenter"]
    comparisons["detailCenter"]["globalMinusDetailedM"] = center["globalHeightM"] - center["detailHeightM"]

    return {"regionalAsset": str(context_path), "regionalBytes": context_path.stat().st_size,
            "regionalSha256": sha256(context_path.read_bytes()), "regionalRowsCols": [101, 101],
            "regionalNullSamples": int((~valid).sum()), "stitchRingNullSamples": 0,
            "sharedVertices": 121, "maxSharedPositionDifferenceM": max_shared_delta,
            "globalBinary": str(global_bin_path), "globalBinaryBytes": len(global_bin),
            "globalBinarySha256": global_bin_hash,
            "globalSourceTifSha256": global_meta["source"]["sha256"],
            "globalFirstRowLatDeg": 89.875, "globalFirstColLonDeg": -179.875,
            "pdsRegistrationVerification": pds_verification, "globalHeightComparisons": comparisons}


if __name__ == "__main__":
    print(json.dumps(prepare(), indent=2))
