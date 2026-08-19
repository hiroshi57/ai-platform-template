import pytest

from service.db import ServiceDB
from service.report_html import build_html_report


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


def test_api_e2e_and_tenant_isolation(auth_headers, other_headers):
    # importorskip はローカルでは便利だが、CI で依存が抜けていると
    # テストが黙ってスキップされ「緑」に見える。CI では必須扱いにする。
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from service.api import create_app
    c = TestClient(create_app())
    ha, hb = auth_headers, other_headers
    r = c.post("/v1/chat", json={"prompt": "経費精算の締め日は?", "strategy": "cost"}, headers=ha)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["text"] and body["provider"]
    # tenant-a はメトリクス1件、tenant-b は0件(分離)
    assert c.get("/v1/metrics", headers=ha).json()["count"] == 1
    assert c.get("/v1/metrics", headers=hb).json()["count"] == 0
    assert c.get("/v1/providers").status_code == 200
    rep = c.get("/v1/report", headers=ha)
    assert rep.status_code == 200 and "観測性レポート" in rep.text


def test_api_requires_authentication():
    """回帰テスト: 旧実装は X-Tenant-Id を送るだけで誰でも任意テナントを読めた."""
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from service.api import create_app
    c = TestClient(create_app())
    # 認証ヘッダ無し
    assert c.post("/v1/chat", json={"prompt": "x"}).status_code == 401
    assert c.get("/v1/metrics").status_code == 401
    assert c.get("/v1/report").status_code == 401
    # テナントをクライアントが指定しても無視される(成りすまし不可)
    assert c.get("/v1/metrics", headers={"X-Tenant-Id": "t-a"}).status_code == 401
    assert c.get("/v1/metrics", headers={"X-API-Key": "bogus-key"}).status_code == 401


def test_api_rejects_unknown_strategy(auth_headers):
    """旧実装は不正な strategy を黙って balanced に落としていた."""
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from service.api import create_app
    c = TestClient(create_app())
    r = c.post("/v1/chat", json={"prompt": "x", "strategy": "cheapest"},
               headers=auth_headers)
    assert r.status_code == 400
    assert "cheapest" in r.text


def test_db_month_to_date_and_daily_costs():
    db = ServiceDB(":memory:")
    db.log_metric("t-a", "claude", "m", "balanced", 0.5, 900, False, True,
                  created_at="2020-01-05T00:00:00+00:00")   # 過去月
    db.log_metric("t-a", "claude", "m", "balanced", 0.25, 900, False, True)  # 今月
    # 全期間合計は 0.75 だが、当月分は 0.25 のみ
    assert db.summary("t-a")["total_cost_usd"] == 0.75
    assert db.month_to_date_cost("t-a") == 0.25
    assert len(db.daily_costs("t-a")) == 2


def test_failed_calls_do_not_deflate_p95():
    """失敗レコード(latency=0)を混ぜると p95 が実態より小さく出る回帰."""
    db = ServiceDB(":memory:")
    for _ in range(9):
        db.log_metric("t-a", "claude", "m", "balanced", 0.001, 1000, False, True)
    db.log_metric("t-a", "none", "none", "balanced", 0.0, 0.0, True, False)
    s = db.summary("t-a")
    assert s["p95_latency_ms"] == 1000.0     # 0ms の失敗に引きずられない
    assert s["error_count"] == 1
    assert "none" not in s["by_provider"]
