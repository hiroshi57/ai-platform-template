"""テスト共通設定.

重要: service/api.py は import 時に Settings.from_env() と ServiceDB(path) を評価する。
何もしないと実行ディレクトリに ai_platform.db が作られ、テスト間で状態が漏れる。
service.api を import する前に環境変数を確定させる必要があるため、
session スコープの autouse fixture ではなく **モジュール読み込み時** に設定する。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# --- service.api の import 前に確定させる必要がある設定 ---
os.environ.setdefault("AI_PLATFORM_DB_PATH", ":memory:")
# 認証テスト用の固定キー(十分な長さ。本番では generate_api_key() を使う)
TEST_API_KEY = "test-key-0123456789abcdef0123456789"
TEST_TENANT = "t-a"
OTHER_API_KEY = "other-key-0123456789abcdef0123456"
OTHER_TENANT = "t-b"
os.environ.setdefault(
    "AI_PLATFORM_API_KEYS",
    f"{TEST_API_KEY}:{TEST_TENANT},{OTHER_API_KEY}:{OTHER_TENANT}",
)
# 実プロバイダのキーが開発機の環境に残っていると、テストが本物の API を
# 叩いて課金される。テスト中は必ず mock を使う。
for _k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"):
    os.environ.pop(_k, None)

import pytest  # noqa: E402


@pytest.fixture
def api_key() -> str:
    return TEST_API_KEY


@pytest.fixture
def other_api_key() -> str:
    return OTHER_API_KEY


@pytest.fixture
def auth_headers() -> dict:
    return {"X-API-Key": TEST_API_KEY}


@pytest.fixture
def other_headers() -> dict:
    return {"X-API-Key": OTHER_API_KEY}
