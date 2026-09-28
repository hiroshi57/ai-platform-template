# DI-MCP オントロジーツール 仕様書 v1（DI-MCP 運用担当への引き渡し用）

- **起源**: 提案 [`harness-proposals/2026-09-28-evoontology-gated-ontology-layer.md`](../../harness-proposals/2026-09-28-evoontology-gated-ontology-layer.md) 提案 B（2026-09-28 人間承認済み）
- **根拠**: arXiv:2609.15779（EvoOntology）。オントロジーをプロンプトに静的に入れず、MCP ツールで必要な分だけ引かせる
- **初期定義ストア**: [`terms.v1.json`](./terms.v1.json)（10 指標。Google 広告・Meta 広告・GA4）
- **この repo の範囲**: 仕様と初期データまで。DI-MCP への実装とデプロイは DI-MCP 運用担当が行う

## 1. ツール

命名は DI-MCP の規約 `<媒体>_<動作>_<対象>` に合わせる（媒体の位置に `ontology` を置く）。

### 1.1 `ontology_get_manifest`

セッションの最初に 1 回呼ぶ。プロンプトに入れてよいオントロジー情報はこれだけ。

- 引数: なし
- 返り値:
  ```json
  {
    "store_version": "2026-09-28.1",
    "media": ["google_ads", "meta_ads", "ga4"],
    "term_count": 10,
    "usage": "指標の定義や媒体ごとの列が必要になったら ontology_browse_terms で探し、ontology_resolve_terms で詳細を取る。"
  }
  ```

### 1.2 `ontology_browse_terms`

- 引数:
  | 名前 | 型 | 必須 | 説明 |
  |---|---|---|---|
  | `query` | string | ✅ | 自然文または用語（例: 「獲得単価」「CPA」） |
  | `kind` | `"metric"` \| `"dimension"` \| `"entity"` | | 絞り込み |
  | `media` | string[] | | 指定した媒体に Mapping がある用語だけに絞る |
  | `limit` | integer | | 既定 10、最大 50 |
- 返り値: `[{ "id": "cpa", "name": "獲得単価（CPA）", "kind": "metric", "description": "費用 ÷ CV。", "score": 0.93 }]`
- 検索対象は `id`・`name`・`description`。v1 は部分一致とエイリアスで十分（埋め込み検索は用語が増えてから）

### 1.3 `ontology_resolve_terms`

- 引数:
  | 名前 | 型 | 必須 | 説明 |
  |---|---|---|---|
  | `ids` | string[] | ✅ | `browse` で得た ID。最大 20 |
  | `include` | (`"mappings"` \| `"constraints"` \| `"evidence"` \| `"relations"` \| `"formula"`)[] | | 既定は全部 |
- 返り値: `terms.v1.json` の該当レコード。**`mappings` は呼び出した利用者が権限を持つ媒体の分だけ返す**（§3）
- 未知の ID は `{"id": "...", "error": "not_found"}` として返し、他の ID の結果は返す

## 2. 書き込み

- **エージェントに書き込み用ツールを公開しない。**
- 更新は運用担当が手作業で行う（提案書 §7 P-3 既定案: 最初は自動修正しない）。
- 更新したら `store_version` を上げる。ダッシュボード側は生成ファイルの先頭にこの版と SHA-256 を残すので、どの版の定義で作ったかを追える。

## 3. 権限

- `ontology_get_manifest` / `ontology_browse_terms`: DI-MCP の全利用者。
- `ontology_resolve_terms` の `mappings`: 媒体ごとに、その媒体のレポート権限（例: `google_ads_report`）を持つ利用者だけに返す。権限がない媒体のキーは返り値から除く（`null` と区別するため、キーごと除く）。

## 4. Evidence（確認クエリの結果）

- `evidence.status` は `unverified` / `verified` / `failed` の 3 値。
- `verified` にできるのは、DI-MCP の内部で確認クエリを実行し、**列の存在・型・値の範囲**を確かめたときだけ。
- Evidence に書いてよいのは次の要約だけ。**実値・アカウント ID・クライアント名は書かない**（`.claude/rules/secret-isolation.md` ルール2・6）。
  ```json
  { "status": "verified", "checked_at": "2026-10-01", "probe": "google_ads_report で列の存在と型を確認", "result": "float, 非負" }
  ```
- `unverified` の Mapping を返すときは、エージェントが「未確認」と分かるよう、そのまま `status` を付けて返す。

## 5. 受け入れ条件（DI-MCP 側）

1. `terms.v1.json` を読み込み、3 ツールが上記の引数・返り値で動く
2. 媒体の権限がない利用者に、その媒体の `mappings` が返らない
3. 10 指標すべての Mapping について確認クエリを実行し、`evidence.status` を `verified` か `failed` にする
4. `failed` になった Mapping は、この仕様書の repo に報告する（`terms.v1.json` 側を直す）

## 6. ダッシュボードからの使い方（提案 C）

- ダッシュボードの画面表示中には呼ばない（本番の画面が MCP の可用性に依存しないようにするため）。
- ビルド前に定義を取得して各 repo の `ontology/terms.snapshot.json` に置き、`lib/kpi-definitions.generated.ts` を生成してコミットする。
- DI-MCP 側の実装ができるまでは、`terms.v1.json` をそのままコピーして使う。
