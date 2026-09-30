"""harness-logs の worker-report.json から、ツール使用の内訳を集計する（提案 D / harness-retro 提案6）.

使い方:
    python scripts/token_breakdown.py                       # 直近10タスク・テキスト出力
    python scripts/token_breakdown.py --limit 20 --json     # 直近20タスク・JSON 出力
    python scripts/token_breakdown.py --logs-dir <path>     # ログの場所を指定

集計はトークン数ではなく「ツール呼び出し回数」による近似。tool_usage は Worker の自己申告で
任意項目なので、未記入のタスクは件数だけ数えてエラーにしない。
結果は advisory（通知のみ）で、ハーネスを自動で変更しない。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

DEFAULT_LOGS_DIR = Path(".claude/harness-logs")
CALL_KEYS = ("read_calls", "search_calls", "bash_calls", "edit_calls")
RETRIEVAL_KEYS = ("read_calls", "search_calls", "bash_calls")
# 元資料（Jev 設計メモ III 章）では読み込み・検索・コマンド出力で処理トークンの約3分の2。
# これを超えたら「改善余地は検索の賢さにある」とみなして advisory を出す。
RETRIEVAL_ADVISORY_THRESHOLD = 0.6
REREAD_MIN_TASKS = 2


def _count_lines(path: Path) -> int | None:
    if not path.is_file():
        return None
    with path.open(encoding="utf-8", errors="replace") as f:
        return sum(1 for _ in f)


def collect_reports(logs_dir: Path, limit: int = 10) -> list[dict]:
    """<logs_dir>/<project>/<YYYYMM>/<task_id>/worker-report.json を新しい順に最大 limit 件読む."""
    if not logs_dir.is_dir():
        return []
    files = sorted(
        logs_dir.glob("*/*/*/worker-report.json"),
        key=lambda p: (p.parent.parent.name, p.stat().st_mtime),
        reverse=True,
    )
    out: list[dict] = []
    skipped = 0
    for f in files:
        if len(out) >= limit:
            break
        try:
            report = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            skipped += 1
            continue
        usage = report.get("tool_usage") if isinstance(report, dict) else None
        out.append({
            "project": f.parent.parent.parent.name,
            "month": f.parent.parent.name,
            "task_id": f.parent.name,
            "tool_usage": usage if isinstance(usage, dict) else None,
            "stdout_log_lines": _count_lines(f.parent / "commands.stdout.log"),
        })
    if out:
        out[0]["_skipped_files"] = skipped
    elif skipped:
        out.append({"_skipped_only": True, "_skipped_files": skipped})
    return out


def summarize(reports: list[dict]) -> dict:
    skipped = sum(r.get("_skipped_files", 0) for r in reports)
    reports = [r for r in reports if not r.get("_skipped_only")]
    totals = dict.fromkeys(CALL_KEYS, 0)
    reread: Counter[str] = Counter()
    per_task = []
    without = 0
    for r in reports:
        usage = r["tool_usage"]
        if usage is None:
            without += 1
            usage = {}
        for k in CALL_KEYS:
            v = usage.get(k, 0)
            totals[k] += v if isinstance(v, int) and v > 0 else 0
        for path in set(usage.get("reread_files") or []):
            reread[path] += 1
        per_task.append({
            "project": r["project"],
            "month": r["month"],
            "task_id": r["task_id"],
            "has_tool_usage": r["tool_usage"] is not None,
            "largest_output_lines": usage.get("largest_output_lines"),
            "stdout_log_lines": r["stdout_log_lines"],
        })

    all_calls = sum(totals.values())
    ratio = sum(totals[k] for k in RETRIEVAL_KEYS) / all_calls if all_calls else None
    frequent = [
        {"file": path, "tasks": n}
        for path, n in sorted(reread.items(), key=lambda kv: (-kv[1], kv[0]))
        if n >= REREAD_MIN_TASKS
    ]

    advisories = []
    if ratio is not None and ratio > RETRIEVAL_ADVISORY_THRESHOLD:
        advisories.append(
            f"読み込み+検索+コマンドの比率が {ratio:.0%}（閾値 {RETRIEVAL_ADVISORY_THRESHOLD:.0%}）。"
            "モデル強化より先にツールセット（検索ツール・出力の絞り込み）を見直す（harness-retro 提案4）"
        )
    if frequent:
        names = ", ".join(x["file"] for x in frequent[:5])
        advisories.append(
            f"複数タスクで読み直されているファイルあり: {names}。"
            "そのディレクトリの GOTCHAS.md か要点メモの追加を検討する"
        )

    return {
        "tasks": len(reports),
        "tasks_without_tool_usage": without,
        "skipped_files": skipped,
        "totals": totals,
        "retrieval_ratio": ratio,
        "frequent_rereads": frequent,
        "per_task": per_task,
        "advisories": advisories,
    }


def _format_text(s: dict) -> str:
    lines = [f"対象タスク: {s['tasks']} 件（tool_usage 未記入 {s['tasks_without_tool_usage']} 件"
             f"・読めなかったファイル {s['skipped_files']} 件）"]
    if s["retrieval_ratio"] is None:
        lines.append("集計できる tool_usage がありません")
    else:
        t = s["totals"]
        lines.append(f"呼び出し回数: 読み込み {t['read_calls']} / 検索 {t['search_calls']} / "
                     f"コマンド {t['bash_calls']} / 編集 {t['edit_calls']}")
        lines.append(f"読み込み+検索+コマンドの比率: {s['retrieval_ratio']:.0%}")
    for x in s["frequent_rereads"]:
        lines.append(f"  読み直し: {x['file']}（{x['tasks']} タスク）")
    lines.extend(f"[advisory] {a}" for a in s["advisories"])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--logs-dir", type=Path, default=DEFAULT_LOGS_DIR)
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    s = summarize(collect_reports(a.logs_dir, a.limit))
    # Windows の既定 (cp932) だと Git Bash などで日本語が文字化けするため UTF-8 に固定する
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(s, ensure_ascii=False, indent=2) if a.json else _format_text(s))
    return 0


if __name__ == "__main__":
    sys.exit(main())
