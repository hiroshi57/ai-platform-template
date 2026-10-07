"""git diff から、実行すべきテストファイルを Jev（TypeSafe の System One API）に選ばせる（お試し・助言用）.

使い方:
    python scripts/jev_test_filter.py                 # origin/main との差分（未コミット分も含む）で選ぶ
    python scripts/jev_test_filter.py --dry-run       # 送る内容の大きさだけ確かめる（通信しない・キー不要）
    python scripts/jev_test_filter.py --json          # 結果を JSON で
    python scripts/jev_test_filter.py --base <ref>    # 比べる基準を変える

API キーは環境変数 TYPESAFE_API_KEY から読む（表示もログもしない）。

位置づけ:
- ローカルで「まず走らせるテスト」を絞るための助言。CI は今までどおり全テストを走らせる
- 迷ったら多く走らせる側に倒す。Jev が「影響なし」とはっきり言ったもの（はいの確率 0.15 以下）だけを省く
- 次の場合は Jev に聞かずに全テストにする: テスト設定・CI 設定の変更 / 認証・秘密情報などに当たるパスの変更 /
  差分に秘密らしい文字列がある / 差分が大きすぎる / API キーがない / API の失敗・答えの形の不一致
- 外部 API に送るのは、変更ファイル名・差分・テストファイル名と、その要約（docstring の1行目と、
  プロジェクト内の import 先）だけ
"""
from __future__ import annotations

import argparse
import ast
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from fnmatch import fnmatch
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASE_URL = "https://api.typesafe.ai"
MODEL = "jev-latest"
SKIP_BELOW = 0.15            # これ以下だけを「影響なし」として省く
BATCH_SIZE = 50
MAX_DIFF_CHARS = 20_000      # 大きすぎる差分は判断の精度が落ちる（Jev 1.13 の既知の弱点）ので全件にする
PROJECT_PKGS = ("core", "service", "app_template", "scripts")

RUN_ALL_PATTERNS = ("conftest.py", "*/conftest.py", "pyproject.toml", "setup.cfg", "pytest.ini", "tox.ini",
                    "requirements*.txt", ".github/workflows/*")
SECRET_PATTERNS = re.compile(
    r"AKIA[0-9A-Z]{16}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*[\"']?[^\s\"']{8,}",
    re.IGNORECASE,
)


