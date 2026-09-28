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

## 提案6: 記憶・生ログへの秘密混入チェック（arXiv:2608.19857）

> **起源**: 提案 `harness-proposals/2026-09-25-context-leakage-secret-isolation.md`（提案 E）
> **承認**: 2026-09-28 人間承認済み

実証結果: コンテキストにある秘密は、モデルが開示を拒否していても無害な出力から統計的に復元されうる。
生ログを逐語で読ませる retro は、ログに混入した秘密を毎回コンテキストに戻してしまう。

### チェック項目（retro 実行時 / `/harness-release` 前・advisory）

```bash
# キー形式・秘密鍵ヘッダ・長い Base64 を検出（誤検知前提の advisory）
grep -rEn '(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z0-9+/]{40,}={0,2})' \
  .claude/agent-memory .claude/harness-logs 2>/dev/null | head
```

### 判断

- 検出しても**自動削除しない**（`memory-curation.md` ルール3）。人間に通知し、人間の指示で伏せ字化する。
- 伏せ字化した場合は、何を伏せたかをコミットメッセージに残す（`memory-curation.md` 例外規定）。
- 再発防止は `.claude/rules/secret-isolation.md` ルール6（保存前マスク）で行う。

## 提案7: 判定器（Reviewer / LLM-as-judge）の健全性チェック（arXiv:2608.21766）

> **起源**: 提案 `harness-proposals/2026-09-24-eval-awareness-judge-rubric.md`
> **承認**: 2026-09-24 人間承認済み

実証結果: 採点スケール・同点時の扱い・アンカーの置き方が違う2つの LLM 判定器は、
同じ出力に対して Cohen's κ ≤ 0.09 しか一致しなかった。端点しか定義しない判定器は、
「ペルソナを守る」といった無関係な推論に最高点近くを付けた。

### チェック項目（retro のたびに実施。`/harness-release` 前の必須 retro を含む）

4. **判定器の一致度**: 直近の `review.json` から最低10件をサンプルし、人間（または別系統の判定器）が
   同じ rubric で再採点する。Cohen's κ < 0.4 なら rubric を見直す（`.claude/rules/judge-rubric.md`）。
   閾値 0.4 は暫定値。最初の 2〜3 回の retro の実測値で見直す。
5. **rubric_version の記録漏れ**: `review.json` に `rubric_version` が無いレコードは、集計（再発率・APPROVE 率）から除外する。
   rubric が異なるレコードの判定を同じ母集団として比較しない。

### 判断（追記）

- 4 が閾値を下回ったら、判定器モデルを強化する前に、まず rubric のアンカー定義とツールセット（提案4）を見直す。

## 提案8: retro には SKILL.state 方式（履歴を捨てる実行）を適用しない（arXiv:2608.26263）

> **起源**: 提案 `harness-proposals/2026-09-28-skill-state-runtime.md`（提案 D）
> **承認**: 2026-09-28 人間承認済み

- retro は「履歴そのものが目的」のタスクなので、`.claude/rules/skill-state.md` の「状態だけを渡し、履歴を捨てる」
  方式の対象外とする（同ルール7）。retro には、これまでどおり `harness-logs/` の生ログを逐語で読ませる。
- Worker の実行プロンプトから推論を外しても、`harness-logs/` への生ログ保存は止めない（同ルール6）。
  retro の材料が減るためである。
