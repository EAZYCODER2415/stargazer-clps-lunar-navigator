"""Sites, their skyline and their local terrain."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlitedb import Connection

from ..db import Database
from ..deps import get_conn, get_db
from ..errors import ApiError
from ..schemas import HorizonResponse, SiteResponse, SitesResponse, TerrainTileResponse
from ..services import data

router = APIRouter(tags=["sites"])


@router.get("/sites", response_model=SitesResponse, summary="All landing sites")
def list_sites(db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    sites = [data.site_detail(conn, s) for s in data.list_sites(conn)]
    return {"sites": sites, "meta": data.build_meta(db, site_ids=[s["site_id"] for s in sites],
                                                    sources=["jpl_horizons", "lola_ldem_80s_80m"])}


@router.get("/sites/{site_id}", response_model=SiteResponse, summary="One site: coordinates, ground height, skyline stats, coverage")
def get_site(site_id: str, db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    site = data.site_detail(conn, data.get_site(conn, site_id))
    return {"site": site, "meta": data.build_meta(db, site_ids=[site_id], sources=["jpl_horizons", "lola_ldem_80s_80m"])}


@router.get("/sites/{site_id}/horizon", response_model=HorizonResponse,
            summary="The 360-bin terrain skyline seen from the site")
def get_horizon(site_id: str, format: Literal["rows", "columns"] = Query("rows", description="rows = list of objects; columns = one list per field"),
                db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    data.get_site(conn, site_id)
    profile = data.get_profile(conn, site_id)
    if profile is None:
        raise ApiError(404, "no_horizon_profile", f"No terrain skyline is loaded for site {site_id!r}.")
    bins = data.horizon_bins(conn, profile["profile_id"])
    out = {"site_id": site_id,
           "profile": {k: profile[k] for k in ("mast_m", "ground_height_m", "azimuth_convention", "n_bins", "sigma_deg",
                                               "source_id", "mask_source_file", "notes")},
           "stats": {**data.skyline_stats(bins), "sigma_deg": profile["sigma_deg"]},
           "meta": data.build_meta(db, horizon_model="lola_mask", mask_interpolation="linear_between_bins",
                                   site_ids=[site_id], sources=["lola_ldem_80s_80m"])}
    names = ["azimuth_deg", "skyline_elevation_deg", "blocker_distance_km", "covered_km"]
    if format == "columns":
        out["columns"] = data.to_columns(bins, names)
    else:
        out["bins"] = bins
    return out


@router.get("/sites/{site_id}/terrain-tile", response_model=TerrainTileResponse,
            summary="Local heightmap around the site (metres relative to the site)")
def get_terrain_tile(site_id: str,
                     level: Optional[int] = Query(None, ge=0, description="Tile level, 0 = innermost. Default: the level closest to 10 km x 10 km."),
                     stride: Optional[int] = Query(None, ge=1, le=64, description="Keep every stride-th point per axis. Default: at most 129 points per side."),
                     db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    data.get_site(conn, site_id)
    tile = data.terrain_tile(conn, site_id, level, stride)
    tile["meta"] = data.build_meta(db, site_ids=[site_id], sources=["lola_ldem_80s_80m"])
    return tile
