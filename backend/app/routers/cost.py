"""Probabilistic cost per usable hour."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlitedb import Connection

from ..db import Database
from ..deps import get_conn, get_db, sources_for
from ..schemas import CostResponse, HorizonModel
from ..services import data

router = APIRouter(tags=["cost"])


@router.get("/sites/{site_id}/cost", response_model=CostResponse,
            summary="Cost per usable hour: p10/p50/p90, histogram, assumptions and their evidence status")
def get_cost(site_id: str,
             horizon_model: HorizonModel = Query("lola_mask", description="Which horizon the cost run used. Never falls back to another one."),
             horizon_lookup: Optional[Literal["linear_between_bins", "nearest_lower_bin", "not_applicable"]] = Query(
                 None, description="Default: the run that reads the mask like the website (linear_between_bins)"),
             db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    data.get_site(conn, site_id)
    out = data.cost_run(conn, site_id, horizon_model, horizon_lookup)
    out["meta"] = data.build_meta(db, horizon_model=horizon_model,
                                  mask_interpolation=out["horizon_lookup"] if horizon_model == "lola_mask" else "not_applicable",
                                  site_ids=[site_id], cost_run_ids=[out["cost_run_id"]], sources=sources_for(horizon_model, cost=True))
    return out
