"""Numerical gate: direct SPICE, independent CSPICE AZ/EL, optional serial Horizons."""
from __future__ import annotations

import argparse
import bisect
import csv
import io
import json
import math
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import spiceypy as spice

sys.dont_write_bytecode = True
from generate import ROOT, FRAME, START, END, kernels, position

SITES = [(0, 0), (0, -180), (-89.5, 0), (-85, 45), (-89, -135), (45, 179.999), (90, 0)]


def angle(a, b) -> float:
    a, b = np.asarray(a), np.asarray(b)
    return float(np.degrees(np.arctan2(np.linalg.norm(np.cross(a, b)), np.dot(a, b))))


def site_position(lat: float, lon: float):
    return spice.latrec(1737400, math.radians(lon), math.radians(lat))


def interpolation(data, et):
    rows = data["samples"]
    i = min(len(rows) - 2, bisect.bisect_right([s["et"] for s in rows], et) - 1)
    a, b = rows[i], rows[i + 1]
    f = (et - a["et"]) / (b["et"] - a["et"])
    return {key: np.asarray(a[key]) * (1 - f) + np.asarray(b[key]) * f for key in ("sunM", "earthM")}


def offline(data, cache: Path, fixtures_path: Path):
    max_angle, max_alt, max_radius, max_utc_seconds = 0., 0., 0., 0.
    worst = {}
    rng = random.Random(20261114)
    # Every interval midpoint + one reproducibly random point per interval.
    epochs = []
    for a, b in zip(data["samples"], data["samples"][1:]):
        epochs.extend([(a["et"] + b["et"]) / 2, a["et"] + rng.random() * (b["et"] - a["et"])])
    fixtures = []
    started = time.perf_counter()
    for index, et in enumerate(epochs):
        approx = interpolation(data, et)
        # UTC tags have microsecond rounding; this explicitly measures bounded time lookup.
        rows = data["samples"]
        i = min(len(rows) - 2, bisect.bisect_right([s["et"] for s in rows], et) - 1)
        a, b = rows[i], rows[i + 1]
        au, bu = [datetime.fromisoformat(s["utc"].replace("Z", "+00:00")).timestamp() for s in (a, b)]
        actual_u = datetime.fromisoformat((spice.et2utc(et, "ISOC", 6) + "Z").replace("Z", "+00:00")).timestamp()
        predicted_et = a["et"] + (actual_u - au) / (bu - au) * (b["et"] - a["et"])
        max_utc_seconds = max(max_utc_seconds, abs(predicted_et - et))
        for body, key, radius_key in [("10", "sunM", "sunRadiusM"), ("399", "earthM", "earthRadiusM")]:
            direct = np.asarray(position(body, et))
            radius = data["model"][radius_key]
            for lat, lon in SITES:
                obs = site_position(lat, lon)
                exact_d, approximate_d = direct - obs, approx[key] - obs
                error = angle(exact_d, approximate_d)
                normal = obs / np.linalg.norm(obs)
                alt_exact = np.degrees(np.arctan2(np.dot(exact_d, normal), np.linalg.norm(np.cross(exact_d, normal))))
                alt_approx = np.degrees(np.arctan2(np.dot(approximate_d, normal), np.linalg.norm(np.cross(approximate_d, normal))))
                radius_error = abs(np.degrees(np.arcsin(radius / np.linalg.norm(exact_d))) - np.degrees(np.arcsin(radius / np.linalg.norm(approximate_d))))
                max_alt = max(max_alt, float(abs(alt_exact - alt_approx)))
                max_radius = max(max_radius, float(radius_error))
                if error > max_angle:
                    max_angle, worst = error, {"et": et, "body": body, "latDeg": lat, "lonDeg": lon}
    # Direct CSPICE AZLCPO uses its own ellipsoid-normal/local-frame machinery.
    fixture_epochs = [spice.str2et(v) for v in [START, "2026-11-14T00:00:00Z", "2026-11-30T12:34:56Z", END]]
    for et in fixture_epochs:
        for lat, lon in SITES:
            obs = site_position(lat, lon)
            fixture = {"et": et, "site": {"latDeg": lat, "lonDeg": lon, "heightAboveReferenceSphereM": 0}, "bodies": {}}
            for body, key in [("10", "sun"), ("399", "earth")]:
                vector = np.asarray(position(body, et)) - obs
                # AZLCPO cannot define local north at an exact pole. Test pole altitude with vector geometry instead.
                if abs(lat) < 90:
                    state, _ = spice.azlcpo("ELLIPSOID", body, et, "NONE", False, True, obs / 1000, "301", FRAME)
                    az, alt = float(np.degrees(state[1]) % 360), float(np.degrees(state[2]))
                else:
                    az = None
                    alt = float(np.degrees(np.arctan2(np.dot(vector, obs / 1737400), np.linalg.norm(np.cross(vector, obs / 1737400)))))
                fixture["bodies"][key] = {"azDeg": az, "altDeg": alt, "direction": (vector / np.linalg.norm(vector)).tolist(), "distanceM": float(np.linalg.norm(vector))}
            fixtures.append(fixture)
    result = {"offGridEpochs": len(epochs), "sitesPerEpoch": len(SITES), "bodiesPerEpoch": 2,
              "maxTopocentricAngularErrorDeg": max_angle, "maxAltitudeErrorDeg": max_alt,
              "maxAngularRadiusErrorDeg": max_radius, "maxUtcToEtErrorSeconds": max_utc_seconds,
              "worstCase": worst, "elapsedSeconds": time.perf_counter() - started,
              "directAzlcpoFixtures": len(fixtures)}
    if max_angle > 0.001 or max_utc_seconds > 0.001:
        raise AssertionError(f"Interpolation/time target failed: {result}")
    fixtures_path.write_text(json.dumps({"offlineResults": result, "observations": fixtures}, indent=2) + "\n", encoding="utf-8")
    return result


