"""LLM プロバイダ抽象と mock 実装.

差別化の土台: 各プロバイダは「コスト・レイテンシ・品質」のメタデータを持ち、
Router がこれを使って要求に最適なプロバイダを選ぶ。API キーが無くても
rule-based の MockProvider で動作する(OpenMythos パターン)。
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass(frozen=True)
class ProviderSpec:
    """プロバイダの選択に使うメタデータ."""

    name: str                       # 例: "claude", "openai", "gemini"
    model: str
    cost_per_1k_input: float        # USD / 1k input tokens
    cost_per_1k_output: float       # USD / 1k output tokens
    avg_latency_ms: float           # 実測 EMA で更新される想定の初期値
    quality_score: float            # 0.0-1.0 の相対品質(社内ベンチ想定)

    def estimated_cost(self, input_tokens: int, output_tokens: int) -> float:
        return (
            input_tokens / 1000 * self.cost_per_1k_input
            + output_tokens / 1000 * self.cost_per_1k_output
        )


@dataclass
class Completion:
    text: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    cost_usd: float


class BaseProvider:
    """全プロバイダの基底. spec を必ず持つ."""

    def __init__(self, spec: ProviderSpec) -> None:
        self.spec = spec

    def generate(self, prompt: str, max_output_tokens: int = 256) -> Completion:  # pragma: no cover
        raise NotImplementedError


def _estimate_tokens(text: str) -> int:
    """外部依存なしの粗いトークン推定(語数 * 1.3)."""
    words = max(1, len(text.split()))
    return int(words * 1.3) + 1


class MockProvider(BaseProvider):
    """API キー無しで決定的に動く rule-based プロバイダ.

    テストと fallback の両方で使う。latency は spec の avg_latency_ms を
    そのまま返し(スリープはしない=テスト高速)、レスポンスは決定的。
    """

    def __init__(self, spec: ProviderSpec, responder: Optional[Callable[[str], str]] = None) -> None:
        super().__init__(spec)
        self._responder = responder or (lambda p: f"[{spec.name}:{spec.model}] response to: {p.strip()[:80]}")

    def generate(self, prompt: str, max_output_tokens: int = 256) -> Completion:
        text = self._responder(prompt)
        input_tokens = _estimate_tokens(prompt)
        output_tokens = min(_estimate_tokens(text), max_output_tokens)
        return Completion(
            text=text,
            provider=self.spec.name,
            model=self.spec.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=self.spec.avg_latency_ms,
            cost_usd=self.spec.estimated_cost(input_tokens, output_tokens),
        )


class FailingProvider(BaseProvider):
    """fallback 検証用: 常に例外を投げる."""

    def generate(self, prompt: str, max_output_tokens: int = 256) -> Completion:
        raise RuntimeError(f"provider {self.spec.name} is unavailable")


# --- 既定のプロバイダ群(社内ベンチ想定の初期値。実測で上書きする) ---
DEFAULT_SPECS = [
    ProviderSpec("claude", "claude-sonnet", cost_per_1k_input=0.003, cost_per_1k_output=0.015,
                 avg_latency_ms=900, quality_score=0.93),
    ProviderSpec("openai", "gpt-4o", cost_per_1k_input=0.005, cost_per_1k_output=0.015,
                 avg_latency_ms=1100, quality_score=0.92),
    ProviderSpec("gemini", "gemini-1.5-pro", cost_per_1k_input=0.00125, cost_per_1k_output=0.005,
                 avg_latency_ms=1300, quality_score=0.88),
]


def default_mock_providers() -> "dict[str, BaseProvider]":
    return {spec.name: MockProvider(spec) for spec in DEFAULT_SPECS}
