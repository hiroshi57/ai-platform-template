"""完全版のデータを、公開フォルダ(site/data)から非公開フォルダ(site/api/_paid)へ分ける。

無料・有料の範囲は画面と同じ site/js/plan.js の freeIndicators から読む(1か所で管理)。
    python -m world_atlas.pipeline.split_paid
build_data の最後にも自動で実行される。何度実行しても同じ結果になる。
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
PUBLIC = SITE / "data"
PAID = SITE / "api" / "_paid"


def free_indicators(plan_js: Path = SITE / "js" / "plan.js") -> set[str]:
    text = plan_js.read_text(encoding="utf-8")
    m = re.search(r"freeIndicators:\s*\[(.*?)\]", text, re.S)
    if not m:
        raise RuntimeError("plan.js に freeIndicators が見つかりません")
    return set(re.findall(r'"([a-z0-9_]+)"', m.group(1)))


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def load_latest_all(public: Path = PUBLIC, paid: Path = PAID) -> dict:
    """公開分と完全版分の latest を合わせたもの(差分レポートなどで使う)。"""
    out = {}
    for p in (public / "latest.json", paid / "latest_paid.json"):
        if p.exists():
            out.update(json.loads(p.read_text(encoding="utf-8")))
    return out


def series_file(ind_id: str, public: Path = PUBLIC, paid: Path = PAID) -> Path | None:
    for d in (public / "series", paid / "series"):
        f = d / f"{ind_id}.json"
        if f.exists():
            return f
    return None


def split(public: Path = PUBLIC, paid: Path = PAID, free: set[str] | None = None) -> dict:
    free = free if free is not None else free_indicators()
    moved = []
    # 1) 指標の時系列
    (paid / "series").mkdir(parents=True, exist_ok=True)
    for f in sorted((public / "series").glob("*.json")):
        if f.stem not in free:
            shutil.move(str(f), paid / "series" / f.name)  # 新しい方で上書き
            moved.append(f"series/{f.name}")
    # 2) 最新値のまとめ
    latest = load_latest_all(public, paid)
    if latest:
        _dump(public / "latest.json", {k: v for k, v in latest.items() if k in free})
        _dump(paid / "latest_paid.json", {k: v for k, v in latest.items() if k not in free})
    # 3) 完全版だけのデータ(輸出品・難民の流れ)
    for rel in ("exports.json", "flows/refugees.json"):
        src = public / rel
        if src.exists():
            (paid / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), paid / rel)
            moved.append(rel)
    # 4) 国データから CIA の日本語要約(完全版)を取り出す
    cpath = public / "countries.json"
    if cpath.exists():
        cj = json.loads(cpath.read_text(encoding="utf-8"))
        ja = {k: c.pop("factbook_ja") for k, c in cj["countries"].items() if "factbook_ja" in c}
        if ja:
            _dump(paid / "factbook_ja.json", ja)
            _dump(cpath, cj)
            moved.append("factbook_ja")
    return {"free": len(free), "moved": moved}


def main() -> int:
    r = split()
    print(f"free indicators: {r['free']}, moved to api/_paid: {len(r['moved'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