def horizons(cache: Path, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    epochs = [spice.str2et(v) for v in [START, "2026-11-14T00:00:00Z", "2026-11-30T12:34:56Z", END]]
    results = []
    for body in ("10", "399"):
        path = output / f"horizons-{body}.json"
        if path.exists():
            saved = json.loads(path.read_text(encoding="utf-8"))
        else:
            params = {"format": "json", "COMMAND": f"'{body}'", "OBJ_DATA": "'NO'", "EPHEM_TYPE": "'VECTORS'",
                      "CENTER": "'500@301'", "REF_PLANE": "'FRAME'", "REF_SYSTEM": "'ICRF'", "TIME_TYPE": "'TDB'",
                      "TLIST_TYPE": "'JD'", "TLIST": " ".join(f"'{spice.unitim(et, 'ET', 'JDTDB'):.12f}'" for et in epochs),
                      "OUT_UNITS": "'KM-S'", "VEC_CORR": "'NONE'", "VEC_TABLE": "'1'", "CSV_FORMAT": "'YES'"}
            url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
            request = urllib.request.Request(url, headers={"User-Agent": "LunarLandingNavigator-ScienceValidation/1.0 (contact: https://github.com/Fizeroo/lunar-landing-navigator)"})
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read()
                payload = json.loads(raw)
                saved = {"url": url, "retrievedUtc": datetime.now(timezone.utc).isoformat(), "httpStatus": response.status, "bytes": len(raw), "payload": payload}
            path.write_text(json.dumps(saved, indent=2) + "\n", encoding="utf-8")
        payload = saved["payload"]
        # Live service returned 1.2 (despite the docs page currently saying 1.3).
        # Its saved result/CSV fields were inspected; reject future unreviewed formats.
        if payload.get("signature", {}).get("version") != "1.2":
            raise ValueError("Unreviewed Horizons API version; inspect saved response")
        text = payload.get("result", "")
        required_headers = [
            rf"Target body name:.*\({body}\).*\{{source: DE441\}}",
            r"Center body name: Moon \(301\).*\{source: DE441\}",
            r"Center-site name:\s+BODY CENTER", r"Output units\s+: KM-S",
            r"Output type\s+: GEOMETRIC cartesian states", r"Reference frame\s+: ICRF",
            r"JDTDB,\s+Calendar Date \(TDB\)", r"\$\$SOE", r"\$\$EOE",
        ]
        if not all(re.search(pattern, text) for pattern in required_headers):
            raise ValueError(f"Horizons did not return expected vectors: {text[:1000]}")
        rows = list(csv.reader(io.StringIO(text.split("$$SOE")[1].split("$$EOE")[0].strip())))
        if len(rows) != len(epochs):
            raise AssertionError("Unexpected Horizons sample count")
        for row in rows:
            jd = float(row[0])
            # Compare at returned JD itself to avoid silently ignoring JD decimal quantization.
            et = spice.unitim(jd, "JDTDB", "ET")
            external = np.array([float(v) for v in row[2:5]]) * 1000
            direct = np.asarray(position(body, et, "J2000"))
            angular = angle(external, direct)
            difference = float(np.linalg.norm(external - direct))
            # Same ME rotation, then independent ENU via CSPICE AZLCPO above.
            rotation = spice.pxform("J2000", FRAME, et)
            topo_errors = [angle(rotation @ external - site_position(lat, lon), rotation @ direct - site_position(lat, lon)) for lat, lon in SITES]
            result = {"body": body, "jdTdb": jd, "et": et, "differenceM": difference, "angularErrorDeg": angular, "maxTopocentricAngularErrorDeg": max(topo_errors)}
            if angular > 0.01 or max(topo_errors) > 0.01:
                raise AssertionError(f"Horizons crosscheck failed: {result}")
            results.append(result)
    return {"samples": results, "maxDifferenceM": max(r["differenceM"] for r in results), "maxAngularErrorDeg": max(r["angularErrorDeg"] for r in results), "modelNote": "SPICE DE440 vs current Horizons service ephemeris (see saved headers); shared JPL family, not independent observations."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--horizons", action="store_true", help="Two serial cached official requests, never per slider")
    parser.add_argument("--cache", type=Path, default=ROOT / ".venv/kernels")
    args = parser.parse_args()
    data = json.loads((ROOT / "public/data/ephemeris-2026-11.json").read_text(encoding="utf-8"))
    try:
        kernels(args.cache)
        results = {"offline": offline(data, args.cache, Path(__file__).with_name("validation-fixtures.json"))}
        if args.horizons:
            results["horizons"] = horizons(args.cache, Path(__file__).with_name("reference"))
        Path(__file__).with_name("validation-results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(results, indent=2))
    finally:
        spice.kclear()
