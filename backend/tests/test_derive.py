"""Unit tests for backend/derive.py (no database needed)."""
from __future__ import annotations

import math

import pytest

import derive
from derive import Window

H = 3600.0


def test_horizons_time_is_converted_to_iso():
    t = derive.horizons_time_to_epoch("2026-Dec-01 00:00")
    assert derive.epoch_to_iso(t) == "2026-12-01T00:00:00Z"
    assert derive.parse_iso_utc("2026-12-01T00:00:00Z") == t
    assert derive.parse_iso_utc("2026-12-01") == t
    assert derive.parse_iso_utc("2026-12-01T08:00:00+08:00") == t


def test_skyline_linear_between_bins_and_wraps():
    mask = [float(i) for i in range(360)]
    assert derive.skyline_at(mask, 10.0) == 10.0
    assert derive.skyline_at(mask, 10.25) == pytest.approx(10.25)
    assert derive.skyline_at(mask, 359.5) == pytest.approx(359 * 0.5 + 0 * 0.5)      # wraps 359 -> 0
    assert derive.skyline_at(mask, 370.0) == pytest.approx(10.0)
    assert derive.skyline_at(mask, -1.0) == pytest.approx(359.0)


def test_skyline_floor_rule_and_flat_horizon():
    mask = [float(i) for i in range(360)]
    assert derive.skyline_at(mask, 10.9, derive.MASK_FLOOR) == 10.0
    assert derive.skyline_at(None, 123.4) == 0.0
    with pytest.raises(ValueError):
        derive.skyline_at(mask, 1.0, "nearest")


def test_skyline_numpy_matches_scalar():
    np = pytest.importorskip("numpy")
    mask = [math.sin(i / 20.0) for i in range(360)]
    az = np.array([0.0, 0.5, 12.75, 359.99, 180.0])
    for method in derive.MASK_METHODS:
        got = derive.skyline_at(mask, az, method)
        assert got == pytest.approx([derive.skyline_at(mask, float(a), method) for a in az])
    assert derive.skyline_at(None, az).tolist() == [0.0] * 5


def test_position_at_sample_returns_raw_value_and_midpoint_is_between():
    times = [0.0, H, 2 * H]
    az, el = [359.8, 0.2, 0.6], [1.0, 2.0, 4.0]
    assert derive.position_at(times, az, el, H) == (0.2, 2.0)
    a, e = derive.position_at(times, az, el, 0.5 * H)
    assert e == pytest.approx(1.5)
    assert a == pytest.approx(0.0, abs=1e-9) or a == pytest.approx(360.0, abs=1e-9)   # short way through north
    with pytest.raises(ValueError):
        derive.position_at(times, az, el, 3 * H)


def test_windows_use_interpolated_crossings_and_flag_data_edges():
    times = [i * H for i in range(6)]
    clearance = [1.0, 1.0, -1.0, -1.0, 1.0, 3.0]
    windows = derive.windows_from_clearance(times, clearance)
    assert len(windows) == 2
    first, second = windows
    assert first.start == 0.0 and first.starts_before_data and not first.ends_after_data
    assert first.end == pytest.approx(1.5 * H)                  # crosses zero half-way between hour 1 and hour 2
    assert second.start == pytest.approx(3.5 * H)
    assert second.end == 5 * H and second.ends_after_data
    assert first.duration_h == pytest.approx(1.5)


def test_scenario_shift_widens_and_narrows():
    times = [i * H for i in range(5)]
    clearance = [-1.0, 0.2, 1.0, 0.2, -1.0]
    nominal = derive.windows_from_clearance(times, clearance)[0]
    wide = derive.windows_from_clearance(times, clearance, shift=0.3)[0]
    narrow = derive.windows_from_clearance(times, clearance, shift=-0.3)[0]
    assert wide.start < nominal.start < narrow.start
    assert wide.end > nominal.end > narrow.end


def test_zero_clearance_is_not_visible():
    times = [0.0, H, 2 * H]
    assert derive.windows_from_clearance(times, [0.0, 0.0, 0.0]) == []


