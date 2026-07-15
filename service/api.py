"""AI基盤テンプレート サービスAPI(FastAPI). ルーティング実行 -> メトリクス永続化 -> 観測性レポート.
テナント分離(X-Tenant-Id)。`uvicorn service.api:app --reload`
"""
from core import LLMRouter, RoutingStrategy, Settings, build_providers, provider_mode
from .db import ServiceDB
from .report_html import build_html_report

SETTINGS = Settings.from_env()
DB = ServiceDB(":memory:")
ROUTER = LLMRouter(providers=build_providers(SETTINGS.enabled_providers))


def chat(tenant: str, prompt: str, strategy: RoutingStrategy) -> dict:
    c = ROUTER.route(prompt, strategy=strategy)
    # 直近メトリクスをテナント別にDBへ
    m = ROUTER.metrics._metrics[-1]  # noqa: SLF001 - 直近レコード
    DB.log_metric(tenant, m.provider, m.model, m.strategy, m.cost_usd, m.latency_ms, m.fell_back, m.ok)
    return {"text": c.text, "provider": c.provider, "model": c.model,
            "cost_usd": c.cost_usd, "latency_ms": c.latency_ms}


def create_app():  # pragma: no cover
    from fastapi import Depends, FastAPI, Header, HTTPException
    from fastapi.responses import HTMLResponse
    from pydantic import BaseModel

    app = FastAPI(title="AI Platform Template", version="1.0.0")

    def tenant(x_tenant_id: str = Header(...)) -> str:
        if not x_tenant_id:
            raise HTTPException(401, "tenant required")
        return x_tenant_id

    class ChatIn(BaseModel):
        prompt: str
        strategy: str = "balanced"

    @app.post("/v1/chat")
    def do_chat(body: ChatIn, t: str = Depends(tenant)):
        try:
            strat = RoutingStrategy(body.strategy)
        except ValueError:
            strat = RoutingStrategy.BALANCED
        return chat(t, body.prompt, strat)

    @app.get("/v1/metrics")
    def metrics(t: str = Depends(tenant)):
        return DB.summary(t)

    @app.get("/v1/providers")
    def providers():
        return {name: provider_mode(name) for name in SETTINGS.enabled_providers}

    @app.get("/v1/report", response_class=HTMLResponse)
    def report(t: str = Depends(tenant)):
        modes = {name: provider_mode(name) for name in SETTINGS.enabled_providers}
        return build_html_report(DB.summary(t), modes)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    return app


try:  # pragma: no cover
    app = create_app()
except Exception:
    app = None
