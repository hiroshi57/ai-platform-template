# 提案: MemRL 由来の utility-scored-memory スキル追加

> **date**: 2026-09-24
> **slug**: utility-scored-memory
> **status**: 人間承認待ち（human-approval-pending）
> **根拠論文**: arXiv:2601.03192 — *MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory*（SJTU ほか, 2026-02）。コード: https://github.com/MemTensor/MemRL
> **提案者**: Claude Code (harness-worker) / セッション: arxiv-paper-translation-79336a

## 背景・動機

CLAUDE.md セクション7「Self-Tuning Harness Loop」の `harness-logs/` は現状、生ログを逐語で
**溜めるだけ**（受動的 RAG 相当）。過去エピソードの再利用は「意味が似ている」検索に依存し、
役立つか（utility）を見ていないためノイズを拾いうる。

MemRL は **推論（凍結LLM）と記憶（学習層）を分離**し、重みを一切更新せずに「記憶の選び方」を
強化学習で鍛える。これは本ハーネスの自己改善ループと同じ問題意識であり、既存の生ログ資産を
壊さずに検索品質だけを上げられる（薄い Q値レイヤーの追加のみ）。

## 変更内容（diff 形式）

### 1. 新規スキル追加

```diff
+ .claude/skills/utility-scored-memory/SKILL.md   (新規 / 80 行)
```

スキルの骨子（全文は当該ファイル参照）:

```diff
+ ## 中心となる考え方（3点）
+ 1. Intent-Experience-Utility トリプレット
+    - Intent   = task.json（task/task_id/files/mode の埋め込み）
+    - Experience= worker-report・commands.stdout.log・diff（★逐語保持）
+    - Utility   = review 判定 + 検証結果から算出する 0〜1 の Q値（★追加する薄い層）
+ 2. Two-Phase Retrieval
+    - Phase A: 類似度で上位 k1 件リコール
+    - Phase B: Q値で再ランクし上位 k2 件を採用（distractor を排除）
+    - score = (1-α)・zscore(sim) + α・zscore(Q)
+ 3. Utility-Driven Update
+    - Q ← Q + η・(r − Q)   （モンテカルロ流）
+    - r: APPROVE かつ検証全PASS→1.0 / REQUEST_CHANGES→0.0〜0.3 / 部分成功は按分
```

harness-logs への適用（既存ログは書き換えず、Q値ファイルだけ足す）:

```diff
  harness-logs/<slug>/<YYYYMM>/<task_id>/
    task.json
    worker-report.json
    review.json
    commands.stdout.log
+   utility.json          ← { "intent_embedding_ref": ..., "q": 0.0, "updates": [] }
```

### 2. 参照メモリ追加

```diff
+ .claude/agent-memory/claude-code-harness-worker/reference_utility-scored-memory-skill.md
~ .claude/agent-memory/claude-code-harness-worker/MEMORY.md   (索引に1行追記)
```

### 3. 保護対象は不変更（no-op を明示）

```diff
  CLAUDE.md                       (変更なし — 禁止事項・規約に非干渉)
  .claude/rules/memory-curation.md (変更なし)
  .claude/rules/harness-retro.md   (変更なし)
  各案件 Plans.md の cc:* マーカー   (変更なし)
```

## 根拠ログ・出典へのリンク

- 論文本体: https://arxiv.org/abs/2601.03192 / PDF https://arxiv.org/pdf/2601.03192
- 参照実装: https://github.com/MemTensor/MemRL
- 整合先ルール: [.claude/rules/memory-curation.md](../.claude/rules/memory-curation.md)（逐語保存・提案2 検索経済性）
- 整合先ルール: [.claude/rules/harness-retro.md](../.claude/rules/harness-retro.md)（提案4 ツールセット優先・提案5 単調改善で忘却回避）
- スキル本体: [.claude/skills/utility-scored-memory/SKILL.md](../.claude/skills/utility-scored-memory/SKILL.md)
- 実装コミット: `fb84ec2` / PR: https://github.com/hiroshi57/ai-platform-template/pull/10

## 期待効果

| 指標 | 期待 | 論文の裏付け（実測） |
|---|---|---|
| 過去解法再利用の的中率 | 向上（ノイズ排除） | 学習 Q値と成功率の相関 r=0.861 |
| 累積成功率 (CSR) | 向上 | 最強ベースライン比 +3.8%（探索環境 +6.2%） |
| 未知タスクへの転移 | 向上 | 転移で +2.8% |
| 破滅的忘却 | 抑制 | 忘却率 0.041（最小・単調改善が理論保証） |
| 同一 escalation_reason 再発 | 減少 | 失敗パターンの Q値低下で能動回避 |
| 導入コスト | 低 | 重み更新なし・Q値ファイル追加のみ |

## リスク・限界（論文 Limitations より）

- 長い軌跡では step-wise 更新が高分散 → 定期的メモリ統合を将来検討。
- 複数記憶参照時の功績配分（credit assignment）が曖昧。
- タスク間類似度が低いと Reflexion に退化 → **案件 slug 単位でメモリ分割・タスク密度確保**で緩和。

## 承認後の反映先

- 本スキルはそのまま `.claude/skills/utility-scored-memory/` に据え置き（新規追加のため既存資産の破壊なし）。
- 実際に harness-logs へ `utility.json` を書き出す実装を起こす場合は、別タスクとして
  `scripts/` に Q値更新ユーティリティを追加する後続提案を出す。

## 承認記録（人間が記入）

- [ ] 承認 / 却下:
- [ ] 承認者:
- [ ] 日付:
- [ ] 備考:
