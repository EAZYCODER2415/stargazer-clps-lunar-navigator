"""
Real terrain horizons from NASA LOLA elevation data.

For each landing site this works out the HORIZON MASK: for every compass
direction (0-359 degrees), how many degrees above or below eye level the real
skyline sits. The Sun (or Earth) is visible only when its elevation is higher
than the mask in its direction. This replaces the flat-horizon assumption.

Data: LOLA gridded elevation model LDEM_80S_80M (80 m per pixel, 80S to the
pole), from the LOLA PDS archive. Label values used here were read from
LDEM_80S_80M.LBL: 7600 x 7600 pixels, 16-bit little-endian integers,
height in metres = value * 0.5 above a 1737.4 km sphere, south polar
stereographic projection, longitude 0 at the top.

Run:  pip install numpy
      python lola_terrain.py            (downloads the 111 MB map on first run)

Options:
      python lola_terrain.py --mast 3   (sensor height above the ground, metres)
      python lola_terrain.py --dem path/to/LDEM_80S_80M.IMG

Outputs, per site:
  terrain/<site>_horizon.json                  the mask plus details
  terrain/<site>_tile.json                     heights of the 10 km x 10 km area around the site
  frontend/src/data/horizon/<site>.json        the mask, for the web app
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
DEM_URL = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.IMG"
DEM_NAME = "LDEM_80S_80M"
DEM_SIZE_BYTES = 7600 * 7600 * 2
CACHE_DIR = ROOT / "lola_cache"
SITES_FILE = ROOT / "frontend" / "src" / "data" / "landingSites.json"
OUT_DIR = ROOT / "terrain"
FRONTEND_DIR = ROOT / "frontend" / "src" / "data" / "horizon"

MOON_RADIUS_M = 1_737_400.0
MAX_RANGE_M = 300_000.0      # far enough to catch any ridge that can reach the skyline


class Dem:
    """A south polar stereographic elevation grid (heights in metres above the reference sphere)."""

    def __init__(self, heights, metres_per_pixel=80.0, centre_pixel=3799.5):
        self.heights = heights
        self.scale = metres_per_pixel
        self.centre = centre_pixel
        self.size = heights.shape[0]

    @classmethod
    def from_img(cls, path):
        raw = np.memmap(path, dtype="<i2", mode="r", shape=(7600, 7600))
        return cls(raw)

    def pixel(self, lat_deg, lon_deg):
        """Fractional (row, col) of a latitude/longitude (east-positive)."""
        radius = 2 * MOON_RADIUS_M * np.tan(np.radians(90.0 + lat_deg) / 2)
        x = radius * np.sin(np.radians(lon_deg))
        y = radius * np.cos(np.radians(lon_deg))
        return self.centre - y / self.scale, self.centre + x / self.scale

    def height(self, lat_deg, lon_deg):
        """Bilinear height in metres. NaN where the point is off the map."""
        row, col = self.pixel(np.asarray(lat_deg, dtype=float), np.asarray(lon_deg, dtype=float))
        inside = (row >= 0) & (row <= self.size - 1) & (col >= 0) & (col <= self.size - 1)
        r0 = np.clip(np.floor(row).astype(int), 0, self.size - 2)
        c0 = np.clip(np.floor(col).astype(int), 0, self.size - 2)
        fr = row - r0
        fc = col - c0
        h = self.heights
        value = (
            h[r0, c0] * (1 - fr) * (1 - fc) + h[r0, c0 + 1] * (1 - fr) * fc
            + h[r0 + 1, c0] * fr * (1 - fc) + h[r0 + 1, c0 + 1] * fr * fc
        ) * 0.5
        return np.where(inside, value, np.nan)


def destination(lat_deg, lon_deg, bearing_deg, distance_m):
    """Point reached by travelling distance_m along a compass bearing on the lunar sphere."""
    lat1 = np.radians(lat_deg)
    bearing = np.radians(bearing_deg)
    arc = distance_m / MOON_RADIUS_M
    lat2 = np.arcsin(np.sin(lat1) * np.cos(arc) + np.cos(lat1) * np.sin(arc) * np.cos(bearing))
    lon2 = np.radians(lon_deg) + np.arctan2(
        np.sin(bearing) * np.sin(arc) * np.cos(lat1),
        np.cos(arc) - np.sin(lat1) * np.sin(lat2),
    )
    return np.degrees(lat2), np.degrees(lon2)


def sample_distances(step_m):
    """Fine steps near the site, coarser far away (far ridges are large)."""
    return np.concatenate([
        np.arange(step_m / 2, 20_000, step_m / 2),
        np.arange(20_000, 100_000, step_m),
        np.arange(100_000, MAX_RANGE_M + 1, step_m * 2),
    ])


def horizon_mask(dem, lat_deg, lon_deg, mast_m=3.0):
    """
    Skyline elevation angle (degrees) for each whole-degree azimuth, 0 = north, 90 = east.
    Negative values mean the skyline is below eye level, which is normal on a peak.
    The Moon's curvature is included: far terrain drops away as it would in reality.
    """
    ground = float(dem.height(lat_deg, lon_deg))
    eye_radius = MOON_RADIUS_M + ground + mast_m
    distances = sample_distances(dem.scale)
    arc = distances / MOON_RADIUS_M

    mask = np.empty(360)
    blocker_km = np.empty(360)
    covered_km = np.empty(360)
    for azimuth in range(360):
        lat, lon = destination(lat_deg, lon_deg, azimuth, distances)
        heights = dem.height(lat, lon)
        on_map = ~np.isnan(heights)
        terrain_radius = MOON_RADIUS_M + np.where(on_map, heights, -1e6)
        angle = np.degrees(np.arctan2(terrain_radius * np.cos(arc) - eye_radius, terrain_radius * np.sin(arc)))
        angle[~on_map] = -90.0
        best = int(np.argmax(angle))
        mask[azimuth] = angle[best]
        blocker_km[azimuth] = distances[best] / 1000
        covered_km[azimuth] = distances[on_map][-1] / 1000 if on_map.any() else 0.0
    return {"ground_height_m": ground, "mask": mask, "blocker_km": blocker_km, "covered_km": covered_km}


def terrain_tile(dem, lat_deg, lon_deg, half_width_m=5_000.0, cells=129):
    """Heights (m, relative to the site) on a local east/north grid around the site."""
    offsets = np.linspace(-half_width_m, half_width_m, cells)
    east, north = np.meshgrid(offsets, offsets)
    distance = np.hypot(east, north)
    bearing = np.degrees(np.arctan2(east, north))
    lat, lon = destination(lat_deg, lon_deg, bearing, distance)
    heights = dem.height(lat, lon) - float(dem.height(lat_deg, lon_deg))
    return {
        "half_width_m": half_width_m,
        "cells": cells,
        "note": "rows run south to north, columns west to east; heights in metres relative to the site",
        "heights_m": np.round(np.nan_to_num(heights), 1).tolist(),
    }


def download_dem(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {DEM_NAME}.IMG (111 MB) from the LOLA PDS archive ...")
    partial = path.with_suffix(".part")

    def progress(blocks, block_size, total):
        done = min(blocks * block_size, total)
        sys.stdout.write(f"\r  {done / 1e6:6.1f} / {total / 1e6:.1f} MB")
        sys.stdout.flush()

    urllib.request.urlretrieve(DEM_URL, partial, progress)
    print()
    if partial.stat().st_size != DEM_SIZE_BYTES:
        raise RuntimeError(f"Download incomplete: got {partial.stat().st_size} bytes, expected {DEM_SIZE_BYTES}.")
    partial.replace(path)


def main():
    parser = argparse.ArgumentParser(description="Horizon masks from LOLA elevation data.")
    parser.add_argument("--dem", type=Path, default=CACHE_DIR / f"{DEM_NAME}.IMG")
    parser.add_argument("--mast", type=float, default=3.0, help="sensor height above the ground in metres")
    args = parser.parse_args()

    if not args.dem.exists():
        download_dem(args.dem)
    if args.dem.stat().st_size != DEM_SIZE_BYTES:
        raise SystemExit(f"{args.dem} is not a complete {DEM_NAME}.IMG. Delete it and run again.")
    dem = Dem.from_img(args.dem)

    sites = json.loads(SITES_FILE.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(exist_ok=True)
    FRONTEND_DIR.mkdir(parents=True, exist_ok=True)

    for site in sites:
        result = horizon_mask(dem, site["latitude"], site["longitude"], args.mast)
        mask = result["mask"]
        highest = int(np.argmax(mask))
        record = {
            "site": site,
            "source": f"NASA LOLA {DEM_NAME} v2.0, 80 m/pixel (LOLA PDS archive)",
            "observer": {"ground_height_m": round(result["ground_height_m"], 1), "mast_m": args.mast},
            "note": "mask_deg[i] is the skyline elevation in degrees at azimuth i (0 = north, 90 = east). "
                    "A body is visible when its elevation is above mask_deg at its azimuth.",
            "mask_deg": np.round(mask, 3).tolist(),
            "blocker_km": np.round(result["blocker_km"], 1).tolist(),
            "covered_km": np.round(result["covered_km"], 0).tolist(),
        }
        (OUT_DIR / f"{site['id']}_horizon.json").write_text(json.dumps(record), encoding="utf-8")
        (OUT_DIR / f"{site['id']}_tile.json").write_text(
            json.dumps({"site": site, "source": record["source"], **terrain_tile(dem, site["latitude"], site["longitude"])}),
            encoding="utf-8",
        )
        frontend = {key: record[key] for key in ("site", "source", "observer", "mask_deg", "blocker_km")}
        (FRONTEND_DIR / f"{site['id']}.json").write_text(json.dumps(frontend), encoding="utf-8")
        print(
            f"{site['id']}: ground {result['ground_height_m']:+.0f} m | skyline {mask.min():+.2f} to {mask.max():+.2f} deg "
            f"(mean {mask.mean():+.2f}) | highest at azimuth {highest} deg, {result['blocker_km'][highest]:.0f} km away"
        )

    print(f"Wrote {OUT_DIR.name}/ and {FRONTEND_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
