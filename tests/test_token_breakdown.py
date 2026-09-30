"""scripts/token_breakdown.py のテスト（提案 D: retro のツール使用内訳の集計）."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("token_breakdown", ROOT / "scripts" / "token_breakdown.py")
tb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tb)


def _write_task(logs: Path, month: str, task_id: str, tool_usage=None, mtime: float = 0.0,
                stdout_lines: int | None = None) -> Path:
    d = logs / "proj" / month / task_id
    d.mkdir(parents=True)
    report = {"schema_version": "worker-report.v1", "status": "completed", "turns_used": 5}
    if tool_usage is not None:
        report["tool_usage"] = tool_usage
    f = d / "worker-report.json"
    f.write_text(json.dumps(report), encoding="utf-8")
    if stdout_lines is not None:
        (d / "commands.stdout.log").write_text("x\n" * stdout_lines, encoding="utf-8")
    if mtime:
        os.utime(f, (mtime, mtime))
    return f


def _usage(read=0, search=0, bash=0, edit=0, largest=0, reread=None):
    return {"read_calls": read, "search_calls": search, "bash_calls": bash, "edit_calls": edit,
            "largest_output_lines": largest, "reread_files": reread or []}


def test_retrieval_ratio_counts_read_search_bash_over_all_calls(tmp_path):
    _write_task(tmp_path, "202609", "1.1", _usage(read=6, search=2, bash=2, edit=10))
    r = tb.summarize(tb.collect_reports(tmp_path, limit=10))
    assert r["totals"] == {"read_calls": 6, "search_calls": 2, "bash_calls": 2, "edit_calls": 10}
    assert r["retrieval_ratio"] == pytest.approx(0.5)
    assert r["advisories"] == []


def test_high_retrieval_ratio_raises_toolset_advisory(tmp_path):
    _write_task(tmp_path, "202609", "1.1", _usage(read=7, search=1, bash=1, edit=1))
    r = tb.summarize(tb.collect_reports(tmp_path, limit=10))
    assert r["retrieval_ratio"] == pytest.approx(0.9)
    assert any("ツールセット" in a for a in r["advisories"])


def test_limit_keeps_most_recent_tasks_only(tmp_path):
    _write_task(tmp_path, "202608", "old", _usage(edit=100), mtime=1_000)
    _write_task(tmp_path, "202609", "new1", _usage(read=1, edit=1), mtime=2_000)
    _write_task(tmp_path, "202609", "new2", _usage(read=1, edit=1), mtime=3_000)
    reports = tb.collect_reports(tmp_path, limit=2)
    assert [x["task_id"] for x in reports] == ["new2", "new1"]
    assert tb.summarize(reports)["totals"]["edit_calls"] == 2


def test_missing_tool_usage_is_counted_not_failed(tmp_path):
    _write_task(tmp_path, "202609", "1.1", None)
    _write_task(tmp_path, "202609", "1.2", _usage(read=1, edit=1))
    r = tb.summarize(tb.collect_reports(tmp_path, limit=10))
    assert r["tasks"] == 2
    assert r["tasks_without_tool_usage"] == 1
    assert r["totals"]["read_calls"] == 1


def test_files_reread_in_multiple_tasks_are_reported(tmp_path):
    _write_task(tmp_path, "202609", "1.1", _usage(read=1, reread=["core/router.py", "a.py"]))
    _write_task(tmp_path, "202609", "1.2", _usage(read=1, reread=["core/router.py"]))
    r = tb.summarize(tb.collect_reports(tmp_path, limit=10))
    assert r["frequent_rereads"] == [{"file": "core/router.py", "tasks": 2}]
    assert any("GOTCHAS.md" in a for a in r["advisories"])


def test_stdout_log_lines_are_attached_for_cross_check(tmp_path):
    _write_task(tmp_path, "202609", "1.1", _usage(bash=1, largest=40), stdout_lines=120)
    task = tb.summarize(tb.collect_reports(tmp_path, limit=10))["per_task"][0]
    assert task["largest_output_lines"] == 40
    assert task["stdout_log_lines"] == 120


def test_no_logs_returns_empty_summary(tmp_path):
    r = tb.summarize(tb.collect_reports(tmp_path / "missing", limit=10))
    assert r["tasks"] == 0
    assert r["retrieval_ratio"] is None


def test_broken_json_is_skipped(tmp_path):
    d = tmp_path / "proj" / "202609" / "bad"
    d.mkdir(parents=True)
    (d / "worker-report.json").write_text("{not json", encoding="utf-8")
    _write_task(tmp_path, "202609", "ok", _usage(read=1, edit=1))
    r = tb.summarize(tb.collect_reports(tmp_path, limit=10))
    assert r["tasks"] == 1
    assert r["skipped_files"] == 1
