# 提案: Meta「Organizational Second Brain」の知見を harness へ取り込む

- **日付**: 2026-09-15
- **起案**: Worker (harness) / 依頼者レビュー待ち
- **状態**: 提案A・B・C すべて **2026-09-15 承認・反映済み**
  - A → `.claude/rules/failure-attribution.md`（新規）
  - B → `.claude/rules/harness-retro.md`（提案6 を追記）
  - C → `.claude/rules/memory-curation.md`（position/gateway type を追記）
- **一次エビデンス**: Meta Engineering, "An Organizational Second Brain: Building an AI That Learns From Experts" (2026-09-02)
  <https://engineering.fb.com/2026/09/02/ml-applications/organizational-second-brain-ai-learns-from-experts/>
- **二次エビデンス（既存承認済み）**:
  - `harness-proposals/2026-09-11-filesystem-memory-findings.md`（記事内で未参照だが本 harness の既存提案）
  - `.claude/rules/memory-curation.md`（提案1〜3・根拠 arXiv:2607.26637）
  - `.claude/rules/harness-retro.md`（提案4・5・根拠 arXiv:2607.26637 RQ5・RQ4）

---

## 背景 / 動機

Meta の記事は、本 harness が既に採用している「生ログ層 vs 蒸留層」「in-place な記憶更新」「回帰スイート成長」「人間承認 (HITL)」と**同一思想を産業実運用で実証**している（6週間で 日→分・回帰ゼロ・出力有用性ほぼ常時）。
記事の産業実績を二次エビデンスとして活用しつつ、本 harness にまだ無い**3つの具体機構**を取り込む。

対応関係（記事 → 本 harness）:

| 記事の機構 | 本 harness の現状 | ギャップ |
|---|---|---|
| 知識/推論の分離（knowledge files / recipes） | agent-memory / skills | 概ね充足 |
| 逐語 vs 蒸留の二層 | `memory-curation.md`「記憶の提供形式」 | 充足 |
| 回帰スイートが修正ごと成長 | `self_review` + validation_commands | 概ね充足 |
| **診断の帰属テスト**（材料から正解に到達できたか?） | Worker の失敗分類は escalation_reason 依存 | **未実装** |
| **独立コンテキストの敵対的レビュー** | Reviewer/Lead は改善意図を共有 | **未実装** |
| **Position / Gateway ファイル型の知識分離** | memory は type 4種のみ、適用範囲ゲート無し | **未実装** |

---

## 提案 A: 失敗診断に「帰属テスト」を導入（記事「Diagnosis」節）

Worker / Lead が失敗を分類する際、会話の形式ではなく**単一の帰属テスト**で根本原因を切り分ける:
「エージェントは手元の材料（memory / skill / context）から正しい結論に到達できたか?」
- 材料に正解があったのに誤った → **procedure 問題**（skill/recipe を修正）
- 材料に正解が無かった → **knowledge gap**（memory を追加）
- 人間同士で正解が割れる → **ambiguity**（human 判断へ escalate）

### 変更案（diff・`.claude/rules/` へ新規追加を想定、承認後に人間が反映）

```diff
--- /dev/null
+++ b/.claude/rules/failure-attribution.md
+# 失敗の根本原因帰属ルール（attribution test）
+
+> 起源: harness-proposals/2026-09-15-organizational-second-brain.md（提案A）
+> 根拠: Meta "Organizational Second Brain" — Diagnosis 節
+
+Worker/Lead が retry / escalate の理由を分類するとき、会話の形式
+（情報提供か軌道修正か）で判断してはならない。次の単一テストを適用する。
+
+  Q: エージェントは手元の材料（memory/skill/context/検証出力）から
+     正しい結論に到達できたか?
+
+  - 材料に正解あり かつ 誤った  → procedure 問題（skill/recipe を編集）
+  - 材料に正解なし              → knowledge gap（memory を追加）
+  - 人間が正解で割れる          → ambiguity（human へ escalate）
+
+worker-report / advisor-request の reason_code はこの帰属で選ぶ。
```

