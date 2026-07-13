"""新規 AI アプリの雛形. これを clone/コピーして機能を足すだけで、
認証・レート制限・LLM自動ルーティング・観測性・構造化ロギングが最初から揃う。

- 設定は Settings.from_env() で一元管理
- プロバイダはキーがあれば実API、無ければ mock に自動フォールバック
- 全リクエストに request_id を付与しログ相関

FastAPI が入っていれば `uvicorn app_template.main:app --reload` で起動。
FastAPI 未インストールでも core 単体はテスト可能(この import は遅延)。
"""
from __future__ import annotations

from core import (
    APIKeyStore, LLMRouter, RateLimiter, RoutingStrategy, Settings,
    build_providers, provider_mode, configure_logging, new_request_id, get_request_id,
)

# --- 設定と共通基盤の初期化 ---
SETTINGS = Settings.from_env()
configure_logging(level=SETTINGS.log_level, json_format=SETTINGS.log_json)

API_KEYS = APIKeyStore.from_env()
if not API_KEYS.verify("demo-key"):
    API_KEYS.add("demo-key", "demo-tenant")  # ローカルデモ用

# キーがあれば実API、無ければ mock で動く
ROUTER = LLMRouter(providers=build_providers(SETTINGS.enabled_providers))
RATE_LIMITER = RateLimiter(capacity=SETTINGS.rate_capacity, refill_per_sec=SETTINGS.rate_refill_per_sec)


def create_app():  # pragma: no cover - FastAPI 実行経路(テストは core を直接検証)
    from fastapi import Depends, FastAPI, Header, HTTPException, Request
    from pydantic import BaseModel

    app = FastAPI(title="AI Platform Template", version="0.2.0")

    @app.middleware("http")
    async def request_id_mw(request: Request, call_next):
        rid = request.headers.get("x-request-id") or new_request_id()
        from core import set_request_id
        set_request_id(rid)
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response

    class ChatRequest(BaseModel):
        prompt: str
        strategy: RoutingStrategy = SETTINGS.default_strategy
        max_output_tokens: int = 256

    def auth_and_limit(x_api_key: str = Header(default="")) -> str:
        tenant = API_KEYS.resolve_tenant(x_api_key)
        if tenant is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        if not RATE_LIMITER.allow(tenant):
            raise HTTPException(status_code=429, detail="rate limit exceeded")
        return tenant

    @app.post("/v1/chat")
    def chat(req: ChatRequest, tenant: str = Depends(auth_and_limit)):
        c = ROUTER.route(req.prompt, strategy=req.strategy, max_output_tokens=req.max_output_tokens)
        return {
            "request_id": get_request_id(), "tenant": tenant, "text": c.text,
            "provider": c.provider, "model": c.model,
            "cost_usd": c.cost_usd, "latency_ms": c.latency_ms,
        }

    @app.get("/v1/metrics")
    def metrics(tenant: str = Depends(auth_and_limit)):
        return ROUTER.metrics.summary()

    @app.get("/v1/providers")
    def providers():
        # 各プロバイダが real(キーあり) か mock(キー無し) かを可視化
        return {name: provider_mode(name) for name in SETTINGS.enabled_providers}

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "providers": list(ROUTER.providers)}

    return app


# uvicorn エントリポイント
try:  # pragma: no cover
    app = create_app()
except Exception:  # FastAPI 未インストール等
    app = None
