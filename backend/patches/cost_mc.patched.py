"""
Stargazer cost model: Monte Carlo "financial burn ratio" per landing site.

  burn ratio B = total mission cost / usable operating hours   ($M per usable hour)
  usable hour  = an hour where the Sun AND Earth are above the terrain horizon
                 (power + direct-to-Earth comms), counted only while the lander is alive

Each trial samples the uncertain inputs (ASSUMPTIONS below), recomputes the
windows, and records B. The output is a distribution (P10/P50/P90 + histogram),
not a single number.

Run (from the top of the repo):
      pip install numpy
      python backend/cost_mc.py ephemeris_long/malapert.json
          uses the site's LOLA skyline (frontend/src/data/horizon/<site>.json) when that file exists
      python backend/cost_mc.py ephemeris_long/malapert.json --mask <horizon.json>
          a specific mask: lola_terrain.py's JSON (a dict with "mask_deg") or a bare list of 360 numbers
      python backend/cost_mc.py ephemeris_long/malapert.json --flat
          flat 0-degree horizon (the original default; ignores terrain)
Options: --seed N (default 42), --lookup linear_between_bins | nearest_lower_bin
The result is written next to the ephemeris file, named after the horizon it used so the two
cannot be mixed up: <name>_cost_lola_mask.json or <name>_cost_flat.json.
Every output records horizon_model, horizon_lookup and seed.

MISSION LENGTH is set by the data file:
  - about one lunar day of data (709 rows): mission = one lunar day.
  - longer data (the default from `python backend/ephemeris_fetch.py`): the first
    lunar day is only used to pick the landing time, and the mission runs for the
    rest (118.2 days of data -> 88.6-day mission = 3 lunar days).
"""
import argparse, json, sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))    # so `derive` is found from any working directory
from derive import skyline_at, MASK_LINEAR, MASK_FLOOR      # one mask-lookup rule for the website, database and cost model

N_TRIALS = 10_000
LUNAR_DAY_H = 709
DEFAULT_SEED = 42
rng = np.random.default_rng(DEFAULT_SEED)
# How the skyline is read between whole-degree bins. linear_between_bins matches the website.
# nearest_lower_bin (floor of the azimuth) is what this script did originally; keep it for reproducing old runs.
HORIZON_LOOKUP = MASK_LINEAR
REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------- ASSUMPTIONS (show these on screen) ----------------
# Delivery price, $M. Triangular(min, mode, max) anchored on real CLPS task orders:
#   Peregrine $79.5M (2019), CP-22 $116.9M (2024), IM-5 $180.4M (2026)
DELIVERY_M = (79.5, 116.9, 180.4)
# Cost growth on top of the award (program average reported ~26%)
COST_GROWTH = (0.0, 0.26, 0.60)
# Surface ops cost, $M per hour alive. None = not modelled separately: a CLPS task order is a
# fixed-price end-to-end delivery service, so operations are already inside DELIVERY_M.
# To test a separate ops cost, set a (min, mode, max) tuple, e.g. (0.005, 0.015, 0.030).
OPS_M_PER_H = None
# Battery endurance, hours the lander keeps working with the Sun down. From flown CLPS landers:
#   Blue Ghost M1 ran ~5 h into lunar night (Mar 2025); IM-1 Odysseus was given 10-20 h of
#   battery life near the end of its mission (Feb 2024). Neither was built to survive the night.
BATTERY_H = (5, 10, 20)
# Horizon uncertainty, degrees (terrain model + mast height error), Normal(0, sd)
HORIZON_SD_DEG = 0.3
# --------------------------------------------------------------------


def horizon_at(mask, az):
    return skyline_at(mask, az, HORIZON_LOOKUP)


def read_mask(mask_path):
    """360 skyline angles in degrees. Accepts lola_terrain.py's horizon JSON (a dict with "mask_deg") or a bare list."""
    data = json.load(open(mask_path))
    values = data["mask_deg"] if isinstance(data, dict) else data
    if len(values) != 360:
        raise SystemExit(f"{mask_path}: expected 360 skyline values, found {len(values)}")
    return np.array(values, dtype=float)


def load(path, mask_path=None):
    d = json.load(open(path))
    sun_az = np.array([r["az"] for r in d["sun"]]); sun_el = np.array([r["el"] for r in d["sun"]])
    e_az = np.array([r["az"] for r in d["earth"]]); e_el = np.array([r["el"] for r in d["earth"]])
    mask = np.zeros(360) if mask_path is None else read_mask(mask_path)  # 360 values, deg
    n = len(sun_el)
    up = sun_el > horizon_at(mask, sun_az)

    # LANDING TIME: real CLPS landers touch down near local sunrise to get a full day of power.
    # Land at the start of the longest sunlit stretch that begins in the first lunar day.
    long_data = n >= 2 * LUNAR_DAY_H
    scan = up if long_data else np.concatenate([up, up])     # short data: wrap (Sun cycle repeats monthly)
    window = LUNAR_DAY_H if long_data else n
    best_len, best_start, run_len = 0, 0, 0
    for i, u in enumerate(scan):
        run_len = run_len + 1 if u else 0
        start = i - run_len + 1
        if u and start < window and run_len > best_len:
            best_len, best_start = run_len, start

    if long_data:
        mission_h = n - LUNAR_DAY_H
        cut = lambda a: a[best_start:best_start + mission_h]
    else:
        mission_h = n
        cut = lambda a: np.roll(a, -best_start)
    site = dict(d["site"], landing_time=d["sun"][best_start]["t"], mission_days=round(mission_h / 24, 1))
    return site, cut(sun_az), cut(sun_el), cut(e_az), cut(e_el), mask