**期待効果**: escalation_reason の分類精度が上がり、harness-retro の再発検知（同一 reason_code が10タスク中3回）が「knowledge か procedure か」で正しく束ねられる。誤帰属による無駄な skill 改変を減らす。

---

## 提案 B: harness-retro に「独立コンテキストの敵対的レビュー」を追加（記事「Compilation」節）

改善提案（harness-proposals の diff）を、**その改善意図を一切知らない別エージェント**に diff だけ渡して検証させる。提案側の盲点を継承させない。

### 変更案（diff・`.claude/rules/harness-retro.md` への追記を想定）

```diff
--- a/.claude/rules/harness-retro.md
+++ b/.claude/rules/harness-retro.md
@@ 提案5 の後に追記
+## 提案6: 独立コンテキストの敵対的レビュー（Meta OSB / Compilation 節）
+
+harness-proposals の diff を landing する前に、改善の rationale を
+知らない fresh-context のレビューエージェントへ **diff だけ** を渡す。
+役割は「矛盾の導入・壊れたエッジケース・既存ルールとの衝突」の発見に限定。
+提案側と context を共有しないことで盲点の継承を防ぐ。
+
+- 対象: CLAUDE.md/AGENTS.md/skills/rules を変える提案のみ（メモ追記は対象外）
+- 出力: APPROVE / REQUEST_CHANGES + 検出した衝突の列挙
+- これは人間承認の前段であり、人間承認を置き換えない
```

**期待効果**: 提案の自己確証バイアスを削減。memory-curation の「silently condense」検知（既存セルフチェック）と相補的に、ルール改変時の回帰を landing 前に捕捉。

---

## 提案 C: memory に Position / Gateway の概念を導入（記事「Second Brain」節）

現状 memory type は user/feedback/project/reference の4種。記事の **Position（組織の確定した立場）** と **Gateway（適用範囲の閾値テスト）** を軽量に取り込み、「確定方針」を通常の観察メモと区別する。

### 変更案（diff・`.claude/agent-memory/*/MEMORY.md` 運用と memory type 拡張を想定）

```diff
 memory types:
   user / feedback / project / reference
+  position : 組織が確定した方針・立場。覆すには人間承認が要る強い制約。
+             例「本番デプロイは Cursor 責務」「cc:* マーカーは人間のみ変更」
+  gateway  : そのメモリ/skill を適用してよい前提条件（threshold）。
+             満たさない場面で適用しないためのゲート。
```

**注意 / 制約**:
- 「禁止事項」「cc:* マーカー」等は CLAUDE.md セクション7で**自動改善対象外**。position type はそれらを *記録* するだけで、変更権限は人間に留める。
- 小規模ストアでの過度な type 増設は `memory-curation.md` 提案2（over-curation 回避）に反するため、**position/gateway は「人間承認済みの確定方針」に限定**して肥大化を防ぐ。

**期待効果**: 強い制約（人間のみ変更可）と通常観察の混同を防ぎ、Worker が誤って確定方針を上書きするリスクを下げる。gateway により memory の誤適用（無関係ドメインへの適用）を減らす。

---

## 反映しないもの（人間のみ・自動改善対象外）

CLAUDE.md セクション7に従い、本提案は以下を**変更しない**:
- 「禁止事項」全般（本番デプロイ禁止・セキュリティ設定変更禁止）
- コミットメッセージ規約・ブランチ運用
- 各案件 Plans.md の `cc:*` マーカー

上記3提案はいずれも**人間の承認を経てから** rules/skills へ反映する。本ファイルは提案のみ。

---

## 承認チェックリスト（依頼者記入）

- [x] 提案A（帰属テスト）を採用する — 2026-09-15 反映（`.claude/rules/failure-attribution.md`）
- [x] 提案B（敵対的レビュー）を採用する — 2026-09-15 反映（`.claude/rules/harness-retro.md` 提案6）
- [x] 提案C（position/gateway type）を採用する — 2026-09-15 反映（`.claude/rules/memory-curation.md`）
- [ ] 却下 / 保留（理由: ____________）
