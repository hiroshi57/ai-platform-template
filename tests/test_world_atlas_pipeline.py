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


# ---------------------------------------------------------------- Phase 2 データソース
def _make_xlsx(rows):
    """テスト用の最小 xlsx(sharedStrings + sheet2='data')を作る。"""
    import io
    import zipfile

    strings: list[str] = []

    def cell(v, ref):
        if isinstance(v, str):
            if v not in strings:
                strings.append(v)
            return f'<c r="{ref}" t="s"><v>{strings.index(v)}</v></c>'
        return f'<c r="{ref}"><v>{v}</v></c>'

    body = "".join(
        f'<row r="{i + 1}">' + "".join(cell(v, f"{chr(65 + j)}{i + 1}") for j, v in enumerate(r)) + "</row>"
        for i, r in enumerate(rows)
    )
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} {rel}><sheets><sheet name="README" sheetId="1" r:id="rId1"/>'
                                      f'<sheet name="data" sheetId="2" r:id="rId2"/></sheets></workbook>')
        z.writestr("xl/sharedStrings.xml", f"<sst {ns}>" + "".join(f"<si><t>{s}</t></si>" for s in strings) + "</sst>")
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}><sheetData/></worksheet>")
        z.writestr("xl/worksheets/sheet2.xml", f"<worksheet {ns}><sheetData>{body}</sheetData></worksheet>")
    return buf.getvalue()


def test_read_xlsx_sheet_by_name():
    data = _make_xlsx([["iso", "EPI.new"], ["JPN", 61.5], ["AFG", "NA"]])
    rows = A.read_xlsx_sheet(data, "data")
    assert rows[0] == ["iso", "EPI.new"]
    assert rows[1] == ["JPN", "61.5"]
    assert rows[2] == ["AFG", "NA"]


def test_read_xlsx_keeps_column_positions_with_gaps():
    import io
    import zipfile

    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns}><sheets><sheet name="data" sheetId="1"/></sheets></workbook>')
        z.writestr("xl/worksheets/sheet1.xml",
                   f'<worksheet {ns}><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>'
                   f"</sheetData></worksheet>")
    assert A.read_xlsx_sheet(buf.getvalue(), "data") == [["1", None, "3"]]


def test_parse_wide_rows():
    rows = [["ISO3", "Name", "2000", "2001", "2002"], ["JPN", "Japan", "1.5", "", "NA"], ["XXX", "x", "1", "2", "3"]]
    out = A.parse_wide_rows(rows, iso_col="ISO3", valid={"JPN"})
    assert out == {"JPN": [[2000, 1.5]]}


def test_parse_wide_rows_with_prefixed_year_columns():
    rows = [["code", "iso", "country", "BER.ind.1996", "BER.ind.1997"], ["4", "AFG", "Afghanistan", "NA", "51.6"]]
    assert A.parse_wide_rows(rows, iso_col="iso", valid={"AFG"}) == {"AFG": [[1997, 51.6]]}


def test_parse_long_rows():
    rows = [
        {"country_iso3_code": "JPN", "year": "2020", "eci_hs92": "2.1"},
        {"country_iso3_code": "JPN", "year": "2019", "eci_hs92": "2.2"},
        {"country_iso3_code": "JPN", "year": "2021", "eci_hs92": ""},
        {"country_iso3_code": "ZZZ", "year": "2021", "eci_hs92": "1"},
    ]
    assert A.parse_long_rows(rows, "country_iso3_code", "year", "eci_hs92", {"JPN"}) == {"JPN": [[2019, 2.2], [2020, 2.1]]}


def test_parse_independence_year():
    assert A.parse_independence_year("15 August 1947 (from the UK)") == 1947
    assert A.parse_independence_year("4 July 1776 (declared); 3 September 1783 (recognized by Great Britain)") == 1776
    assert A.parse_independence_year("3 May 1947 (current constitution adopted as amendment); notable earlier dates: "
                                     "11 February 660 B.C. (mythological date)") is None
    assert A.parse_independence_year("none") is None
    assert A.parse_independence_year("1 January 1804 (from France)") == 1804
    assert A.parse_independence_year("") is None


