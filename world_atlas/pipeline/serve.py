"""ローカル確認用サーバー。vercel.json と同じセキュリティヘッダーを付けて site/ を配信する。

    python -m world_atlas.pipeline.serve            # http://127.0.0.1:8765/
    python -m world_atlas.pipeline.serve --port 9000

本番(Vercel)と同じ CSP で動くかを、公開前に手元で確かめるためのもの。
"""

from __future__ import annotations

import argparse
import functools
import json
import re
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


class Handler(SimpleHTTPRequestHandler):
    rules: list = []

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
    httpd = ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Handler, directory=str(SITE)))
    print(f"serving {SITE} on http://127.0.0.1:{a.port}/ (vercel.json headers)")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
