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
  terrain/<site>_horizon.json                  the mask plus details (not committed)
  frontend/src/data/horizon/<site>.json        the mask, for the web app
  frontend/src/data/terrain/<site>.bin + .json nested height tiles for the 3D view: the same
                                               80 m map, cut out around the site at five scales
                                               (out to about 330 km), as 16-bit integers
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
TILE_DIR = ROOT / "frontend" / "src" / "data" / "terrain"

# Nested height tiles for the 3D view, all centred on the site: (half width in metres, points per
# side, sub-samples averaged per axis). The inner two re-sample the 80 m map finely enough that the
# 3D ground matches what the horizon mask was computed from; the outer three are averaged down
# (to 160 m, 640 m and 5.1 km per point). The last one reaches past the edge of the map at 80 S.
TILE_LEVELS = [(640, 129, 1), (5120, 257, 1), (20480, 257, 2), (81920, 257, 8), (327680, 129, 16)]

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


def local_heights(dem, lat_deg, lon_deg, east, north):
    """
    Height of the terrain above the site's own horizontal plane, at points given as metres east and
    north of the site. The Moon's curvature is included, so far ground drops away as it really does
    and a straight line in these coordinates is a straight line of sight.
    """
    ground = float(dem.height(lat_deg, lon_deg))
    distance = np.hypot(east, north)
    bearing = np.degrees(np.arctan2(east, north))
    lat, lon = destination(lat_deg, lon_deg, bearing, distance)
    heights = dem.height(lat, lon)
    floor = np.nanmin(heights) if np.isfinite(heights).any() else 0.0
    heights = np.where(np.isnan(heights), floor, heights)      # off the map (north of 80 S): use the lowest ground seen
    return (MOON_RADIUS_M + heights) * np.cos(distance / MOON_RADIUS_M) - (MOON_RADIUS_M + ground)


def terrain_tiles(dem, lat_deg, lon_deg):
    """Nested square height grids around the site. Rows run south to north, columns west to east."""
    levels = []
    for half_width, cells, sub in TILE_LEVELS:
        spacing = 2 * half_width / (cells - 1)
        offsets = np.linspace(-half_width, half_width, cells)
        east, north = np.meshgrid(offsets, offsets)
        total = np.zeros_like(east)
        shifts = (np.arange(sub) + 0.5) / sub - 0.5             # average over the cell when it is coarser than the map
        for shift_north in shifts:
            for shift_east in shifts:
                total += local_heights(dem, lat_deg, lon_deg, east + shift_east * spacing, north + shift_north * spacing)
        heights = total / (sub * sub)
        scale = next(step for step in (0.125, 0.25, 0.5, 1.0, 2.0, 4.0) if np.abs(heights).max() / step < 32000)
        levels.append({
            "half_width_m": half_width, "cells": cells, "spacing_m": spacing, "scale_m": scale,
            "data": np.round(heights / scale).astype("<i2"),
        })
    return levels


def far_skyline(dem, lat_deg, lon_deg, mast_m, beyond_m):
    """The skyline made only by terrain further away than the 3D tiles reach, and how far away it is."""
    ground = float(dem.height(lat_deg, lon_deg))
    eye_radius = MOON_RADIUS_M + ground + mast_m
    distances = sample_distances(dem.scale)
    arc = distances / MOON_RADIUS_M
    mask = np.empty(360)
    blocker_km = np.empty(360)
    for azimuth in range(360):
        edge = beyond_m / max(abs(np.sin(np.radians(azimuth))), abs(np.cos(np.radians(azimuth))))
        lat, lon = destination(lat_deg, lon_deg, azimuth, distances)
        heights = dem.height(lat, lon)
        usable = ~np.isnan(heights) & (distances > edge)
        terrain_radius = MOON_RADIUS_M + np.where(usable, heights, -1e6)
        angle = np.degrees(np.arctan2(terrain_radius * np.cos(arc) - eye_radius, terrain_radius * np.sin(arc)))
        angle[~usable] = -90.0
        best = int(np.argmax(angle))
        mask[azimuth] = angle[best]
        blocker_km[azimuth] = distances[best] / 1000
    return mask, blocker_km


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
    TILE_DIR.mkdir(parents=True, exist_ok=True)

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
        # The web app's mask keeps two decimals and four keys, exactly as first committed, so that
        # re-running this script never shifts the visibility hours.
        frontend = {"site": site, "source": record["source"], "observer": record["observer"],
                    "mask_deg": np.round(mask, 2).tolist()}
        mask_file = FRONTEND_DIR / f"{site['id']}.json"
        unchanged = mask_file.exists() and json.loads(mask_file.read_text(encoding="utf-8")) == frontend
        if not unchanged:
            mask_file.write_text(json.dumps(frontend), encoding="utf-8")
            print(f"  NOTE: {mask_file.name} changed. Check the visibility hours before committing it.")

        levels = terrain_tiles(dem, site["latitude"], site["longitude"])
        far_mask, far_km = far_skyline(dem, site["latitude"], site["longitude"], args.mast, TILE_LEVELS[-1][0])
        offset = 0
        for level in levels:
            level["offset_bytes"] = offset
            offset += level["data"].nbytes
        (TILE_DIR / f"{site['id']}.bin").write_bytes(b"".join(level.pop("data").tobytes() for level in levels))
        (TILE_DIR / f"{site['id']}.json").write_text(json.dumps({
            "site": site,
            "source": record["source"],
            "observer": record["observer"],
            "note": "Heights are 16-bit little-endian integers in the .bin file; metres = value * scale_m, measured "
                    "from the site's own horizontal plane (the Moon's curvature is included, so far ground drops "
                    "away). Rows run south to north, columns west to east. Every level is cut from the same 80 m "
                    "map: the inner levels re-sample it, the outer levels average it. far_mask_deg is the skyline "
                    "made by terrain beyond the outermost level, and far_blocker_km how far away that terrain is.",
            "levels": levels,
            "far_mask_deg": np.round(far_mask, 2).tolist(),
            "far_blocker_km": np.round(far_km, 1).tolist(),
        }), encoding="utf-8")
        print(
            f"{site['id']}: ground {result['ground_height_m']:+.0f} m | skyline {mask.min():+.2f} to {mask.max():+.2f} deg "
            f"(mean {mask.mean():+.2f}) | highest at azimuth {highest} deg, {result['blocker_km'][highest]:.0f} km away"
        )

    print(f"Wrote {OUT_DIR.name}/, {FRONTEND_DIR.relative_to(ROOT)}/ and {TILE_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
