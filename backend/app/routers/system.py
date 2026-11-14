"""Liveness, build information and provenance."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlitedb import Connection, text

import derive

from ..config import API_VERSION
from ..db import Database
from ..deps import get_conn, get_db
from ..schemas import HealthResponse, MetaResponse, SourcesResponse
from ..services import data

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse, summary="Is the API up and is the dataset built?")
def health(db: Database = Depends(get_db)):
    if not db.available():
        return {"status": "degraded", "database": "not_built", "dataset_build_id": None, "api_version": API_VERSION}
    return {"status": "ok", "database": "ok", "dataset_build_id": db.build_id(), "api_version": API_VERSION}


@router.get("/meta", response_model=MetaResponse, summary="Build info, coverage, conventions and every quality flag")
def meta(db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    build = db.info()["build"]
    runs = {r["site_id"]: data.coverage_dict(dict(r)) for r in conn.execute(text("SELECT * FROM ephemeris_run")).mappings()}
    sigma = conn.execute(text("SELECT MAX(sigma_deg) FROM analysis")).scalar()
    return {
        "api_version": API_VERSION,
        "sites": sorted(runs),
        "coverage": runs,
        "horizon_models": list(data.HORIZON_MODELS),
        "scenarios": list(derive.SCENARIOS),
        "sigma_deg": sigma,
        "row_counts": json.loads(build["row_counts_json"]),
        "input_files": json.loads(build["input_manifest_json"]),
        "build_notes": build["notes"],
        "meta": data.build_meta(db, all_flags=True,
                                sources=["jpl_horizons", "lola_ldem_80s_80m", "stargazer_cost_model", "clps_public_awards"]),
    }


@router.get("/sources", response_model=SourcesResponse, summary="Where the data comes from")
def sources(db: Database = Depends(get_db)):
    info = db.info()
    return {"sources": sorted(info["sources"].values(), key=lambda s: s["source_id"]),
            "meta": data.build_meta(db, sources=sorted(info["sources"]))}
