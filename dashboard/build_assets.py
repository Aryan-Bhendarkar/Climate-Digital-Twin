"""Offline asset builder for the dashboard (run once by hand; NOT part of the server).

Inputs : Natural Earth vector geojson (public domain) + the training NetCDF (for sample input states and climate stats).
Outputs: assets/outlines.json, assets/grid_states.json, assets/heat_p95.json, samples/*.json

    python build_assets.py --ne /tmp/ne --nc /path/to/india_climate_train.nc
"""
import argparse
import json
import os

import numpy as np
import shapely
from shapely.geometry import box, shape

HERE = os.path.dirname(os.path.abspath(__file__))
LAT = np.arange(6.5, 37.6, 1.0)
LON = np.arange(65.5, 100.6, 1.0)
BBOX = box(65.0, 6.0, 101.0, 38.0)
SHORT = {
    "Andaman and Nicobar": "AN", "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR", "Assam": "AS", "Bihar": "BR",
    "Chandigarh": "CH", "Chhattisgarh": "CG", "Dadra and Nagar Haveli and Daman and Diu": "DN", "Delhi": "DL",
    "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR", "Himachal Pradesh": "HP", "Jammu and Kashmir": "JK",
    "Jharkhand": "JH", "Karnataka": "KA", "Kerala": "KL", "Ladakh": "LA", "Lakshadweep": "LD",
    "Madhya Pradesh": "MP", "Maharashtra": "MH", "Manipur": "MN", "Meghalaya": "ML", "Mizoram": "MZ",
    "Nagaland": "NL", "Odisha": "OD", "Puducherry": "PY", "Punjab": "PB", "Rajasthan": "RJ", "Sikkim": "SK",
    "Tamil Nadu": "TN", "Telangana": "TG", "Tripura": "TR", "Uttar Pradesh": "UP", "Uttarakhand": "UK",
    "West Bengal": "WB",
}
NE_SMALL = {"Manipur", "Mizoram", "Nagaland", "Tripura", "Meghalaya", "Sikkim"}
ISLANDS = {"Andaman and Nicobar", "Lakshadweep"}
SAMPLES = [  # (file, name, label, (y, m, d))
    ("onset", "Monsoon onset", "28 May 2020", (2020, 5, 28)),
    ("heavy_rain", "Heavy rain", "17 Jul 2021", (2021, 7, 17)),
    ("heatwave", "Heatwave", "6 Jun 2019", (2019, 6, 6)),
    ("cyclone", "Cyclone Amphan", "15 May 2020", (2020, 5, 15)),
    ("western_disturbance", "Western disturbance", "9 Jan 2020", (2020, 1, 9)),
]


