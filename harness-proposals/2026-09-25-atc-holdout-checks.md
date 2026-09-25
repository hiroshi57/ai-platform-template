# Harness 改善提案: ATC 由来「検証の一部を Worker から隠す（holdout checks）」

- **日付**: 2026-09-25
- **slug**: `atc-holdout-checks`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— CLAUDE.md §7 の運用に従い、承認前は本体ファイル（CLAUDE.md / AGENTS.md / skills / agent frontmatter / plugin）へ反映しない
- **根拠論文**: *Learn Your Own Thoughts: Abstract Token Curriculum*（ATC）
  - Gatmiry, Ghosh, Mirtaheri, Lee, Haghtalab, Abbe, Bartlett — arXiv:2609.19717v2 [cs.LG], 2026-09-23
  - https://arxiv.org/abs/2609.19717

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。自動修正3回・相談3回などの上限値も変更しない。
>
> ⚠️ **提案の性質**: ATC はモデル学習の手法であり、本ハーネス（LLM エージェントのオーケストレーション）へは**アナロジーとして**移植する。論文の数値（精度 0% → 98.7% 等）は本ハーネスでの効果を保証しない。効果は §4 で実測して判断する。

## TL;DR（3行要約）

- **論文の観察**: 答えの候補が入力に見えていると、モデルは計算せずに**候補をコピーする近道**を覚え、学習が第1段階から進まなくなった（候補を隠さない条件では 8 桁足し算の精度 0%）。訓練例の 75% で候補を隠す **candidate dropout** を入れると 98.7% まで解けた。
- **本ハーネスへの対応**: Worker が合格条件（期待値・検証ケース）を**全部見えている**状態では、「本当に正しい実装」ではなく「見えている検証だけを通す実装」（期待値のハードコード、特定入力だけの分岐）に流れやすい。
- **提案**: sprint-contract の検証を **Worker に見せる `checks`** と **Reviewer だけが持つ `holdout_checks`** に分ける（A）。一部のタスクだけで試す（B）。「見えている検証は通るのに holdout で落ちる」差を retro の新しい指標にする（C）。

### 承認で決まること（決裁事項）

- ✅ 提案 A〜C を **フェーズ 1（C の計測だけ）→ 2（A+B の試行）** の順に進めてよい
- ❌ 承認しても本体ファイル・plugin への反映は各フェーズで**別途レビュー**を経る（一括反映の許可ではない）
- ❌ Worker に渡す `validation_commands`（test / lint / build）は**隠さない**。隠すのは Reviewer 側で追加する検証ケースだけ

**却下・保留する場合**: フェーズ単位で可。C（計測）だけの採用もできる。

---

## 1. 背景: ATC と本ハーネスの構造対応

| ATC（論文） | 本ハーネス | 対応の性質 |
|---|---|---|
| 入力に答えの候補が見える | Worker が contract の `checks` / 期待値 / テストケースを全部読める | 同型 |
| 候補のコピーという近道（計算しない） | 期待値のハードコード・見えているケース専用の分岐・テストに合わせた実装 | 同型 |
| candidate dropout（訓練例の 75% で候補を隠す） | 一部の検証ケースを Worker から隠し、Reviewer だけが実行する | 類似 |
| 評価時には dropout を外す | Reviewer は見える検証と隠した検証の**両方**で判定する | 同型 |
| 途中経過ではなく**答えだけ**を教師にする | 実装方法は指定せず、観察できる振る舞いだけで合否を決める | 同一方向 |

**既存の仕組みとの関係**: preflight の「テストを弱める変更（`it.skip` 等）をしない」は、近道を**事後に禁止**するルールである。本提案は、近道が効かない状況を**事前に作る**。両者は補い合う関係であり、既存ルールは変更しない。

## 2. 現行運用の不足点

- `skills/harness-work/SKILL.md`（plugin 4.3.1）の sprint-contract には `checks` / `runtime_validation` / `browser_validation` があり、**どれも Worker が `contract_path` から最初に読む**（Worker 定義「開始直後の確認 2.」）。
- このため、合格条件がすべて Worker に見えている。「見えている条件だけを満たす実装」と「一般的に正しい実装」を、Reviewer が見分ける仕組みがない。
- 見分けられないので、近道がどれくらい起きているかも**計測されていない**（§4 の C で可視化する）。

## 3. 提案（A / B / C）

### 提案 A: sprint-contract に `holdout_checks` を追加（Reviewer 専用）

- **変更**: contract の生成時（`enrich-sprint-contract.sh` の段階）に、Reviewer 観点の追加検証を **Worker に渡さない別ファイル**として置く。

```diff
 .claude/state/contracts/<task-id>.sprint-contract.json      # Worker が読む（現行どおり）
+.claude/state/contracts/<task-id>.holdout.json              # Reviewer / Lead のみが読む
```

```diff
 ## 開始直後の確認   (agents/worker.md)
 1. `files` に入っていないファイルは編集しない。
 2. `contract_path` がある場合は最初に読む。
+   - `*.holdout.json` は Reviewer 専用のため読まない（存在を探索しない）。
```

