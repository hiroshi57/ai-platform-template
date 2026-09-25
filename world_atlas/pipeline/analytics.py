"""データ整形・予測の純粋関数(標準ライブラリのみ・ネットワーク不要)。"""

from __future__ import annotations

import html
import re
from collections.abc import Iterable
from typing import Any

# ccTLD と ISO 3166-1 alpha-2 が異なる例外
_TLD_EXCEPTIONS = {"uk": "GB"}


def linear_forecast(points: Iterable[Iterable[float]], target_year: int, window: int = 10) -> dict | None:
    """直近 window 年の最小二乗直線で target_year の値を外挿する。

    points: [[year, value], ...](順不同可)
    戻り値: {"year", "value", "slope", "r2", "base_year", "n"} / データ不足なら None
    """
    pts = sorted((int(y), float(v)) for y, v in points if v is not None)
    if len(pts) < 3:
        return None
    last = pts[-1][0]
    recent = [(y, v) for y, v in pts if y > last - window]
    if len(recent) < 3:
        recent = pts[-3:]
    n = len(recent)
    mx = sum(y for y, _ in recent) / n
    my = sum(v for _, v in recent) / n
    sxx = sum((y - mx) ** 2 for y, _ in recent)
    if sxx == 0:
        return None
    sxy = sum((y - mx) * (v - my) for y, v in recent)
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_tot = sum((v - my) ** 2 for _, v in recent)
    ss_res = sum((v - (intercept + slope * y)) ** 2 for y, v in recent)
    r2 = 1.0 if ss_tot == 0 else max(0.0, 1.0 - ss_res / ss_tot)
    return {
        "year": target_year,
        "value": intercept + slope * target_year,
        "slope": slope,
        "r2": r2,
        "base_year": last,
        "n": n,
    }


def clamp_forecast(value: float, history: Iterable[float], unit: str) -> float:
    """外挿値を現実的な範囲に収める。

    - 履歴がすべて非負なら 0 未満にしない(人口・割合など)
    - 単位が % で履歴がすべて 100 以下なら 100 を超えない(総就学率のように 100 超があれば掛けない)
    """
    hist = [float(h) for h in history]
    if hist and min(hist) >= 0 and value < 0:
        value = 0.0
    if unit == "%" and hist and max(hist) <= 100 and value > 100:
        value = 100.0
    return value


def tld_to_iso2(tld_text: str | None) -> str | None:
    """Factbook の 'Internet country code'(例 '.jp')を ISO2 に変換する。"""
    if not tld_text:
        return None
    m = re.search(r"\.([a-z]{2})\b", tld_text.lower())
    if not m:
        return None
    code = m.group(1)
    return _TLD_EXCEPTIONS.get(code, code.upper())


def strip_html(text: str | None) -> str:
    """Factbook テキストの HTML タグを除去し、段落を改行にする。"""
    if not text:
        return ""
    t = re.sub(r"</p>\s*<p>", "\n", text)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    return "\n".join(line.strip() for line in t.split("\n") if line.strip())


def parse_wb_rows(rows: Iterable[dict], valid: set[str], keep_world: bool = True) -> dict[str, list]:
    """World Bank API の行を {ISO3: [[year, value], ...]}(年昇順)に変換する。"""
    out: dict[str, list] = {}
    for r in rows:
        iso3 = r.get("countryiso3code") or ""
        v = r.get("value")
        if v is None or not iso3:
            continue
        if iso3 not in valid and not (keep_world and iso3 == "WLD"):
            continue
        try:
            out.setdefault(iso3, []).append([int(r["date"]), float(v)])
        except (TypeError, ValueError, KeyError):
            continue
    for k in out:
        out[k].sort(key=lambda p: p[0])
    return out


def _num(x: Any) -> float | None:
    if x is None or x == "-" or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def parse_unhcr_items(
    items: Iterable[dict], key: str, valid: set[str], field: str = "refugees"
) -> dict[str, list]:
    """UNHCR population API の items を {ISO3: [[year, total], ...]} に集計する。"""
    acc: dict[str, dict[int, float]] = {}
    for it in items:
        iso3 = it.get(key)
        v = _num(it.get(field))
        if not iso3 or iso3 not in valid or v is None:
            continue
        y = int(it["year"])
        acc.setdefault(iso3, {})
        acc[iso3][y] = acc[iso3].get(y, 0.0) + v
    return {k: [[y, acc[k][y]] for y in sorted(acc[k])] for k in acc}


