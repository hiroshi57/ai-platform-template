"""同じツール呼び出しの連続を検出する Claude Code hook（PostToolUse / PostToolUseFailure）.

仕様: `decision-boundaries.md` ルール1「機械的な検出」（hiroshi57/harness-rules の `.claude/rules/`）
  - 同じツール名・同じ引数の呼び出しが NOTICE 回連続        → 注意を1回だけ context に入れる
  - 同じツール名・同じ引数で失敗した呼び出しが NOTICE 回連続 → 同上
  - 同じツール名・同じ引数で失敗した呼び出しが STOP 回連続   → 実行を止める（escalated を促す）
既定値 NOTICE=5 / STOP=8（arXiv:2609.20804 の設定値。暫定）。環境変数
IDENTICAL_CALL_NOTICE / IDENTICAL_CALL_STOP で変えられる。

判定はすべてコードで行い、LLM を呼ばない。
記録するのは「ツール名＋引数」の SHA-256 と成否だけで、引数の中身は保存しない
（`secret-isolation.md` ルール6。同じく harness-rules）。
hook 自体の不具合でツール実行を妨げないよう、想定外の入力・例外では何も出力せず exit 0 で通す。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

DEFAULT_NOTICE = 5
DEFAULT_STOP = 8
MAX_HISTORY = 50
STATE_SUBDIR = Path(".claude") / "state" / "identical-call-guard"

NOTICE_TEXT = (
    "[identical-call-guard] 同じツール（{tool}）を同じ引数で {n} 回続けて呼んでいます{fail}。"
    "次の試行では `decision-boundaries.md`（harness-rules）ルール1の4つ"
    "（証拠を足す・仮説を変える・範囲を絞る・エスカレーション）のどれかを必ず選んでください。"
)
STOP_TEXT = (
    "[identical-call-guard] 同じツール（{tool}）を同じ引数で {n} 回続けて失敗しました。"
    "実行を止めます。Worker は status: escalated、"
    'escalation_reason: "identical-failing-calls" で返してください。'
)


def call_key(tool_name: str, tool_input: object) -> str:
    """ツール名と引数から、引数のキー順に依存しない hash を作る."""
    canon = json.dumps(tool_input, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(f"{tool_name}\x00{canon}".encode()).hexdigest()


def is_failure(payload: dict) -> bool:
    """呼び出しが失敗したか。形式の違いに備えて複数の目印を見る."""
    if payload.get("hook_event_name") == "PostToolUseFailure":
        return True
    if payload.get("error"):
        return True
    resp = payload.get("tool_response")
    if isinstance(resp, dict):
        if resp.get("is_error") is True or resp.get("isError") is True:
            return True
        if resp.get("success") is False:
            return True
        if resp.get("error"):
            return True
        for k in ("exit_code", "exitCode", "returnCode"):
            v = resp.get(k)
            if isinstance(v, int) and not isinstance(v, bool) and v != 0:
                return True
    return False


def _streaks(history: list[dict]) -> tuple[int, int, bool]:
    """末尾から見た (同じ呼び出しの連続数, 同じ失敗の連続数, その連続中に注意済みか)."""
    if not history:
        return 0, 0, False
    key = history[-1]["k"]
    same = 0
    noticed = False
    for h in reversed(history):
        if h["k"] != key:
            break
        same += 1
        noticed = noticed or h.get("a") == "notice"
    fail = 0
    for h in reversed(history):
        if h["k"] != key or not h["f"]:
            break
        fail += 1
    return same, fail, noticed


def decide(history: list[dict], notice: int, stop: int) -> tuple[str, int, int]:
    """直近の履歴（最後の要素が今回の呼び出し）から動作を決める: none / notice / stop."""
    same, fail, noticed = _streaks(history)
    if fail >= stop:
        return "stop", same, fail
    if not noticed and (same >= notice or fail >= notice):
        return "notice", same, fail
    return "none", same, fail


def _int_env(env: dict, name: str, default: int) -> int:
    try:
        v = int(env.get(name, default))
    except (TypeError, ValueError):
        return default
    return v if v > 0 else default


def _state_file(state_dir: Path, session_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", session_id)[:128] or "default"
    return state_dir / f"{safe}.jsonl"


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            h = json.loads(line)
        except ValueError:
            continue
        if isinstance(h, dict) and isinstance(h.get("k"), str):
            out.append({"k": h["k"], "f": bool(h.get("f")), "a": h.get("a")})
    return out


def _save(path: Path, history: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tail = history[-MAX_HISTORY:]
    path.write_text("".join(json.dumps(h, separators=(",", ":")) + "\n" for h in tail), encoding="utf-8")


def _log_retry(env: dict, action: str, tool: str, key: str, same: int, fail: int) -> None:
    log = env.get("HARNESS_RETRIES_LOG")
    if not log:
        return
    ts = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    fields = [
        "identical-call-guard",
        ts,
        action,
        f"tool={tool}",
        f"key={key[:12]}",
        f"streak={same}",
        f"fail_streak={fail}",
    ]
    line = "\t".join(fields) + "\n"
    p = Path(log)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as fh:
        fh.write(line)


def run(stdin_text: str, state_dir: Path, env: dict) -> tuple[str, int]:
    """hook の本体。(stdout に出す文字列, 終了コード) を返す."""
    try:
        payload = json.loads(stdin_text)
    except ValueError:
        return "", 0
    if not isinstance(payload, dict):
        return "", 0
    tool = payload.get("tool_name")
    if not isinstance(tool, str) or not tool:
        return "", 0

    notice = _int_env(env, "IDENTICAL_CALL_NOTICE", DEFAULT_NOTICE)
    stop = _int_env(env, "IDENTICAL_CALL_STOP", DEFAULT_STOP)
    key = call_key(tool, payload.get("tool_input", {}))
    failed = is_failure(payload)

    path = _state_file(Path(state_dir), str(payload.get("session_id") or "default"))
    history = _load(path)
    history.append({"k": key, "f": failed, "a": None})
    action, same, fail = decide(history, notice, stop)
    history[-1]["a"] = None if action == "none" else action
    _save(path, history)

    if action == "none":
        return "", 0
    _log_retry(env, action, tool, key, same, fail)

    event = payload.get("hook_event_name") or "PostToolUse"
    if action == "notice":
        n = max(same, fail)
        msg = NOTICE_TEXT.format(tool=tool, n=n, fail="（うち失敗が連続）" if fail >= notice else "")
        out = {"hookSpecificOutput": {"hookEventName": event, "additionalContext": msg}}
    else:
        msg = STOP_TEXT.format(tool=tool, n=fail)
        out = {
            "continue": False,
            "stopReason": msg,
            "hookSpecificOutput": {"hookEventName": event, "additionalContext": msg},
        }
    return json.dumps(out, ensure_ascii=False), 0


def main() -> int:
    env = dict(os.environ)
    base = Path(env.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    try:
        # Claude Code は UTF-8 の JSON を渡す。Windows の既定（cp932）で読むと日本語の引数で壊れるので、
        # バイト列で読んで UTF-8 として解釈する
        stdin_text = sys.stdin.buffer.read().decode("utf-8", errors="replace")
        out, code = run(stdin_text, base / STATE_SUBDIR, env)
    except Exception:  # noqa: BLE001 — hook の不具合でツール実行を止めない
        return 0
    if out:
        sys.stdout.buffer.write(out.encode("utf-8"))
        sys.stdout.flush()
    return code


if __name__ == "__main__":
    sys.exit(main())
