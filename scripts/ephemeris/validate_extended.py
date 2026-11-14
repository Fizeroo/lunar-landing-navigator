"""Independent, seeded direct-CSPICE check of the expanded October-February grid."""
from __future__ import annotations

import json
import math
import random
import time
from pathlib import Path

import numpy as np
import spiceypy as spice

from generate import ROOT, FRAME, kernels, loaded_coverage, position

DATA_PATH = ROOT / "public/data/ephemeris-2026-10_2027-02.json"
OUT_PATH = Path(__file__).with_name("validation-extended-results.json")
SITES = [(0, 0), (-89.5, 0), (-85, 45), (-89, -135), (45, 179.999), (90, 0)]


def angle(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return float(np.degrees(np.arctan2(np.linalg.norm(np.cross(a, b)), np.dot(a, b))))


def main():
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    records = kernels(ROOT / ".venv/kernels")
    actual_coverage = loaded_coverage(ROOT / ".venv/kernels")
    rows = data["samples"]
    rng = random.Random(20261114)
    max_direction = max_altitude = 0.0
    worst = None
    started = time.perf_counter()
    for _ in range(512):
        segment = rng.randrange(len(rows) - 1)
        a, b = rows[segment], rows[segment + 1]
        f = 0.05 + 0.9 * rng.random()
        et = a["et"] + f * (b["et"] - a["et"])
        phi, lon = math.radians(rng.uniform(-90, 90)), math.radians(rng.uniform(-180, 180))
        site = np.array([math.cos(phi) * math.cos(lon), math.cos(phi) * math.sin(lon), math.sin(phi)]) * data["model"]["referenceRadiusM"]
        for body, key in (("10", "sunM"), ("399", "earthM")):
            approximate = np.asarray(a[key]) + f * (np.asarray(b[key]) - np.asarray(a[key]))
            direct = np.asarray(position(body, et, FRAME))
            for lat, lon_deg in SITES:
                p, l = math.radians(lat), math.radians(lon_deg)
                observer = np.array([math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p)]) * data["model"]["referenceRadiusM"]
                da, dd = approximate - observer, direct - observer
                error = angle(da, dd)
                up = observer / np.linalg.norm(observer)
                alt_error = abs(math.degrees(math.atan2(np.dot(da, up), np.linalg.norm(np.cross(da, up)))) -
                                math.degrees(math.atan2(np.dot(dd, up), np.linalg.norm(np.cross(dd, up)))))
                if error > max_direction:
                    max_direction, max_altitude = error, alt_error
                    worst = {"segment": segment, "et": et, "body": body, "siteLatDeg": lat, "siteLonDeg": lon_deg}
                else:
                    max_altitude = max(max_altitude, alt_error)
    if actual_coverage != data["provenance"]["loadedCoverage"]:
        raise AssertionError("Current loaded CSPICE coverage differs from dataset provenance")
    coverage = actual_coverage["intersectionEt"]
    if not any(lo <= data["coverage"]["startEt"] <= data["coverage"]["endEt"] <= hi for lo, hi in coverage):
        raise AssertionError("Extended dataset exceeds its recorded loaded-kernel intersection")
    import hashlib
    result = {"dataset": DATA_PATH.name, "sha256": hashlib.sha256(DATA_PATH.read_bytes()).hexdigest(),
              "samples": len(rows), "coverageUtc": [data["coverage"]["startUtc"], data["coverage"]["endUtc"]],
              "offGridEpochs": 512, "sitesPerEpoch": len(SITES), "bodiesPerEpoch": 2,
              "comparisons": 512 * len(SITES) * 2, "maxTopocentricDirectionErrorDeg": max_direction,
              "maxAltitudeErrorDeg": max_altitude, "gateDeg": 0.001, "worstCase": worst,
              "kernelSha256": {entry["filename"]: entry["sha256"] for entry in records},
              "verifiedLoadedKernelIntersectionEt": coverage,
              "elapsedSeconds": time.perf_counter() - started,
              "note": "Approximate vectors are linear interpolation of adjacent published JSON positions; expected vectors are fresh direct CSPICE SPKPOS calls at seeded off-grid ET."}
    if max_direction > 0.001 or max_altitude > 0.001:
        raise AssertionError(result)
    OUT_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    finally:
        spice.kclear()
