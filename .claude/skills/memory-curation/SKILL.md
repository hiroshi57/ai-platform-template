---
name: memory-curation
description: Use when editing, reorganizing, merging, splitting, or deleting agent memory / skills / harness-logs, and when running harness-retro or preparing a release. Enforces the preservation rule (no silent summarization on reorg), curation investment judgment, verbatim-vs-distilled serving, toolset-first debugging, and store-health checks. 根拠 arXiv:2607.26637.
---

# メモリ curation スキル

`.claude/agent-memory/`・Claude Code skills・`harness-logs/` を扱う全作業のガードレール。
ファイルシステムベースのメモリ研究（arXiv:2607.26637）の実証知見に基づく。論文の
management/search/execution 役割は本ハーネスの Lead/Reviewer/Worker に対応する。

> **承認**: 2026-09-11 人間承認（提案1-3・5）／2026-09-14（提案4）。
> 起源: `harness-proposals/2026-09-11-filesystem-memory-findings.md`

## いつ使うか

- メモリ/skills/log の **編集・統合・分割・再編成・並べ替え・削除** をする瞬間
- **harness-retro**（自己改善ループ）を回す時・`/harness-release` 前の点検時
- 記憶をどの形で consumer エージェントに渡すか決める時

---

## 1. 保存ルール（preservation rule）★最重要 / RQ1

実証された最悪の退行は、**再編成パスが本文を黙って圧縮する（silently condense）** こと。
要約しながらの再編成は記憶ストアを no-memory ベースライン以下に劣化させうる。

### MUST

再編成 = フォルダ移動・ファイル統合・分割・見出し再構成・並べ替え を指す。

1. **本文を要約・圧縮・削除しない。** 構造だけ変え、内容は逐語（verbatim）のまま移送する。
2. **統合で重複を除く場合も情報を落とさない。** 除去は「完全に同一の情報」に限り、
   ニュアンス・日付・出典・数値が異なる行は残す。
3. **削除は明示タスクのときだけ。** 「整理」を口実に既存記憶を消さない。古い事実は上書きではなく
   `[更新: YYYY-MM-DD]` 付きの追記で更新し経緯を残す（in-place edit）。
4. **`harness-logs/` の生ログは常に逐語保存。** 要約版で置き換えない。

### セルフチェック（コミット前・MUST）

```bash
# 再編成対象パスを指定（例: .claude/agent-memory）
TARGET=".claude/agent-memory"
# 追加(+)より削除(-)が大幅に多い = 圧縮の疑い。中身を目視確認する
git diff --numstat HEAD -- "$TARGET"
# 削除された本文行を一覧（純粋な移動なら別ファイルに同内容が現れるはず）
git diff HEAD -- "$TARGET" | grep -E '^-' | grep -vE '^---'
```

- 削除行の内容が**別ファイル/別見出しに逐語で再出現している**ことを確認してからコミットする。
- 再出現しない削除（＝実質的な要約・欠落）が1件でもあれば、コミットを止めて内容を復元する。

### 例外

- ユーザー/Lead が明示的に「要約して」「削除して」「作り直して」と指示した場合のみ本ルールを外れてよい。
  その場合も何を要約/削除したかをコミットメッセージに残す。

---

## 2. 整理の投資判断 / RQ2・結論

**組織化そのものは回答品質を上げない。** 整理の確実な見返りは「大規模ストアでの検索コスト削減」に
限られる（大規模で約半減、小規模では割に合わない）。

1. **小規模ストアで過度なフォルダ分割・再編成をしない。** curation は per-episode で安くならない。
2. **「きれいに整理したい」衝動が出たら、先に次の3レバーを見直す**（この順で効く）:
   - (a) 書き込むエージェントの能力（記憶を書く側のモデル/プロンプト品質）
   - (b) 記憶を提供する形式（§3）
   - (c) curate に使うツールセット（§4）
3. **整理の是非は「素材の大きさ」で判断する。** 検索コストを実感するほど大きい時だけ階層化に投資する。

---

## 3. 記憶の提供形式 / RQ2

スキル/記憶をどの形で consumer エージェントに渡すかは、**consumer の能力で最適が逆転する**。

1. **強いエージェント向け**: 逐語の生ログ（`harness-logs/` の episode log）をそのまま参照させる。
2. **弱いエージェント向け**: 蒸留済み skill（手順化・要点化したガイダンス）を渡す。
3. **二層を両方維持する**: 生ログ層（`harness-logs/`）と蒸留層（skills）のどちらか一方に寄せない。
4. 逐語ログは「全部を毎回読ませる」検索コストが唯一 store と共に増える負債。大規模化したら
   蒸留層のインデックス化で検索範囲を絞る。

---

## 4. ツールセットを retro の第一級レバーに / RQ5

**ツールを1個足しても挙動は変わるが結果は変わらない。ツールセットを丸ごと替えると
ストアの形自体が変わる（モデル差し替えと同等のインパクト）。**

- ストアが劣化した（検索コスト増・taxonomy 崩れ・重複増）と判断したら、
  **モデル強度を上げる前に、まずツールセットを見直す**。対象:
  - Worker の `allowedTools` / `disallowedTools` 構成
  - 検索ツール（grep/検索エージェントの粒度）
  - file 操作 API 群（memory-tool 系の関数セット）
- ツールセット変更は安価でインパクト大。モデル変更（高コスト）は最後の手段。

---

## 5. 成長前提のストア健全性チェック / RQ4

ストアは成長するほど有用になり、健全性は保たれる（初期記憶は削除されず in-place 編集で生存）。
ただし **taxonomy 遵守は最強の管理エージェント以外では成長とともに崩れる**。

retro 実行時 / `/harness-release` 前に確認する。

1. **初期記憶の生存**（削除ゼロを期待）:
   ```bash
   git log --diff-filter=D --name-only -- .claude/agent-memory | head
   ```
2. **in-place 更新か**（wholesale な作り直しの兆候を検出）:
   ```bash
   git log --diff-filter=A --name-only -- .claude/agent-memory | head
   ```
3. **taxonomy 逸脱の増加**: 命名規約から外れたファイル/フォルダが成長とともに増えていないか。
   増え始めたら人手 or 強いモデルでの再整理をトリガーする。

### 判断

- 1・2 が崩れた場合は §1 保存ルール違反。内容欠落がないか diff で確認する。
- 3 が悪化した場合、taxonomy を守れる強い管理エージェントに切り替えるか §4 のツールセットを見直す。
