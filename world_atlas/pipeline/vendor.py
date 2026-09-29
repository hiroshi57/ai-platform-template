"""外部ライブラリ・画像の自前配信(6-C1)。

外部 CDN から実行時に読み込むのをやめ、バージョンを固定したファイルを site/vendor/ に置く。
ファイルの SHA-256 を vendor/manifest.json に記録し、改ざん・入れかわりを検出する。

使い方:
    python -m world_atlas.pipeline.vendor --fetch    # ダウンロードしてハッシュを記録(更新時だけ)
    python -m world_atlas.pipeline.vendor --verify   # 置いてあるファイルが記録どおりか確認(CI で実行)
    python -m world_atlas.pipeline.vendor --audit    # OSV(オープンソース脆弱性DB)で既知の脆弱性を確認
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent / "site"
VENDOR = SITE / "vendor"
MANIFEST = VENDOR / "manifest.json"
UA = "Mozilla/5.0 (compatible; WorldAtlasBuilder/0.1)"

# ライブラリ(バージョン固定)。bundles は同梱されている依存(脆弱性チェックの対象)
LIBS = [
    {
        "name": "globe.gl", "version": "2.46.2", "license": "MIT",
        "url": "https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js",
        "path": "globe.gl-2.46.2.min.js",
        # 同梱の three.js はバンドル内の REVISION="185"(0.185 系)。脆弱性チェックは 0.185.0 で行う
        "bundles": [["three-globe", "2.45.2"], ["three", "0.185.0"]],
    },
]
# 地球の画像(three-globe のサンプル画像。MIT。元画像は NASA Blue Marble / パブリックドメイン)
IMAGES = [
    {"name": f"three-globe/{n}", "version": "2.45.2", "license": "MIT(元画像 NASA・パブリックドメイン)",
     "url": f"https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/{n}", "path": f"img/{n}"}
    for n in ("earth-blue-marble.jpg", "earth-topology.png", "night-sky.png")
]
FLAG_SIZES = ("w40", "w160")
FLAG_LICENSE = "国旗画像: flagcdn.com(国旗の図柄はパブリックドメイン)"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _get(url: str) -> bytes:
    if not url.startswith("https://"):
        raise ValueError(url)
    req = urllib.request.Request(url, headers={"User-Agent": UA})  # noqa: S310 (https のみ)
    with urllib.request.urlopen(req, timeout=120) as r:  # noqa: S310
        return r.read()


def flag_codes() -> list[str]:
    countries = json.loads((SITE / "data" / "countries.json").read_text(encoding="utf-8"))["countries"]
    iso2 = [(c.get("iso2") or "") for c in countries.values()]
    codes = {x.lower() for x in iso2 if len(x) == 2 and x.isalpha()}
    return sorted(codes)


def fetch() -> dict:
    files = {}
    for item in [*LIBS, *IMAGES]:
        dest = VENDOR / item["path"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(_get(item["url"]))
        files[item["path"]] = {k: v for k, v in item.items() if k != "path"} | {"sha256": sha256(dest)}
        print(f"fetched {item['path']}", file=sys.stderr)
    for size in FLAG_SIZES:
        for code in flag_codes():
            rel = f"flags/{size}/{code}.png"
            dest = VENDOR / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                dest.write_bytes(_get(f"https://flagcdn.com/{size}/{code}.png"))
            except Exception as e:  # noqa: BLE001  国旗が無い地域は画面側で表示しない
                print(f"flag skip {code}: {e}", file=sys.stderr)
                continue
            files[rel] = {"name": "flag", "license": FLAG_LICENSE, "sha256": sha256(dest)}
    manifest = {"files": files}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest


def verify(manifest: dict | None = None) -> list[str]:
    """記録と違う・無いファイルの一覧(空なら OK)。"""
    manifest = manifest or json.loads(MANIFEST.read_text(encoding="utf-8"))
    bad = []
    for rel, info in manifest["files"].items():
        p = VENDOR / rel
        if not p.exists():
            bad.append(f"missing: {rel}")
        elif sha256(p) != info["sha256"]:
            bad.append(f"hash mismatch: {rel}")
    return bad


def osv_packages() -> list[tuple[str, str]]:
    pkgs = []
    for lib in LIBS:
        pkgs.append((lib["name"], lib["version"]))
        pkgs += [tuple(b) for b in lib.get("bundles", [])]
    return pkgs


def audit() -> list[str]:
    """OSV の npm 脆弱性情報を調べる。見つかった脆弱性 ID の一覧を返す。"""
    found = []
    for name, ver in osv_packages():
        body = json.dumps({"package": {"name": name, "ecosystem": "npm"}, "version": ver}).encode()
        req = urllib.request.Request("https://api.osv.dev/v1/query", data=body,  # noqa: S310 (固定の https URL)
                                     headers={"Content-Type": "application/json", "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            vulns = json.loads(r.read()).get("vulns", [])
        print(f"{name}@{ver}: {len(vulns)} vulnerabilities", file=sys.stderr)
        found += [f"{name}@{ver}: {v['id']} {v.get('summary', '')}" for v in vulns]
    return found


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--audit", action="store_true")
    a = ap.parse_args(argv)
    if a.fetch:
        m = fetch()
        print(f"{len(m['files'])} files recorded")
    if a.verify or not (a.fetch or a.audit):
        bad = verify()
        print("vendor verify:", "OK" if not bad else "; ".join(bad[:10]))
        if bad:
            return 1
    if a.audit:
        found = audit()
        for f in found:
            print("VULN", f)
        if found:
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
