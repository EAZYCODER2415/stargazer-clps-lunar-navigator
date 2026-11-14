"""
Pull hourly Sun + Earth azimuth/elevation for each landing site from JPL Horizons.
Output: one JSON per site in ./ephemeris_long/  (this is the "already-calculated" ephemeris Liam means)
Default: 118.2 days of hourly rows (4 lunar days). The first 709 rows are one lunar day (29.53 days).

Run:  pip install requests  &&  python ephemeris_fetch.py
No API key needed.

Optional: python ephemeris_fetch.py <days> <output_folder>
  e.g.    python ephemeris_fetch.py 29.53 my_folder   (one lunar day only)
"""
import json, os, sys, requests
from datetime import datetime, timedelta

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
START = "2026-12-01 00:00"       # change to the scenario start date
DAYS = float(sys.argv[1]) if len(sys.argv) > 1 else 118.2   # default: 4 synodic months (4 lunar days)
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else "ephemeris_long"
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


def fetch(body_id, site):
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


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for site in SITES:
        data = {"site": site, "start": START, "step_h": 1}
        for name, bid in BODIES.items():
            data[name] = fetch(bid, site)
        path = f"{OUT_DIR}/{site['id']}.json"
        with open(path, "w") as f:
            json.dump(data, f)
        print(f"{path}: {len(data['sun'])} hourly rows")


if __name__ == "__main__":
    main()
