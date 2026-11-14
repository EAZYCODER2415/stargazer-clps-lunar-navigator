"""Side-by-side comparison of sites over one period, under ONE horizon model."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlitedb import Connection

import derive

from ..db import Database
from ..deps import get_conn, get_db, sources_for
from ..errors import ApiError
from ..schemas import CompareResponse, HorizonModel, Scenario
from ..services import data

router = APIRouter(tags=["compare"])


@router.get("/compare", response_model=CompareResponse,
            summary="Per-site visibility summaries, windows and cost percentiles for the same period and horizon")
def compare(sites: Optional[str] = Query(None, description="Comma-separated site ids. Default: every site"),
            start: Optional[str] = Query(None, description="ISO 8601 UTC. Default: start of coverage"),
            days: Optional[float] = Query(None, gt=0, description="Length of the period in days. Default: 29.53 (one lunar day)"),
            lunar_day: Optional[int] = Query(None, ge=0, description="Precomputed period instead of start/days: 1, 2, ... or 0 for the whole coverage"),
            horizon_model: HorizonModel = Query("lola_mask", description="One horizon for the whole payload, cost included"),
            scenario: Scenario = Query("nominal"),
            db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    if lunar_day is not None and (start is not None or days is not None):
        raise ApiError(422, "invalid_range", "Use either 'lunar_day' or 'start'/'days', not both.")
    wanted = [s.strip() for s in sites.split(",") if s.strip()] if sites else [s["site_id"] for s in data.list_sites(conn)]
    if len(set(wanted)) != len(wanted):
        raise ApiError(422, "duplicate_site", "Each site may appear only once in 'sites'.")
    out_sites, cost_ids = [], []
    for site_id in wanted:
        site = data.get_site(conn, site_id)
        run = data.get_run(conn, site_id)
        analysis = data.get_analysis(conn, site_id, horizon_model)
        if lunar_day is not None:
            summary = data.summary_for_lunar_day(conn, analysis, lunar_day, scenario)
            s, e = derive.parse_iso_utc(summary["period"]["start_utc"]), derive.parse_iso_utc(summary["period"]["end_utc"])
        else:
            s, e = data.resolve_period(run, start, days)
            summary = data.summary_for_period(conn, analysis, s, e, scenario)
        windows = {body: data.windows_in_range(conn, analysis, body, scenario, s, e) for body in data.WINDOW_BODIES}
        entry = {"site_id": site_id, "name": site["name"], "latitude_deg": site["latitude_deg"],
                 "longitude_deg_east": site["longitude_deg_east"], "period": summary["period"],
                 "bodies": summary["bodies"], "best_overlap": summary["best_overlap"], "windows": windows,
                 "cost": None, "cost_unavailable_reason": None}
        try:
            cost = data.cost_run(conn, site_id, horizon_model)
            cost_ids.append(cost["cost_run_id"])
            entry["cost"] = {k: cost[k] for k in ("cost_run_id", "horizon_model", "horizon_lookup", "landing_time_utc",
                                                  "mission_days", "p_survive_full_mission", "p_zero_usable_hours", "metrics")}
        except ApiError as error:
            if error.code != "no_cost_run":
                raise
            entry["cost_unavailable_reason"] = (f"No {horizon_model} cost run for this site. A cost run for a different "
                                                f"horizon is never substituted.")
        out_sites.append(entry)
    return {"horizon_model": horizon_model, "scenario": scenario, "sites": out_sites,
            "cost_caveat": data.COST_CAVEAT + " Cost runs cover their own mission period (see landing_time_utc and "
                           "mission_days), not the comparison period.",
            "usable_hour_definition": data.USABLE_HOUR_DEFINITION,
            "meta": data.build_meta(db, horizon_model=horizon_model,
                                    mask_interpolation="linear_between_bins" if horizon_model == "lola_mask" else "not_applicable",
                                    site_ids=wanted, cost_run_ids=cost_ids, sources=sources_for(horizon_model, cost=True))}
