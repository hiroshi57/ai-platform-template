# Harness 改善提案: ATC 由来「Reviewer に "近道" の確認を 1 項目足す」

- **日付**: 2026-09-25（改訂: 2026-09-28）
- **slug**: `atc-shortcut-review-check`（旧: `atc-holdout-checks`）
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— CLAUDE.md §7 の運用に従い、承認前は本体ファイル（CLAUDE.md / AGENTS.md / skills / agent frontmatter / plugin / `.claude/rules/`）へ反映しない
- **根拠論文**: *Learn Your Own Thoughts: Abstract Token Curriculum*（ATC）
  - Gatmiry, Ghosh, Mirtaheri, Lee, Haghtalab, Abbe, Bartlett — arXiv:2609.19717v2 [cs.LG], 2026-09-23
  - https://arxiv.org/abs/2609.19717

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。自動修正3回・相談3回などの上限値も変更しない。
>
> ⚠️ **提案の性質**: ATC はモデル学習の手法であり、本ハーネスへは**アナロジーとして**移植する。論文の数値は本ハーネスでの効果を保証しない。

## TL;DR（3行要約）

- **論文の観察**: 答えの候補が入力に見えていると、モデルは計算せずに**候補を写す近道**を覚え、学習が第1段階から進まなかった（8 桁足し算の精度 0%）。訓練例の 75% で候補を隠すと 98.7% まで解けた。
- **本ハーネスでの同じ問題**: Worker が合格条件を全部見ていると、正しい実装ではなく「見えている検証だけを通す実装」（期待値の直書き、特定入力だけの分岐）に流れうる。
- **提案**: 仕組みは作らず、**Reviewer の確認項目に 1 行足すだけ**にする。見つけた近道は `shortcut:` と書いて差し戻し、件数を後から数えられるようにする。

### 承認で決まること（決裁事項）

- ✅ §2 のルールファイル `.claude/rules/review-shortcut.md` を、この repo に追加してよい
- ❌ plugin（`claude-code-harness`）のファイルは編集しない
- ❌ Worker に渡す情報（contract・検証コマンド）は何も変えない

---

## 1. なぜ仕組みではなく 1 行なのか（初版からの変更理由）

初版（2026-09-25）では、検証の一部を Worker から隠す **holdout checks** を提案した。2026-09-28 に次の理由で縮小した。

1. **測る土台がまだない**: 初版は `harness-logs/` の `review.json` と `scripts/harness-retro.sh` による集計を前提にしていた。2026-09-28 時点で、この repo にはどちらも存在しない（確認コマンド: `find . -name harness-retro.sh -o -type d -name harness-logs` → 0 件）。
2. **近道が本当に起きているか分かっていない**: 起きているか分からない問題のために、「誰が holdout を作るか」「どこに置くか」「どう隠すか」（初版 P-1〜P-3）を決めるのは順番が逆である。
3. **1 行で大部分をカバーできる**: holdout は近道を**起こさせない**仕組み、Reviewer の確認は起きた近道を**見つける**仕組みである。今の規模なら、見つけられれば十分と判断した。

初版の holdout 案は §4 に「将来案」として残す。

## 2. 提案: Reviewer の確認項目に 1 行足す

### 反映先

plugin の `agents/reviewer.md` は cache 内にあり、plugin を更新すると消える。代わりに、この repo の `.claude/rules/` にルールファイルを 1 つ追加する。`.claude/rules/*.md` は Claude Code がプロジェクトの指示として自動で読み込むため、Reviewer にも適用される。

```diff
+.claude/rules/review-shortcut.md   （新規・承認後に追加）
```

### ルール本文（案）

