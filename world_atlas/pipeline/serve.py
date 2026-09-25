"""ローカル確認用サーバー。vercel.json と同じセキュリティヘッダーを付けて site/ を配信する。

    python -m world_atlas.pipeline.serve            # http://127.0.0.1:8765/
    python -m world_atlas.pipeline.serve --port 9000

本番(Vercel)と同じ CSP で動くかを、公開前に手元で確かめるためのもの。
"""

from __future__ import annotations

import argparse
import functools
import json
import os
import re
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"


def load_rules(vercel_json: Path = SITE / "vercel.json") -> list[tuple[re.Pattern, list[dict]]]:
    """vercel.json の headers を (パスの正規表現, ヘッダー一覧) にする。"(.*)" 形式のみ対応。"""
    conf = json.loads(vercel_json.read_text(encoding="utf-8"))
    rules = []
    for h in conf.get("headers", []):
        pat = "^" + re.escape(h["source"]).replace(re.escape("(.*)"), "(.*)") + "$"
        rules.append((re.compile(pat), h["headers"]))
    return rules


def headers_for(path: str, rules) -> dict[str, str]:
    out: dict[str, str] = {}
    for pat, hs in rules:
        if pat.match(path):
            for h in hs:
                out[h["key"]] = h["value"]
    return out


PAID_DIR = SITE / "api" / "_paid"
PAID_NAME = re.compile(
    r"series/[a-z0-9_]+\.json|latest_paid\.json|exports\.json|flows/refugees\.json|factbook_ja\.json"
)
NO_LOCAL_BUY = "ローカルでは購入できません(Vercel のプレビューで確認してください)"


class Handler(SimpleHTTPRequestHandler):
    """静的ファイルに加え、/api/license と /api/data を開発用にまねる(Stripe は使わない)。

    ATLAS_DEV_PAID=1 で起動すると「購入済み」として完全版のデータを返す。
    購入の流れそのもの(checkout/claim/redeem)は、Vercel のプレビュー環境と Stripe のテストモードで確かめる。
    """

    rules: list = []
    dev_paid = False

    def _json(self, status: int, obj) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/api/license":
            return self._json(200, {"paid": self.dev_paid})
        if path == "/api/data":
            if not self.dev_paid:
                return self._json(401, {"error": "完全版のライセンスが必要です"})
            f = dict(p.split("=", 1) for p in query.split("&") if "=" in p).get("f", "")
            f = urllib.parse.unquote(f)
            if not PAID_NAME.fullmatch(f):
                return self._json(400, {"error": "bad name"})
            target = PAID_DIR / f
            if not target.exists():
                return self._json(404, {"error": "not found"})
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return None
        if path.startswith("/api/"):
            return self._json(501, {"error": NO_LOCAL_BUY})
        return super().do_GET()

    def do_POST(self):
        return self._json(501, {"error": NO_LOCAL_BUY})

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        for k, v in headers_for(path, self.rules).items():
            if k == "Strict-Transport-Security":
                continue  # http のローカルでは付けない
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, fmt, *args):  # 静かにする
        pass


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args(argv)
    Handler.rules = load_rules()
    Handler.dev_paid = os.environ.get("ATLAS_DEV_PAID") == "1"
    httpd = ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Handler, directory=str(SITE)))
    print(f"serving {SITE} on http://127.0.0.1:{a.port}/ (vercel.json headers)")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
