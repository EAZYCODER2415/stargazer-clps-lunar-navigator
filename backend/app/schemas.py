"""Response models. These define the contract exported to backend/openapi.json."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

HorizonModel = Literal["lola_mask", "flat"]
Body = Literal["sun", "earth"]
WindowBody = Literal["sun", "earth", "both"]
Scenario = Literal["nominal", "optimistic", "pessimistic"]


class QualityFlag(BaseModel):
    code: str
    severity: Literal["info", "warning", "blocker"]
    scope: str = Field(description="'dataset', 'site:<id>' or 'cost_run:<id>'")
    message: str
    fix_order: Optional[str] = None


class SourceRef(BaseModel):
    source_id: str
    name: str
    version: Optional[str] = None
    url: Optional[str] = None


class Meta(BaseModel):
    dataset_build_id: str
    schema_version: str
    built_at_utc: str
    time_scale: str = "UTC"
    conventions: dict[str, Any]
    horizon_model: Optional[str] = Field(None, description="Horizon used for every value in this response, when one applies")
    mask_interpolation: Optional[str] = None
    sources: list[SourceRef]
    quality_flags: list[QualityFlag]
    caveat: str


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody


class Coverage(BaseModel):
    start_utc: str
    end_utc: str
    step_seconds: int
    n_samples: int


class Page(BaseModel):
    returned: int
    total: int
    limit: int
    offset: int
    next_offset: Optional[int] = Field(None, description="Pass as 'offset' to get the next page; null on the last page")


class HealthResponse(BaseModel):
    status: str
    database: str
    dataset_build_id: Optional[str] = None
    api_version: str


class MetaResponse(BaseModel):
    api_version: str
    sites: list[str]
    coverage: dict[str, Coverage]
    horizon_models: list[str]
    scenarios: list[str]
    sigma_deg: Optional[float] = None
    row_counts: dict[str, int]
    input_files: dict[str, str] = Field(description="Input file name -> SHA-256")
    build_notes: Optional[str] = None
    meta: Meta


class Source(BaseModel):
    source_id: str
    name: str
    version: Optional[str] = None
    url: Optional[str] = None
    retrieved_utc: Optional[str] = None
    license_note: Optional[str] = None
    description: Optional[str] = None


class SourcesResponse(BaseModel):
    sources: list[Source]
    meta: Meta


class Site(BaseModel):
    site_id: str
    name: str
    latitude_deg: float
    longitude_deg_east: float
    ground_height_m: Optional[float] = None
    observer_mast_m: Optional[float] = None
    region_note: Optional[str] = None
    mission_context: Optional[str] = None
    coordinate_source: Optional[str] = None
    coordinate_status: str


class SkylineStats(BaseModel):
    min_deg: float
    max_deg: float
    mean_deg: float
    azimuth_of_max_deg: int
    blocker_distance_at_max_km: Optional[float] = None
    sigma_deg: Optional[float] = None


class CostRunRef(BaseModel):
    horizon_model: str
    horizon_lookup: str
    is_default: bool


class SiteDetail(Site):
    coverage: Coverage
    observer_alt_km_used: float
    skyline: Optional[SkylineStats] = None
    horizon_models: list[str]
    cost_runs: list[CostRunRef]
    terrain_tile_levels: int


class SitesResponse(BaseModel):
    sites: list[SiteDetail]
    meta: Meta


class SiteResponse(BaseModel):
    site: SiteDetail
    meta: Meta


class HorizonProfile(BaseModel):
    mast_m: float
    ground_height_m: Optional[float] = None
    azimuth_convention: str
    n_bins: int
    sigma_deg: Optional[float] = None
    source_id: str
    mask_source_file: Optional[str] = None
    notes: Optional[str] = None


class HorizonResponse(BaseModel):
    site_id: str
    profile: HorizonProfile
    stats: SkylineStats
    bins: Optional[list[dict[str, Any]]] = Field(None, description="format=rows: one object per azimuth degree")
    columns: Optional[dict[str, list[Any]]] = Field(None, description="format=columns: one list per field")
    meta: Meta


class TileLevel(BaseModel):
    level_index: int
    half_width_m: float
    n_cells: int
    spacing_m: float
    scale_m: float


class TerrainTileResponse(BaseModel):
    site_id: str
    level_index: int
    half_width_m: float
    n_cells_stored: int
    stride: int
    n_cells: int = Field(description="Points per side in this response, after applying stride")
    spacing_m: float
    source_id: str
    layout_note: str
    levels_available: list[TileLevel]
    heights_m: list[list[float]]
    meta: Meta


class EphemerisResponse(BaseModel):
    site_id: str
    body: str
    step_hours: int
    range: dict[str, Any]
    rows: Optional[list[dict[str, Any]]] = None
    columns: Optional[dict[str, list[Any]]] = None
    page: Page
    meta: Meta


class ScenarioPosition(BaseModel):
    skyline_elevation_deg: float
    clearance_deg: float
    is_visible: bool


class PositionResponse(BaseModel):
    site_id: str
    body: str
    at_utc: str
    azimuth_deg: float
    elevation_deg: float
    skyline_elevation_deg: float
    clearance_deg: float
    is_visible: bool
    interpolated: bool
    sample_before_utc: str
    sample_after_utc: str
    sigma_deg: float
    scenarios: dict[str, ScenarioPosition]
    meta: Meta


class WindowUncertainty(BaseModel):
    earliest_start_utc: Optional[str] = None
    latest_start_utc: Optional[str] = None
    earliest_end_utc: Optional[str] = None
    latest_end_utc: Optional[str] = None
    min_duration_h: Optional[float] = None
    max_duration_h: Optional[float] = None
    note: Optional[str] = None


class WindowItem(BaseModel):
    start_utc: str
    end_utc: str
    duration_h: float
    start_azimuth_deg: Optional[float] = None
    end_azimuth_deg: Optional[float] = None
    peak_elevation_deg: Optional[float] = None
    starts_before_data: bool
    ends_after_data: bool
    overlap_start_utc: str = Field(description="Start of the part of this window inside the requested range")
    overlap_end_utc: str
    overlap_duration_h: float
    uncertainty: Optional[WindowUncertainty] = None


class RangeInfo(BaseModel):
    start_utc: str
    end_utc: str
    clipped_to_coverage: bool = False


class WindowsResponse(BaseModel):
    site_id: str
    body: str
    scenario: str
    range: RangeInfo
    sigma_deg: float
    windows: list[WindowItem]
    total_overlap_hours: float
    meta: Meta


class BodySummary(BaseModel):
    visible_hours: float
    visible_fraction: float
    n_windows: int
    longest_window_h: float
    longest_window_start_utc: Optional[str] = None
    longest_window_end_utc: Optional[str] = None
    longest_gap_h: float = Field(description="Longest stretch with the body not visible; for the Sun, the longest darkness")


class Period(BaseModel):
    start_utc: str
    end_utc: str
    hours: float
    lunar_day_index: Optional[int] = None


class BestOverlap(BaseModel):
    start_utc: Optional[str] = None
    end_utc: Optional[str] = None
    duration_h: float
    duration_h_optimistic: float
    duration_h_pessimistic: float
    horizon_model: str
    note: str


class SummaryResponse(BaseModel):
    site_id: str
    period: Period
    scenario: str
    bodies: dict[str, BodySummary]
    best_overlap: BestOverlap
    meta: Meta


class TransitionResponse(BaseModel):
    site_id: str
    body: str
    after_utc: str
    scenario: str
    currently_visible: bool
    event: Optional[Literal["rise", "set"]] = None
    time_utc: Optional[str] = None
    hours_until: Optional[float] = None
    azimuth_deg: Optional[float] = None
    note: Optional[str] = None
    meta: Meta


class Percentiles(BaseModel):
    unit: str
    p10: float
    p50: float
    p90: float
    mean: Optional[float] = None


class HistogramBin(BaseModel):
    bin_lo: float
    bin_hi: float
    trial_count: int


class Histogram(BaseModel):
    metric: str
    unit: str
    bins: list[HistogramBin]
    note: str


class CostModelInfo(BaseModel):
    name: str
    n_trials: int
    n_finite_trials: Optional[int] = None
    rng_seed: Optional[int] = None
    script_sha256: Optional[str] = None
    source_file: Optional[str] = None
    notes: Optional[str] = None


class CostAssumption(BaseModel):
    name: str
    description: Optional[str] = None
    distribution: str
    param_min: Optional[float] = None
    param_mode: Optional[float] = None
    param_max: Optional[float] = None
    param_mean: Optional[float] = None
    param_sd: Optional[float] = None
    unit: Optional[str] = None
    source_note: Optional[str] = None
    evidence_status: str


class CostAnchor(BaseModel):
    anchor: str
    award_musd: float
    award_year: Optional[int] = None
    source_url: Optional[str] = None
    verified_by: Optional[str] = None
    verified_on: Optional[str] = None
    evidence_status: str


class CostBlock(BaseModel):
    cost_run_id: int
    site_id: str
    horizon_model: str
    horizon_lookup: str
    is_default: bool
    model: CostModelInfo
    landing_time_utc: str
    mission_days: float
    p_survive_full_mission: Optional[float] = None
    p_zero_usable_hours: Optional[float] = None
    metrics: dict[str, Percentiles]
    histogram: Histogram
    assumptions: list[CostAssumption]
    anchors: list[CostAnchor]
    usable_hour_definition: str
    caveats: list[str]
    available_runs: list[CostRunRef]


class CostResponse(CostBlock):
    meta: Meta


class CompareCost(BaseModel):
    cost_run_id: int
    horizon_model: str
    horizon_lookup: str
    landing_time_utc: str
    mission_days: float
    p_survive_full_mission: Optional[float] = None
    p_zero_usable_hours: Optional[float] = None
    metrics: dict[str, Percentiles]


class CompareSite(BaseModel):
    site_id: str
    name: str
    latitude_deg: float
    longitude_deg_east: float
    period: Period
    bodies: dict[str, BodySummary]
    best_overlap: BestOverlap
    windows: dict[str, list[WindowItem]]
    cost: Optional[CompareCost] = None
    cost_unavailable_reason: Optional[str] = None


class CompareResponse(BaseModel):
    horizon_model: str
    scenario: str
    sites: list[CompareSite]
    cost_caveat: str
    usable_hour_definition: str
    meta: Meta
