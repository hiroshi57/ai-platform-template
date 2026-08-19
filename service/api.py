"""AI基盤テンプレート サービスAPI(FastAPI). ルーティング実行 -> メトリクス永続化 -> 観測性レポート.

セキュリティ上の重要な変更:
  旧実装はテナントを `X-Tenant-Id` ヘッダから読むだけで **認証が一切無かった**。
  ヘッダを書き換えれば任意テナントのコスト・メトリクスを読めるため、
  「テナント分離」はセキュリティ境界として成立していなかった。
  現在は API キー認証でテナントを解決し、クライアントはテナントを選べない。

`uvicorn service.api:app --reload`
"""
from __future__ import annotations

import logging
from typing import Optional

from core import (
    APIKeyStore, BudgetGuard, LLMRouter, NoProviderAvailable, RoutingStrategy, Settings,
    build_providers, configure_logging, detect_cost_anomaly, get_request_id, new_request_id,
    provider_mode, set_request_id, unverified_providers, RateLimiter,
)

from .db import ServiceDB
from .report_html import build_html_report

logger = logging.getLogger("ai_platform.api")

SETTINGS = Settings.from_env()
configure_logging(level=SETTINGS.log_level, json_format=SETTINGS.log_json)

# 旧実装は ":memory:" 固定で、README の「永続化」という記述と矛盾していた
# (プロセス再起動でコスト履歴が消える = FinOps が成立しない)。
DB = ServiceDB(SETTINGS.db_path)
ROUTER = LLMRouter(providers=build_providers(SETTINGS.enabled_providers))
API_KEYS = APIKeyStore.from_env()
RATE_LIMITER = RateLimiter(capacity=SETTINGS.rate_capacity,
                           refill_per_sec=SETTINGS.rate_refill_per_sec)

MAX_PROMPT_CHARS = 32_000

# --- リクエストモデル -----------------------------------------------------------
# 重要: Pydantic モデルは **モジュールスコープ** に置く必要がある。
# `from __future__ import annotations` があると型注釈は文字列として保持され、
# FastAPI は typing.get_type_hints() でモジュールの globals から解決する。
# create_app() 内のローカルクラスは globals に無いため解決できず、
# FastAPI はボディではなく **クエリパラメータ** とみなして必ず 422 を返す。
# (旧 app_template/main.py はこの形だったため /v1/chat が常に 422 だった)
try:
    from pydantic import BaseModel, Field

    class ChatIn(BaseModel):
        prompt: str = Field(..., min_length=1, max_length=MAX_PROMPT_CHARS)
        strategy: str = "balanced"
        max_output_tokens: int = Field(256, gt=0, le=8192)
except ImportError:  # pragma: no cover - pydantic 未インストール環境
    ChatIn = None  # type: ignore[assignment]


def chat(tenant: str, prompt: str, strategy: RoutingStrategy,
         max_output_tokens: int = 256) -> dict:
    """ルーティング実行 + メトリクス永続化.

    旧実装は `ROUTER.metrics._metrics[-1]` で「直近レコード」を取っていた。
    並行リクエスト下では別リクエストのレコードを掴み、
    **他テナントのコストを自テナントに記録する** 取り違えが起きうる。
    route_with_metric で自分のメトリクスを直接受け取る形に変更。
    """
    completion, metric = ROUTER.route_with_metric(
        prompt, strategy=strategy, max_output_tokens=max_output_tokens)
    DB.log_metric(tenant, metric.provider, metric.model, metric.strategy,
                  metric.cost_usd, metric.latency_ms, metric.fell_back, metric.ok,
                  input_tokens=metric.input_tokens, output_tokens=metric.output_tokens)
    return {
        "text": completion.text, "provider": completion.provider, "model": completion.model,
        "cost_usd": completion.cost_usd, "latency_ms": completion.latency_ms,
        "input_tokens": completion.input_tokens, "output_tokens": completion.output_tokens,
        "estimated_tokens": completion.estimated_tokens,
        "fell_back": metric.fell_back, "strategy": metric.strategy,
        "request_id": get_request_id(),
    }


def effective_strategy(tenant: str, requested: RoutingStrategy) -> RoutingStrategy:
    """予算内ルーティング。README が謳う機能を実際に API 経路へ接続する.

    旧実装では BudgetGuard.choose_strategy がどこからも呼ばれておらず、
    「残予算が危険域なら自動で cost 戦略へ降格」は動作していなかった。
    """
    if SETTINGS.monthly_budget_usd <= 0:
        return requested
    spent = DB.month_to_date_cost(tenant)
    return BudgetGuard(SETTINGS.monthly_budget_usd).choose_strategy(spent, None, requested)