def _sensitive_pattern() -> re.Pattern:
    """needs_full_diff.py と同じ「機密に当たるパス」の判定を使う（2か所でずれないように）."""
    path = Path(__file__).with_name("needs_full_diff.py")
    spec = importlib.util.spec_from_file_location("needs_full_diff", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SENSITIVE


def summarize_test(path: Path) -> dict:
    """テストファイルの要約: docstring の1行目と、プロジェクト内の import 先."""
    try:
        tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    except (OSError, SyntaxError, UnicodeDecodeError):
        return {}
    doc = (ast.get_docstring(tree) or "").strip().splitlines()
    imports: list[str] = []
    for node in tree.body:
        names = []
        if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names = [node.module]
        elif isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        for n in names:
            if n.split(".")[0] in PROJECT_PKGS and n not in imports:
                imports.append(n)
    return {"purpose": doc[0] if doc else "", "imports": imports}


def _all(tests: list[str], reason: str) -> dict:
    return {"mode": "all", "reason": reason, "run": sorted(tests), "skipped": [], "usage": {}}


def _is_test_file(path: str) -> bool:
    return fnmatch(Path(path).name, "test_*.py")


def plan(changed: list[str], diff: str, tests: list[str], api_key: str | None, post,
         summaries: dict | None = None, skip_below: float = SKIP_BELOW, batch_size: int = BATCH_SIZE,
         max_diff_chars: int = MAX_DIFF_CHARS) -> dict:
    """実行するテストを決める。post(payload) は API を呼んで応答の dict を返す関数."""
    if not changed:
        return {"mode": "selected", "reason": "変更なし", "run": [], "skipped": [], "usage": {}}

    hit = [p for p in changed if any(fnmatch(p, pat) for pat in RUN_ALL_PATTERNS)]
    if hit:
        return _all(tests, f"テスト設定・CI 設定の変更があるため全件: {hit}")

    always = sorted({p for p in changed if _is_test_file(p) and p in tests} |
                    {p for p in changed if _is_test_file(p) and Path(p).parts[:1] == ("tests",)})
    code_changes = [p for p in changed if not _is_test_file(p)]
    if not code_changes:
        return {"mode": "selected", "reason": "変更はテストファイルだけ", "run": always,
                "skipped": [], "usage": {}}

    sensitive = [p for p in changed if _sensitive_pattern().search(p)]
    if sensitive:
        return _all(tests, f"認証・秘密情報などに当たるパスの変更があるため外部 API に送らない: {sensitive}")
    if SECRET_PATTERNS.search(diff or ""):
        return _all(tests, "差分に秘密らしい文字列があるため外部 API に送らない")
    if len(diff or "") > max_diff_chars:
        return _all(tests, f"差分が {len(diff)} 文字で {max_diff_chars} を超えるため全件")
    if not api_key:
        return _all(tests, "環境変数 TYPESAFE_API_KEY が設定されていないため全件")

    candidates = [t for t in tests if t not in always]
    probs: dict[str, float] = {}
    usage = {"input_tokens": 0, "output_tokens": 0}
    try:
        for start in range(0, len(candidates), batch_size):
            batch = candidates[start:start + batch_size]
            questions = {}
            for i, t in enumerate(batch):
                summary = (summaries.get(t) if summaries is not None else summarize_test(ROOT / t)) or {}
                questions[f"q{start + i}"] = {
                    "type": "noul",
                    "instructions": {
                        "test_file": t,
                        "test_summary": summary,
                        "question": ("Could the code change in `diff` plausibly change the result of "
                                     "the tests in `test_file`? "
                                     "Consider what `test_file` imports and exercises."),
                    },
                    "criteria": {
                        "true": "The change touches code this test exercises, directly or through imports",
                        "false": "The change is unrelated to anything this test exercises",
                    },
                }
            payload = {"model": MODEL, "state": {"changed_files": code_changes, "diff": diff},
                       "questions": questions}
            resp = post(payload)
            answers = resp.get("answers") if isinstance(resp, dict) else None
            if not isinstance(answers, dict):
                raise ValueError("answers がない")
            for qid, t in zip(questions, batch):
                a = answers.get(qid)
                p = a.get("noul") if isinstance(a, dict) and a.get("type") == "noul" else None
                if isinstance(p, bool) or not isinstance(p, (int, float)) or not 0 <= p <= 1:
                    raise ValueError(f"{qid} の答えが noul の形ではない")
                probs[t] = float(p)
            for k in usage:
                usage[k] += int((resp.get("usage") or {}).get(k, 0))
    except Exception as e:  # noqa: BLE001 — どんな失敗でも全件実行に倒す
        return _all(tests, f"Jev の呼び出しに失敗したため全件（{type(e).__name__}: {e}）")

    run = sorted(set(always) | {t for t, p in probs.items() if p > skip_below})
    skipped = sorted(({"test": t, "p": round(p, 4)} for t, p in probs.items() if p <= skip_below),
                     key=lambda x: x["test"])
    return {"mode": "selected", "reason": f"Jev のはいの確率が {skip_below} 以下のものだけ省いた",
            "run": run, "skipped": skipped, "usage": usage}


def http_post(payload: dict, api_key: str, base_url: str | None = None, timeout: float = 15.0) -> dict:
    """POST /v1/systemone。429 / 529 は少し待って最大3回まで送り直す."""
    url = (base_url or os.environ.get("TYPESAFE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/") + "/v1/systemone"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    for attempt in range(3):
        req = urllib.request.Request(url, data=body, method="POST", headers={  # noqa: S310 — https 固定
            "Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 — URL は固定の https
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 529) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"HTTP {e.code}") from None      # 応答本文は出さない
    raise RuntimeError("送り直しの上限に達した")


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True,  # noqa: S603,S607
                          text=True, encoding="utf-8", errors="replace").stdout


def _default_base() -> str:
    for ref in ("origin/main", "origin/master", "main", "master"):
        try:
            return _git("merge-base", "HEAD", ref).strip()
        except subprocess.CalledProcessError:
            continue
    raise SystemExit("比べる基準が見つかりません。--base を指定してください")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--base", help="比べる基準（既定: origin/main との merge-base）")
    p.add_argument("--tests-glob", default="tests/test_*.py")
    p.add_argument("--skip-below", type=float, default=SKIP_BELOW)
    p.add_argument("--dry-run", action="store_true", help="通信せず、送る内容の大きさだけ表示する")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)

    base = a.base or _default_base()
    changed = [c for c in _git("diff", "--name-only", base).splitlines() if c.strip()]
    code = [c for c in changed if not _is_test_file(c)]
    diff = _git("diff", "-U3", base, "--", *code) if code else ""
    tests = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.glob(a.tests_glob))

    sent: list[dict] = []
    if a.dry_run:
        def post(payload):
            sent.append(payload)
            return {"answers": {q: {"type": "noul", "noul": 1.0} for q in payload["questions"]}}
        result = plan(changed, diff, tests, api_key="dry-run", post=post, skip_below=a.skip_below)
        result = {"dry_run": True, "requests": len(sent),
                  "questions": sum(len(s["questions"]) for s in sent),
                  "state_chars": sum(len(json.dumps(s["state"], ensure_ascii=False)) for s in sent),
                  "would_send": bool(sent), "reason_if_not_sent": None if sent else result["reason"]}
    else:
        key = os.environ.get("TYPESAFE_API_KEY")
        result = plan(changed, diff, tests, api_key=key, post=lambda payload: http_post(payload, key),
                      skip_below=a.skip_below)
    result["base"] = base

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if a.json or a.dry_run:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    print(f"[{result['mode']}] {result['reason']}")
    for s in result["skipped"]:
        print(f"  省略: {s['test']}（はいの確率 {s['p']}）")
    if result["mode"] == "all":
        print("python -m pytest")
    elif result["run"]:
        print("python -m pytest " + " ".join(result["run"]))
    else:
        print("実行するテストはありません")
    if result.get("usage"):
        u = result["usage"]
        print(f"使用トークン: 入力 {u.get('input_tokens', 0)} / 出力 {u.get('output_tokens', 0)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
