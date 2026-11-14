"""Reproduce the expanded October 2026-February 2027 geometric ephemeris."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import spiceypy as spice

ROOT = Path(__file__).resolve().parents[2]
FRAME = "MOON_ME_DE440_ME421"
START = "2026-10-01T00:00:00Z"
END = "2027-02-01T00:00:00Z"
STEP = 600.0


def kernels(cache: Path) -> list[dict]:
    """TLS verification stays enabled; reject changed/truncated kernels."""
    lock = json.loads((Path(__file__).with_name("kernels.lock.json")).read_text())
    cache.mkdir(parents=True, exist_ok=True)
    records = []
    for entry in lock:
        path = cache / entry["filename"]
        if not path.exists():
            partial = path.with_suffix(path.suffix + ".download")
            try:
                request = urllib.request.Request(entry["url"], headers={"User-Agent": "LunarLandingNavigator-offline/1.0"})
                with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
                    while block := response.read(1024 * 1024):
                        output.write(block)
                check_file(partial, entry)
                partial.replace(path)
            finally:
                partial.unlink(missing_ok=True)
        check_file(path, entry)
        spice.furnsh(str(path))
        records.append(dict(entry))
    return records


def check_file(path: Path, entry: dict) -> None:
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if path.stat().st_size != entry["bytes"] or digest != entry["sha256"]:
        raise ValueError(f"Kernel differs from pinned lock: {path}")


def intervals(window) -> list[list[float]]:
    return [list(spice.wnfetd(window, i)) for i in range(spice.wncard(window))]


def loaded_coverage(cache: Path) -> dict:
    windows = {}
    # Include the EMB->SSB chain as well as the requested target/origin IDs.
    for body in (3, 10, 301, 399):
        windows[f"spk:{body}"] = spice.spkcov(str(cache / "de440s.bsp"), body)
    _, _, class_id = spice.frinfo(spice.namfrm("MOON_PA_DE440"))
    windows[f"pck:{class_id}"] = spice.pckcov(str(cache / "moon_pa_de440_200625.bpc"), class_id)
    common = next(iter(windows.values()))
    for window in list(windows.values())[1:]:
        common = spice.wnintd(common, window)
    return {"byObjectEt": {key: intervals(value) for key, value in windows.items()}, "intersectionEt": intervals(common)}


def utc(et: float) -> str:
    return spice.et2utc(et, "ISOC", 6) + "Z"


def position(body: str, et: float, frame: str = FRAME) -> list[float]:
    return (spice.spkpos(body, et, frame, "NONE", "301")[0] * 1000.0).tolist()


def generate(cache: Path, output: Path) -> dict:
    spice.kclear()
    records = kernels(cache)
    coverage = loaded_coverage(cache)
    start, end = spice.str2et(START), spice.str2et(END)
    if not any(a <= start <= end <= b for a, b in coverage["intersectionEt"]):
        raise ValueError("Requested interval is not covered by the loaded kernel intersection")
    times = [start + i * STEP for i in range(int((end - start) // STEP) + 1)]
    if times[-1] < end:
        times.append(end)
    else:
        times[-1] = end
    samples = [{"utc": utc(et), "et": et, "sunM": position("10", et), "earthM": position("399", et)} for et in times]
    # Preserve the explicitly requested UTC endpoints, not rounded grid labels.
    samples[0]["utc"], samples[-1]["utc"] = START, END
    data = {
        "schemaVersion": "1.0", "id": "de440-me421-geometric-2026-10_2027-02-v1",
        "model": {"frame": FRAME, "originNaifId": 301, "abcorr": "NONE", "units": "m",
                  "referenceRadiusM": 1737400, "sunRadiusM": float(max(spice.bodvrd("SUN", "RADII", 3)[1]) * 1000),
                  "earthRadiusM": float(max(spice.bodvrd("EARTH", "RADII", 3)[1]) * 1000), "horizon": "reference-tangent-h0"},
        "coverage": {"startUtc": START, "endUtc": END, "startEt": start, "endEt": end},
        "provenance": {
            "generator": "scripts/ephemeris/generate.py", "generatorVersion": "1.0.0", "pythonVersion": platform.python_version(),
            "targetNaifIds": {"sun": 10, "earth": 399},
            "spiceypyVersion": spice.__version__, "cspiceVersion": spice.tkvrsn("TOOLKIT"),
            "generatedUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "kernels": records, "loadedCoverage": coverage,
            "timeScale": "TDB", "etEpoch": "J2000", "stepSeconds": STEP,
            "utcPrecisionSeconds": 0.000001,
            "utcAssumption": "Pinned naif0012.tls, last leap entry 2017-01-01. No additional unannounced leap seconds assumed for future UTC.",
            "leapSecondBoundariesUtc": ["1972-07-01T00:00:00Z", "1973-01-01T00:00:00Z", "1974-01-01T00:00:00Z", "1975-01-01T00:00:00Z", "1976-01-01T00:00:00Z", "1977-01-01T00:00:00Z", "1978-01-01T00:00:00Z", "1979-01-01T00:00:00Z", "1980-01-01T00:00:00Z", "1981-07-01T00:00:00Z", "1982-07-01T00:00:00Z", "1983-07-01T00:00:00Z", "1985-07-01T00:00:00Z", "1988-01-01T00:00:00Z", "1990-01-01T00:00:00Z", "1991-01-01T00:00:00Z", "1992-07-01T00:00:00Z", "1993-07-01T00:00:00Z", "1994-07-01T00:00:00Z", "1996-01-01T00:00:00Z", "1997-07-01T00:00:00Z", "1999-01-01T00:00:00Z", "2006-01-01T00:00:00Z", "2009-01-01T00:00:00Z", "2012-07-01T00:00:00Z", "2015-07-01T00:00:00Z", "2017-01-01T00:00:00Z"],
            "bodyShapeModel": "spherical-envelope: max PCK semiaxis",
            "terrainApplied": False, "occultationsApplied": False, "refractionApplied": False,
            "limitations": ["Geometric, not apparent; reference sphere h=0 only.", "No terrain, eclipses, power or radio-link calculation.", "Linear XYZ interpolation; error measured separately in science-validation.md."]
        }, "samples": samples,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "samples": len(samples), "bytes": output.stat().st_size, "coverage": data["coverage"], "loadedCoverage": coverage}, indent=2))
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=ROOT / ".venv" / "kernels")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/ephemeris-2026-10_2027-02.json")
    args = parser.parse_args()
    try:
        generate(args.cache, args.output)
    finally:
        spice.kclear()