def survival_hours(sun_up, battery_h):
    """Lander dies at the first dark stretch longer than its battery endurance."""
    idx = np.arange(len(sun_up))
    if not sun_up.any():
        return 0
    # The landing time was picked for the nominal horizon. If this trial's horizon makes sunrise a
    # few hours later, the lander simply lands then: darkness before first light doesn't drain it.
    first = int(np.argmax(sun_up))
    lit = sun_up.copy(); lit[:first] = True
    last_up = np.maximum.accumulate(np.where(lit, idx, -1))
    dead = (idx - last_up) > battery_h          # hours of continuous darkness so far > endurance
    return int(np.argmax(dead)) if dead.any() else len(sun_up)


def run(site, sun_az, sun_el, e_az, e_el, mask, seed=None):
    """seed=None keeps drawing from the module-level generator (original behaviour). Pass a seed to
    restart the generator, so a run inside another program matches a command-line run."""
    global rng
    if seed is not None:
        rng = np.random.default_rng(seed)
    tri = lambda p: rng.triangular(*p, N_TRIALS)
    delivery = tri(DELIVERY_M) * (1 + tri(COST_GROWTH))
    ops = tri(OPS_M_PER_H) if OPS_M_PER_H else np.zeros(N_TRIALS)
    battery = tri(BATTERY_H)
    dh = rng.normal(0, HORIZON_SD_DEG, N_TRIALS)

    sun_h, e_h = horizon_at(mask, sun_az), horizon_at(mask, e_az)
    n = len(sun_el)
    burn, usable, alive_h = np.empty(N_TRIALS), np.empty(N_TRIALS), np.empty(N_TRIALS)
    for k in range(N_TRIALS):
        sun_up = sun_el > sun_h + dh[k]
        earth_up = e_el > e_h + dh[k]
        alive = survival_hours(sun_up, battery[k])
        u = int(np.sum((sun_up & earth_up)[:alive]))
        usable[k], alive_h[k] = u, alive
        burn[k] = (delivery[k] + ops[k] * alive) / u if u > 0 else np.inf

    finite = burn[np.isfinite(burn)]
    pct = lambda a: [float(x) for x in np.percentile(a, [10, 50, 90])]
    b10, b50, b90 = pct(finite)
    counts, edges = np.histogram(finite, bins=40)
    u10, u50, u90 = pct(usable); a10, a50, a90 = pct(alive_h)
    return {
        "site": site["name"],
        "landing_time_utc": site["landing_time"],
        "mission_days": site["mission_days"],
        "trials": N_TRIALS,
        "burn_M_per_usable_h": {"p10": round(b10, 3), "p50": round(b50, 3), "p90": round(b90, 3)},
        "usable_h": {"p10": int(u10), "p50": int(u50), "p90": int(u90)},
        "alive_days": {"p10": round(a10 / 24, 1), "p50": round(a50 / 24, 1), "p90": round(a90 / 24, 1)},
        "p_survive_full_mission": round(float(np.mean(alive_h >= n)), 3),
        "p_zero_usable_hours": round(float(np.mean(~np.isfinite(burn))), 3),
        "histogram": {"bin_edges": edges.round(4).tolist(), "counts": counts.tolist()},  # frontend plots this
        "assumptions": {"delivery_M": DELIVERY_M, "cost_growth": COST_GROWTH, "ops_M_per_h": OPS_M_PER_H,
                        "battery_h": BATTERY_H, "horizon_sd_deg": HORIZON_SD_DEG},
    }


def main(argv=None):
    global HORIZON_LOOKUP
    parser = argparse.ArgumentParser(description="Monte Carlo cost per usable hour for one landing site.")
    parser.add_argument("ephemeris", help="ephemeris_long/<site>.json")
    parser.add_argument("mask_file", nargs="?", help="horizon mask file (old positional form; same as --mask)")
    parser.add_argument("--mask", help="horizon mask file: lola_terrain.py JSON or a bare list of 360 numbers")
    parser.add_argument("--flat", action="store_true", help="flat 0-degree horizon (ignores terrain)")
    parser.add_argument("--lookup", choices=[MASK_LINEAR, MASK_FLOOR], default=MASK_LINEAR,
                        help="how the skyline is read between whole-degree bins")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args(argv)

    mask_path = args.mask or args.mask_file
    if args.flat and mask_path:
        parser.error("--flat and a mask file cannot be used together")
    if not args.flat and not mask_path:
        # Default to the site's real skyline whenever it exists, so a cost run matches the website.
        candidate = REPO_ROOT / "frontend" / "src" / "data" / "horizon" / (Path(args.ephemeris).stem + ".json")
        if candidate.exists():
            mask_path = str(candidate)
        else:
            print(f"NOTE: no horizon file at {candidate}. Using a flat horizon, which ignores terrain.")
    horizon_model = "lola_mask" if mask_path else "flat"
    HORIZON_LOOKUP = args.lookup

    res = run(*load(args.ephemeris, mask_path), seed=args.seed)
    res["horizon_model"] = horizon_model
    res["horizon_lookup"] = args.lookup if mask_path else "not_applicable"
    res["seed"] = args.seed
    suffix = f"_cost_{horizon_model}" + ("_nearest_lower_bin" if mask_path and args.lookup == MASK_FLOOR else "")
    out = args.ephemeris.replace(".json", suffix + ".json")
    json.dump(res, open(out, "w"), indent=2)
    print(json.dumps({k: v for k, v in res.items() if k not in ("histogram", "assumptions")}, indent=2))
    print(f"-> {out}")


if __name__ == "__main__":
    main()
