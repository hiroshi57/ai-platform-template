"""観測性: リクエスト単位でコスト・レイテンシ・トークンを記録し集計する.

差別化ポイント。新規 AI アプリがこのテンプレートを clone するだけで
「プロバイダ別コスト」「p95 レイテンシ」「フォールバック発生率」を
すぐ可視化できる。外部監視サービス非依存。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List

logger = logging.getLogger("ai_platform.observability")


@dataclass
class RequestMetric:
    """1 論理リクエスト = 1 レコード. 途中のフォールバック試行は attempts に集約する
    (失敗試行を別レコードにすると count / コスト / p95 が歪むため)."""

    provider: str
    model: str
    strategy: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    cost_usd: float
    fell_back: bool = False   # 一次プロバイダ以外で成功したか
    attempts: int = 1         # 成功までに試したプロバイダ数
    ok: bool = True


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * (pct / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(ordered) - 1)
    frac = k - lo
    return ordered[lo] + (ordered[hi] - ordered[lo]) * frac


class MetricsStore:
    """インメモリのメトリクス集計。プロセス横断が必要なら差し替え可能."""

    def __init__(self) -> None:
        self._metrics: List[RequestMetric] = []

    def record(self, metric: RequestMetric) -> None:
        self._metrics.append(metric)
        logger.info(
            "llm_call provider=%s model=%s strategy=%s cost=%.6f latency_ms=%.1f "
            "fell_back=%s attempts=%d ok=%s",
            metric.provider, metric.model, metric.strategy,
            metric.cost_usd, metric.latency_ms, metric.fell_back, metric.attempts, metric.ok,
        )

    @property
    def count(self) -> int:
        return len(self._metrics)

    def summary(self) -> Dict:
        total = len(self._metrics)
        if total == 0:
            return {"count": 0, "total_cost_usd": 0.0, "p95_latency_ms": 0.0,
                    "fallback_rate": 0.0, "by_provider": {}}
        latencies = [m.latency_ms for m in self._metrics]
        by_provider: Dict[str, Dict] = {}
        for m in self._metrics:
            bp = by_provider.setdefault(m.provider, {"count": 0, "cost_usd": 0.0})
            bp["count"] += 1
            bp["cost_usd"] = round(bp["cost_usd"] + m.cost_usd, 6)
        return {
            "count": total,
            "total_cost_usd": round(sum(m.cost_usd for m in self._metrics), 6),
            "p95_latency_ms": round(_percentile(latencies, 95), 1),
            "fallback_rate": round(sum(1 for m in self._metrics if m.fell_back) / total, 4),
            "by_provider": by_provider,
        }
