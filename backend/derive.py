"""
derive.py: the one place Stargazer's derivations live.

The database build, the cost step and the API all import from here, so the website,
the Python library and the CLI can cite one method. Nothing in this module reads or
writes files. It needs only the standard library; `skyline_at` also accepts numpy
arrays (numpy is imported only if an array is passed, i.e. in the build step).

Conventions
-----------
- Times are UTC. Inside this module a time is a float: seconds since 1970-01-01T00:00:00Z.
- Azimuth: degrees, 0 = north, 90 = east, clockwise, in [0, 360).
- Elevation: degrees above the local horizontal.
- A horizon mask is 360 skyline elevations, mask[i] at azimuth i degrees. `None` means a flat
  horizon (0 degrees everywhere).

Formulas
--------
- Skyline at azimuth a (linear between bins, wrapping 359 -> 0):
      lo = floor(a) mod 360, f = a - floor(a)
      skyline = mask[lo] * (1 - f) + mask[(lo + 1) mod 360] * f
- Clearance:   clearance = elevation - skyline       (degrees; positive = geometrically visible)
- Visible:     clearance > 0                          (body centre point; apparent disc size is NOT included)
- Scenarios:   the whole skyline is shifted by -sigma (optimistic), 0 (nominal) or +sigma (pessimistic),
               so clearance becomes clearance + sigma, clearance, clearance - sigma.
- Crossing time between two hourly samples (t0, c0) and (t1, c1) with opposite visibility:
      t = t0 + (t1 - t0) * c0 / (c0 - c1)             (linear interpolation of clearance)
- Position between two samples: elevation is linear in time; azimuth is linear along the short way
  round the compass (so 359.9 -> 0.1 passes through north).
- 'both' windows are the intersection of the Sun windows and the Earth windows of the same scenario.
"""
from __future__ import annotations

import bisect
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Sequence

LUNAR_DAY_HOURS = 29.53 * 24            # 708.72 h, the synodic lunar day used across the project
DEFAULT_SIGMA_DEG = 0.3                 # 1-sigma skyline uncertainty (HORIZON_SD_DEG in cost_mc.py; a team assumption)
MASK_LINEAR = "linear_between_bins"
MASK_FLOOR = "nearest_lower_bin"
MASK_METHODS = (MASK_LINEAR, MASK_FLOOR)
SCENARIOS = ("nominal", "optimistic", "pessimistic")
# Multiplier applied to sigma and ADDED to the skyline for each scenario.
SCENARIO_SKYLINE_SHIFT = {"nominal": 0.0, "optimistic": -1.0, "pessimistic": 1.0}

_MONTHS = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
           "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# --------------------------------------------------------------------------- time helpers

def horizons_time_to_epoch(text: str) -> float:
    """'2026-Dec-01 00:00' (JPL Horizons) or an ISO 8601 string -> epoch seconds (UTC)."""
    text = text.strip()
    if "T" in text or text[5:6].isdigit():
        return parse_iso_utc(text)
    date, clock = text.split()
    year, month, day = date.split("-")
    parts = [int(p) for p in clock.split(":")]
    hour, minute = parts[0], parts[1]
    second = parts[2] if len(parts) > 2 else 0
    dt = datetime(int(year), _MONTHS[month], int(day), hour, minute, second, tzinfo=timezone.utc)
    return (dt - _EPOCH).total_seconds()


def parse_iso_utc(text: str) -> float:
    """ISO 8601 date or date-time -> epoch seconds. A value without an offset is taken as UTC."""
    raw = text.strip()
    if not raw:
        raise ValueError("empty timestamp")
    cleaned = raw.replace(" ", "T") if "T" not in raw and " " in raw else raw
    if cleaned.endswith(("Z", "z")):
        cleaned = cleaned[:-1] + "+00:00"
    dt = datetime.fromisoformat(cleaned)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt.astimezone(timezone.utc) - _EPOCH).total_seconds()


def epoch_to_iso(seconds: float) -> str:
    """Epoch seconds -> '2026-12-01T00:00:00Z' (rounded to the nearest second)."""
    dt = _EPOCH + timedelta(seconds=round(seconds))
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- skyline and position

