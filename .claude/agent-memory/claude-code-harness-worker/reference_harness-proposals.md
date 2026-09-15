---
name: harness-proposals-filesystem-memory
description: Where the filesystem-memory improvement proposal lives (diff-format, human-approval-pending) in this repo.
metadata:
  type: reference
---

ファイルシステムメモリ研究（arXiv:2607.26637）の知見を本ハーネスに反映する改善提案は
`harness-proposals/2026-09-11-filesystem-memory-findings.md` にある。

diff 形式・根拠リンク付き。5提案すべて **2026-09-11 承認・repo 反映済み**:
保存ルール明文化 / 組織化の目的化を戒める / 逐語vs蒸留 / ツールセットを retro 第一級レバーに / 成長前提の健全性チェック。
反映先は `.claude/rules/memory-curation.md`（1・2・3）と `.claude/rules/harness-retro.md`（4・5）。
残作業は提案4のグローバル CLAUDE.md セクション7 本文追記のみ（保護対象・本 repo 外）。

[更新: 2026-09-15] 追加提案 `harness-proposals/2026-09-15-organizational-second-brain.md` を作成（**承認待ち**）。
根拠は Meta "Organizational Second Brain"（engineering.fb.com 2026-09-02）。3提案:
A=失敗の帰属テスト（材料から正解に到達できたか?で knowledge/procedure/ambiguity を切り分け）、
B=harness-retro に独立コンテキストの敵対的レビュー追加、C=memory に position/gateway type 導入。
[更新: 2026-09-15] **提案A・B・C すべて承認・反映済み**:
A → `.claude/rules/failure-attribution.md`（新規・帰属テスト）、
B → `.claude/rules/harness-retro.md`（提案6・独立コンテキスト敵対的レビュー）、
C → `.claude/rules/memory-curation.md`（memory type に position/gateway 追加。position=人間のみ変更可の確定方針、gateway=適用条件ゲート）。

**How to apply**: メモリ運用ルールの改善や harness-retro を扱うとき参照。
運用ルール本体は [[memory-curation-rules]]。グローバル CLAUDE.md セクション7 の提案フォーマット規約に準拠。