def round_coords(geom: Any, ndigits: int = 2) -> Any:
    """GeoJSON geometry の座標を丸めてファイルサイズを縮める。"""
    def rec(c):
        if isinstance(c, (int, float)):
            return round(float(c), ndigits)
        return [rec(x) for x in c]

    out = dict(geom)
    out["coordinates"] = rec(geom["coordinates"])
    return out


def rate_label(percentile: float) -> str:
    """望ましさのパーセンタイル(0〜1, 1が最良)を S〜D の評価ラベルにする。

    フロントエンド(app.js の rateLabel)と同じ閾値。
    """
    if percentile >= 0.9:
        return "S"
    if percentile >= 0.7:
        return "A"
    if percentile >= 0.4:
        return "B"
    if percentile >= 0.15:
        return "C"
    return "D"


def summarize_series(series: dict, window: int = 10, ndigits: int = 6) -> dict:
    """series/<id>.json の内容を、画面で使う軽量サマリに縮める。

    戻り値: {"w": [年, 値] | None, "c": {ISO3: [最新年, 最新値, 比較年, 比較値, 2030予測値 | None]}}
    比較年 = 最新年から window 年以内で最も古い観測(推移の向きを出すため)。
    """
    def r(v):
        return None if v is None else round(v, ndigits)

    out: dict = {"w": None, "c": {}}
    world = series.get("world") or []
    if world:
        out["w"] = [world[-1][0], r(world[-1][1])]
    for iso3, c in series.get("countries", {}).items():
        pts = c.get("s") or []
        if not pts:
            continue
        ly, lv = pts[-1]
        base = next((p for p in pts if p[0] >= ly - window), pts[-1])
        f = (c.get("f") or {}).get("value")
        out["c"][iso3] = [ly, r(lv), base[0], r(base[1]), r(f)]
    return out


# ---------------------------------------------------------------- Phase 2: 表形式データの読み取り
_XLSX_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_index(ref: str) -> int:
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def read_xlsx_sheet(data: bytes, sheet_name: str) -> list[list[str | None]]:
    """xlsx(bytes)の指定シートを行の list にする(標準ライブラリのみ・値は文字列)。

    workbook.xml のシート順で worksheets/sheetN.xml を対応づける(r:id が無い簡易ファイルにも対応)。
    """
    import io
    import xml.etree.ElementTree as ET  # noqa: S405 (信頼できる公開統計の xlsx のみを読む)
    import zipfile

    z = zipfile.ZipFile(io.BytesIO(data))
    wb = ET.fromstring(z.read("xl/workbook.xml"))  # noqa: S314
    sheets = [s.get("name") for s in wb.iter(f"{_XLSX_NS}sheet")]
    if sheet_name not in sheets:
        raise KeyError(f"sheet not found: {sheet_name} (have {sheets})")
    path = f"xl/worksheets/sheet{sheets.index(sheet_name) + 1}.xml"
    strings: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        sst = ET.fromstring(z.read("xl/sharedStrings.xml"))  # noqa: S314
        strings = [
            "".join(t.text or "" for t in si.iter(f"{_XLSX_NS}t")) for si in sst.findall(f"{_XLSX_NS}si")
        ]
    out: list[list[str | None]] = []
    root = ET.fromstring(z.read(path))  # noqa: S314
    for row in root.iter(f"{_XLSX_NS}row"):
        vals: list[str | None] = []
        for c in row.findall(f"{_XLSX_NS}c"):
            idx = _col_index(c.get("r", "")) if c.get("r") else len(vals)
            while len(vals) < idx:
                vals.append(None)
            v = c.find(f"{_XLSX_NS}v")
            if v is None:
                is_ = c.find(f"{_XLSX_NS}is")
                val = "".join(t.text or "" for t in is_.iter(f"{_XLSX_NS}t")) if is_ is not None else None
            elif c.get("t") == "s":
                val = strings[int(v.text)]
            else:
                val = v.text
            vals.append(val)
        out.append(vals)
    return out