```markdown
# レビュー時の「近道」確認

> 適用対象: `type: code` のレビューを行う Reviewer / Lead
> 起源: harness-proposals/2026-09-25-atc-shortcut-review-check.md（根拠 arXiv:2609.19717）

## 確認すること

実装が「検証を通すこと」だけを目的にしていないかを確認する。

- テストや DoD の期待値を、実装側にそのまま直書きしていないか
- テストで使われている入力だけに合わせた分岐（if 文・特別扱い）がないか
- 見えているケース以外の入力を与えると、明らかに壊れる作りになっていないか

## 見つけたとき

- severity は `major` とする（verdict ルールにより REQUEST_CHANGES になる）
- `gaps[].issue` の先頭に `shortcut:` と書く（件数を検索で数えるため）

  例: `"issue": "shortcut: 期待値 1180 を返す分岐が add() に直書きされている"`

- 対象の PR がある場合、Reviewer（Reviewer が PR に書き込めない場合は Lead）は同じ内容を PR コメントとして残す（件数を後から数えるため）

  ```bash
  gh pr comment <PR番号> --body "shortcut: 期待値 1180 を返す分岐が add() に直書きされている（<ファイル名:行番号>）"
  ```

## 確認しないこと

- テストの弱化（`it.skip` 等）は `.claude/rules/test-quality.md` の範囲とし、ここでは扱わない
```

### 既存の仕組みとの関係

- plugin の `agents/reviewer.md` の `type: code` の観点（acceptance・変更範囲・テスト弱化・空実装）は変更せず、そのまま使う。
- テストの弱化は `test-quality.md` の担当で、本ルールは「テストは弱めていないが、テストに合わせて実装を歪めた」ケースだけを扱う。

## 3. 効果の確かめ方

ログ集計の仕組みがなくても数えられる方法にする。指摘は **PR コメント**に残す（2026-09-28 決定）。

```bash
# PR コメント中の shortcut 指摘を検索（該当 PR の一覧が出る）
gh search prs --repo hiroshi57/ai-platform-template "shortcut: in:comments" --json number,title
```

- PR を作らずに進めたタスク（main へ直接コミットした solo 作業など）の指摘は、この方法では数えられない。対象は PR を経由したタスクに限る。

- 20 タスク程度（またはルール追加から 1 か月）経ったら件数を確認する。
- **0〜1 件**: ルールはそのまま残し、holdout（§4）は検討しない。
- **3 件以上**: §4 の holdout 案の検討を始める（新しい提案として起案する）。

## 4. 将来案（今回は提案しない）: holdout checks

`shortcut:` の指摘が繰り返し出た場合に限り検討する。概要だけ残す。

- sprint-contract の検証を、Worker に見せる `checks` と、Reviewer だけが持つ `holdout.json` に分ける
- holdout は一部のタスクだけに付ける（論文でも候補を隠したのは訓練例の 75% で、全部ではない）
- 「見えている検証は通るのに holdout で落ちる」件数を retro の指標にする
- 着手前に決めること: holdout を誰が作るか / plugin への反映方法 / Worker に holdout を読ませない方法（Worker は `Read` を持つため、ルールだけでは技術的に止められない）

## 5. 本論文から取り入れないもの

- 「最後の思考トークン 1 つに、それまでの計算がまとまる」という結果（論文 §6.4）は、モデル内部のベクトルについての話である。ログや記憶を要約して引き継ぐ根拠には**使わない**。生ログは逐語で保存する（`.claude/rules/memory-curation.md`）。
- 論文の curriculum backtracking（通過済みの段階を毎回テストし直す）は、既存の `no-existing-test-regression` と同じ考え方で、本ハーネスはすでに満たしている。

---

## 付録: 関連ファイル

- 関連提案: [`2026-09-17-ngu-effort-reallocation.md`](2026-09-17-ngu-effort-reallocation.md)
- 関連提案: [`2026-09-14-ecdysis-cross-instance.md`](2026-09-14-ecdysis-cross-instance.md)（失敗の原因分類。`shortcut` は分類の 1 カテゴリとして接続できる）
- 関連ルール: `.claude/rules/harness-retro.md` / `.claude/rules/memory-curation.md`