def rings_of(geom, tol):
    geom = geom.intersection(BBOX)
    if geom.is_empty:
        return []
    geom = geom.simplify(tol, preserve_topology=True)
    polys = [geom] if geom.geom_type == "Polygon" else [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon"]
    out = []
    for p in polys:
        for r in [p.exterior] + list(p.interiors):
            c = np.round(np.asarray(r.coords), 2)
            if len(c) >= 4:
                out.append(c.reshape(-1).tolist())
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ne", default="/tmp/ne")
    ap.add_argument("--nc", default="/mnt/user-data/uploads/Devforge/data/india_climate_train.nc")
    a = ap.parse_args()
    adm1 = json.load(open(os.path.join(a.ne, "ne_10m_admin_1_states_provinces.geojson")))
    adm0 = json.load(open(os.path.join(a.ne, "ne_10m_admin_0_countries_ind.geojson")))
    states = [f for f in adm1["features"] if f["properties"].get("admin") == "India"]

    # ---- rasterise to the grid (5x5 sub-samples per cell) ----
    sub = (np.arange(5) + 0.5) / 5 - 0.5
    cells, geoms = {}, {}
    for f in states:
        nm = f["properties"]["name"]
        g = shape(f["geometry"])
        geoms[nm] = g
        frac = np.zeros((32, 36))
        for i, la in enumerate(LAT):
            for j, lo in enumerate(LON):
                if not g.intersects(box(lo - .5, la - .5, lo + .5, la + .5)):
                    continue
                yy, xx = np.meshgrid(la + sub, lo + sub, indexing="ij")
                frac[i, j] = shapely.contains_xy(g, xx.ravel(), yy.ravel()).mean()
        cells[nm] = frac
    # ---- grouping of tiny states (< 3 cells of coverage) ----
    group = {}
    for nm, fr in cells.items():
        if nm in ISLANDS:
            group[nm] = ("ISL", "Islands (A&N, Lakshadweep)")
        elif fr.sum() < 3.0:
            group[nm] = ("NE", "NE small states") if nm in NE_SMALL else ("UT", "Small UTs (DL, CH, GA, PY, DNHDD)")
        else:
            group[nm] = (SHORT[nm], nm)
    merged = {}
    for nm, (gid, gname) in group.items():
        m = merged.setdefault(gid, {"name": gname, "frac": np.zeros((32, 36)), "members": []})
        m["frac"] = np.clip(m["frac"] + cells[nm], 0, 1)
        m["members"].append(SHORT[nm])
    order = sorted(merged, key=lambda k: -merged[k]["frac"].sum())
    gs = {"order": order, "meta": {}, "cells": {}}
    for gid in order:
        m = merged[gid]
        idx = np.argwhere(m["frac"] >= 0.05)
        gs["meta"][gid] = {"name": m["name"], "members": m["members"], "ncells": round(float(m["frac"].sum()), 2)}
        gs["cells"][gid] = [[int(i * 36 + j), round(float(m["frac"][i, j]), 2)] for i, j in idx]
    json.dump(gs, open(os.path.join(HERE, "assets/grid_states.json"), "w"), separators=(",", ":"))

    # ---- outlines ----
    out = {"states": [], "countries": [], "source": "Natural Earth (public domain), simplified; boundaries indicative"}
    for f in states:
        nm = f["properties"]["name"]
        r = rings_of(geoms[nm], 0.03)
        if r:
            out["states"].append({"id": group[nm][0], "name": nm, "rings": r})
    for f in adm0["features"]:
        g = shape(f["geometry"])
        if g.intersects(BBOX):
            r = rings_of(g, 0.04)
            if r:
                out["countries"].append({"name": f["properties"].get("NAME", ""), "rings": r})
    json.dump(out, open(os.path.join(HERE, "assets/outlines.json"), "w"), separators=(",", ":"))

    # ---- climate stats + samples from the NetCDF ----
    import xarray as xr
    ds = xr.open_dataset(a.nc)
    t = ds.time.values
    data = ds["data"]
    train = (ds.time.dt.year >= 2005) & (ds.time.dt.year <= 2018)
    t2 = data.sel(channel="t2m").values[train.values].astype(np.float64)
    months = ds.time.dt.month.values[train.values]
    cosw = np.cos(np.deg2rad(LAT))[:, None]
    heat = {}
    for gid in order:
        w = np.zeros(32 * 36)
        for k, fr in gs["cells"][gid]:
            w[k] = fr
        w = (w.reshape(32, 36) * cosw)
        series = (t2 * w).sum(axis=(1, 2)) / w.sum()
        heat[gid] = [round(float(np.percentile(series[months == m], 95)), 2) for m in range(1, 13)]
    tp = data.sel(channel="tp").values[train.values].astype(np.float64)
    rain = {}
    for gid in order:
        w = np.zeros(32 * 36)
        for k, fr in gs["cells"][gid]:
            w[k] = fr
        w = (w.reshape(32, 36) * cosw)
        series = (tp * w).sum(axis=(1, 2)) / w.sum()
        rain[gid] = [round(float(series[months == m].mean()), 2) for m in range(1, 13)]
    json.dump({"note": "per-state mean of daily area-mean rain (mm/day) by calendar month, training years 2005-2018; climate statistic",
               "mean_daily": rain}, open(os.path.join(HERE, "assets/rain_clim.json"), "w"), separators=(",", ":"))
    json.dump({"note": "per-state P95 of daily-mean t2m (K) by calendar month, training years 2005-2018; geography/climate statistic",
               "p95": heat}, open(os.path.join(HERE, "assets/heat_p95.json"), "w"), separators=(",", ":"))

    names = []
    for fn, nm, label, (y, mo, d) in SAMPLES:
        day = np.datetime64(f"{y}-{mo:02d}-{d:02d}")
        k = int(np.where(t == day)[0][0])
        arr = np.round(data.isel(time=slice(k - 2, k + 1)).values.astype(np.float64), 2)
        doy = int((day - np.datetime64(f"{y}-01-01")).astype(int)) + 1
        ang = 2 * np.pi * doy / 365.0
        js = {"name": nm, "date_label": label, "doy_sincos": [round(float(np.sin(ang)), 6), round(float(np.cos(ang)), 6)],
              "init_states": arr.tolist()}
        json.dump(js, open(os.path.join(HERE, "samples", fn + ".json"), "w"), separators=(",", ":"))
        names.append({"file": fn + ".json", "name": nm, "date_label": label})
    json.dump(names, open(os.path.join(HERE, "samples/index.json"), "w"), separators=(",", ":"))
    print("done", order)


if __name__ == "__main__":
    main()