def parse_wide_rows(rows: list[list], iso_col: str, valid: set[str]) -> dict[str, list]:
    """横持ち(列=年)の表を {ISO3: [[year, value], ...]} にする。

    年の列名は "2001" や "BER.ind.2001" のように末尾が4桁の年であればよい。
    """
    header = [str(h or "") for h in rows[0]]
    ic = header.index(iso_col)
    year_cols = [
        (i, int(h[-4:])) for i, h in enumerate(header) if len(h) >= 4 and h[-4:].isdigit() and i != ic
    ]
    out: dict[str, list] = {}
    for r in rows[1:]:
        if ic >= len(r) or r[ic] not in valid:
            continue
        pts = []
        for i, y in year_cols:
            v = _num(r[i]) if i < len(r) and r[i] not in ("NA", "N/A") else None
            if v is not None:
                pts.append([y, v])
        if pts:
            out[r[ic]] = sorted(pts)
    return out


def parse_long_rows(rows: Iterable[dict], iso_key: str, year_key: str, value_key: str,
                    valid: set[str]) -> dict[str, list]:
    """縦持ち(1行=国×年)の表を {ISO3: [[year, value], ...]} にする。"""
    out: dict[str, list] = {}
    for r in rows:
        iso3 = r.get(iso_key)
        v = _num(r.get(value_key))
        if iso3 not in valid or v is None:
            continue
        out.setdefault(iso3, []).append([int(r[year_key]), v])
    for k in out:
        out[k].sort()
    return out


_INDEP_KEYWORDS = ("from", "declared", "independence", "established", "unification", "unified", "founded",
                   "recognized", "proclaimed")
_MONTHS = ("January|February|March|April|May|June|July|August|September|October|November|December")


def parse_independence_year(text: str | None) -> int | None:
    """CIA Factbook の Independence 欄から独立(建国)年を取り出す。

    直後の括弧書きに独立を示す語(from / declared / established など)がある最初の日付だけを採用する。
    憲法の制定日しか書かれていない国(日本など)は None。
    """
    if not text:
        return None
    for m in re.finditer(rf"\b\d{{1,2}} (?:{_MONTHS}) (\d{{3,4}})\b(?:\s*\(([^)]*)\))?", text):
        note = (m.group(2) or "").lower()
        if any(k in note for k in _INDEP_KEYWORDS):
            return int(m.group(1))
    return None


def summarize_exports(rows: Iterable[dict], products: dict[str, dict], top: int = 8) -> dict | None:
    """Atlas の countryProductYear の行から、最新年の上位品目と分野別の割合をまとめる。

    products: {productId: {"code": HS2 コード, "sector": 分野名}}
    戻り値: {"year", "total", "top": [[code, value, share], ...], "sectors": {sector: share}}
    """
    rows = [r for r in rows if r.get("productId") in products and _num(r.get("exportValue"))]
    if not rows:
        return None
    year = max(int(r["year"]) for r in rows)
    cur = [r for r in rows if int(r["year"]) == year]
    total = sum(float(r["exportValue"]) for r in cur)
    if total <= 0:
        return None
    items = sorted(cur, key=lambda r: -float(r["exportValue"]))
    top_items = [[products[r["productId"]]["code"], float(r["exportValue"]),
                  round(float(r["exportValue"]) / total, 4)] for r in items[:top]]
    sectors: dict[str, float] = {}
    for r in cur:
        s = products[r["productId"]]["sector"]
        sectors[s] = sectors.get(s, 0.0) + float(r["exportValue"])
    return {
        "year": year,
        "total": total,
        "top": top_items,
        "sectors": {k: round(v / total, 4) for k, v in sorted(sectors.items(), key=lambda kv: -kv[1])},
    }


# ---------------------------------------------------------------- Phase 3: 国連 SDG Global Database
def parse_sdg_code(code: str) -> tuple[str, dict[str, list[str]]]:
    """"SERIES|Dim=A/B;Dim2=C" を (系列コード, {区分: [許す値(優先順)]}) にする。"""
    series, _, rest = code.partition("|")
    filters: dict[str, list[str]] = {}
    for part in filter(None, rest.split(";")):
        k, _, v = part.partition("=")
        filters[k] = v.split("/")
    return series, filters


def _sdg_value(v) -> float | None:
    if v is None:
        return None
    s = str(v).strip().lstrip("<>").strip()
    n = _num(s)
    return None if n is None or n != n else n  # NaN を除く


