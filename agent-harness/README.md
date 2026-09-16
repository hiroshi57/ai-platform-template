# agent-harness — 5分で6層すべてを動かす

依存パッケージゼロの Node.js（v18+）で「ハーネス・エンジニアリング 6層」を最小構成で実装したデモ。
`AGENTS.md` の対応表を参照。

## 実行

```bash
node agent-harness/src/harness.mjs
```

### 期待される出力（決定的）

```
[step 1] write_workspace -> ok
  ❌ 失敗: [{"name":"date_format",...},{"name":"fixture_match",...}]
  🔧 限定修復 1/1 回目へ
[step 2] write_workspace -> ok
  ✅ 全チェック通過: output_schema, date_format, fixture_match, no_new_dependency
[step 3] send_message -> paused_for_human_approval
  ⏸ 承認待ち: send_message

=== stop_reason: human_approval_required / retries: 1 ===
```

実行すると `state/current.json`（層4）と `runs/traces.jsonl`（層6）、
`artifacts/export.csv`（成果物）が生成される。

## ★自分で壊して学ぶ

読むだけでは身につかない。1つずつ壊して、なぜ壊れるかを確かめる。

1. **証拠を消す（層5）**: `src/verify.mjs` の `date_format` チェック行を削除して再実行。
   → `fixture_match` だけが落ち、証拠から「日付形式」が消えるためモデルは修復を空振りし、
     エスカレーションする。検証の粒度が修復可能性を決めている。

2. **契約を変える（層1）**: `contracts/feature_042.json` の `max_repairs` を `0` にして再実行。
   → 1回も修復せずエスカレーション。「何回粘るか」はモデルでなく契約が決めている。

3. **権限を変える（層3）**: `tools/permissions.json` の `send_message` の `mode` を
   `automatic` にして再実行。→ 承認待ちにならず送信まで走る。モデルのコードは1行も
   変えていないのに振る舞いが変わる（提案・許可・実行の分離）。

4. **コンテキストを削る（層2）**: `src/context.mjs` の `last_evidence` 行を消して再実行。
   → モデルが失敗の証拠を「見られなく」なり、同じ間違いを繰り返してエスカレーション。
     再試行がやめられないのはモデルのせいではなく、環境が証拠を返していないから。

## ディレクトリ

```
agent-harness/
├── AGENTS.md                 # 小さな地図（層2）
├── contracts/
│   ├── feature_042.yaml      # 人間が読む契約
│   └── feature_042.json      # コードが読む契約（層1）
├── context/product-rules.md  # ISO 8601 を要求するルール
├── tools/permissions.json    # 権限のはしご（層3）
├── checks/fixture.csv        # 受け入れ正解データ（層5）
├── src/
│   ├── context.mjs           # 層2 コンテキスト・コンパイラ
│   ├── model.mjs             # モデルの代役（決定的）
│   ├── gateway.mjs           # 層3 ツール・ゲートウェイ
│   ├── verify.mjs            # 層5 証拠ゲート
│   ├── state.mjs             # 層4 永続状態 ＋ 層6 トレース
│   └── harness.mjs           # ループ本体
├── state/current.json        # 実行で生成
├── runs/traces.jsonl         # 実行で生成
├── artifacts/export.csv      # 成果物（実行で生成）
└── lessons/harness-updates.md
```
