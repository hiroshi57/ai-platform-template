# Harness 改善提案: AHGA 由来「検証を生き残る仮説へバイアスする retro ループ」の理論的裏付け

- **日付**: 2026-09-17
- **slug**: `ahga-retro-loop-theory`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— 本提案は CLAUDE.md §7 の運用に従い、承認前は本体ファイル（CLAUDE.md / AGENTS.md / skills）へ反映しない
- **根拠論文**: *How to Build an Autonomous Hypothesis Generation Agent That Learns What Survives Validation and Searches Toward It*（AHGA）
  - 出所: Google Drive PDF（6ページ）— https://drive.google.com/file/d/1lby5eiN48qWaXEZx5n44-__GYPXMZUHJ/view
  - 全文和訳: [`docs/paper-translations/2026-09-17-ahga-hypothesis-generation-agent.ja.md`](../docs/paper-translations/2026-09-17-ahga-hypothesis-generation-agent.ja.md)
  - 元ネタ Meta-Harness 論文（CLAUDE.md §7 が参照）: arXiv:2603.28052

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には一切触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。対象は harness-retro / worker self_review / ログスキーマの**運用改善と理論的根拠づけ**のみ。
>
> ⚠️ **注意（別論文との混同回避）**: alphaxiv 2609.13443 *"Learning to Solve Hard Problems in RL for LLMs by Never Giving Up"* は本提案の根拠論文とは**別物**（LLM の RL 学習におけるマタイ効果の話）。本提案は AHGA（クオンツ仮説生成）のみを根拠とする。

## TL;DR（3行要約）

- **主張**: AHGA は「検証結果に符号化された構造的情報は学習可能なシグナルであり、それを活用する生成方策はステートレスな生成を上回る」を定量実証（検証率 3.1×, 初検証までの反復 2.4×削減）。これは本ハーネスの Self-Tuning Harness Loop（CLAUDE.md §7）と**構造同型**。
- **提案**: ①retro が「失敗の冗長性」だけでなく「成功パターンへの正のバイアス」も学ぶよう指標を対称化（A）②Worker self_review に「過去検証履歴（harness-logs）参照」を advisory 追加（B）③レジーム=プロジェクト/mode 条件付けの明示（C）。**いずれも既存メモリ/ログ資産の再利用で実装可、新規基盤不要**。
- **効果**: AHGA の数値は金融ドメイン固有で本ハーネスに転用保証はしない。本提案の価値は「既存 retro 運用の理論的裏付け」と「安価な運用微調整」であり、§4 で実測して確認する。

### 承認で決まること（決裁事項）

このドキュメントを承認すると以下が確定する。**コード / 本体ファイルの変更はまだ発生しない**（承認は各フェーズ着手の GO サイン）。

- ✅ 提案 A〜C を **フェーズ 1→2→3 の順で実装してよい**（各フェーズ完了時に §4 指標で効果確認）
- ✅ §1 の**対応表（AHGA 概念 ↔ 本ハーネス機構）を共通語彙として採用**する
- ❌ 承認しても CLAUDE.md / AGENTS.md / skills への反映は各フェーズごとに**別途レビュー**を経る（本承認は一括反映の許可ではない）

**却下・保留する場合**: フェーズ単位で可（提案 A〜C は相互に独立実装可能）。

---

## 1. 背景: AHGA と本ハーネスの構造同型

CLAUDE.md §7 の Self-Tuning Harness Loop は、**生ログを要約せず蓄積し、AI 自身に読ませて改善案を出させる**設計で、元ネタは Meta-Harness 論文（arXiv:2603.28052）の「要約フィードバックでなく生ログへのフルアクセスが改善の鍵」という知見。

AHGA はこの思想を**別ドメイン（クオンツ仮説生成）で定量実証**したものと読める。両者の対応:

| AHGA（論文）| 本ハーネス（CLAUDE.md §7 / rules）| 対応の性質 |
|---|---|---|
| DSR ゲート = 検証可能な報酬 | Reviewer / Lead の APPROVE 判定 = 検証シグナル | 同型（verifiable reward）|
| 検証履歴を捨てない | `harness-logs/` の生ログ逐語保存（memory-curation.md）| **同一原則** |
| 永続メモリ（セッション横断の事前知識）| `.claude/agent-memory/` + セッション横断参照 | 同型（cold-start 解消）|
| 冗長性ペナルティ（既棄却と構造類似を罰する）| 重複タスク / DRY 違反の抑制（self_review `dry-violation-none`）| 同型 |
| レジーム条件付け（市場環境で生成を条件付け）| プロジェクト slug / mode（solo/codex/breezing）条件付け | 類似 |
| 理由コードで棄却を構造化 | `escalation_reason` / advisor `reason_code`（retro 起動条件）| 同型 |
| モメンタム更新で破滅的忘却を防ぐ | 初期記憶の生存・in-place 編集（harness-retro.md §提案5）| **同一原則** |

**含意**: 本ハーネスの既存設計（生ログ保存・永続メモリ・再発ベース起動）は AHGA によって独立に裏付けられた。同時に AHGA は本ハーネスに欠けている 2 点を示唆する（§2）。

---

## 2. AHGA が示唆する、現行 retro の不足点

### 2.1 retro は「失敗の抑制」に寄り、「成功への正バイアス」を明示的に学んでいない

