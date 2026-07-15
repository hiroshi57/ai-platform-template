import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from service.db import ServiceDB  # noqa: E402
from service.report_html import build_html_report  # noqa: E402


def test_metrics_log_and_summary():
    db = ServiceDB(":memory:")
    db.log_metric("t-a", "claude", "claude-3-5-sonnet", "balanced", 0.0001, 900, False, True)
    db.log_metric("t-a", "gemini", "gemini-1.5-pro", "cost", 0.00003, 1300, True, True)
    s = db.summary("t-a")
    assert s["count"] == 2
    assert s["total_cost_usd"] > 0
    assert s["fallback_rate"] == 0.5
    assert set(s["by_provider"]) == {"claude", "gemini"}


def test_metrics_tenant_isolation():
    db = ServiceDB(":memory:")
    db.log_metric("t-a", "claude", "m", "balanced", 0.1, 900, False, True)
    assert db.summary("t-b")["count"] == 0     # 越境不可


def test_p95_latency():
    db = ServiceDB(":memory:")
    for lat in [100, 200, 300, 400, 1000]:
        db.log_metric("t-a", "claude", "m", "balanced", 0.001, lat, False, True)
    assert db.summary("t-a")["p95_latency_ms"] >= 400


def test_html_report():
    db = ServiceDB(":memory:")
    db.log_metric("t-a", "claude", "m", "balanced", 0.001, 900, False, True)
    html = build_html_report(db.summary("t-a"), {"claude": "mock"})
    assert "観測性レポート" in html and "claude" in html and "総リクエスト" in html


def test_api_e2e_and_tenant_isolation():
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    from service.api import create_app
    c = TestClient(create_app())
    ha, hb = {"X-Tenant-Id": "t-a"}, {"X-Tenant-Id": "t-b"}
    r = c.post("/v1/chat", json={"prompt": "経費精算の締め日は?", "strategy": "cost"}, headers=ha).json()
    assert r["text"] and r["provider"]
    # tenant-a はメトリクス1件、tenant-b は0件(分離)
    assert c.get("/v1/metrics", headers=ha).json()["count"] == 1
    assert c.get("/v1/metrics", headers=hb).json()["count"] == 0
    assert c.get("/v1/providers").status_code == 200
    rep = c.get("/v1/report", headers=ha)
    assert rep.status_code == 200 and "観測性レポート" in rep.text
