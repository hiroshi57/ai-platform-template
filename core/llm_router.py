"""コスト/レイテンシ/品質を考慮した LLM ルーター(本テンプレートの差別化コア).

- strategy に応じて登録済みプロバイダから最適な1つを選ぶ
- 呼び出しが失敗したら次点へ自動フォールバック
- 全呼び出しを MetricsStore に記録
"""
from __future__ import annotations

from enum import Enum
from typing import Dict, List, Optional

from .observability import MetricsStore, RequestMetric
from .providers import BaseProvider, Completion, default_mock_providers


class RoutingStrategy(str, Enum):
    COST = "cost"          # 最安を優先
    LATENCY = "latency"    # 最速を優先
    QUALITY = "quality"    # 最高品質を優先
    BALANCED = "balanced"  # コスト・レイテンシ・品質の合成スコア


class NoProviderAvailable(RuntimeError):
    pass


class LLMRouter:
    def __init__(
        self,
        providers: Optional[Dict[str, BaseProvider]] = None,
        metrics: Optional[MetricsStore] = None,
    ) -> None:
        self.providers: Dict[str, BaseProvider] = providers or default_mock_providers()
        if not self.providers:
            raise ValueError("at least one provider is required")
        self.metrics = metrics or MetricsStore()

    # --- 選択ロジック ---
    def _rank(self, strategy: RoutingStrategy) -> List[BaseProvider]:
        provs = list(self.providers.values())
        if strategy == RoutingStrategy.COST:
            # 1k in + 1k out の代表コストで昇順
            return sorted(provs, key=lambda p: p.spec.estimated_cost(1000, 1000))
        if strategy == RoutingStrategy.LATENCY:
            return sorted(provs, key=lambda p: p.spec.avg_latency_ms)
        if strategy == RoutingStrategy.QUALITY:
            return sorted(provs, key=lambda p: p.spec.quality_score, reverse=True)
        # BALANCED: 正規化した合成スコア(高いほど良い)
        max_cost = max(p.spec.estimated_cost(1000, 1000) for p in provs) or 1.0
        max_lat = max(p.spec.avg_latency_ms for p in provs) or 1.0

        def score(p: BaseProvider) -> float:
            cost_term = 1 - (p.spec.estimated_cost(1000, 1000) / max_cost)
            lat_term = 1 - (p.spec.avg_latency_ms / max_lat)
            return 0.4 * cost_term + 0.3 * lat_term + 0.3 * p.spec.quality_score

        return sorted(provs, key=score, reverse=True)

    def select(self, strategy: RoutingStrategy = RoutingStrategy.BALANCED) -> BaseProvider:
        ranked = self._rank(strategy)
        return ranked[0]

    # --- 実行(フォールバック付き) ---
    def route(
        self,
        prompt: str,
        strategy: RoutingStrategy = RoutingStrategy.BALANCED,
        max_output_tokens: int = 256,
    ) -> Completion:
        ranked = self._rank(strategy)
        last_error: Optional[Exception] = None
        for idx, provider in enumerate(ranked):
            try:
                completion = provider.generate(prompt, max_output_tokens=max_output_tokens)
            except Exception as exc:  # noqa: BLE001 - 意図的に全捕捉して次点へ
                last_error = exc
                continue
            # 1 論理リクエスト = 1 レコード. attempts に到達までの試行数を残す
            self.metrics.record(RequestMetric(
                provider=completion.provider, model=completion.model,
                strategy=strategy.value, input_tokens=completion.input_tokens,
                output_tokens=completion.output_tokens, latency_ms=completion.latency_ms,
                cost_usd=completion.cost_usd, fell_back=(idx > 0), attempts=idx + 1, ok=True,
            ))
            return completion
        # 全滅時は失敗レコードを 1 件残してから raise
        self.metrics.record(RequestMetric(
            provider="none", model="none", strategy=strategy.value,
            input_tokens=0, output_tokens=0, latency_ms=0.0, cost_usd=0.0,
            fell_back=True, attempts=len(ranked), ok=False,
        ))
        raise NoProviderAvailable(f"all providers failed; last error: {last_error}")