現行 harness-retro の起動条件は「同一 `escalation_reason` / `reason_code` が直近10タスク中3回以上再発」（CLAUDE.md §7）で、**失敗の再発検知**が中心。AHGA の報酬は**負のペナルティ（冗長性・理由コード）と正の報酬（DSR・レジーム一貫ボーナス・ウォークフォワード）の両方**で形成される（和訳 §3.2 表1）。

現行 retro には「**何が APPROVE を通ったか（成功構造）を積極的に次タスクへバイアスする**」経路が明示されていない。失敗だけ見ると「過去の失敗を避けるが、検証済みの良い approach からも遠ざかる」— これは Worker Agent frontmatter のメモリ運用が既に警告している退行（feedback は失敗と成功の両方から記録せよ）と同じ構図。

### 2.2 クロスセッション事前知識の「参照」が Worker 側で任意になっている

AHGA の最大の実証は「**永続メモリはセッション開始直後・レジーム転換時（＝今の証拠が最も乏しいとき）に最大価値**」（和訳 §7.5）。本ハーネスで対応するのは「新規タスク着手直後」。現行 Worker self_review（5 rule）には**過去の類似タスクの検証履歴を参照したか**を確認する項目がない。

---

## 3. 提案（A / B / C）

### 提案 A: retro 指標の対称化（失敗再発 + 成功再現）

- **現状**: 起動条件が `escalation_reason` / `reason_code` の**再発**のみ。
- **変更**: retro の集計に「**直近10タスクで 2 回以上 APPROVE first-pass した approach パターン**」の抽出を advisory で追加（`harness-retro.sh --check` の出力に併記）。成功パターンは Worker への briefing に「過去に通った類似手順」として渡す候補にする。
- **AHGA 根拠**: 和訳 §3.2（正負両成分の報酬整形）/ §7.4（検証時 DSR = 「かろうじて通過」でなく「マージンを持って通過」を評価）。
- **対象外の尊重**: 起動閾値（10タスク中3回）や cc:* マーカーは変更しない。追加は集計の**advisory 出力のみ**。

### 提案 B: Worker self_review に「過去検証履歴の参照」を advisory 追加

- **変更**: worker-report.v1 の self_review に project override 候補として次の rule を追加（`harness.toml [worker.self_review]`）:
  - `prior-validation-consulted`（advisory）: 着手前に `harness-logs/` の類似 task_id / 同一 escalation_reason の過去エピソードを確認したか。evidence 例: 参照した過去 task_id 一覧、または「該当なし」の明記。
- **性質**: **advisory（違反は警告のみ、自動差し戻ししない）**。既存5 rule の verified 判定には影響させない（ECDYSIS 提案 D-1 の運用と整合）。
- **AHGA 根拠**: 和訳 §4.3 / §7.2 / §7.5（永続メモリのヘッドスタート効果）。
- **対象外の尊重**: `plans-cc-markers-untouched` など既存 rule は不変。

### 提案 C: 「レジーム = プロジェクト / mode」条件付けの明示

- **変更**: retro 集計と self_review 参照を、**プロジェクト slug と mode（solo/codex/breezing）で層別**することを運用ルールに明記。異なる mode の成功/失敗パターンを混ぜて一般化しない。
- **AHGA 根拠**: 和訳 §8.1（レジーム条件付けが最大の貢献要素。環境が違えば生成分布を変えるべき）。
- **対象外の尊重**: mode 別ルール（Worker frontmatter の NG-1 等）の意味論は変更しない。層別の**観点追加のみ**。

---

## 4. 効果測定（承認後・各フェーズで実測）

AHGA の数値（VR 3.1×, IFV 2.4×削減）は金融ドメイン固有であり本ハーネスに転用保証しない。以下を実測する。

| 指標 | 測定方法 | 期待方向 |
|---|---|---|
| REQUEST_CHANGES 率 | review.json 集計（提案前後 各20タスク）| 低下 |
| 初回 APPROVE 率（first-pass）| worker-report → review の first-pass 比率 | 上昇 |
| 重複/DRY 指摘の再発 | retro `dry-violation` 系の再発カウント | 低下 |
| self_review advisory の記入率 | `prior-validation-consulted` の非空率 | ベースライン把握 |

- 効果が確認できないフェーズは**その時点で停止**し、本提案を撤回してよい（各提案は独立）。

## 5. 未解決論点（フェーズ着手前に個別確定）

- **P-1**: 「成功パターン」の同一性判定粒度（task 種別 / files 重なり / escalation_reason）。AHGA の「部分グラフパターン索引」（和訳 §4.1）に相当する定義が必要。
- **P-2**: advisory rule `prior-validation-consulted` を全 mode 必須にするか、breezing のみにするか。
- **P-3**: harness-logs の検索コスト。ログ大規模化時は memory-curation.md §提案2（検索経済性）に従い蒸留層のインデックス化を先に検討。

---

## 付録: 根拠ログへのリンク

- 全文和訳: [`docs/paper-translations/2026-09-17-ahga-hypothesis-generation-agent.ja.md`](../docs/paper-translations/2026-09-17-ahga-hypothesis-generation-agent.ja.md)
- 関連既存提案: [`harness-proposals/2026-09-14-ecdysis-cross-instance.md`](2026-09-14-ecdysis-cross-instance.md)（失敗帰属分類・横断再発）— 本提案 A/B は ECDYSIS の「横断再発＝体系欠陥の証拠」と整合し、成功側にも同じ横断ロジックを適用する
- 関連ルール: `.claude/rules/memory-curation.md`（生ログ逐語保存・検索経済性）/ `.claude/rules/harness-retro.md`（ストア健全性・ツールセットレバー）