def create_app():
    from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import HTMLResponse

    app = FastAPI(title="AI Platform Template", version="1.1.0")

    # ブラウザから frontend(localhost:5173)が叩けるよう CORS を明示。
    # 旧実装には CORS 設定が無く、README 通りに vite dev + uvicorn を起動しても
    # プリフライトで弾かれて画面が動作しなかった。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=SETTINGS.cors_origins,   # "*" は使わない(資格情報付き要求のため)
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key", "X-Request-Id"],
        expose_headers=["X-Request-Id"],
    )

    @app.middleware("http")
    async def request_id_mw(request: Request, call_next):
        set_request_id(request.headers.get("x-request-id") or new_request_id())
        rid = get_request_id()
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response

    def current_tenant(x_api_key: str = Header(default="", alias="X-API-Key")) -> str:
        """API キーからテナントを解決する。クライアントはテナントを指定できない."""
        tenant = API_KEYS.resolve_tenant(x_api_key)
        if tenant is None:
            raise HTTPException(status_code=401, detail="invalid or missing api key")
        if not RATE_LIMITER.allow(tenant):
            raise HTTPException(status_code=429, detail="rate limit exceeded")
        return tenant

    @app.post("/v1/chat")
    def do_chat(body: ChatIn, t: str = Depends(current_tenant)):
        try:
            strat = RoutingStrategy(body.strategy)
        except ValueError:
            # 旧実装は不正な strategy を黙って balanced に落としていた。
            # 利用者は cost 指定のつもりで高いモデルを使い続けることになる。
            raise HTTPException(
                status_code=400,
                detail=f"unknown strategy {body.strategy!r}; "
                       f"valid: {[s.value for s in RoutingStrategy]}")
        strat = effective_strategy(t, strat)
        try:
            return chat(t, body.prompt, strat, body.max_output_tokens)
        except NoProviderAvailable as exc:
            # 上流プロバイダ全滅は 500 ではなく 503(再試行可能)
            logger.error("all providers failed: %s", exc)
            raise HTTPException(status_code=503, detail="all upstream providers unavailable")

    @app.get("/v1/metrics")
    def metrics(t: str = Depends(current_tenant)):
        return DB.summary(t)

    @app.get("/v1/providers")
    def providers():
        return {
            "providers": {name: provider_mode(name) for name in SETTINGS.enabled_providers},
            # 単価が一次情報で未検証であることを API 上でも明示する
            "pricing_unverified": unverified_providers(),
        }

    @app.get("/v1/budget")
    def budget(budget_usd: float = Query(..., gt=0),
               day_of_month: Optional[int] = Query(None, ge=1, le=31),
               days_in_month: Optional[int] = Query(None, ge=28, le=31),
               t: str = Depends(current_tenant)):
        # 旧実装は全期間の合計を「今月の消費」として扱い、day_of_month の既定が
        # 15 固定だった(実日付と無関係な数字で予算アラートを出していた)。
        spent = DB.month_to_date_cost(t)
        status = BudgetGuard(budget_usd).status(spent, day_of_month, days_in_month).as_dict()
        daily = DB.daily_costs(t)          # 1 回だけ問い合わせる
        today_cost = daily[-1] if daily else 0.0
        status["anomaly"] = detect_cost_anomaly(daily[:-1], today_cost).__dict__
        status["daily_costs"] = daily
        return status

    @app.get("/v1/report", response_class=HTMLResponse)
    def report(t: str = Depends(current_tenant)):
        modes = {name: provider_mode(name) for name in SETTINGS.enabled_providers}
        return build_html_report(DB.summary(t), modes, tenant=t,
                                 unverified=unverified_providers())

    @app.get("/healthz")
    def healthz():
        """liveness: プロセスが生きているか(依存は見ない)."""
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz():
        """readiness: DB とプロバイダ構成が使えるか."""
        try:
            DB.conn.execute("SELECT 1").fetchone()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"db unavailable: {exc}")
        return {"status": "ready", "providers": sorted(ROUTER.providers),
                "auth_configured": len(API_KEYS) > 0}

    return app


# uvicorn エントリポイント。
# 旧実装は `except Exception: app = None` で起動失敗を握り潰しており、
# uvicorn が "app is None" という原因不明のエラーで落ちていた。失敗はログに出して再送出する。
try:
    app = create_app()
except Exception:  # pragma: no cover
    logger.exception("failed to create FastAPI app")
    raise
