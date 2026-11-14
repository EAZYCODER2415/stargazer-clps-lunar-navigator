"""Visibility windows, summaries and the next rise or set."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlitedb import Connection

import derive

from ..db import Database
from ..deps import get_conn, get_db, sources_for
from ..errors import ApiError
from ..schemas import HorizonModel, Scenario, SummaryResponse, TransitionResponse, WindowBody, WindowsResponse
from ..services import data

router = APIRouter(tags=["visibility"])
WINDOW_COLUMNS = ["start_utc", "end_utc", "duration_h", "start_azimuth_deg", "end_azimuth_deg", "peak_elevation_deg",
                  "starts_before_data", "ends_after_data", "overlap_start_utc", "overlap_end_utc", "overlap_duration_h"]


@router.get("/sites/{site_id}/visibility/windows", response_model=WindowsResponse,
            summary="When the Sun, the Earth, or both are above the skyline")
def get_windows(site_id: str,
                body: WindowBody = Query("both", description="sun, earth, or both (Sun AND Earth at the same time)"),
                start: Optional[str] = Query(None, description="ISO 8601 UTC. Default: start of coverage"),
                end: Optional[str] = Query(None, description="ISO 8601 UTC. Default: end of coverage"),
                month: Optional[str] = Query(None, description="Shortcut for one calendar month, e.g. 2027-01 (instead of start/end)"),
                horizon_model: HorizonModel = Query("lola_mask"),
                scenario: Literal["nominal", "optimistic", "pessimistic", "all"] = Query(
                    "nominal", description="Skyline as modelled, lowered by sigma, raised by sigma; 'all' = nominal windows each with an uncertainty block"),
                format: Literal["json", "csv"] = Query("json"),
                db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    data.get_site(conn, site_id)
    run = data.get_run(conn, site_id)
    analysis = data.get_analysis(conn, site_id, horizon_model)
    rng = data.resolve_range(run, start, end, month)
    stored = "nominal" if scenario == "all" else scenario
    windows = data.windows_in_range(conn, analysis, body, stored, rng["start"], rng["end"], with_uncertainty=scenario == "all")
    if format == "csv":
        return Response(data.to_csv(windows, WINDOW_COLUMNS), media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="{site_id}_{body}_windows_{horizon_model}.csv"',
            "X-Horizon-Model": horizon_model})
    return {"site_id": site_id, "body": body, "scenario": scenario,
            "range": {"start_utc": derive.epoch_to_iso(rng["start"]), "end_utc": derive.epoch_to_iso(rng["end"]),
                      "clipped_to_coverage": rng["clipped_to_coverage"]},
            "sigma_deg": analysis["sigma_deg"], "windows": windows,
            "total_overlap_hours": sum(w["overlap_duration_h"] for w in windows),
            "meta": data.build_meta(db, horizon_model=horizon_model, mask_interpolation=analysis["mask_interpolation"],
                                    site_ids=[site_id], sources=sources_for(horizon_model))}


@router.get("/sites/{site_id}/visibility/summary", response_model=SummaryResponse,
            summary="Hours, fraction, longest window and longest gap for Sun, Earth and both")
def get_summary(site_id: str,
                start: Optional[str] = Query(None, description="ISO 8601 UTC. Default: start of coverage"),
                days: Optional[float] = Query(None, gt=0, description="Length of the period in days. Default: 29.53 (one lunar day)"),
                lunar_day: Optional[int] = Query(None, ge=0, description="Precomputed period instead of start/days: 1, 2, ... or 0 for the whole coverage"),
                horizon_model: HorizonModel = Query("lola_mask"),
                scenario: Scenario = Query("nominal"),
                db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    data.get_site(conn, site_id)
    run = data.get_run(conn, site_id)
    analysis = data.get_analysis(conn, site_id, horizon_model)
    if lunar_day is not None:
        if start is not None or days is not None:
            raise ApiError(422, "invalid_range", "Use either 'lunar_day' or 'start'/'days', not both.")
        out = data.summary_for_lunar_day(conn, analysis, lunar_day, scenario)
    else:
        s, e = data.resolve_period(run, start, days)
        out = data.summary_for_period(conn, analysis, s, e, scenario)
    out["site_id"] = site_id
    out["meta"] = data.build_meta(db, horizon_model=horizon_model, mask_interpolation=analysis["mask_interpolation"],
                                  site_ids=[site_id], sources=sources_for(horizon_model))
    return out


@router.get("/sites/{site_id}/visibility/next-transition", response_model=TransitionResponse,
            summary="The next rise or set after a time, with its azimuth")
def get_next_transition(site_id: str,
                        after: str = Query(..., description="ISO 8601 UTC time inside the data coverage"),
                        body: WindowBody = Query("sun"),
                        horizon_model: HorizonModel = Query("lola_mask"),
                        scenario: Scenario = Query("nominal"),
                        db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    data.get_site(conn, site_id)
    run = data.get_run(conn, site_id)
    analysis = data.get_analysis(conn, site_id, horizon_model)
    out = data.transition(conn, run, analysis, body, data.parse_time(after, "after"), scenario)
    out["site_id"] = site_id
    out["meta"] = data.build_meta(db, horizon_model=horizon_model, mask_interpolation=analysis["mask_interpolation"],
                                  site_ids=[site_id], sources=sources_for(horizon_model))
    return out