def skyline_at(mask, azimuth_deg, method: str = MASK_LINEAR):
    """
    Skyline elevation (degrees) at an azimuth. `mask` is 360 values or None (flat horizon).
    `azimuth_deg` may be a float or a numpy array. `method` is 'linear_between_bins' (what the
    website does) or 'nearest_lower_bin' (floor(azimuth), what cost_mc.py did originally).
    """
    if method not in MASK_METHODS:
        raise ValueError(f"unknown mask lookup {method!r}; use one of {MASK_METHODS}")
    if hasattr(azimuth_deg, "__array__"):
        import numpy as np          # build step only
        az = np.mod(np.asarray(azimuth_deg, dtype=float), 360.0)
        if mask is None:
            return np.zeros_like(az)
        m = np.asarray(mask, dtype=float)
        lower = np.floor(az).astype(int) % 360
        if method == MASK_FLOOR:
            return m[lower]
        fraction = az - np.floor(az)
        return m[lower] * (1.0 - fraction) + m[(lower + 1) % 360] * fraction
    if mask is None:
        return 0.0
    wrapped = math.fmod(float(azimuth_deg), 360.0)
    if wrapped < 0:
        wrapped += 360.0
    floor = math.floor(wrapped)
    lower = int(floor) % 360
    if method == MASK_FLOOR:
        return float(mask[lower])
    fraction = wrapped - floor
    return float(mask[lower]) * (1.0 - fraction) + float(mask[(lower + 1) % 360]) * fraction


def interpolate_azimuth(az0: float, az1: float, fraction: float) -> float:
    """Azimuth between two samples, going the short way round the compass."""
    turn = ((az1 - az0 + 540.0) % 360.0) - 180.0
    return ((az0 + turn * fraction) % 360.0 + 360.0) % 360.0


def position_at(times: Sequence[float], azimuth: Sequence[float], elevation: Sequence[float], t: float):
    """
    (azimuth, elevation) at time t by linear interpolation between the bracketing samples.
    Never extrapolates: raises ValueError when t is outside [times[0], times[-1]].
    At a sample time the raw sample is returned unchanged.
    """
    if t < times[0] or t > times[-1]:
        raise ValueError("time is outside the sampled coverage")
    upper = bisect.bisect_left(times, t)
    if times[upper] == t:
        return float(azimuth[upper]), float(elevation[upper])
    lower = upper - 1
    fraction = (t - times[lower]) / (times[upper] - times[lower])
    return (interpolate_azimuth(azimuth[lower], azimuth[upper], fraction),
            elevation[lower] + (elevation[upper] - elevation[lower]) * fraction)


def clearance_series(azimuth: Sequence[float], elevation: Sequence[float], mask,
                     method: str = MASK_LINEAR):
    """Per-sample (skyline, clearance) lists, rounded to 6 decimals. clearance = elevation - skyline at the body's azimuth."""
    skyline = [round(skyline_at(mask, az, method), 6) for az in azimuth]       # 6 decimals, like the Horizons values
    return skyline, [round(el - sk, 6) for el, sk in zip(elevation, skyline)]


# --------------------------------------------------------------------------- windows

@dataclass(frozen=True)
class Window:
    """A continuous stretch of geometric visibility. Times are epoch seconds."""
    start: float
    end: float
    starts_before_data: bool = False     # the window was already open at the first sample
    ends_after_data: bool = False        # the window was still open at the last sample

    @property
    def duration_h(self) -> float:
        return (self.end - self.start) / 3600.0


