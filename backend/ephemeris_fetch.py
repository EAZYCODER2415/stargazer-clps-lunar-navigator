"""
Pull hourly Sun + Earth azimuth/elevation for each landing site from JPL Horizons.
Output: one JSON per site in ephemeris_long/ at the top of the repo  (this is the "already-calculated" ephemeris Liam means)
Default: 118.2 days of hourly rows (4 lunar days). The first 709 rows are one lunar day (29.53 days).

Run (from the top of the repo): pip install requests && python backend/ephemeris_fetch.py
No API key needed.

Optional: python backend/ephemeris_fetch.py <days> <output_folder>
  e.g.    python backend/ephemeris_fetch.py 29.53 my_folder   (one lunar day only)
The default output folder and the frontend data files are found from this file's location,
so the script works from any working directory. A folder given on the command line is
relative to where you run it.
"""
import json, os, sys, requests, math
from datetime import datetime, timedelta
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
START = "2026-12-01 00:00"       # change to the scenario start date
DAYS = float(sys.argv[1]) if len(sys.argv) > 1 else 118.2   # default: 4 synodic months (4 lunar days)
REPO_ROOT = Path(__file__).resolve().parent.parent      # this file lives in backend/
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else str(REPO_ROOT / "ephemeris_long")
STEP = "1h"

# Fact-checked 14 Nov 2026 (sources in comments).
# lon = EAST-positive degrees (0-360 ok), lat = degrees (south = negative),
# alt_km = site height above the 1737.4 km reference sphere.
# TODO (Liam/LOLA): fill in real alt_km. 0 = flat sphere, which UNDER-estimates
# Sun/Earth time on these peaks (Malapert and Mons Mouton rise ~5-6 km).
SITES = [
    # Malapert Massif - Artemis III candidate region. Inside LROC's Malapert NAC
    # mosaic bounds (lat -86.33..-85.63, lon -5.66..5.15).
    {"id": "malapert", "name": "Malapert Mountain / Massif", "lon": 2.93, "lat": -85.99, "alt_km": 0.0},
    # Shackleton rim at the Shackleton-de Gerlache ridge junction (LROC NAC mosaic).
    # NOT the crater centre (89.67S 129.78E), which is a 4.2 km-deep shadowed floor.
    {"id": "shackleton", "name": "Shackleton Rim (connecting ridge)", "lon": 196.739, "lat": -89.684, "alt_km": 0.0},
    # Mons Mouton - IM-2 Athena actual touchdown (CLPS, 6 Mar 2025); Artemis III candidate region.
    {"id": "mons-mouton", "name": "Mons Mouton (IM-2 site)", "lon": 29.1957, "lat": -84.7906, "alt_km": 0.0},
]

BODIES = {"sun": "10", "earth": "399"}
FRONTEND_SITE_MANIFEST = REPO_ROOT / "frontend" / "src" / "data" / "landingSites.json"
FRONTEND_EPHEMERIS_DIR = REPO_ROOT / "frontend" / "src" / "data" / "ephemeris"


def calculate_sun_position(time, latitude, longitude):
    """Return the demo Sun azimuth/elevation for a lunar surface observer."""
    del latitude, longitude
    hours = time.hour + time.minute / 60 + time.second / 3600
    start_of_year = datetime(time.year, 1, 1)
    day_of_year = (time - start_of_year).days + 1
    azimuth = (hours / 24) * 360
    annual_offset = 1.5 * math.sin((day_of_year - 80) * 2 * math.pi / 365)
    daily_variation = math.sin(hours * 2 * math.pi / 24)
    return {"azimuth": azimuth, "elevation": annual_offset + daily_variation}


def calculate_earth_position(time, latitude, longitude):
    """Return the demo Earth azimuth/elevation for a lunar surface observer."""
    del longitude
    days = (time - datetime(1970, 1, 1)).total_seconds() / 86400
    month = 27.321661
    azimuth = (days * 360 / month) % 360
    base_elevation = 90 + latitude
    libration = (
        2 * math.sin(days * 2 * math.pi / month)
        + math.sin(days * 2 * math.pi / 29.530588)
    )
    elevation = max(-90, min(90, base_elevation + libration))
    return {"azimuth": azimuth, "elevation": elevation}


def fetch(body_id, site):
    import requests

    stop = datetime.strptime(START, "%Y-%m-%d %H:%M") + timedelta(days=DAYS)
    params = {
        "format": "text",
        "COMMAND": f"'{body_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",          # observer on the Moon
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{site['lon']},{site['lat']},{site['alt_km']}'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{stop:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": f"'{STEP}'",
        "QUANTITIES": "'4'",              # 4 = apparent azimuth & elevation
        "CSV_FORMAT": "'YES'",
    }
    text = requests.get(API, params=params, timeout=60).text
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons error for {site['id']}/{body_id}:\n{text[:800]}")
    rows = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    out = []
    for r in rows:
        p = [x.strip() for x in r.split(",")]
        out.append({"t": p[0], "az": float(p[3]), "el": float(p[4])})
    return out


def write_frontend_site_manifest():
    """Keep the frontend landing-site metadata derived from ``SITES``."""
    manifest = [
        {
            "id": site["id"],
            "name": site["name"],
            "latitude": site["lat"],
            "longitude": site["lon"],
        }
        for site in SITES
    ]
    FRONTEND_SITE_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with FRONTEND_SITE_MANIFEST.open("w", encoding="utf-8") as output:
        json.dump(manifest, output, indent=2)
        output.write("\n")


def calculate_longest_sun_earth_overlap(sun_rows, earth_rows, step_hours):
    """Return the longest contiguous window where both bodies are above the horizon."""
    mission_rows = round(29.53 * 24 / step_hours)
    sun_rows = sun_rows[:mission_rows]
    earth_rows = earth_rows[:mission_rows]
    best_length = 0
    best_start = None
    current_length = 0
    current_start = None

    for sun_row, earth_row in zip(sun_rows, earth_rows):
        if sun_row["el"] > 0 and earth_row["el"] > 0:
            if current_length == 0:
                current_start = sun_row["t"]
            current_length += 1
            if current_length > best_length:
                best_length = current_length
                best_start = current_start
        else:
            current_length = 0
            current_start = None

    return {
        "hours": round(best_length * step_hours, 1),
        "start": best_start,
    }


def main():
    write_frontend_site_manifest()
    os.makedirs(OUT_DIR, exist_ok=True)
    FRONTEND_EPHEMERIS_DIR.mkdir(parents=True, exist_ok=True)
    for site in SITES:
        data = {"site": site, "start": START, "step_h": 1}
        for name, bid in BODIES.items():
            data[name] = fetch(bid, site)
        data["best_overlap"] = calculate_longest_sun_earth_overlap(
            data["sun"], data["earth"], data["step_h"]
        )
        path = f"{OUT_DIR}/{site['id']}.json"
        with open(path, "w") as f:
            json.dump(data, f)
        with (FRONTEND_EPHEMERIS_DIR / f"{site['id']}.json").open("w", encoding="utf-8") as output:
            json.dump(data, output)
        print(f"{path}: {len(data['sun'])} hourly rows")


if __name__ == "__main__":
    main()