def test_summarize_exports_top_items_and_sectors():
    products = {
        "p87": {"code": "87", "sector": "Vehicles"},
        "p84": {"code": "84", "sector": "Machinery"},
        "p27": {"code": "27", "sector": "Minerals"},
        "ptr": {"code": "travel", "sector": "Services"},
    }
    rows = [
        {"productId": "p87", "year": 2024, "exportValue": 60.0},
        {"productId": "p84", "year": 2024, "exportValue": 30.0},
        {"productId": "p27", "year": 2024, "exportValue": 10.0},
        {"productId": "ptr", "year": 2024, "exportValue": None},
        {"productId": "p87", "year": 2023, "exportValue": 999.0},  # 古い年は無視
        {"productId": "zzz", "year": 2024, "exportValue": 5.0},  # 未知の品目は無視
    ]
    out = A.summarize_exports(rows, products, top=2)
    assert out["year"] == 2024
    assert out["total"] == 100.0
    assert out["top"] == [["87", 60.0, 0.6], ["84", 30.0, 0.3]]
    assert out["sectors"] == {"Vehicles": 0.6, "Machinery": 0.3, "Minerals": 0.1}


def test_summarize_exports_empty():
    assert A.summarize_exports([], {}) is None


def test_products_ja_covers_all_hs_chapters():
    from world_atlas.pipeline.products_ja import HS2_JA, SECTOR_JA

    chapters = [f"{i:02d}" for i in range(1, 98) if i != 77]  # HS に 77 類は存在しない
    assert all(c in HS2_JA for c in chapters)
    assert len(SECTOR_JA) == 11


def test_parse_sdg_code():
    assert A.parse_sdg_code("SH_TBS_INCD") == ("SH_TBS_INCD", {})
    assert A.parse_sdg_code("AG_PRD_FIESMS|Age=ALLAGE/15+;Sex=BOTHSEX") == (
        "AG_PRD_FIESMS", {"Age": ["ALLAGE", "15+"], "Sex": ["BOTHSEX"]})


def test_parse_unsdg_rows_filters_dimensions_and_maps_m49():
    m49 = {"392": "JPN", "4": "AFG"}
    rows = [
        {"geoAreaCode": "392", "timePeriodStart": 2020.0, "value": "10", "dimensions": {"Sex": "BOTHSEX", "Age": "15+"}},
        {"geoAreaCode": "392", "timePeriodStart": 2020.0, "value": "11", "dimensions": {"Sex": "BOTHSEX", "Age": "ALLAGE"}},
        {"geoAreaCode": "392", "timePeriodStart": 2020.0, "value": "99", "dimensions": {"Sex": "MALE", "Age": "ALLAGE"}},
        {"geoAreaCode": "392", "timePeriodStart": 2021.0, "value": "NaN", "dimensions": {"Sex": "BOTHSEX", "Age": "ALLAGE"}},
        {"geoAreaCode": "4", "timePeriodStart": 2019.0, "value": "<5", "dimensions": {"Sex": "BOTHSEX", "Age": "ALLAGE"}},
        {"geoAreaCode": "1", "timePeriodStart": 2020.0, "value": "30", "dimensions": {"Sex": "BOTHSEX", "Age": "ALLAGE"}},
        {"geoAreaCode": "999", "timePeriodStart": 2020.0, "value": "1", "dimensions": {"Sex": "BOTHSEX", "Age": "ALLAGE"}},
    ]
    out = A.parse_unsdg_rows(rows, {"Sex": ["BOTHSEX"], "Age": ["ALLAGE", "15+"]}, m49, valid={"JPN", "AFG"})
    assert out["JPN"] == [[2020, 11.0]]  # 同じ年は、先に書いた区分(ALLAGE)を優先
    assert out["AFG"] == [[2019, 5.0]]  # "<5" は 5 として扱う
    assert out["WLD"] == [[2020, 30.0]]


def test_factbook_ja_merge_marks_stale_when_source_changes():
    from world_atlas.pipeline import factbook_ja as F

    countries = {"JPN": {"factbook": {"background": "old text"}}, "USA": {"factbook": {"background": "x"}}}
    ja = {"JPN": {"background_ja": "要約", "source_sha1": F.source_hash("old text"), "reviewed": True, "reviewer": "先生"}}
    out = F.merge_translations(countries, ja)
    assert out["JPN"]["factbook_ja"]["stale"] is False
    assert out["JPN"]["factbook_ja"]["reviewed"] is True
    assert "factbook_ja" not in out["USA"]
    countries["JPN"]["factbook"]["background"] = "new text"
    assert F.merge_translations(countries, ja)["JPN"]["factbook_ja"]["stale"] is True


def test_factbook_ja_review_requires_reviewer_and_updates_hash():
    import pytest

    from world_atlas.pipeline import factbook_ja as F

    countries = {"JPN": {"factbook": {"background": "v2"}}}
    ja = {"JPN": {"background_ja": "要約", "source_sha1": F.source_hash("v1"), "reviewed": False}}
    with pytest.raises(ValueError):
        F.review(ja, "JPN", " ", countries)
    with pytest.raises(KeyError):
        F.review(ja, "USA", "先生", countries)
    F.review(ja, "JPN", "山田(社会科)", countries)
    assert ja["JPN"]["reviewed"] is True and ja["JPN"]["source_sha1"] == F.source_hash("v2")
    assert F.status_rows(ja, countries) == [("JPN", "確認済み(山田(社会科))")]


