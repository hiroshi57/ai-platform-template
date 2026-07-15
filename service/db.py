"""永続化層(SQLite, 標準ライブラリ). LLM呼び出しメトリクスの保存. テナント分離."""
from __future__ import annotations

import sqlite3
from typing import Dict, List

SCHEMA = """
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    strategy TEXT NOT NULL,
    cost_usd REAL NOT NULL,
    latency_ms REAL NOT NULL,
    fell_back INTEGER NOT NULL,
    ok INTEGER NOT NULL
);
"""


class ServiceDB:
    def __init__(self, path: str = ":memory:") -> None:
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def log_metric(self, tenant_id: str, provider: str, model: str, strategy: str,
                   cost_usd: float, latency_ms: float, fell_back: bool, ok: bool) -> None:
        self.conn.execute(
            "INSERT INTO metrics(tenant_id, provider, model, strategy, cost_usd, latency_ms, "
            "fell_back, ok) VALUES (?,?,?,?,?,?,?,?)",
            (tenant_id, provider, model, strategy, cost_usd, latency_ms,
             1 if fell_back else 0, 1 if ok else 0))
        self.conn.commit()

    def summary(self, tenant_id: str) -> Dict:
        rows = self.conn.execute(
            "SELECT provider, cost_usd, latency_ms, fell_back FROM metrics WHERE tenant_id=?",
            (tenant_id,)).fetchall()
        if not rows:
            return {"count": 0, "total_cost_usd": 0.0, "p95_latency_ms": 0.0,
                    "fallback_rate": 0.0, "by_provider": {}}
        latencies = sorted(r["latency_ms"] for r in rows)
        k = (len(latencies) - 1) * 0.95
        lo = int(k)
        hi = min(lo + 1, len(latencies) - 1)
        p95 = latencies[lo] + (latencies[hi] - latencies[lo]) * (k - lo)
        by: Dict[str, Dict] = {}
        for r in rows:
            b = by.setdefault(r["provider"], {"count": 0, "cost_usd": 0.0})
            b["count"] += 1
            b["cost_usd"] = round(b["cost_usd"] + r["cost_usd"], 6)
        return {
            "count": len(rows),
            "total_cost_usd": round(sum(r["cost_usd"] for r in rows), 6),
            "p95_latency_ms": round(p95, 1),
            "fallback_rate": round(sum(1 for r in rows if r["fell_back"]) / len(rows), 4),
            "by_provider": by,
        }

    def close(self) -> None:
        self.conn.close()