def parse_unsdg_rows(rows: Iterable[dict], filters: dict[str, list[str]], m49_to_iso3: dict[str, str],
                     valid: set[str]) -> dict[str, list]:
    """SDG API の Series/Data の行を {ISO3: [[year, value], ...]} にする。

    - filters の区分がすべて許す値の行だけを使う(例: 男女計・全地域)。
    - 同じ国・年に複数行あるときは、filters に先に書いた値の行を優先する。
    - geoAreaCode "1" は世界全体(WLD)。
    """
    best: dict[tuple[str, int], tuple[int, float]] = {}
    for r in rows:
        code = str(r.get("geoAreaCode", ""))
        iso3 = "WLD" if code == "1" else m49_to_iso3.get(code)
        if not iso3 or (iso3 != "WLD" and iso3 not in valid):
            continue
        dims = r.get("dimensions") or {}
        rank = 0
        ok = True
        for dim, allowed in filters.items():
            val = dims.get(dim)
            if val not in allowed:
                ok = False
                break
            rank += allowed.index(val)
        v = _sdg_value(r.get("value"))
        if not ok or v is None or r.get("timePeriodStart") is None:
            continue
        key = (iso3, int(float(r["timePeriodStart"])))
        if key not in best or rank < best[key][0]:
            best[key] = (rank, v)
    out: dict[str, list] = {}
    for (iso3, y), (_, v) in sorted(best.items()):
        out.setdefault(iso3, []).append([y, v])
    return out


# ---------------------------------------------------------------- 運用: 更新の差分レポート
def _max_year(summary: dict) -> int | None:
    ys = [v[0] for v in (summary.get("c") or {}).values()]
    return max(ys) if ys else None


def diff_latest(old: dict, new: dict) -> dict:
    """前回と今回の latest.json をくらべ、指標ごとの変化をまとめる。

    status: new(新しい指標) / updated(新しい年や国のデータが入った) / unchanged
    updated = 最新の年が進んだ国 + 新しくデータが入った国 の数
    """
    rows = []
    for iid, n in new.items():
        o = old.get(iid)
        nc = n.get("c") or {}
        if o is None:
            rows.append({"id": iid, "status": "new", "year_from": None, "year_to": _max_year(n),
                         "countries_from": 0, "countries_to": len(nc), "updated": len(nc)})
            continue
        oc = o.get("c") or {}
        updated = sum(1 for k, v in nc.items() if k not in oc or v[0] > oc[k][0])
        rows.append({
            "id": iid, "status": "updated" if updated or len(nc) != len(oc) else "unchanged",
            "year_from": _max_year(o), "year_to": _max_year(n),
            "countries_from": len(oc), "countries_to": len(nc), "updated": updated,
        })
    rows.sort(key=lambda r: ({"new": 0, "updated": 1, "unchanged": 2}[r["status"]], -r["updated"]))
    return {
        "indicators": rows,
        "removed": sorted(k for k in old if k not in new),
        "changed_count": sum(1 for r in rows if r["status"] != "unchanged"),
    }


def update_report_markdown(report: dict, sources: dict, names: dict[str, str], generated_at: str) -> str:
    """PR 本文・Issue 用の Markdown。取得失敗と、新しくなったデータを一覧にする。"""
    failed = {k: v for k, v in sources.items() if not v.get("ok")}
    lines = [f"## せかい3Dデジタル図鑑 データ更新レポート({generated_at[:16].replace('T', ' ')} UTC)", ""]
    lines.append(f"- 取得成功 {len(sources) - len(failed)} / {len(sources)} ソース")
    lines.append(f"- データが新しくなった指標 {report['changed_count']} / {len(report['indicators'])}")
    if failed:
        lines += ["", "### ⚠️ 取得に失敗したソース(前回のデータを表示し続けています)", ""]
        lines += [f"- `{k}`: {str(v.get('error', ''))[:200]}" for k, v in sorted(failed.items())]
    changed = [r for r in report["indicators"] if r["status"] != "unchanged"]
    if changed:
        lines += ["", "### 🆕 新しくなったデータ", ""]
        lines += ["| 指標 | 最新の年 | 国の数 | 更新された国 |", "|---|---|---|---|"]
        for r in changed:
            yr = f"{r['year_from']} → {r['year_to']}" if r["year_from"] != r["year_to"] else f"{r['year_to']}"
            label = names.get(r["id"], r["id"]) + ("(新規)" if r["status"] == "new" else "")
            lines.append(f"| {label} | {yr} | {r['countries_from']} → {r['countries_to']} | {r['updated']} |")
    if report["removed"]:
        lines += ["", "### 🗑️ なくなった指標", ""] + [f"- {k}" for k in report["removed"]]
    return "\n".join(lines) + "\n"
