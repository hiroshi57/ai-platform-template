"""Worker の出力を harness-logs に逐語で保存し、ツール使用をトランスクリプトから実測する（提案 D）.

使い方（Lead が Worker の結果を受け取るたびに実行する）:
    python scripts/harness_log.py save --project <slug> --task-id <id> \\
        --task task.json --worker-report worker-report.json --stdout-log out.log \\
        [--review review.json] [--retries retries.log] [--advisor advisor.json] \\
        [--transcript <Worker のトランスクリプト .jsonl>] [--sidechain-only] [--month YYYYMM]
    python scripts/harness_log.py measure --transcript <.jsonl> [--sidechain-only]

保存先: .claude/harness-logs/<project>/<YYYYMM>/<task_id>/（CLAUDE.md §7 のファイル名に合わせる）
- 中身は整形も要約もせず、そのままコピーする（memory-curation.md ルール4）
- worker-report / review / task / advisor は上書きしない。2件目からは <名前>.<n>.json にする（§7 提案10）
- commands.stdout.log / retries.log は区切り行を入れて追記する
- --transcript を渡すと、ツール呼び出しを数えた tool-usage.measured[.<n>].json を候補の隣に置く。
  これは Worker の自己申告ではなく実測なので、tool_usage（自己申告）より優先して集計に使われる。
  トランスクリプト本体と、メッセージ・コマンド・出力の中身は保存しない（秘密を写さないため）。数とファイルパスだけを残す
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_LOGS_DIR = Path(".claude/harness-logs")

# 種類 → (§7 のファイル名, 2件目以降の扱い)
KINDS = {
    "task": ("task.json", "number"),
    "worker_report": ("worker-report.json", "number"),
    "review": ("review.json", "number"),
    "advisor": ("advisor.json", "number"),
    "stdout_log": ("commands.stdout.log", "append"),
    "retries": ("retries.log", "append"),
}
MEASURED_NAME = "tool-usage.measured.json"

READ_TOOLS = {"Read", "NotebookRead"}
SEARCH_TOOLS = {"Grep", "Glob"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
SHELL_TOOLS = {"Bash", "PowerShell"}
READ_CMDS = {"cat", "head", "tail", "sed", "less", "more", "wc", "type", "get-content"}
SEARCH_CMDS = {"grep", "rg", "find", "fd", "ls", "tree", "dir", "select-string", "get-childitem"}
SETUP_CMDS = {"cd", "export", "set", "pushd", "source", "."}

_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def _check(label: str, value: str) -> str:
    if not value or not _SAFE.match(value) or value in {".", ".."}:
        raise ValueError(f"{label} に使えない名前です: {value!r}（英数字・. _ - のみ）")
    return value


def _numbered(directory: Path, name: str) -> Path:
    """name が空いていればそれを、埋まっていれば <stem>.<n><suffix>（n=2,3,...）を返す."""
    first = directory / name
    if not first.exists():
        return first
    stem, suffix = name[: -len(Path(name).suffix)], Path(name).suffix
    n = 2
    while (directory / f"{stem}.{n}{suffix}").exists():
        n += 1
    return directory / f"{stem}.{n}{suffix}"


def _suffix_of(path: Path, base: str) -> str:
    """worker-report.2.json → '.2'、worker-report.json → ''."""
    stem = base[: -len(Path(base).suffix)]
    m = re.match(rf"^{re.escape(stem)}(\.\d+)?{re.escape(Path(base).suffix)}$", path.name)
    return (m.group(1) or "") if m else ""


# --- 実測 --------------------------------------------------------------------

def _shell_kind(command: str) -> str:
    for segment in re.split(r"&&|\|\||;|\|", command or ""):
        words = segment.strip().split()
        while words and "=" in words[0] and not words[0].startswith("-"):
            words = words[1:]                        # FOO=bar cmd の FOO=bar を飛ばす
        if not words:
            continue
        first = words[0].lower().rsplit("/", 1)[-1]
        if first in SETUP_CMDS:
            continue
        if first == "git" and len(words) > 1 and words[1] == "grep":
            return "search"
        if first in SEARCH_CMDS:
            return "search"
        if first in READ_CMDS:
            return "read"
        return "bash"
    return "bash"


def _result_lines(content: object) -> int:
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    else:
        return 0
    return len(text.splitlines())   # 末尾の改行で1行増やさない


def measure(transcript: Path, sidechain_only: bool = False) -> dict:
    """トランスクリプト（JSON Lines）からツール呼び出しを種類ごとに数える。中身は写さない."""
    counts = Counter()
    reads: Counter[str] = Counter()
    largest = 0
    lines_read = bad_lines = 0
    with Path(transcript).open(encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                bad_lines += 1
                continue
            lines_read += 1
            if not isinstance(entry, dict) or (sidechain_only and not entry.get("isSidechain")):
                continue
            message = entry.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for c in content:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "tool_result":
                    largest = max(largest, _result_lines(c.get("content")))
                    continue
                if c.get("type") != "tool_use":
                    continue
                name = str(c.get("name", ""))
                inp = c.get("input") if isinstance(c.get("input"), dict) else {}
                if name in READ_TOOLS:
                    counts["read_calls"] += 1
                    if isinstance(inp.get("file_path"), str):
                        reads[inp["file_path"]] += 1
                elif name in SEARCH_TOOLS:
                    counts["search_calls"] += 1
                elif name in EDIT_TOOLS:
                    counts["edit_calls"] += 1
                elif name in SHELL_TOOLS:
                    counts[f"{_shell_kind(str(inp.get('command', '')))}_calls"] += 1
                else:
                    counts["other_calls"] += 1
    return {
        "data_source": "measured",
        "read_calls": counts["read_calls"],
        "search_calls": counts["search_calls"],
        "bash_calls": counts["bash_calls"],
        "edit_calls": counts["edit_calls"],
        "other_calls": counts["other_calls"],
        "largest_output_lines": largest,
        "reread_files": sorted(p for p, n in reads.items() if n >= 2),
        "transcript_entries": lines_read,
        "transcript_bad_lines": bad_lines,
        "sidechain_only": sidechain_only,
        "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


# --- 保存 --------------------------------------------------------------------

def save(logs_dir: Path, project: str, task_id: str, month: str, files: dict[str, Path],
         transcript: Path | None = None, sidechain_only: bool = False, warn=None) -> list[str]:
    _check("project", project)
    _check("task_id", task_id)
    if not re.fullmatch(r"\d{6}", month or ""):
        raise ValueError(f"month は YYYYMM の6桁にしてください: {month!r}")
    unknown = set(files) - set(KINDS)
    if unknown:
        raise ValueError(f"知らない種類です: {sorted(unknown)}")
    warn = warn or (lambda msg: print(f"[warn] {msg}", file=sys.stderr))

    d = Path(logs_dir) / project / month / task_id
    d.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    report_suffix: str | None = None

    for kind, src in files.items():
        name, mode = KINDS[kind]
        data = Path(src).read_bytes()
        if name.endswith(".json"):
            try:
                json.loads(data.decode("utf-8-sig"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                warn(f"{kind} が JSON として読めません（そのまま保存します）: {src}")
        if mode == "append":
            dest = d / name
            with dest.open("ab") as f:
                if dest.stat().st_size:
                    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
                    f.write(f"\n===== appended {stamp} from {Path(src).name} =====\n".encode())
                f.write(data)
        else:
            dest = _numbered(d, name)
            dest.write_bytes(data)
            if kind == "worker_report":
                report_suffix = _suffix_of(dest, name)
        if dest.name not in saved:
            saved.append(dest.name)

    if transcript is not None:
        stem, ext = MEASURED_NAME[: -len(".json")], ".json"
        dest = d / f"{stem}{report_suffix}{ext}" if report_suffix is not None else _numbered(d, MEASURED_NAME)
        if dest.exists():
            dest = _numbered(d, MEASURED_NAME)
        dest.write_text(json.dumps(measure(transcript, sidechain_only), ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        saved.append(dest.name)
    return saved


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("save", help="Worker の出力を harness-logs に逐語で保存する")
    s.add_argument("--project", required=True)
    s.add_argument("--task-id", required=True)
    s.add_argument("--month", default=datetime.now().strftime("%Y%m"))
    s.add_argument("--logs-dir", type=Path, default=DEFAULT_LOGS_DIR)
    for kind in KINDS:
        s.add_argument(f"--{kind.replace('_', '-')}", type=Path, dest=kind)
    s.add_argument("--transcript", type=Path, help="Worker のトランスクリプト（ツール呼び出しの実測に使う）")
    s.add_argument("--sidechain-only", action="store_true", help="サブエージェント側の記録だけを数える")

    m = sub.add_parser("measure", help="トランスクリプトからツール呼び出しを数えて表示する")
    m.add_argument("--transcript", type=Path, required=True)
    m.add_argument("--sidechain-only", action="store_true")

    a = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if a.cmd == "measure":
        print(json.dumps(measure(a.transcript, a.sidechain_only), ensure_ascii=False, indent=2))
        return 0

    files = {k: getattr(a, k) for k in KINDS if getattr(a, k) is not None}
    if not files and a.transcript is None:
        raise SystemExit("保存するファイルを1つ以上指定してください")
    try:
        saved = save(a.logs_dir, a.project, a.task_id, a.month, files, a.transcript, a.sidechain_only)
    except (ValueError, OSError) as e:
        raise SystemExit(str(e)) from e
    print(json.dumps({"dir": (a.logs_dir / a.project / a.month / a.task_id).as_posix(), "saved": saved},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