def test_intersect_and_clip():
    sun = [Window(0, 10 * H, starts_before_data=True), Window(20 * H, 30 * H)]
    earth = [Window(5 * H, 25 * H)]
    both = derive.intersect_windows(sun, earth)
    assert [(w.start, w.end) for w in both] == [(5 * H, 10 * H), (20 * H, 25 * H)]
    assert not both[0].starts_before_data
    same_start = derive.intersect_windows([Window(0, 4 * H, starts_before_data=True)], [Window(0, 2 * H, starts_before_data=True)])
    assert same_start[0].starts_before_data and same_start[0].end == 2 * H
    clipped = derive.clip_windows(sun, 8 * H, 22 * H)
    assert [(w.start, w.end) for w in clipped] == [(8 * H, 10 * H), (20 * H, 22 * H)]
    assert not clipped[0].starts_before_data


def test_summary_hours_fraction_longest_window_and_gap():
    windows = [Window(2 * H, 5 * H), Window(9 * H, 10 * H)]
    s = derive.summarise_windows(windows, 0.0, 20 * H)
    assert s["visible_hours"] == pytest.approx(4.0)
    assert s["visible_fraction"] == pytest.approx(0.2)
    assert s["n_windows"] == 2
    assert s["longest_window_h"] == pytest.approx(3.0) and s["longest_window_start"] == 2 * H
    assert s["longest_gap_h"] == pytest.approx(10.0)            # from hour 10 to the end of the period
    empty = derive.summarise_windows([], 0.0, 10 * H)
    assert empty["visible_hours"] == 0 and empty["longest_gap_h"] == pytest.approx(10.0) and empty["longest_window_start"] is None


def test_lunar_day_periods():
    full = derive.lunar_day_periods(0.0, 2836 * H)              # the 118.2-day files
    assert [p[0] for p in full] == [0, 1, 2, 3, 4]
    assert full[1][2] - full[1][1] == pytest.approx(derive.LUNAR_DAY_HOURS * H)
    one = derive.lunar_day_periods(0.0, 708 * H)                # a single-lunar-day file stops 0.72 h short
    assert [p[0] for p in one] == [0, 1] and one[1][2] == 708 * H
    assert [p[0] for p in derive.lunar_day_periods(0.0, 100 * H)] == [0]


def test_uncertainty_clean_match():
    nominal = [Window(10 * H, 20 * H)]
    optimistic = [Window(9 * H, 21 * H)]
    pessimistic = [Window(11 * H, 19 * H)]
    (m,) = derive.match_uncertainty(nominal, optimistic, pessimistic)
    assert (m["earliest_start"], m["latest_start"], m["earliest_end"], m["latest_end"]) == (9 * H, 11 * H, 19 * H, 21 * H)
    assert m["min_duration_h"] == pytest.approx(8.0) and m["max_duration_h"] == pytest.approx(12.0) and m["note"] is None


def test_uncertainty_vanish_split_and_merge_are_null_with_a_note():
    nominal = [Window(10 * H, 20 * H), Window(22 * H, 30 * H)]
    optimistic = [Window(9 * H, 31 * H)]                         # merges the two
    pessimistic = [Window(11 * H, 14 * H), Window(16 * H, 19 * H)]   # first splits, second vanishes
    first, second = derive.match_uncertainty(nominal, optimistic, pessimistic)
    assert first["earliest_start"] is None and "merges" in first["note"]
    assert first["latest_start"] is None and "splits into 2" in first["note"]
    assert second["min_duration_h"] == 0.0 and "vanishes" in second["note"]


def test_next_transition():
    windows = [Window(5 * H, 10 * H), Window(20 * H, 30 * H, ends_after_data=True)]
    assert derive.next_transition(windows, 0.0, 30 * H) == {"event": "rise", "time": 5 * H}
    assert derive.next_transition(windows, 7 * H, 30 * H) == {"event": "set", "time": 10 * H}
    assert derive.next_transition(windows, 25 * H, 30 * H) is None       # still up when the data ends
    assert derive.is_inside(windows, 7 * H) and not derive.is_inside(windows, 15 * H)
