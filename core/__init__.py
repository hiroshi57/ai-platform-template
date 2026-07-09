"""ai-platform-template core: 認証/レート制限/観測性/LLMルーティングの共通基盤."""
from .auth import APIKeyStore
from .llm_router import LLMRouter, RoutingStrategy, NoProviderAvailable
from .observability import MetricsStore, RequestMetric
from .providers import (
    BaseProvider,
    Completion,
    FailingProvider,
    MockProvider,
    ProviderSpec,
    default_mock_providers,
)
from .rate_limit import RateLimiter

__all__ = [
    "APIKeyStore",
    "LLMRouter",
    "RoutingStrategy",
    "NoProviderAvailable",
    "MetricsStore",
    "RequestMetric",
    "BaseProvider",
    "Completion",
    "FailingProvider",
    "MockProvider",
    "ProviderSpec",
    "default_mock_providers",
    "RateLimiter",
]