def windows_from_clearance(times: Sequence[float], clearance: Sequence[float], shift: float = 0.0) -> list[Window]:
    """
    Visibility windows for one body. A sample is visible when clearance + shift > 0. Rise and set
    times are found by linear interpolation of the (shifted) clearance between neighbouring samples,
    then rounded to the nearest whole second (the resolution of the stored timestamps), so every
    duration computed later from stored times is exact. Windows cut by the ends of the data are
    kept and flagged, not dropped.
    """
    if len(times) != len(clearance):
        raise ValueError("times and clearance must be the same length")
    if not times:
        return []
    windows: list[Window] = []
    c_prev = clearance[0] + shift
    start: Optional[float] = times[0] if c_prev > 0 else None
    open_at_first = c_prev > 0
    for i in range(1, len(times)):
        c = clearance[i] + shift
        if c_prev > 0 and not c > 0:                       # set
            end = float(round(times[i - 1] + (times[i] - times[i - 1]) * c_prev / (c_prev - c)))
            if end > start:
                windows.append(Window(start, end, starts_before_data=open_at_first and start == times[0]))
            start = None
        elif not c_prev > 0 and c > 0:                     # rise
            start = float(round(times[i - 1] + (times[i] - times[i - 1]) * (-c_prev) / (c - c_prev)))
        c_prev = c
    if start is not None and times[-1] > start:
        windows.append(Window(start, times[-1], starts_before_data=open_at_first and start == times[0],
                              ends_after_data=True))
    return windows


def intersect_windows(a: Sequence[Window], b: Sequence[Window]) -> list[Window]:
    """Stretches where a window from `a` and a window from `b` overlap ('both' = Sun AND Earth)."""
    out: list[Window] = []
    i = j = 0
    while i < len(a) and j < len(b):
        start = max(a[i].start, b[j].start)
        end = min(a[i].end, b[j].end)
        if end > start:
            # The overlap is cut by the data only if every window that defines that edge is itself cut there.
            before = all(w.starts_before_data for w in (a[i], b[j]) if w.start == start)
            after = all(w.ends_after_data for w in (a[i], b[j]) if w.end == end)
            out.append(Window(start, end, starts_before_data=before, ends_after_data=after))
        if a[i].end <= b[j].end:
            i += 1
        else:
            j += 1
    return out


def clip_windows(windows: Iterable[Window], start: float, end: float) -> list[Window]:
    """The parts of each window that fall inside [start, end]. Coverage flags are kept only where the cut did not move that edge."""
    out = []
    for w in windows:
        s, e = max(w.start, start), min(w.end, end)
        if e > s:
            out.append(Window(s, e, starts_before_data=w.starts_before_data and s == w.start,
                              ends_after_data=w.ends_after_data and e == w.end))
    return out


def window_details(window: Window, times: Sequence[float], azimuth: Sequence[float],
                   elevation: Sequence[float]) -> dict:
    """Rise azimuth, set azimuth and peak elevation for a single-body window."""
    start_az, start_el = position_at(times, azimuth, elevation, window.start)
    end_az, end_el = position_at(times, azimuth, elevation, window.end)
    lo = bisect.bisect_left(times, window.start)
    hi = bisect.bisect_right(times, window.end)
    peak = max([start_el, end_el] + [float(e) for e in elevation[lo:hi]])
    return {"start_azimuth_deg": start_az, "end_azimuth_deg": end_az, "peak_elevation_deg": peak}


# --------------------------------------------------------------------------- summaries

def summarise_windows(windows: Sequence[Window], period_start: float, period_end: float) -> dict:
    """
    Visibility totals inside [period_start, period_end]:
    visible hours and fraction, number of windows, the longest window (with its clipped start
    and end) and the longest gap (for the Sun, the longest darkness).
    """
    if period_end <= period_start:
        raise ValueError("period must have positive length")
    period_h = (period_end - period_start) / 3600.0
    clipped = clip_windows(windows, period_start, period_end)
    visible_h = sum(w.duration_h for w in clipped)
    longest = max(clipped, key=lambda w: (w.duration_h, -w.start), default=None)
    gap = 0.0
    cursor = period_start
    for w in clipped:
        gap = max(gap, (w.start - cursor) / 3600.0)
        cursor = w.end
    gap = max(gap, (period_end - cursor) / 3600.0)
    return {
        "period_hours": period_h,
        "visible_hours": visible_h,
        "visible_fraction": visible_h / period_h,
        "n_windows": len(clipped),
        "longest_window_h": longest.duration_h if longest else 0.0,
        "longest_window_start": longest.start if longest else None,
        "longest_window_end": longest.end if longest else None,
        "longest_gap_h": gap,
    }


