# ai-platform-template

AI エージェント / RAG アプリを **最短で本番稼働**させるための社内向け AI 基盤テンプレート。
新規 AI アプリはこのテンプレートを clone するだけで、認証・レート制限・LLM 切替・観測性が最初から揃う。

## 差別化ポイント

一般的な「LLM ラッパー」との違いは次の 2 点:

1. **コスト/レイテンシ自動ルーティング** — `LLMRouter` が Claude / GPT / Gemini を
   `cost` / `latency` / `quality` / `balanced` の戦略に応じて自動選択し、
   呼び出し失敗時は次点プロバイダへ自動フォールバックする。
2. **観測性の標準装備** — 全 LLM 呼び出しの「プロバイダ別コスト」「p95 レイテンシ」
   「フォールバック発生率」を追加実装なしで集計・API 公開できる。

いずれも **API キーなしで動く rule-based モック**を同梱しているため、clone 直後に動作確認できる。

## 構成

```
core/
  llm_router.py     # 差別化コア: コスト/レイテンシ考慮ルーティング + フォールバック
  providers.py      # プロバイダ抽象 + MockProvider(APIキー不要)
  observability.py  # コスト/レイテンシ/フォールバック率の集計
  auth.py           # APIキー認証(テナント解決)
  rate_limit.py     # テナント別トークンバケット
app_template/
  main.py           # 新規アプリの雛形(FastAPI)。これをコピーして機能追加
infra/
  Dockerfile
tests/              # 外部依存なしで PASS
```

## クイックスタート

```bash
pip install -r requirements.txt

# コア動作確認(APIキー不要)
python -m app_template.demo

# テスト
python -m pytest -q

# API 起動(FastAPI)
uvicorn app_template.main:app --reload
# 認証ヘッダ X-API-Key: demo-key で /v1/chat, /v1/metrics を呼べる
```

## 戦略の使い分け

| strategy | 選択基準 | 使いどころ |
|----------|---------|-----------|
| `cost` | 最安 | 大量バッチ・要約 |
| `latency` | 最速 | 対話UI・リアルタイム |
| `quality` | 最高品質 | 重要な意思決定支援 |
| `balanced` | 合成スコア(既定) | 汎用 |

## 実プロバイダ接続

`core/providers.py` の `MockProvider` を各社 SDK 実装に差し替え、
`ProviderSpec` の cost/latency/quality を実測値で更新する。ルーティング・観測性・
認証・レート制限のコードは変更不要。