def test_diff_latest_reports_new_years_and_country_changes():
    old = {
        "life_exp": {"w": [2023, 73.0], "c": {"JPN": [2023, 84.0, 2013, 83, None], "USA": [2023, 77.0, 2013, 78, None]}},
        "gone": {"w": None, "c": {"JPN": [2020, 1.0, 2010, 1, None]}},
    }
    new = {
        "life_exp": {"w": [2024, 73.3], "c": {"JPN": [2024, 84.1, 2014, 83, None], "USA": [2023, 77.0, 2013, 78, None],
                                                "IND": [2024, 72.0, 2014, 69, None]}},
        "added": {"w": None, "c": {"JPN": [2025, 5.0, 2015, 4, None]}},
    }
    rep = A.diff_latest(old, new)
    by = {r["id"]: r for r in rep["indicators"]}
    assert by["life_exp"]["year_from"] == 2023 and by["life_exp"]["year_to"] == 2024
    assert by["life_exp"]["countries_from"] == 2 and by["life_exp"]["countries_to"] == 3
    assert by["life_exp"]["updated"] == 2  # JPN(年が進んだ)+ IND(新規)
    assert by["added"]["status"] == "new"
    assert rep["removed"] == ["gone"]
    assert "unchanged" not in {r["status"] for r in rep["indicators"] if r["id"] == "life_exp"}


def test_diff_latest_marks_unchanged():
    same = {"x": {"w": None, "c": {"JPN": [2020, 1.0, 2010, 1, None]}}}
    rep = A.diff_latest(same, same)
    assert rep["indicators"][0]["status"] == "unchanged"
    assert rep["changed_count"] == 0


def test_update_report_markdown_lists_failures_and_changes():
    rep = A.diff_latest({}, {"x": {"w": None, "c": {"JPN": [2020, 1.0, 2010, 1, None]}}})
    md = A.update_report_markdown(rep, {"wb:X": {"ok": False, "error": "timeout"}, "geo": {"ok": True}},
                                  names={"x": "指標X"}, generated_at="2026-09-25T00:00:00+00:00")
    assert "取得に失敗したソース" in md and "wb:X" in md and "timeout" in md
    assert "指標X" in md


def test_factbook_ja_number_check_flags_numbers_missing_from_source():
    from world_atlas.pipeline import factbook_ja as F

    en = "Silla allied with China to create the first unified Korean state in 688. Choson dates from 2300 B.C."
    assert F.unmatched_numbers("新羅は688年に統一。古朝鮮は紀元前2300年頃。", en) == []
    assert F.unmatched_numbers("新羅は668年に統一した。", en) == ["668"]
    # 1,000 のような桁区切りや「2度」「3つ」のような小さい数は対象外
    assert F.unmatched_numbers("約1,000人。3つの国。", "about 1,000 people") == []
    # 英語の言葉を数字に言いかえたもの(1.5 million→150万、three centuries→300年間)は対象外
    assert F.unmatched_numbers("約150万人が300年間くらした。", "about 1.5 million people for three centuries") == []
    # 原文に無い年は検出する
    assert F.unmatched_numbers("1910年に独立した。", "independence in 1907") == ["1910"]


def test_factbook_ja_normalize_removes_markdown_and_blank_lines():
    from world_atlas.pipeline import factbook_ja as F

    assert F.normalize_ja("**古代**の王国。\n\n近代の独立。\n") == "古代の王国。\n近代の独立。"


def test_factbook_ja_english_word_check():
    from world_atlas.pipeline import factbook_ja as F

    assert F.english_words("抗議activityが起きた。") == ["activity"]
    assert F.english_words("NATO や EU に加盟した。") == []


def test_parse_coded_rows_static_and_yearly():
    rows = [
        {"iso3": "JPN", "minage_fem_any": "5.0", "minage_par_18_f_2000": "0.0", "minage_par_18_f_2001": "1.0"},
        {"iso3": "AFG", "minage_fem_any": "", "minage_par_18_f_2000": "0.0", "minage_par_18_f_2001": ""},
        {"iso3": "IRN", "minage_fem_any": "9.0", "minage_par_18_f_2000": "", "minage_par_18_f_2001": ""},
        {"iso3": "XXX", "minage_fem_any": "5.0"},
    ]
    scores = {9: 0, 1: 1, 2: 2, 3: 3, 5: 4}
    out = A.parse_coded_rows(rows, "minage_fem_any", scores, valid={"JPN", "AFG", "IRN"}, year=2023)
    assert out == {"JPN": [[2023, 4.0]], "IRN": [[2023, 0.0]]}
    yearly = A.parse_coded_rows(rows, "minage_par_18_f_*", {0: 0, 1: 1}, valid={"JPN", "AFG"}, year=None)
    assert yearly == {"JPN": [[2000, 0.0], [2001, 1.0]], "AFG": [[2000, 0.0]]}


