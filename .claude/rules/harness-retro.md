# harness-retro ルール（ツールセット・ストア健全性）

> **適用対象**: harness-retro（自己改善ループ）を回す Lead / 運用者
> **起源**: 提案 `harness-proposals/2026-09-11-filesystem-memory-findings.md`（提案4・5）／根拠 arXiv:2607.26637 RQ5・RQ4
> **承認**: 2026-09-11 人間承認済み

## 提案4: ツールセットを retro の第一級レバーに（RQ5）

実証結果: **ツールを1個足しても挙動は変わるが結果は変わらない。ツールセットを丸ごと替えると
ストアの形自体が変わる（モデル差し替えと同等のインパクト）**。

### ルール

- メモリ/skills のストアが劣化した（検索コスト増、taxonomy 崩れ、重複増）と判断したら、
  **モデル強度を上げる前に、まずツールセットを見直す**。対象:
  - Worker の `allowedTools` / `disallowedTools` 構成
  - 検索ツール（grep/検索エージェントの粒度）
  - file 操作 API 群（memory-tool 系の関数セット）
- ツールセット変更は安価でインパクトが大きい。モデル変更（高コスト）は最後の手段。
- ※本ルールをグローバル `CLAUDE.md` セクション7「改善提案のルール」本文にも反映する場合は、
  当該ファイルが存在する環境で人間が別途追記する（保護対象のため本 repo からは変更しない）。

## 提案5: 成長前提のストア健全性チェック（RQ4）

実証結果: ストアは成長するほど有用になり、健全性は保たれる（初期記憶は削除されず in-place 編集で生存）。
ただし **taxonomy（命名・フォルダ規約）の遵守は、最強の管理エージェント以外では成長とともに崩れる**。

### チェック項目（`bash scripts/harness-retro.sh --check` 拡張案 / 手動運用可）

retro 実行時、または `/harness-release` 前に以下を確認する。

1. **初期記憶の生存**: 初期に作られた記憶ファイルが後の再編成後も残っているか（削除ゼロを期待）。
   ```bash
   # 記憶ファイルの削除履歴を確認（削除があれば要調査）
   git log --diff-filter=D --name-only -- .claude/agent-memory | head
   ```
2. **in-place 更新か**: 更新が既存ファイルの編集で行われ、wholesale な作り直し（全削除→再作成）に
   なっていないか。
   ```bash
   git log --diff-filter=A --name-only -- .claude/agent-memory | head   # 再作成の兆候
   ```
3. **taxonomy 逸脱の増加**: フォルダ命名規約から外れたファイル/フォルダが成長とともに増えていないか
   （劣化の早期警告）。逸脱が増え始めたら、人手 or 強いモデルでの再整理をトリガーする。

### 判断

- 1・2 が崩れた（削除・作り直しが起きた）場合は `.claude/rules/memory-curation.md` の保存ルール違反。
  内容欠落がないか diff で確認する。
- 3 が悪化した場合、taxonomy を守れる強い管理エージェントに切り替えるか、ツールセット（提案4）を見直す。

---

# 提案6: 独立コンテキストの敵対的レビュー

> **起源**: 提案 `harness-proposals/2026-09-15-organizational-second-brain.md`（提案B）／根拠 Meta "Organizational Second Brain"（engineering.fb.com 2026-09-02, Compilation 節）
> **承認**: 2026-09-15 人間承認済み

改善提案（`harness-proposals/` の diff）を landing する前に、**改善の rationale を一切
知らない fresh-context のレビューエージェント**へ、提案された **diff だけ** を渡して検証する。
提案側と context を共有しないことで、その盲点（blind spot）を継承させない。

## ルール

1. **対象**: CLAUDE.md / AGENTS.md / skills / `.claude/rules/` を変える提案のみ。
   memory への通常の追記は対象外（`memory-curation.md` の over-curation 回避と整合）。
2. **レビュー役の役割は問題発見に限定する**: 矛盾の導入・壊れたエッジケース・既存ルールとの
   衝突・宙に浮いた参照。改善意図の忖度や再設計はさせない。
3. **出力**: `APPROVE` / `REQUEST_CHANGES` ＋ 検出した衝突の列挙。
4. **人間承認を置き換えない**: 本レビューは人間承認の**前段**。敵対的レビューが APPROVE でも
   最終反映は人間承認を要する（CLAUDE.md セクション7）。

## 補完関係

- `memory-curation.md` の「silently condense 検知」（コミット前 diff セルフチェック）が
  *内容の欠落* を捕まえるのに対し、本レビューは *論理の衝突* を landing 前に捕まえる。
  両者は相補的で、どちらも人間承認の前に通す。
