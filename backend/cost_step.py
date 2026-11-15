"""
cost_step.py: runs the team's cost model (cost_mc.py) for the database build.

It does not re-implement the model. It imports cost_mc.py as it is in the repo and calls its
own `load` and `run`, controlling only three things from outside:

- the horizon: the 360 skyline values are written to a temporary bare-list file, the one shape
  every version of cost_mc.py accepts (the committed script cannot read lola_terrain.py's dict);
- the mask lookup: `cost_mc.horizon_at` is pointed at `derive.skyline_at`, so the cost model reads
  the skyline with the same rule as the database ('linear_between_bins') or, for parity checks,
  with the original rule ('nearest_lower_bin');
- the random seed: `cost_mc.rng` is replaced with a fresh `default_rng(seed)` before each run, so
  an in-process run gives the same numbers as a single-site command-line run.

Works with the committed cost_mc.py and with the patched one in backend/patches/.
Build step only: needs numpy.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional, Sequence

import derive

MODEL_NAME = "stargazer_cost_mc_financial_burn_ratio"


def load_cost_module(script_path: Path):
    """Import cost_mc.py from its file path without running its command-line block."""
    script_path = Path(script_path)
    backend_dir = str(script_path.resolve().parent)
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)          # the patched script imports `derive` from its own folder
    spec = importlib.util.spec_from_file_location("stargazer_cost_mc", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def script_sha256(script_path: Path) -> str:
    return hashlib.sha256(Path(script_path).read_bytes()).hexdigest()


def run_cost(cost_module, ephemeris_path: Path, mask_deg: Optional[Sequence[float]],
             lookup: str = derive.MASK_LINEAR, seed: int = 42) -> dict:
    """
    One cost run. `mask_deg` is the 360-value skyline, or None for a flat horizon.
    Returns cost_mc.py's own result dict plus horizon_model, horizon_lookup and seed.
    """
    import numpy as np

    if mask_deg is not None and len(mask_deg) != 360:
        raise ValueError(f"mask must have 360 values, got {len(mask_deg)}")
    original_horizon_at = cost_module.horizon_at
    original_rng = cost_module.rng
    mask_file = None
    try:
        if mask_deg is not None:
            handle, mask_file = tempfile.mkstemp(suffix="_mask.json")
            with os.fdopen(handle, "w") as out:
                json.dump([float(v) for v in mask_deg], out)
            cost_module.horizon_at = lambda mask, az: derive.skyline_at(mask, az, lookup)
        cost_module.rng = np.random.default_rng(seed)
        result = cost_module.run(*cost_module.load(str(ephemeris_path), mask_file))
    finally:
        cost_module.horizon_at = original_horizon_at
        cost_module.rng = original_rng
        if mask_file and os.path.exists(mask_file):
            try:
                os.unlink(mask_file)
            except OSError:
                pass                                   # Windows keeps a file locked while any handle is open; harmless
    result = dict(result)
    result["horizon_model"] = "lola_mask" if mask_deg is not None else "flat"
    result["horizon_lookup"] = lookup if mask_deg is not None else "not_applicable"
    result["seed"] = seed
    return result
