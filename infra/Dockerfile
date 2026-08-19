# syntax=docker/dockerfile:1
FROM python:3.11-slim

# 依存の脆弱性修正を取り込みつつ、レイヤを増やさない
RUN apt-get update && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 旧 Dockerfile は service/ を COPY しておらず、
# `uvicorn service.api:app`(README が本番構成として案内)を実行できなかった。
COPY core ./core
COPY service ./service
COPY app_template ./app_template

# 旧イメージは root 実行だった。非 root ユーザへ切り替える。
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data && chown -R appuser:appuser /app /data
USER appuser

# SQLite の保存先。コンテナ再作成でコスト履歴が消えないよう volume を想定する。
ENV AI_PLATFORM_DB_PATH=/data/ai_platform.db
VOLUME ["/data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status==200 else 1)"

# 本番構成(永続化 + テナント分離 + FinOps)は service.api を使う
CMD ["uvicorn", "service.api:app", "--host", "0.0.0.0", "--port", "8000"]
