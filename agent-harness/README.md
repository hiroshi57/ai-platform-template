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

## 案件を自動で「分類 → 6層処理」する（実業務・実ツール・ドライラン）

複雑な案件を **層0の分類器** が type / risk / split に仕分け、種類に応じた6層処理へ
自動で振り分ける司令塔。実業務1件（**ヨシケイ CRレポート**）を実ツール
（`orchestrator.py` / Vercel 読取）に**ドライラン**で接続している。

```bash
node agent-harness/src/orchestrate.mjs
```

処理の流れ:

| 層 | 動き | 実装 |
|---|------|------|
| 0 分類 | 案件を type=DATA / risk=high / split=9単位 と判定 | `src/classifier.mjs` |
| 1 契約 | type ごとに done_when を確定 | `src/orchestrate.mjs` |
| 2 文脈 | 読取専用ツール(`vercel_read`)で環境確認（automatic） | `src/adapters.mjs` |
| 5 検証 | type 別の証拠ゲート（DATAはドライランで前提条件） | `src/verifiers.mjs` |
| 3 ゲート | risk=high の破壊的操作は**承認で停止・自動実行しない** | `src/policy.mjs` |
| 4/6 | `state/cases.json` と `runs/traces.jsonl` に記録 | `src/state.mjs` |

### 安全規則（MUST）

- **`orchestrator.py` は絶対に自動実行しない**（顧客Excelを書き換えるため）。
  ドライランは「コマンド構築＋入力検証(読取)＋ログ」に限定。実行は人間承認後に人手で。
- **Vercel は読取専用**（`vercel projects ls` 等）。deploy は本番禁止のため実装しない。
- **別リポジトリ(`yosikei-agents`)へは一切書き込まない**。
- 実行させたい場合は、承認後に `state/cases.json` の `planned_command` を人間がコピーして実行する。

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
