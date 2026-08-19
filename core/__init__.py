"""ai-platform-template core: 認証/レート制限/観測性/LLMルーティングの共通基盤."""
from .auth import APIKeyStore, generate_api_key
from .llm_router import LLMRouter, RoutingStrategy, NoProviderAvailable, DEFAULT_WEIGHTS
from .observability import (
    MetricsStore, RequestMetric, summarize, empty_summary, percentile,
)
from .pricing import ModelEntry, load_catalog, unverified_providers, PRICING_SOURCE
from .providers import (
    BaseProvider,
    Completion,
    FailingProvider,
    MockProvider,
    ProviderSpec,
    default_mock_providers,
    default_specs,
    estimate_tokens,
)
from .rate_limit import RateLimiter
from .config import Settings
from .logging import configure_logging, new_request_id, get_request_id, set_request_id
from .real_providers import (
    build_providers, build_provider, provider_mode, PROVIDER_REGISTRY, UnknownProviderError,
)
from .finops import (
    BudgetGuard, BudgetStatus, project_month_end, detect_cost_anomaly, CostAnomaly,
    days_in_month_of,
)

__version__ = "1.1.0"

__all__ = [
    "__version__",
    "APIKeyStore",
    "generate_api_key",
    "LLMRouter",
    "RoutingStrategy",
    "NoProviderAvailable",
    "DEFAULT_WEIGHTS",
    "MetricsStore",
    "RequestMetric",
    "summarize",
    "empty_summary",
    "percentile",
    "ModelEntry",
    "load_catalog",
    "unverified_providers",
    "PRICING_SOURCE",
    "BaseProvider",
    "Completion",
    "FailingProvider",
    "MockProvider",
    "ProviderSpec",
    "default_mock_providers",
    "default_specs",
    "estimate_tokens",
    "RateLimiter",
    "Settings",
    "configure_logging",
    "new_request_id",
    "get_request_id",
    "set_request_id",
    "build_providers",
    "build_provider",
    "provider_mode",
    "PROVIDER_REGISTRY",
    "UnknownProviderError",
    "BudgetGuard",
    "BudgetStatus",
    "project_month_end",
    "detect_cost_anomaly",
    "CostAnomaly",
    "days_in_month_of",
]
