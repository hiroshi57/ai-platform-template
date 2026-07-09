"""新規 AI アプリの雛形. これを clone/コピーして機能を足すだけで、
認証・レート制限・LLM自動ルーティング・観測性が最初から揃う。

FastAPI が入っていれば `uvicorn app_template.main:app --reload` で起動。
FastAPI 未インストールでも core 単体はテスト可能(この import は遅延)。
"""
from __future__ import annotations

import os

from core import APIKeyStore, LLMRouter, RateLimiter, RoutingStrategy

# 共通基盤を初期化(実運用では from_env で差し替え)
API_KEYS = APIKeyStore.from_env()
if not API_KEYS.verify("demo-key"):
    API_KEYS.add("demo-key", "demo-tenant")  # ローカルデモ用

ROUTER = LLMRouter()  # API キー無しでも mock で動く
RATE_LIMITER = RateLimiter(capacity=20, refill_per_sec=5)


def create_app():  # pragma: no cover - FastAPI 実行経路(テストは core を直接検証)
    from fastapi import Depends, FastAPI, Header, HTTPException
    from pydantic import BaseModel

    app = FastAPI(title="AI Platform Template", version="0.1.0")

    class ChatRequest(BaseModel):
        prompt: str
        strategy: RoutingStrategy = RoutingStrategy.BALANCED
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
            "tenant": tenant,
            "text": c.text,
            "provider": c.provider,
            "model": c.model,
            "cost_usd": c.cost_usd,
            "latency_ms": c.latency_ms,
        }

    @app.get("/v1/metrics")
    def metrics(tenant: str = Depends(auth_and_limit)):
        return ROUTER.metrics.summary()

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "providers": list(ROUTER.providers)}

    return app


# uvicorn エントリポイント
try:  # pragma: no cover
    app = create_app()
except Exception:  # FastAPI 未インストール等
    app = None