def test_catalog_levels_are_well_formed():
    for ind in INDICATORS:
        if ind.get("levels"):
            scores = [lv[0] for lv in ind["levels"]]
            assert scores == sorted(scores) and len(set(scores)) == len(scores), ind["id"]
            assert ind["forecast"] is False, ind["id"]


# ---------------------------------------------------------------- 6-C1 セキュリティ(回帰テスト)
def _site():
    from pathlib import Path

    return Path(__file__).resolve().parent.parent / "world_atlas" / "site"


def test_vendor_files_match_manifest():
    from world_atlas.pipeline import vendor

    assert vendor.verify() == []


def test_security_headers_in_vercel_json():
    import json

    conf = json.loads((_site() / "vercel.json").read_text(encoding="utf-8"))
    all_headers = {h["key"]: h["value"] for rule in conf["headers"] if rule["source"] == "/(.*)" for h in rule["headers"]}
    csp = all_headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "unsafe-eval" not in csp
    assert "frame-ancestors 'none'" in csp and "object-src 'none'" in csp
    for key in ("Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy",
                "Permissions-Policy"):
        assert key in all_headers


def test_site_loads_nothing_from_external_hosts():
    """画面のコードが実行時に外部 URL を読み込まないこと(出典リンクと OGP は除く)。"""
    import re

    allowed = {"sekai-3d-zukan.vercel.app", "data.un.org", "unstats.un.org"}  # OGP・出典ページのリンク
    site = _site()
    files = [site / "index.html", site / "sw.js", *sorted((site / "js").glob("*.js"))]  # api/ はサーバー側なので対象外
    hosts = set()
    for f in files:
        hosts |= set(re.findall(r"https?://([a-zA-Z0-9.-]+)", f.read_text(encoding="utf-8")))
    assert hosts <= allowed, hosts - allowed


def test_local_server_applies_vercel_headers():
    from world_atlas.pipeline import serve

    rules = serve.load_rules()
    h = serve.headers_for("/index.html", rules)
    assert "Content-Security-Policy" in h
    assert serve.headers_for("/vendor/img/night-sky.png", rules)["Cache-Control"].endswith("immutable")


# ---------------------------------------------------------------- 完全版のデータ保護
def test_paid_data_is_not_in_public_folder():
    import json

    from world_atlas.pipeline.split_paid import free_indicators

    site = _site()
    free = free_indicators()
    public = {p.stem for p in (site / "data" / "series").glob("*.json")}
    assert public <= free, public - free  # 公開フォルダには無料の指標だけ
    assert not (site / "data" / "exports.json").exists()
    assert not (site / "data" / "flows" / "refugees.json").exists()
    latest = json.loads((site / "data" / "latest.json").read_text(encoding="utf-8"))
    assert set(latest) <= free
    countries = json.loads((site / "data" / "countries.json").read_text(encoding="utf-8"))["countries"]
    assert not any("factbook_ja" in c for c in countries.values())


def test_split_paid_is_idempotent(tmp_path):
    import json

    from world_atlas.pipeline.split_paid import split

    pub, paid = tmp_path / "data", tmp_path / "paid"
    (pub / "series").mkdir(parents=True)
    for i in ("a", "b"):
        (pub / "series" / f"{i}.json").write_text("{}", encoding="utf-8")
    (pub / "latest.json").write_text(json.dumps({"a": 1, "b": 2}), encoding="utf-8")
    (pub / "countries.json").write_text(json.dumps({"countries": {"JPN": {"factbook_ja": {"x": 1}}}}), encoding="utf-8")
    for _ in range(2):
        split(pub, paid, free={"a"})
    assert [p.name for p in (pub / "series").iterdir()] == ["a.json"]
    assert (paid / "series" / "b.json").exists()
    assert json.loads((pub / "latest.json").read_text(encoding="utf-8")) == {"a": 1}
    assert json.loads((paid / "latest_paid.json").read_text(encoding="utf-8")) == {"b": 2}
    assert json.loads((paid / "factbook_ja.json").read_text(encoding="utf-8")) == {"JPN": {"x": 1}}
