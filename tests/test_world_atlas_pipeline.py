"""world_atlas データパイプラインの純粋関数テスト(ネットワーク不要)。"""

from __future__ import annotations

import math

from world_atlas.pipeline import analytics as A
from world_atlas.pipeline.indicators import CATEGORIES, INDICATORS, SDG_GOALS, validate_catalog


def test_catalog_is_consistent():
    assert validate_catalog() == []
    assert len(SDG_GOALS) == 17
    # すべての章に最低3指標(薄い章を作らない)
    for c in CATEGORIES:
        n = sum(1 for i in INDICATORS if i["category"] == c["id"])
        assert n >= 3, f"{c['id']} has only {n} indicators"
    # SDGs 17目標のうち大半に対応指標がある
    covered = {n for i in INDICATORS for n in i["sdg"]}
    assert len(covered) >= 15


def test_linear_forecast_exact_line():
    pts = [[2010 + k, 10.0 + 2.0 * k] for k in range(10)]  # 2010..2019, 傾き2
    f = A.linear_forecast(pts, target_year=2030)
    assert f is not None
    assert math.isclose(f["slope"], 2.0, rel_tol=1e-9)
    assert math.isclose(f["value"], 10.0 + 2.0 * 20, rel_tol=1e-9)
    assert math.isclose(f["r2"], 1.0, rel_tol=1e-9)
    assert f["base_year"] == 2019


def test_linear_forecast_uses_recent_window_only():
    # 古い区間は下降、直近10年は横ばい → 予測は横ばい値
    pts = [[1990 + k, 100.0 - k] for k in range(20)] + [[2010 + k, 5.0] for k in range(10)]
    f = A.linear_forecast(pts, target_year=2030, window=10)
    assert math.isclose(f["value"], 5.0, abs_tol=1e-9)
    assert math.isclose(f["slope"], 0.0, abs_tol=1e-9)


def test_linear_forecast_needs_enough_points():
    assert A.linear_forecast([], 2030) is None
    assert A.linear_forecast([[2020, 1.0], [2021, 2.0]], 2030) is None
    # 同じ年だけ(分散ゼロ)は予測不能
    assert A.linear_forecast([[2020, 1.0], [2020, 2.0], [2020, 3.0]], 2030) is None


def test_clamp_forecast_respects_bounds():
    hist = [50.0, 80.0, 99.0]
    assert A.clamp_forecast(130.0, hist, "%") == 100.0
    assert A.clamp_forecast(-5.0, hist, "%") == 0.0
    # 履歴に100超がある(総就学率など)なら上限は掛けない
    assert A.clamp_forecast(130.0, [90.0, 105.0], "%") == 130.0
    # 履歴にマイナスがある(成長率など)なら下限0は掛けない
    assert A.clamp_forecast(-3.0, [1.0, -2.0], "%/年") == -3.0
    # 非負の量(人口など)はマイナスにしない
    assert A.clamp_forecast(-10.0, [5.0, 3.0], "人") == 0.0


def test_tld_to_iso2():
    assert A.tld_to_iso2(".jp") == "JP"
    assert A.tld_to_iso2(".uk") == "GB"
    assert A.tld_to_iso2(".us; note - also .gov") == "US"
    assert A.tld_to_iso2("none") is None
    assert A.tld_to_iso2("") is None


def test_strip_html():
    assert A.strip_html("<p>Hello <b>world</b></p><p>2</p>") == "Hello world\n2"
    assert A.strip_html("a &amp; b") == "a & b"
    assert A.strip_html(None) == ""


def test_parse_wb_rows_filters_and_sorts():
    rows = [
        {"countryiso3code": "JPN", "date": "2021", "value": 2.0},
        {"countryiso3code": "JPN", "date": "2020", "value": 1.0},
        {"countryiso3code": "JPN", "date": "2019", "value": None},
        {"countryiso3code": "WLD", "date": "2020", "value": 9.0},
        {"countryiso3code": "EAS", "date": "2020", "value": 7.0},  # 地域集計は除外
        {"countryiso3code": "", "date": "2020", "value": 7.0},
    ]
    out = A.parse_wb_rows(rows, valid={"JPN"}, keep_world=True)
    assert out["JPN"] == [[2020, 1.0], [2021, 2.0]]
    assert out["WLD"] == [[2020, 9.0]]
    assert "EAS" not in out


def test_parse_unhcr_items_sums_by_country_year():
    items = [
        {"year": 2023, "coo_iso": "AFG", "refugees": 100},
        {"year": 2023, "coo_iso": "AFG", "refugees": "50"},
        {"year": 2024, "coo_iso": "AFG", "refugees": "-"},
        {"year": 2024, "coo_iso": "SYR", "refugees": 7},
        {"year": 2024, "coo_iso": "XXX", "refugees": 7},
    ]
    out = A.parse_unhcr_items(items, key="coo_iso", valid={"AFG", "SYR"})
    assert out["AFG"] == [[2023, 150.0]]
    assert out["SYR"] == [[2024, 7.0]]
    assert "XXX" not in out


def test_round_coords_shrinks_geometry():
    geom = {"type": "Polygon", "coordinates": [[[1.23456, 2.34567], [3.0, 4.0], [1.23456, 2.34567]]]}
    out = A.round_coords(geom, 2)
    assert out["coordinates"][0][0] == [1.23, 2.35]


def test_rate_label_by_percentile():
    assert A.rate_label(0.95) == "S"
    assert A.rate_label(0.75) == "A"
    assert A.rate_label(0.5) == "B"
    assert A.rate_label(0.3) == "C"
    assert A.rate_label(0.05) == "D"


def test_summarize_series_keeps_latest_base_and_forecast():
    ser = {
        "world": [[2019, 1.0], [2020, 2.0]],
        "countries": {
            "JPN": {"s": [[2000, 1.0], [2012, 3.0], [2020, 5.0]], "f": {"value": 7.123456789}},
            "USA": {"s": [[2020, 9.0]]},
            "EMP": {"s": []},
        },
    }
    out = A.summarize_series(ser, window=10)
    assert out["w"] == [2020, 2.0]
    assert out["c"]["JPN"] == [2020, 5.0, 2012, 3.0, 7.123457]
    assert out["c"]["USA"] == [2020, 9.0, 2020, 9.0, None]
    assert "EMP" not in out["c"]
