"""Offline builder for the map's geography assets (run once by hand; NOT part of the server). No weather data.

    python -I dashboard/build_map.py --geonames <cities1000.zip> --admin <admin1CodesASCII.txt>
                                     --imagery <world.topo.bathy.200407.3x21600x10800.jpg> --elevation <etopo_india.nc>

Sources (downloaded once, kept out of the repo):
  places     GeoNames cities1000, CC BY 4.0      https://download.geonames.org/export/dump/
  imagery    NASA Earth Observatory, Blue Marble Next Generation, July 2004 (topography and bathymetry)
  elevation  NOAA NCEI ETOPO 2022, doi:10.25921/fd45-gt74, subset z[(6):2:(38)][(65):2:(101)] as NetCDF
"""
import argparse
import json
import site
import struct
import sys
import zipfile
from pathlib import Path

sys.path.append(site.getusersitepackages())   # -I hides per-user packages: add that one folder back, not the cwd
import numpy as np                            # noqa: E402
from PIL import Image                         # noqa: E402

ASSETS = Path(__file__).resolve().parent / "assets"
LON0, LON1, LAT0, LAT1 = 65, 101, 6, 38
PER_DEGREE = 12                               # elevation samples per degree
SKIP_CODES = {"PPLX", "PPLH", "PPLQ", "PPLW"}  # neighbourhoods and places that no longer exist


def netcdf3(path):
    """Variables of a classic (version 1 or 2) NetCDF file without record dimensions."""
    buf, pos = Path(path).read_bytes(), 4
    if buf[:3] != b"CDF" or buf[3] not in (1, 2):
        raise ValueError("not a classic NetCDF file")
    types = {1: ">i1", 2: "S1", 3: ">i2", 4: ">i4", 5: ">f4", 6: ">f8"}

    def take(fmt):
        nonlocal pos
        value = struct.unpack_from(fmt, buf, pos)[0]
        pos += struct.calcsize(fmt)
        return value

    def name():
        nonlocal pos
        n = take(">I")
        s = buf[pos:pos + n].decode("utf-8")
        pos += (n + 3) // 4 * 4
        return s

    def listed(tag):
        found, n = take(">I"), take(">I")
        if found not in (0, tag) or (found == 0 and n):
            raise ValueError("unexpected NetCDF header")
        return n

    def skip_attributes():
        nonlocal pos
        for _ in range(listed(0x0C)):
            name()
            kind, n = take(">I"), take(">I")
            pos += (n * np.dtype(types[kind]).itemsize + 3) // 4 * 4

    take(">I")                                # number of records
    dims = [(name(), take(">I")) for _ in range(listed(0x0A))]
    skip_attributes()
    out = {}
    for _ in range(listed(0x0B)):
        var = name()
        shape = [dims[take(">I")][1] for _ in range(take(">I"))]
        skip_attributes()
        kind, _size = take(">I"), take(">I")
        begin = take(">I") if buf[3] == 1 else take(">Q")
        out[var] = np.frombuffer(buf, types[kind], int(np.prod(shape)), begin).reshape(shape)
    return out


def elevation(path):
    nc = netcdf3(path)
    lat, lon, z = nc["latitude"], nc["longitude"], nc["z"].astype(np.float32)
    assert abs(lat[0] - LAT0) < 0.05 and abs(lat[-1] - LAT1) < 0.05 and abs(lon[0] - LON0) < 0.05 and abs(lon[-1] - LON1) < 0.05
    z = np.where(z < -20000, 0, z)[::-1]      # north at the top
    size = ((LON1 - LON0) * PER_DEGREE, (LAT1 - LAT0) * PER_DEGREE)
    land = np.asarray(Image.fromarray(z.copy()).resize(size, Image.BOX))
    # square-root coding keeps fine steps on the plains while still reaching 9000 m in one byte
    code = np.round(255 * np.sqrt(np.clip(land, 0, 9000) / 9000)).astype(np.uint8)
    Image.fromarray(code).save(ASSETS / "elevation.png", optimize=True)
    print("elevation.png", code.shape, "highest sample", int(land.max()), "m")


def imagery(path):
    Image.MAX_IMAGE_PIXELS = None             # the global source is 21600 x 10800
    with Image.open(path) as im:
        assert im.size == (21600, 10800), im.size
        px = 60                               # source pixels per degree
        crop = im.crop(((LON0 + 180) * px, (90 - LAT1) * px, (LON1 + 180) * px, (90 - LAT0) * px)).convert("RGB")
    crop.save(ASSETS / "land.jpg", quality=84, optimize=True, progressive=True)
    print("land.jpg", crop.size)


def places(zip_path, admin_path):
    states = {}
    for line in Path(admin_path).read_text(encoding="utf-8").splitlines():
        code, label, ascii_name, *_ = line.split("\t")
        if code.startswith("IN."):
            states[code[3:]] = ascii_name or label
    rows = []
    with zipfile.ZipFile(zip_path) as z:
        for line in z.read("cities1000.txt").decode("utf-8").splitlines():
            f = line.split("\t")
            if f[8] != "IN" or f[6] != "P" or f[7] in SKIP_CODES or f[10] not in states:
                continue
            lat, lon = float(f[4]), float(f[5])
            if LAT0 <= lat <= LAT1 and LON0 <= lon <= LON1:
                rows.append((int(f[14] or 0), f[2].strip(), states[f[10]], round(lat, 3), round(lon, 3)))
    rows.sort(key=lambda r: (-r[0], r[1]))
    kept, seen = [], {}
    for pop, name, state, lat, lon in rows:   # one entry per name within about 10 km
        if any(abs(lat - a) < 0.1 and abs(lon - b) < 0.1 for a, b in seen.get(name, [])):
            continue
        seen.setdefault(name, []).append((lat, lon))
        kept.append((name, state, lat, lon, pop))
    names = sorted({k[1] for k in kept})
    out = {"source": "GeoNames cities1000 (https://www.geonames.org), CC BY 4.0", "states": names,
           "places": [[n, names.index(s), a, b, p] for n, s, a, b, p in kept]}
    (ASSETS / "places.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    by_state = {s: sum(1 for k in kept if k[1] == s) for s in names}
    print("places.json", len(kept), "places in", len(names), "states and territories")
    print(" ", ", ".join(f"{s} {n}" for s, n in sorted(by_state.items(), key=lambda x: -x[1])))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    for flag in ("geonames", "admin", "imagery", "elevation"):
        ap.add_argument(f"--{flag}", required=True)
    a = ap.parse_args()
    elevation(a.elevation)
    imagery(a.imagery)
    places(a.geonames, a.admin)