def lunar_day_periods(coverage_start: float, coverage_end: float) -> list[tuple[int, float, float]]:
    """
    (index, start, end) for the whole coverage (index 0) and for each lunar day inside it
    (index 1, 2, ...), counted from the first sample. A last period is kept only if the data covers
    at least 99% of it (hourly files stop up to an hour short of a full 708.72 h day); it then
    ends at the coverage end. Shorter leftovers are not a lunar day and are left out.
    """
    periods = [(0, coverage_start, coverage_end)]
    step = LUNAR_DAY_HOURS * 3600.0
    index = 1
    while True:
        start = coverage_start + (index - 1) * step
        end = min(start + step, coverage_end)
        if end - start < 0.99 * step:
            break
        periods.append((index, start, end))
        index += 1
    return periods


# --------------------------------------------------------------------------- uncertainty

def match_uncertainty(nominal: Sequence[Window], optimistic: Sequence[Window],
                      pessimistic: Sequence[Window]) -> list[dict]:
    """
    For each nominal window, the range its edges move through when the skyline shifts by -/+ sigma.

    Lowering the skyline (optimistic) can only widen a window, raising it (pessimistic) can only
    shrink it, so every nominal window lies inside exactly one optimistic window and contains zero
    or more pessimistic windows.
      earliest_start / latest_end / max_duration_h come from the optimistic window,
      latest_start / earliest_end / min_duration_h from the pessimistic window.
    A value is None, with the reason in `note`, when there is no clean one-to-one match:
    the pessimistic window vanishes or splits, or the optimistic window merges this window with a
    neighbour.
    """
    eps = 1e-6
    out = []
    for n in nominal:
        notes = []
        result = {"earliest_start": None, "latest_start": None, "earliest_end": None,
                  "latest_end": None, "min_duration_h": None, "max_duration_h": None}
        outer = [o for o in optimistic if o.start <= n.start + eps and o.end >= n.end - eps]
        if outer:
            o = outer[0]
            siblings = [m for m in nominal if m.start >= o.start - eps and m.end <= o.end + eps]
            if len(siblings) == 1:
                result.update(earliest_start=o.start, latest_end=o.end, max_duration_h=o.duration_h)
                if o.starts_before_data or o.ends_after_data:
                    notes.append("optimistic window is cut by the data coverage, so its outer edge is a limit of the data, not a rise or set")
            else:
                notes.append(f"with the skyline lowered by sigma this window merges with {len(siblings) - 1} neighbouring window(s); no single optimistic bound")
        else:
            notes.append("no optimistic window found for this window")
        inner = [p for p in pessimistic if p.start >= n.start - eps and p.end <= n.end + eps]
        if len(inner) == 1:
            p = inner[0]
            result.update(latest_start=p.start, earliest_end=p.end, min_duration_h=p.duration_h)
            if p.starts_before_data or p.ends_after_data:
                notes.append("window is cut by the data coverage, so that edge is a limit of the data, not a rise or set")
        elif not inner:
            notes.append("with the skyline raised by sigma this window vanishes")
            result["min_duration_h"] = 0.0
        else:
            notes.append(f"with the skyline raised by sigma this window splits into {len(inner)} windows; no single pessimistic bound")
        result["note"] = "; ".join(notes) if notes else None
        out.append(result)
    return out


# --------------------------------------------------------------------------- transitions

def next_transition(windows: Sequence[Window], after: float, coverage_end: float) -> Optional[dict]:
    """
    The next rise or set strictly after `after`, read from precomputed windows.
    Returns {'event': 'rise'|'set', 'time': epoch} or None when nothing changes before the data ends.
    """
    for w in windows:
        if w.end <= after:
            continue
        if w.start > after:
            return {"event": "rise", "time": w.start}
        if w.ends_after_data and w.end >= coverage_end:
            return None                                    # still visible when the data ends
        return {"event": "set", "time": w.end}
    return None


def is_inside(windows: Sequence[Window], t: float) -> bool:
    """True when t falls inside one of the windows (start exclusive on a rise, as clearance > 0)."""
    return any(w.start < t < w.end or (w.starts_before_data and t == w.start)
               or (w.ends_after_data and t == w.end) for w in windows)
