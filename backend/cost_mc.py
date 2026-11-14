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
      python backend/cost_mc.py <ephemeris.json> <horizon_mask.json>    (with Liam's terrain mask)
The result is written next to the ephemeris file, as <name>_cost.json.

MISSION LENGTH is set by the data file:
  - about one lunar day of data (709 rows): mission = one lunar day.
  - longer data (the default from `python backend/ephemeris_fetch.py`): the first
    lunar day is only used to pick the landing time, and the mission runs for the
    rest (118.2 days of data -> 88.6-day mission = 3 lunar days).
"""
import json, sys
import numpy as np

N_TRIALS = 10_000
LUNAR_DAY_H = 709
rng = np.random.default_rng(42)

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
    return mask[np.floor(az).astype(int) % 360]


def load(path, mask_path=None):
    d = json.load(open(path))
    sun_az = np.array([r["az"] for r in d["sun"]]); sun_el = np.array([r["el"] for r in d["sun"]])
    e_az = np.array([r["az"] for r in d["earth"]]); e_el = np.array([r["el"] for r in d["earth"]])
    mask = np.zeros(360) if mask_path is None else np.array(json.load(open(mask_path)))  # 360 values, deg
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


def run(site, sun_az, sun_el, e_az, e_el, mask):
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


if __name__ == "__main__":
    res = run(*load(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
    out = sys.argv[1].replace(".json", "_cost.json")
    json.dump(res, open(out, "w"), indent=2)
    print(json.dumps({k: v for k, v in res.items() if k not in ("histogram", "assumptions")}, indent=2))
    print(f"-> {out}")