- `holdout.json` の中身の例: 境界値・別の入力パターン・DoD を言い換えた受け入れ条件など。**見えている `checks` と同じ仕様を、別の入力で確かめるもの**に限る。Worker が知らない仕様を後から足すことはしない（不公平な差し戻しになるため）。
- **注意**: Worker は `Read` / `Grep` を持っているため、ファイルを分けるだけでは技術的に強制できない。提案 A は「読まない」ルールと、B の worktree 分離（holdout を Worker の worktree に置かない）の組み合わせで運用する。強制力が足りなければ、`.claude/rules/harness-retro.md` 提案4 に従って**ツールセット側**（Worker の読み取り範囲の制限）を検討する。

### 提案 B: 一部のタスクだけで試す（全タスクには適用しない）

- 論文でも、候補を隠したのは訓練例の 75% で、100% ではない。全部を隠すと、Worker は何を満たせば良いのか分からなくなる。
- **変更**: holdout は `reviewer_profile: runtime` のタスクの一部（初期値: 5 タスクに 1 つ程度）だけに付ける。UI・ドキュメント系のタスクには付けない。
- holdout で落ちた場合、差し戻しでは**落ちたケースの内容を Worker に開示してよい**。一度開示したケースは、次回以降の同種タスクでは holdout として使わない。

### 提案 C: 「見えている検証と holdout の差」を retro の指標にする

- **変更**: `harness-logs/<project>/<YYYYMM>/<task_id>/review.json` に次の 2 項目を記録し、`harness-retro.sh --check` で集計する。

```diff
 {
   "verdict": "APPROVE | REQUEST_CHANGES",
+  "visible_checks_passed": true,
+  "holdout_checks_passed": false,
   ...
 }
```

- `visible_checks_passed == true` かつ `holdout_checks_passed == false` のタスクを**近道の疑い**として数える。同一プロジェクトで直近 10 タスク中 3 回以上なら、retro の起動条件（CLAUDE.md §7）と同じ扱いにする。
- フェーズ 1 では、holdout を運用せずに**計測の枠だけ**を入れる。Reviewer が「テストは通るが実装が特定ケース専用だった」と判断した REQUEST_CHANGES に、手動でタグ `shortcut` を付けて件数を数える。これで本提案が必要かどうかを先に判断できる。

## 4. 効果測定（承認後・各フェーズで実測）

| 指標 | 測定方法 | 期待方向 |
|---|---|---|
| 近道の疑い件数 | フェーズ1: `shortcut` タグの件数 / フェーズ2: visible 通過・holdout 失敗の件数 | ベースラインを把握 → 減少 |
| 初回 APPROVE 率 | holdout あり / なしのタスクで比較 | holdout ありで一時的に下がり、その後回復 |
| リリース後の不具合 | `cc:完了` 後に再チケット化されたタスクの件数（既存の「失敗タスクの自動再チケット化」を利用） | 減少 |
| コスト | holdout 付きタスクの Reviewer turns の増分 | 許容範囲か判断 |

- フェーズ1で `shortcut` タグがほぼ付かなければ、フェーズ2（A+B）には進まずに打ち切る。

## 5. 未解決論点（フェーズ着手前に確定）

- **P-1**: holdout を誰が作るか（Lead / Reviewer / 別エージェント）。Worker と同じモデル・同じ文脈で作ると、Worker と同じ盲点を持つおそれがある。
- **P-2**: 反映先。`agents/worker.md` と `harness-work/SKILL.md` は plugin（`claude-code-harness` 4.3.1）の cache 内にあり、直接編集すると更新で消える。upstream への提案にするか、この repo の `.claude/rules/` でローカルに上書きするかを決める。
- **P-3**: holdout の強制方法。ルールだけにするか、Worker の worktree に holdout を置かない運用にするか、読み取り範囲の制限まで行うか。

## 6. 本論文から取り入れないもの

- 「最後の思考トークン 1 つに、それまでの計算が要約される」という結果（論文 §6.4）は、モデル内部のベクトルについての話である。ログや記憶を要約して引き継ぐ根拠には**使わない**。生ログは逐語で保存する（`.claude/rules/memory-curation.md`）。
- 論文の curriculum backtracking（通過済みの段階を毎回テストし直す）は、既存の `no-existing-test-regression` と同じ考え方で、本ハーネスはすでに満たしている。新しい提案にはしない。

---

## 付録: 関連ファイル

- 関連提案: [`2026-09-17-ngu-effort-reallocation.md`](2026-09-17-ngu-effort-reallocation.md)（NGU の提案 C は同じ失敗が繰り返されているかを検知する。本提案 C は失敗が隠れているかを検知する）
- 関連提案: [`2026-09-14-ecdysis-cross-instance.md`](2026-09-14-ecdysis-cross-instance.md)（失敗の原因分類。`shortcut` タグは原因分類の 1 カテゴリとして接続できる）
- 関連ルール: `.claude/rules/harness-retro.md`（ツールセットの見直し）/ `.claude/rules/memory-curation.md`（生ログの逐語保存）
