"""設定管理. 環境変数から一元的にロードする(新規アプリはこれを import するだけ)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List

from .llm_router import RoutingStrategy


def _env_bool(key: str, default: bool) -> bool:
    v = os.getenv(key)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    # ルーティング既定戦略
    default_strategy: RoutingStrategy = RoutingStrategy.BALANCED
    # レート制限
    rate_capacity: float = 20.0
    rate_refill_per_sec: float = 5.0
    # ロギング
    log_level: str = "INFO"
    log_json: bool = True
    # プロバイダの有効/無効(キーが無ければ自動でmockにフォールバック)
    enabled_providers: List[str] = field(default_factory=lambda: ["claude", "openai", "gemini"])

    @classmethod
    def from_env(cls) -> "Settings":
        strat = os.getenv("AI_PLATFORM_STRATEGY", "balanced").lower()
        try:
            strategy = RoutingStrategy(strat)
        except ValueError:
            strategy = RoutingStrategy.BALANCED
        providers = os.getenv("AI_PLATFORM_PROVIDERS", "claude,openai,gemini")
        return cls(
            default_strategy=strategy,
            rate_capacity=float(os.getenv("AI_PLATFORM_RATE_CAPACITY", "20")),
            rate_refill_per_sec=float(os.getenv("AI_PLATFORM_RATE_REFILL", "5")),
            log_level=os.getenv("AI_PLATFORM_LOG_LEVEL", "INFO").upper(),
            log_json=_env_bool("AI_PLATFORM_LOG_JSON", True),
            enabled_providers=[p.strip() for p in providers.split(",") if p.strip()],
        )
