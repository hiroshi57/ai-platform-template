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
