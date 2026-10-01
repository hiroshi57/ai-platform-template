"""scripts/harness_log.py のテスト（提案 D: Worker の出力を harness-logs に逐語で保存し、ツール使用を実測する）."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("harness_log", ROOT / "scripts" / "harness_log.py")
hl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hl)


def _file(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / "in" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def _tool_use(name: str, **inp) -> dict:
    return {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "x", "name": name, "input": inp}]}}


def _tool_result(text: str, sidechain: bool = False) -> dict:
    return {"type": "user", "isSidechain": sidechain,
            "message": {"content": [{"type": "tool_result", "tool_use_id": "x", "content": text}]}}


def _transcript(tmp_path: Path, entries: list[dict]) -> Path:
    return _file(tmp_path, "agent.jsonl", "\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n")


# --- 保存 --------------------------------------------------------------------

def test_save_copies_files_verbatim_into_task_dir(tmp_path):
    logs = tmp_path / "logs"
    report = _file(tmp_path, "wr.json", '{"status": "completed",  "odd_spacing": true}\n')
    log = _file(tmp_path, "out.log", "105 passed\n")
    saved = hl.save(logs, "proj", "43.1", "202610", {"worker_report": report, "stdout_log": log})
    d = logs / "proj" / "202610" / "43.1"
    assert (d / "worker-report.json").read_bytes() == report.read_bytes()      # 整形し直さない
    assert (d / "commands.stdout.log").read_bytes() == log.read_bytes()
    assert sorted(saved) == ["commands.stdout.log", "worker-report.json"]


def test_second_candidate_gets_a_number_and_nothing_is_overwritten(tmp_path):
    logs = tmp_path / "logs"
    first = _file(tmp_path, "a.json", '{"n": 1}')
    second = _file(tmp_path, "b.json", '{"n": 2}')
    hl.save(logs, "proj", "1", "202610", {"worker_report": first})
    saved = hl.save(logs, "proj", "1", "202610", {"worker_report": second})
    d = logs / "proj" / "202610" / "1"
    assert json.loads((d / "worker-report.json").read_text()) == {"n": 1}
    assert json.loads((d / "worker-report.2.json").read_text()) == {"n": 2}
    assert saved == ["worker-report.2.json"]


def test_logs_that_accumulate_are_appended_not_numbered(tmp_path):
    logs = tmp_path / "logs"
    hl.save(logs, "proj", "1", "202610", {"stdout_log": _file(tmp_path, "a.log", "run 1\n")})
    hl.save(logs, "proj", "1", "202610", {"stdout_log": _file(tmp_path, "b.log", "run 2\n")})
    text = (logs / "proj" / "202610" / "1" / "commands.stdout.log").read_text(encoding="utf-8")
    assert "run 1\n" in text and "run 2\n" in text and text.index("run 1") < text.index("run 2")


def test_unsafe_names_are_rejected(tmp_path):
    report = _file(tmp_path, "wr.json", "{}")
    for bad in ("../x", "a/b", "", "."):
        with pytest.raises(ValueError):
            hl.save(tmp_path / "logs", bad, "1", "202610", {"worker_report": report})
        with pytest.raises(ValueError):
            hl.save(tmp_path / "logs", "proj", bad, "202610", {"worker_report": report})
    with pytest.raises(ValueError):
        hl.save(tmp_path / "logs", "proj", "1", "2026-10", {"worker_report": report})


def test_invalid_worker_report_json_is_still_saved_but_warned(tmp_path):
    report = _file(tmp_path, "wr.json", "{not json")
    warnings = []
    hl.save(tmp_path / "logs", "proj", "1", "202610", {"worker_report": report}, warn=warnings.append)
    assert (tmp_path / "logs" / "proj" / "202610" / "1" / "worker-report.json").read_text() == "{not json"
    assert warnings and "JSON" in warnings[0]


# --- 実測 --------------------------------------------------------------------

def test_measure_counts_tools_by_kind_from_transcript(tmp_path):
    t = _transcript(tmp_path, [
        _tool_use("Read", file_path="/r/a.py"), _tool_result("1\n2\n3"),
        _tool_use("Read", file_path="/r/a.py"), _tool_result("1"),
        _tool_use("Grep", pattern="x"), _tool_result("hit"),
        _tool_use("Glob", pattern="*.py"), _tool_result("a.py"),
        _tool_use("Bash", command="python -m pytest -q"), _tool_result("ok\n" * 40),
        _tool_use("Bash", command="grep -rn foo src"), _tool_result("hit"),
        _tool_use("Bash", command="cat README.md | head"), _tool_result("x"),
        _tool_use("Edit", file_path="/r/a.py"), _tool_result("ok"),
        _tool_use("Write", file_path="/r/b.py"), _tool_result("ok"),
        _tool_use("mcp__x__search_console_report"), _tool_result("ok"),
    ])
    m = hl.measure(t)
    assert (m["read_calls"], m["search_calls"], m["bash_calls"], m["edit_calls"], m["other_calls"]) == (3, 3, 1, 2, 1)
    assert m["largest_output_lines"] == 40
    assert m["reread_files"] == ["/r/a.py"]
    assert m["data_source"] == "measured"


def test_measure_can_limit_to_sidechain_entries(tmp_path):
    main = _tool_use("Read", file_path="/main.py")
    sub = {**_tool_use("Edit", file_path="/sub.py"), "isSidechain": True}
    m = hl.measure(_transcript(tmp_path, [main, sub]), sidechain_only=True)
    assert (m["read_calls"], m["edit_calls"]) == (0, 1)


def test_measure_does_not_copy_message_text(tmp_path):
    secret = "AKIA-SECRET-VALUE-123"
    t = _transcript(tmp_path, [_tool_use("Bash", command=f"echo {secret}"), _tool_result(secret)])
    assert secret not in json.dumps(hl.measure(t), ensure_ascii=False)


def test_save_with_transcript_writes_measured_usage_next_to_candidate(tmp_path):
    logs = tmp_path / "logs"
    t = _transcript(tmp_path, [_tool_use("Read", file_path="/a"), _tool_result("x")])
    hl.save(logs, "proj", "1", "202610", {"worker_report": _file(tmp_path, "a.json", "{}")}, transcript=t)
    hl.save(logs, "proj", "1", "202610", {"worker_report": _file(tmp_path, "b.json", "{}")}, transcript=t)
    d = logs / "proj" / "202610" / "1"
    assert json.loads((d / "tool-usage.measured.json").read_text())["read_calls"] == 1
    assert (d / "tool-usage.measured.2.json").is_file()
    assert not (d / "agent.jsonl").exists()          # トランスクリプト本体は保存しない


def test_harness_logs_are_gitignored():
    text = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert ".claude/harness-logs/" in text
