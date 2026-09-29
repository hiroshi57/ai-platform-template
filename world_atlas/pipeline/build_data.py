"""せかい3Dデジタル図鑑: データ収集・整形スクリプト(標準ライブラリのみ)。

使い方:
    python -m world_atlas.pipeline.build_data                 # 全ソースを取得
    python -m world_atlas.pipeline.build_data --skip wiki     # 日本語Wikipedia概要を省略
    python -m world_atlas.pipeline.build_data --only wb,undp  # 指定ソースの指標だけ更新

出力先(既定): world_atlas/site/data/
    meta.json            … 生成日時・各ソースの取得結果(成功/失敗・件数)
    catalog.json         … 章・指標・SDGs 目標の定義
    countries.json       … 国の基本情報(日本語名・地域・所得・首都・CIA Factbook・Wikipedia 概要)
    series/<id>.json     … 指標ごとの時系列 + 2030 年予測
    latest.json          … 全指標の最新値・10年前の値・2030予測(国カード/SDGs/レーダー用の軽量版)
    geo/countries.json   … 国境ポリゴン(Natural Earth 1:110m, 座標を丸めて軽量化)
    timeline.json        … 世界史年表

取得に失敗したソースは既存ファイルを上書きしない(前回データを残す)。
これにより週次の自動更新で一時的な障害があっても図鑑が壊れない。
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from . import analytics as A
from .factbook_ja import merge_translations
from .indicators import CATEGORIES, INDICATORS, SDG_GOALS, validate_catalog
from .products_ja import HS2_JA, SECTOR_COLOR, SECTOR_JA
from .split_paid import load_latest_all, series_file
from .split_paid import split as split_paid

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE.parent / "site" / "data"
# 一部の大学サイト(ND-GAIN・EPI)は一般的なブラウザ形式でない UA を 403 で拒否するため、互換形式にする
UA = "Mozilla/5.0 (compatible; WorldAtlasBuilder/0.1; educational digital atlas; +https://github.com/hiroshi57)"
FORECAST_YEAR = 2030
MIN_YEAR = 1960  # 近年指標(wb/undp/unhcr)の下限。歴史指標(owid)は制限しない

UNDP_CSV = "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv"
FACTBOOK_API = "https://api.github.com/repos/factbook/factbook.json/contents/"
FACTBOOK_RAW = "https://raw.githubusercontent.com/factbook/factbook.json/master/"
WIKI_SUMMARY = "https://ja.wikipedia.org/api/rest_v1/page/summary/"
HARVARD_DOI = "doi:10.7910/DVN/XTAQMC"  # Growth Projections and Complexity Rankings
HARVARD_FILE = "growth_proj_eci_rankings.csv"
EPI_DOWNLOADS = "https://epi.yale.edu/{year}/downloads"  # 版ごとに年が入る(隔年発行)
EPI_RESULTS_RE = r"/sites/default/files/[^\"']*epi(\d{4})results[^\"']*\.xlsx"
NDGAIN_DOWNLOADS = "https://gain.nd.edu/our-work/country-index/download-data/"
ATLAS_GRAPHQL = "https://atlas.hks.harvard.edu/api/graphql"
NE_GEOJSON = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
              "ne_110m_admin_0_countries.geojson")

# 日本語名の上書き(ICU の正式名が長すぎる/教科書表記と違うもの)
NAME_OVERRIDES = {
    "HKG": "香港", "MAC": "マカオ", "COD": "コンゴ民主共和国", "COG": "コンゴ共和国",
    "PSE": "パレスチナ", "TWN": "台湾",
}
# 日本語版 Wikipedia の記事名(国名と異なるもの)
WIKI_TITLES = {
    "KOR": "大韓民国", "PRK": "朝鮮民主主義人民共和国", "CHN": "中華人民共和国", "PSE": "パレスチナ国",
    "CHI": "チャンネル諸島", "GEO": "ジョージア (国)", "MAC": "マカオ", "HKG": "香港",
    "TWN": "台湾", "COG": "コンゴ共和国", "COD": "コンゴ民主共和国", "PRI": "プエルトリコ",
}
REGION_JA = {
    "EAS": "東アジア・太平洋", "ECS": "ヨーロッパ・中央アジア", "LCN": "中南米・カリブ",
    "MEA": "中東・北アフリカ", "NAC": "北アメリカ", "SAS": "南アジア", "SSF": "サハラ以南アフリカ",
}
INCOME_JA = {
    "HIC": "高所得国", "UMC": "高中所得国", "LMC": "低中所得国", "LIC": "低所得国", "INX": "分類なし",
}
# Natural Earth の ADM0_A3 → World Bank ISO3
NE_REMAP = {"KOS": "XKX", "SDS": "SSD", "SOL": "SOM", "CYN": "CYP", "PSX": "PSE", "SAH": "ESH"}

FACTBOOK_FIELDS = {
    "background": ("Introduction", "Background"),
    "location": ("Geography", "Location"),
    "area_comparative": ("Geography", "Area - comparative"),
    "climate": ("Geography", "Climate"),
    "terrain": ("Geography", "Terrain"),
    "natural_resources": ("Geography", "Natural resources"),
    "natural_hazards": ("Geography", "Natural hazards"),
    "ethnic_groups": ("People and Society", "Ethnic groups"),
    "languages": ("People and Society", "Languages"),
    "religions": ("People and Society", "Religions"),
    "government_type": ("Government", "Government type"),
    "independence": ("Government", "Independence"),
    "national_holiday": ("Government", "National holiday"),
    "environmental_issues": ("Environment", "Environmental issues"),
    "exports_commodities": ("Economy", "Exports - commodities"),
    "agricultural_products": ("Economy", "Agricultural products"),
}


def log(msg: str) -> None:
    print(f"[build] {msg}", file=sys.stderr, flush=True)


def http_get(url: str, timeout: int = 60, retries: int = 3) -> bytes:
    last: Exception | None = None
    for k in range(retries):
        try:
            if not url.startswith("https://"):
                raise ValueError(f"https のみ許可: {url}")
            req = urllib.request.Request(url, headers={"User-Agent": UA})  # noqa: S310 (https のみ)
            with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (https のみ)
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"GET failed: {url}: {last}")


def http_json(url: str, **kw):
    return json.loads(http_get(url, **kw).decode("utf-8"))


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


# ---------------------------------------------------------------- 国一覧
def load_countries() -> dict[str, dict]:
    names = json.loads((HERE / "names_ja.json").read_text(encoding="utf-8"))
    _, rows = http_json("https://api.worldbank.org/v2/country?format=json&per_page=400")
    out: dict[str, dict] = {}
    for r in rows:
        if r["region"]["id"] == "NA":
            continue
        iso3 = r["id"]
        out[iso3] = {
            "iso3": iso3,
            "iso2": r["iso2Code"],
            "name_ja": NAME_OVERRIDES.get(iso3) or (names.get(iso3) or {}).get("ja") or r["name"],
            "name_en": r["name"],
            "region": r["region"]["id"],
            "region_ja": REGION_JA.get(r["region"]["id"], r["region"]["value"].strip()),
            "income": r["incomeLevel"]["id"],
            "income_ja": INCOME_JA.get(r["incomeLevel"]["id"], r["incomeLevel"]["value"]),
            "capital": r["capitalCity"] or "",
            "lat": float(r["latitude"]) if r["latitude"] else None,
            "lng": float(r["longitude"]) if r["longitude"] else None,
        }
    # World Bank の一覧に無いが、CIA / OWID 等にデータがある地域
    out.setdefault("TWN", {
        "iso3": "TWN", "iso2": "TW", "name_ja": "台湾", "name_en": "Taiwan", "region": "EAS",
        "region_ja": REGION_JA["EAS"], "income": "HIC", "income_ja": INCOME_JA["HIC"],
        "capital": "Taipei", "lat": 25.03, "lng": 121.56, "note": "World Bank の国一覧には含まれない",
    })
    return out


# ---------------------------------------------------------------- 指標ソース
def fetch_wb(code: str, valid: set[str]) -> dict[str, list]:
    this_year = datetime.now(timezone.utc).year
    rows: list[dict] = []
    page, pages = 1, 1
    while page <= pages:
        url = (f"https://api.worldbank.org/v2/country/all/indicator/{code}"
               f"?format=json&per_page=20000&date={MIN_YEAR}:{this_year}&page={page}")
        data = http_json(url, timeout=120)
        if len(data) < 2 or data[1] is None:
            raise RuntimeError(f"World Bank: no data for {code}: {str(data[0])[:200]}")
        pages = int(data[0].get("pages", 1))
        rows.extend(data[1])
        page += 1
    return A.parse_wb_rows(rows, valid=valid, keep_world=True)


def fetch_unhcr(code: str, valid: set[str]) -> dict[str, list]:
    field, side = code.split(":")  # 例 "refugees:coo"
    this_year = datetime.now(timezone.utc).year
    items: list[dict] = []
    page, max_pages = 1, 1
    while page <= max_pages:
        q = urllib.parse.urlencode({"limit": 10000, "yearFrom": 1990, "yearTo": this_year,
                                    f"{side}_all": "true", "page": page})
        d = http_json(f"https://api.unhcr.org/population/v1/population/?{q}", timeout=120)
        items.extend(d.get("items", []))
        max_pages = int(d.get("maxPages", 1))
        page += 1
    out = A.parse_unhcr_items(items, key=f"{side}_iso", valid=valid, field=field)
    # 世界全体 = 各国合計
    world: dict[int, float] = {}
    for pts in out.values():
        for y, v in pts:
            world[y] = world.get(y, 0.0) + v
    out["WLD"] = [[y, world[y]] for y in sorted(world)]
    return out


_undp_cache: list[dict] | None = None


def fetch_undp(prefix: str, valid: set[str]) -> dict[str, list]:
    global _undp_cache
    if _undp_cache is None:
        text = http_get(UNDP_CSV, timeout=180).decode("latin-1")
        _undp_cache = list(csv.DictReader(io.StringIO(text)))
    out: dict[str, list] = {}
    for row in _undp_cache:
        iso3 = row.get("iso3", "")
        if iso3 == "ZZK.WORLD":
            iso3 = "WLD"
        if iso3 not in valid and iso3 != "WLD":
            continue
        pts = []
        for col, val in row.items():
            if not col or not col.startswith(prefix + "_"):
                continue
            tail = col[len(prefix) + 1:]
            if len(tail) == 4 and tail.isdigit() and val not in ("", None):
                try:
                    pts.append([int(tail), float(val)])
                except ValueError:
                    pass
        if pts:
            out[iso3] = sorted(pts)
    return out


_owid_cache: dict[str, list[dict]] = {}


def fetch_owid(code: str, valid: set[str]) -> dict[str, list]:
    slug, column = code.split(":", 1)
    if slug not in _owid_cache:
        url = f"https://ourworldindata.org/grapher/{slug}.csv?v=1&csvType=full&useColumnShortNames=true"
        _owid_cache[slug] = list(csv.DictReader(io.StringIO(http_get(url, timeout=180).decode("utf-8"))))
    out: dict[str, list] = {}
    for row in _owid_cache[slug]:
        iso3 = row.get("code") or ""
        if iso3 == "OWID_WRL":
            iso3 = "WLD"
        if iso3 not in valid and iso3 != "WLD":
            continue
        if column == "*":
            vals = [A._num(v) for k, v in row.items() if k not in ("entity", "code", "year", "owid_region")]
            vals = [v for v in vals if v is not None]
            v = sum(vals) if vals else None
        else:
            v = A._num(row.get(column))
        if v is None:
            continue
        out.setdefault(iso3, []).append([int(row["year"]), v])
    for k in out:
        out[k].sort()
    return out


_harvard_cache: list[dict] | None = None


def fetch_harvard(column: str, valid: set[str]) -> dict[str, list]:
    """ハーバード大 Growth Lab の ECI ランキング(Harvard Dataverse)から列を取り出す。"""
    global _harvard_cache
    if _harvard_cache is None:
        files = http_json("https://dataverse.harvard.edu/api/datasets/:persistentId/versions/:latest/files"
                          f"?persistentId={HARVARD_DOI}")["data"]
        fid = next(f["dataFile"]["id"] for f in files if f["dataFile"].get("filename") == HARVARD_FILE)
        raw = http_get(f"https://dataverse.harvard.edu/api/access/datafile/{fid}", timeout=120)
        text = raw.decode("utf-8-sig")
        _harvard_cache = list(csv.DictReader(io.StringIO(text)))
    return A.parse_long_rows(_harvard_cache, "country_iso3_code", "year", column, valid)


def _find_link(page_url: str, pattern: str) -> str:
    html_text = http_get(page_url).decode("utf-8", "replace")
    m = re.search(pattern, html_text)
    if not m:
        raise RuntimeError(f"download link not found on {page_url}: {pattern}")
    return urllib.parse.urljoin(page_url, m.group(0))


_epi_cache: tuple[int, list] | None = None


def fetch_epi(column: str, valid: set[str]) -> dict[str, list]:
    """イェール大 EPI の結果 xlsx(最新版)から列を取り出す。年は版の年(例 2026)。"""
    global _epi_cache
    if _epi_cache is None:
        this_year = datetime.now(timezone.utc).year
        url, last_err = None, None
        for y in range(this_year, this_year - 4, -1):  # 最新版のページを新しい年から探す
            try:
                url = _find_link(EPI_DOWNLOADS.format(year=y), EPI_RESULTS_RE)
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
        if url is None:
            raise RuntimeError(f"EPI results not found: {last_err}")
        year = int(re.search(r"epi(\d{4})results", url).group(1))
        _epi_cache = (year, A.read_xlsx_sheet(http_get(url, timeout=180), "data"))
    year, rows = _epi_cache
    header = rows[0]
    ic, vc = header.index("iso"), header.index(column)
    out = {}
    for r in rows[1:]:
        iso3 = r[ic] if ic < len(r) else None
        v = A._num(r[vc]) if vc < len(r) and r[vc] not in ("NA", None) else None
        if iso3 in valid and v is not None:
            out[iso3] = [[year, v]]
    return out


_ndgain_zip: bytes | None = None


def fetch_ndgain(name: str, valid: set[str]) -> dict[str, list]:
    """ノートルダム大 ND-GAIN Country Index の zip から <name>/<name>.csv(横持ち)を読む。"""
    global _ndgain_zip
    if _ndgain_zip is None:
        url = _find_link(NDGAIN_DOWNLOADS, r"/assets/\d+/ndgain_countryindex_\d+\.zip")
        _ndgain_zip = http_get(url, timeout=180)
    z = zipfile.ZipFile(io.BytesIO(_ndgain_zip))
    member = next(n for n in z.namelist() if n.endswith(f"/{name}/{name}.csv") and "__MACOSX" not in n)
    rows = list(csv.reader(io.TextIOWrapper(z.open(member), encoding="utf-8-sig")))
    return A.parse_wide_rows(rows, iso_col="ISO3", valid=valid)


_m49_cache: dict[str, str] | None = None


def m49_to_iso3() -> dict[str, str]:
    """国連 M49 の数字コード → ISO3。ハーバード大 Atlas の国一覧(M49 を拡張したID)を使う。"""
    global _m49_cache
    if _m49_cache is None:
        try:
            locs = atlas_query("{ locationCountry { countryId iso3Code } }")["locationCountry"]
            _m49_cache = {x["countryId"].split("-")[-1]: x["iso3Code"] for x in locs}
        except Exception as e:  # noqa: BLE001  Atlas が落ちていたら Dataverse の ECI 表で代用
            log(f"M49 map via Atlas failed ({e}); using Harvard Dataverse table")
            fetch_harvard("eci_hs92", set())
            _m49_cache = {r["country_id"]: r["country_iso3_code"] for r in (_harvard_cache or [])}
    return _m49_cache


def fetch_unsdg(code: str, valid: set[str]) -> dict[str, list]:
    """国連統計部 SDG Global Database API から1系列を取り、区分(男女計など)で絞り込む。"""
    series, filters = A.parse_sdg_code(code)
    rows: list[dict] = []
    page, size = 1, 5000
    while True:
        q = urllib.parse.urlencode({"seriesCode": series, "pageSize": size, "page": page})
        d = http_json(f"https://unstats.un.org/sdgapi/v1/sdg/Series/Data?{q}", timeout=180)
        rows.extend(d.get("data") or [])
        if page * size >= int(d.get("totalElements") or 0) or not d.get("data"):
            break
        page += 1
    return A.parse_unsdg_rows(rows, filters, m49_to_iso3(), valid)


def fetch_uis(indicator: str, valid: set[str]) -> dict[str, list]:
    """UNESCO 統計研究所(UIS)の Data API から1指標を全ての国について取る。"""
    q = urllib.parse.urlencode({"indicator": indicator})
    d = http_json(f"https://api.uis.unesco.org/api/public/data/indicators?{q}", timeout=180)
    out: dict[str, list] = {}
    for r in d.get("records", []):
        iso3, v = r.get("geoUnit"), A._num(r.get("value"))
        if iso3 in valid and v is not None and r.get("year") is not None:
            out.setdefault(iso3, []).append([int(r["year"]), v])
    for k in out:
        out[k].sort()
    return out


# ---------------------------------------------------------------- UCLA WORLD(ゲストブック付き)
GUESTBOOK_FILE = Path.home() / "sekai-zukan.guestbook.env.txt"  # リポジトリの外(個人情報をコミットしない)
_ucla_cache: dict[str, tuple[int | None, list[dict]]] = {}


def _guestbook_payload(guestbook_id: int) -> dict:
    """ゲストブックの回答を組み立てる。回答内容は GUESTBOOK_FILE か環境変数 WORLD_GB_* から読む。"""
    from .factbook_ja import load_env_file

    load_env_file(GUESTBOOK_FILE)
    need = [f"WORLD_GB_{k}" for k in ("NAME", "EMAIL", "INSTITUTION", "POSITION", "COUNTRY")]
    miss = [k for k in need if not os.environ.get(k)]
    if miss:
        raise RuntimeError(f"ゲストブックの回答が未設定です({', '.join(miss)}): {GUESTBOOK_FILE}")
    gb = http_json(f"https://dataverse.harvard.edu/api/guestbooks/{guestbook_id}")["data"]
    answers = []
    for q in gb.get("customQuestions", []):
        text = q["question"].lower()
        if "country" in text:
            answers.append({"id": q["id"], "value": os.environ["WORLD_GB_COUNTRY"]})
        elif "use" in text or "purpose" in text:
            purpose = os.environ.get("WORLD_GB_PURPOSE", "Non-commercial education")
            answers.append({"id": q["id"], "value": purpose})
        elif q.get("required"):
            raise RuntimeError(f"想定外の必須質問があります: {q['question']}")
    return {"guestbookResponse": {
        "name": os.environ["WORLD_GB_NAME"], "email": os.environ["WORLD_GB_EMAIL"],
        "institution": os.environ["WORLD_GB_INSTITUTION"], "position": os.environ["WORLD_GB_POSITION"],
        "answers": answers,
    }}


def fetch_ucla(code: str, valid: set[str]) -> dict[str, list]:
    """UCLA WORLD Policy Analysis Center の表(Harvard Dataverse)をゲストブックに回答して取得する。"""
    doi, column = code.split("|", 1)
    ind = next(i for i in INDICATORS if i["source"] == "ucla" and i["code"] == code)
    if doi not in _ucla_cache:
        meta = http_json(f"https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId={doi}")["data"]
        ver = meta["latestVersion"]
        fields = ver["metadataBlocks"]["citation"]["fields"]
        title = next((f["value"] for f in fields if f["typeName"] == "title"), "")
        m = re.search(r"(19|20)\d{2}", title)
        year = int(m.group(0)) if m else None
        tab = next(f["dataFile"] for f in ver["files"] if f["dataFile"].get("filename", "").endswith(".tab"))
        gb_id = tab.get("guestbookId") or meta.get("guestbookId") or ver.get("guestbookId")
        if not gb_id:
            gb_id = 614  # WORLD Policy Analysis Center Guestbook
        req = urllib.request.Request(  # noqa: S310 (固定の https URL)
            f"https://dataverse.harvard.edu/api/access/datafile/{tab['id']}",
            data=json.dumps(_guestbook_payload(int(gb_id))).encode("utf-8"),
            headers={"User-Agent": UA, "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            signed = json.loads(r.read().decode("utf-8"))["data"]["signedUrl"]
        text = http_get(signed, timeout=180).decode("utf-8", "replace")
        _ucla_cache[doi] = (year, list(csv.DictReader(io.StringIO(text), delimiter="	")))
    year, rows = _ucla_cache[doi]
    codes = {int(k): v for k, v in ind["codes"].items()}
    return A.parse_coded_rows(rows, column, codes, valid, year)


FETCHERS = {"wb": fetch_wb, "unhcr": fetch_unhcr, "undp": fetch_undp, "owid": fetch_owid,
            "harvard": fetch_harvard, "epi": fetch_epi, "ndgain": fetch_ndgain,
            "unsdg": fetch_unsdg, "uis": fetch_uis, "ucla": fetch_ucla}


def atlas_query(query: str) -> dict:
    """ハーバード大 Atlas of Economic Complexity の GraphQL API を呼ぶ。"""
    req = urllib.request.Request(  # noqa: S310 (固定の https URL)
        ATLAS_GRAPHQL, data=json.dumps({"query": query}).encode("utf-8"),
        headers={"User-Agent": UA, "Content-Type": "application/json"},
    )
    last: Exception | None = None
    for k in range(6):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:  # noqa: S310
                d = json.loads(r.read().decode("utf-8"))
            if d.get("errors"):
                raise RuntimeError(str(d["errors"])[:200])
            return d["data"]
        except Exception as e:  # noqa: BLE001
            last = e
            # 429(回数制限)のときは長めに待つ
            time.sleep((8 if "429" in str(e) else 2) * (k + 1))
    raise RuntimeError(f"Atlas GraphQL failed: {last}")


def fetch_exports(valid: set[str]) -> dict:
    """国ごとの主な輸出品目(HS 2桁+サービス)と分野別の割合(ハーバード大 Growth Lab Atlas)。"""
    prods = atlas_query(
        "{ productHs92(productLevel: 2) { productId code topParent { nameShortEn } } }"
    )["productHs92"]
    products = {
        p["productId"]: {
            "code": p["code"], "sector": (p.get("topParent") or {}).get("nameShortEn") or "Other",
        }
        for p in prods
    }
    locs = atlas_query("{ locationCountry { countryId iso3Code } }")["locationCountry"]
    ids = {x["iso3Code"]: int(x["countryId"].split("-")[-1]) for x in locs if x["iso3Code"] in valid}
    y1 = datetime.now(timezone.utc).year
    q = ("{ countryProductYear(countryId: %d, productClass: HS92, productLevel: 2, yearMin: %d, yearMax: %d) "
         "{ productId year exportValue } }")

    def one(item):
        iso3, cid = item
        try:
            rows = atlas_query(q % (cid, y1 - 4, y1))["countryProductYear"]
            return iso3, A.summarize_exports(rows, products)
        except Exception as e:  # noqa: BLE001
            log(f"exports skip {iso3}: {e}")
            return iso3, None

    out = {}
    with ThreadPoolExecutor(max_workers=2) as ex:  # Atlas API の回数制限に配慮して同時2本まで
        for iso3, summ in ex.map(one, sorted(ids.items())):
            if summ:
                out[iso3] = summ
    if not out:
        raise RuntimeError("no export data")
    return {"source": "Harvard Growth Lab, Atlas of Economic Complexity (HS92)", "countries": out}


def fetch_refugee_flows(valid: set[str], top: int = 80) -> dict:
    """UNHCR: 最新年の「出身国 → 受入国」の難民の流れ上位(地球儀の弧に使う)。"""
    this_year = datetime.now(timezone.utc).year
    for year in range(this_year, this_year - 4, -1):
        items: list[dict] = []
        page, max_pages = 1, 1
        while page <= max_pages:
            q = urllib.parse.urlencode({"limit": 10000, "yearFrom": year, "yearTo": year,
                                        "coo_all": "true", "coa_all": "true", "page": page})
            d = http_json(f"https://api.unhcr.org/population/v1/population/?{q}", timeout=120)
            items.extend(d.get("items", []))
            max_pages = int(d.get("maxPages", 1))
            page += 1
        flows = []
        for it in items:
            o, a, n = it.get("coo_iso"), it.get("coa_iso"), A._num(it.get("refugees"))
            if o in valid and a in valid and o != a and n and n > 0:
                flows.append([o, a, int(n)])
        if flows:
            flows.sort(key=lambda f: -f[2])
            return {"year": year, "flows": flows[:top], "total_pairs": len(flows)}
    raise RuntimeError("UNHCR flows: no data in recent years")


def build_series(ind: dict, raw: dict[str, list]) -> dict:
    countries = {}
    for iso3, pts in raw.items():
        if iso3 == "WLD":
            continue
        entry: dict = {"s": pts}
        if ind.get("forecast", True):
            f = A.linear_forecast(pts, FORECAST_YEAR)
            # 最新データが古すぎる(8年以上前)国は予測しない
            if f and f["base_year"] >= FORECAST_YEAR - 16:
                f["value"] = A.clamp_forecast(f["value"], [v for _, v in pts], ind["unit"])
                entry["f"] = {k: (round(v, 6) if isinstance(v, float) else v) for k, v in f.items()}
        countries[iso3] = entry
    years = [y for pts in raw.values() for y, _ in pts]
    return {
        "id": ind["id"],
        "years": [min(years), max(years)] if years else None,
        "world": raw.get("WLD", []),
        "countries": countries,
    }


# ---------------------------------------------------------------- CIA Factbook
def _fb_text(node) -> str:
    if not isinstance(node, dict):
        return ""
    if "text" in node:
        return A.strip_html(node["text"])
    # 小項目(例 Elevation: highest point / lowest point)を連結
    parts = []
    for k, v in node.items():
        if isinstance(v, dict) and "text" in v:
            parts.append(f"{k}: {A.strip_html(v['text'])}")
    return "\n".join(parts)


def fetch_factbook(iso2_to_iso3: dict[str, str]) -> dict[str, dict]:
    listing = http_json(FACTBOOK_API)
    dirs = [x["name"] for x in listing if x["type"] == "dir" and x["name"] not in ("meta", "oceans", "world")]
    paths: list[str] = []
    for d in dirs:
        for f in http_json(FACTBOOK_API + d):
            if f["name"].endswith(".json"):
                paths.append(f"{d}/{f['name']}")
    log(f"factbook: {len(paths)} files")

    def one(p: str):
        try:
            return p, json.loads(http_get(FACTBOOK_RAW + p, timeout=60).decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"factbook skip {p}: {e}")
            return p, None

    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for p, d in ex.map(one, paths):
            if not d:
                continue
            tld = _fb_text(d.get("Communications", {}).get("Internet country code"))
            iso2 = A.tld_to_iso2(tld)
            iso3 = iso2_to_iso3.get(iso2 or "")
            if not iso3:
                continue
            rec = {k: _fb_text(d.get(sec, {}).get(field)) for k, (sec, field) in FACTBOOK_FIELDS.items()}
            elev = d.get("Geography", {}).get("Elevation", {})
            rec["highest_point"] = A.strip_html((elev.get("highest point") or {}).get("text"))
            rec["lowest_point"] = A.strip_html((elev.get("lowest point") or {}).get("text"))
            rec["source_file"] = p
            iy = A.parse_independence_year(rec.get("independence"))
            if iy:
                rec["independence_year"] = iy
            out[iso3] = {k: v for k, v in rec.items() if v}
    return out


# ---------------------------------------------------------------- Wikipedia(日本語)
def fetch_wiki(countries: dict[str, dict]) -> dict[str, dict]:
    def one(item):
        iso3, c = item
        title = WIKI_TITLES.get(iso3, c["name_ja"])
        url = WIKI_SUMMARY + urllib.parse.quote(title.replace(" ", "_"))
        try:
            d = http_json(url, timeout=30, retries=2)
        except Exception:  # noqa: BLE001
            return iso3, None
        if d.get("type") != "standard" or not d.get("extract"):
            return iso3, None
        return iso3, {
            "title": d.get("title"),
            "extract": d["extract"],
            "url": (d.get("content_urls") or {}).get("desktop", {}).get("page"),
        }

    out = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for iso3, v in ex.map(one, countries.items()):
            if v:
                out[iso3] = v
    return out


# ---------------------------------------------------------------- 国境ポリゴン
def fetch_geo(valid: set[str]) -> dict:
    gj = json.loads(http_get(NE_GEOJSON, timeout=120).decode("utf-8"))
    feats = []
    for f in gj["features"]:
        p = f["properties"]
        iso3 = p.get("ISO_A3_EH") if p.get("ISO_A3_EH") not in (None, "-99") else p.get("ADM0_A3")
        iso3 = NE_REMAP.get(iso3, iso3)
        if p.get("ADM0_A3") in NE_REMAP:
            iso3 = NE_REMAP[p["ADM0_A3"]]
        feats.append({
            "type": "Feature",
            "properties": {
                "iso3": iso3 if iso3 in valid else None,
                "name": p.get("NAME_JA") or p.get("NAME"),
                # 地図帳のような国名ラベル用(ラベル位置と、ズームに応じた表示の優先度 1=最優先)
                "label_x": round(p["LABEL_X"], 2) if p.get("LABEL_X") is not None else None,
                "label_y": round(p["LABEL_Y"], 2) if p.get("LABEL_Y") is not None else None,
                "labelrank": p.get("LABELRANK"),
            },
            "geometry": A.round_coords(f["geometry"], 2),
        })
    return {"type": "FeatureCollection", "features": feats}


def write_latest(out: Path) -> dict:
    """series/*.json(今回更新しなかった指標も含む)から latest.json を作り、前回との差分を返す。"""
    paid = out.parent / "api" / "_paid"
    old = load_latest_all(out, paid)  # 公開分+完全版分
    latest = {}
    for ind in INDICATORS:
        f = series_file(ind["id"], out, paid)
        if f:
            latest[ind["id"]] = A.summarize_series(json.loads(f.read_text(encoding="utf-8")))
    write_json(out / "latest.json", latest)
    return A.diff_latest(old, latest)


# ---------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--only", default="",
                    help="更新する指標ソース(カンマ区切り: wb,unhcr,undp,owid,harvard,epi,ndgain,unsdg,uis)")
    ap.add_argument("--report", default="", help="差分レポート(Markdown)の出力先")
    ap.add_argument("--skip", default="",
                    help="省略する付帯ソース(カンマ区切り: factbook,wiki,geo,flows,exports)")
    args = ap.parse_args(argv)

    errs = validate_catalog()
    if errs:
        log("catalog errors: " + "; ".join(errs))
        return 2

    out = Path(args.out)
    only = {s for s in args.only.split(",") if s}
    skip = {s for s in args.skip.split(",") if s}
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    status: dict = meta.get("sources", {})
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    countries = load_countries()
    valid = set(countries)
    iso2_to_iso3 = {c["iso2"]: k for k, c in countries.items()}
    log(f"countries: {len(countries)}")

    # 付帯情報(失敗時は前回の値を使う)
    prev_countries: dict = {}
    if (out / "countries.json").exists():
        prev_countries = json.loads((out / "countries.json").read_text(encoding="utf-8")).get("countries", {})

    def attach(key: str, fn, *fa):
        if key in skip:
            for k, c in countries.items():
                if prev_countries.get(k, {}).get(key):
                    c[key] = prev_countries[k][key]
            return
        try:
            data = fn(*fa)
            for k, v in data.items():
                countries[k][key] = v
            status[key] = {"ok": True, "count": len(data), "at": now}
            log(f"{key}: {len(data)}")
        except Exception as e:  # noqa: BLE001
            status[key] = {"ok": False, "error": str(e)[:300], "at": now}
            log(f"{key} FAILED: {e}")
            for k, c in countries.items():
                if prev_countries.get(k, {}).get(key):
                    c[key] = prev_countries[k][key]

    attach("factbook", fetch_factbook, iso2_to_iso3)
    attach("wiki", fetch_wiki, countries)

    if "geo" not in skip:
        try:
            write_json(out / "geo" / "countries.json", fetch_geo(valid))
            status["geo"] = {"ok": True, "at": now}
        except Exception as e:  # noqa: BLE001
            status["geo"] = {"ok": False, "error": str(e)[:300], "at": now}
            log(f"geo FAILED: {e}")

    if "exports" not in skip:
        try:
            ex_data = fetch_exports(valid)
            write_json(out / "exports.json", ex_data)
            status["exports"] = {"ok": True, "count": len(ex_data["countries"]), "at": now}
            log(f"exports: {len(ex_data['countries'])}")
        except Exception as e:  # noqa: BLE001
            status["exports"] = {"ok": False, "error": str(e)[:300], "at": now}
            log(f"exports FAILED: {e}")

    if "flows" not in skip:
        try:
            fl = fetch_refugee_flows(valid)
            write_json(out / "flows" / "refugees.json", fl)
            status["flows"] = {"ok": True, "count": len(fl["flows"]), "years": [fl["year"], fl["year"]],
                               "at": now}
            log(f"flows: {len(fl['flows'])} ({fl['year']})")
        except Exception as e:  # noqa: BLE001
            status["flows"] = {"ok": False, "error": str(e)[:300], "at": now}
            log(f"flows FAILED: {e}")

    # 指標
    coverage: dict[str, int] = {}
    for ind in INDICATORS:
        if only and ind["source"] not in only:
            continue
        if ind["source"] == "ucla" and "ucla" not in only:
            continue  # ゲストブック回答が必要なため、明示したときだけ取得(前回のファイルを使い続ける)
        key = f"{ind['source']}:{ind['code']}"
        try:
            raw = FETCHERS[ind["source"]](ind["code"], valid)
            ser = build_series(ind, raw)
            if not ser["countries"]:
                raise RuntimeError("0 countries")
            write_json(out / "series" / f"{ind['id']}.json", ser)
            coverage[ind["id"]] = len(ser["countries"])
            status[key] = {"ok": True, "count": len(ser["countries"]), "years": ser["years"], "at": now}
            log(f"{ind['id']:<16} {len(ser['countries']):>3} countries {ser['years']}")
        except Exception as e:  # noqa: BLE001
            status[key] = {"ok": False, "error": str(e)[:300], "at": now}
            log(f"{ind['id']} FAILED: {e}")

    diff = write_latest(out)
    # CIA 原文の日本語要約(人の確認フロー付き)を付ける
    ja_path = HERE / "factbook_ja.json"
    if ja_path.exists():
        merge_translations(countries, json.loads(ja_path.read_text(encoding="utf-8")))
    write_json(out / "countries.json", {"countries": countries})
    write_json(out / "catalog.json", {
        "categories": CATEGORIES, "indicators": INDICATORS, "sdg_goals": SDG_GOALS,
        "forecast_year": FORECAST_YEAR,
        "products": {"hs2": HS2_JA, "sectors": SECTOR_JA, "sector_colors": SECTOR_COLOR},
    })
    shutil.copyfile(HERE / "timeline_ja.json", out / "timeline.json")
    shutil.copyfile(HERE / "glossary_ja.json", out / "glossary.json")
    ok = sum(1 for v in status.values() if v.get("ok"))
    write_json(meta_path, {"generated_at": now, "sources": status, "ok": ok, "total": len(status)})
    # 更新の差分レポート(画面の「出典」と、週次ワークフローの PR 本文・失敗通知に使う)
    write_json(out / "update_report.json", {"generated_at": now, **diff})
    if args.report:
        names = {i["id"]: i["name"] for i in INDICATORS}
        Path(args.report).write_text(A.update_report_markdown(diff, status, names, now), encoding="utf-8")
    # 完全版のデータを非公開フォルダへ分ける(公開フォルダには無料版のデータだけを残す)
    if out.resolve() == DEFAULT_OUT.resolve():
        r = split_paid(out, out.parent / "api" / "_paid")
        log(f"split: free {r['free']} indicators, {len(r['moved'])} files -> api/_paid")
    log(f"done: {ok}/{len(status)} sources ok -> {out}")
    failed = [k for k, v in status.items() if not v.get("ok")]
    if failed:
        log("failed: " + ", ".join(failed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
