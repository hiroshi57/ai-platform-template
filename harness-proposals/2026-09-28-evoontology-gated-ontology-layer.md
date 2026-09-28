# Harness 改善提案: 「引ける・育つ・関門付き」の意味層 — DI-MCP オントロジー / ダッシュボード KPI 定義 / retro の採否ゲート

- **日付**: 2026-09-28
- **slug**: `evoontology-gated-ontology-layer`
- **起案**: Claude Code (Worker)
- **ステータス**: **B・C 承認済み（2026-09-28）／D は未承認（保留）**
  - B → 非公開リポジトリ [hiroshi57/di-kpi-ontology](https://github.com/hiroshi57/di-kpi-ontology)（private）の `SPEC.md`（DI-MCP 運用担当への引き渡し用仕様）と `terms.v1.json`（初期定義ストア 10 指標、store_version `2026-09-28.1`、Mapping はすべて `unverified`）。DI-MCP への実装は運用担当が行う
    - 当初は本 repo の `docs/di-mcp-ontology/` に置いたが、DI-MCP とダッシュボードの両方から参照するため専用リポジトリへ移した [更新: 2026-09-28]
    - §7 P-1（定義ストアの置き場所）は、DI-MCP 実装までの暫定として上記リポジトリとする
  - C → `ad-performance-dashboard` のブランチ `feature/kpi-definitions`（commit `3713c4b`、未 push）。CPA の式 2 か所を定義ストア経由に一本化し、変更前後で値が一致（48 ケース・差分 0）、`npm run build` 成功
  - D → `.claude/rules/harness-retro.md` には反映していない
  - 旧ステータス: 人間承認待ち（DRAFT）[更新: 2026-09-28]
- **根拠論文**: *EvoOntology: A Self-Evolving Ontology Layer for Data Agents*
  - Chong, Zhang, Fan, Du（中国人民大学）— arXiv:2609.15779v1 [cs.AI], 2026-09-14
  - https://arxiv.org/abs/2609.15779 / コード: https://github.com/ruc-datalab/EvoOntology
- **対象**: B = DI-MCP、C = 社内ダッシュボード群、D = Self-Tuning Harness Loop（harness-retro）

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない。
> B（DI-MCP）と C（ダッシュボード）は本 repo の外にあるサービス。**C の各 repo は main / master への push で本番に自動デプロイされる**ため、Claude Code は起案だけを行う。実装は人間の承認後、feature ブランチから PR で行う（本番デプロイは Cursor の責務: CLAUDE.md §1）。
> DI-MCP のソースはこの端末にないため、B は DI-MCP の既存ツール規約（`<媒体>_<動作>_<対象>`）に合わせたインターフェース案に留める。
>
> ⚠️ **根拠の強さ**: v1 が公開されたばかりで査読前。概要では「4 モデル」、本文では「6 モデル」と書かれ、表の数値にも一部ずれがある。評価はベンチマーク（DDR-Bench / InsightBench / BIRD）で、社内データでの効果は検証していない。本提案は数値の再現を約束するものではない。**アブレーションで示された「効いている部品」を設計原則として借りる**。

## TL;DR（3行要約）

- **主張**: データエージェントに業務用語と実データの列の対応（オントロジー）を渡すなら、**プロンプトに静的に入れるのではなく MCP ツールで必要な分だけ引かせる**のがよい。静的注入は悪化することがある（Claude-Sonnet-5 で −15.0pt）。さらに**失敗ログから局所的に修正し、修正前後の比較（ゲート）を通ったものだけを採用する**と、改善が積み上がる（DDR-Bench 平均 +17.8pt）。
- **提案**: B) DI-MCP に `ontology_browse` / `ontology_resolve` を追加し、媒体横断の指標定義を引けるようにする。C) ダッシュボードごとにハードコードされている KPI 定義を、同じ定義ストアに寄せる。D) harness-retro の提案に**修正前後の比較ゲート**と**却下ログ**を必須化し、改善対象を**内容 / ツール / スキーマの 1 層に限定**する。
- **効果**: B・C は定義の重複とずれ（同じ「CPA」でもダッシュボードによって式が違う等）をなくす。D は、人間の承認より前に「効くかどうか」を機械的に確かめ、同じ却下案が繰り返し出るのを防ぐ。

### 承認で決まること（決裁事項）

- ✅ D-1〜D-4 を `.claude/rules/harness-retro.md` に追記してよい（本 repo 内で完結）
- ✅ B のインターフェース案（§3）を DI-MCP 運用担当に渡してよい
- ✅ C のパイロットを `ad-performance-dashboard` で feature ブランチ + PR として実装してよい
- ❌ 承認しても、DI-MCP のデプロイとダッシュボードの本番反映は**人間 / Cursor** が行う
- ❌ オントロジーの自動修正を、ゲートなしで本番の定義ストアに書き込むことは許可しない

**却下・保留する場合**: B・C・D は提案単位で可。C は B に依存する（定義ストアの置き場が B）ため、B を保留にする場合は C を「repo 内共通モジュール化」に縮小する（§4.4）。

---

## 1. 背景: 論文の要点（要約）

### 1.1 構成

| 層 | 中身 |
|---|---|
| 内容層（Content） | Terms（用語）/ **Mappings（実際の列・JOIN 経路との対応）** / Constraints（使ってよい条件）/ **Evidence（実データで確かめた結果）**、および意味関係のエッジ |
| スキーマ層（Schema） | ノードの項目・許可する関係の種類 |
| ツール層（Tool） | MCP ツール `browse(q,k,n)`（検索）と `resolve(ids)`（詳細取得）、および短いマニフェスト。プロンプトに入れるのはマニフェストだけ |

進化ループ: **Diagnose**（失敗パターンを抜き出す）→ **Attribute**（原因を Content / Tool / Schema の 1 つに割り当て、期待効果の仮説を書く）→ **Patch**（1 層だけ修正）→ **Gate**（同じ検証セットで修正前と比べ、改善幅を超えたら採用。却下はログに残す）

### 1.2 本提案が借りる数値（DDR-Bench、4 モデル平均）

| 発見 | 数値 | 使う提案 |
|---|---|---|
| 静的なプロンプト注入は安定しない | Sonnet-5 で −15.0、BIRD の EX で最大 −5.6 | B・C |
| MCP で引かせると改善 | 平均 +17.8（Traj-Wise） | B |
| 過去ログ検索（Memory）より上 | Memory 75.8 に対し 89.5 | D |
| **ゲートを外すと最大の低下** | −11.2 | D-1 |
| 原因を層に割り当てる手順を外すと低下 | −6.3 | D-2 |
| 1 層だけの進化ではツール層が最大 | Tool のみ +13.2 / Content のみ +8.7 / Schema のみ +3.6 / 全層 +20.0 | D-2・harness-retro 提案4 |
| **Mappings と Evidence が中心** | Mappings を外すと −13.4、Evidence を外すと −8.7 | B・C |
| 他モデル向けに育てたストアは効果が落ちる | −6.6〜−10.9 | D-4 |

---

## 2. 現行運用の不足点

### 2.1 指標の定義がダッシュボードごとにハードコードされている（C）

`_projects/dashboards/` には 60 前後のダッシュボードがあり、指標の定義は repo ごとに書かれている。例:

- `ad-performance-dashboard/lib/data.ts` — `TARGET_CPA = 12000`、`TARGET_ROAS = 300`、`cpaOf()` を独自に定義
- 同じ「CPA」「ROAS」「CV」を扱う `kpi-achievement-dashboard`・`budget-vs-actual-dashboard`・`creative-effect-analysis-dashboard`・`ga4_dashboard_v57` 等でも、定義が同じである保証がない

`dashboard-depth` スキルが求める「平均との比較・時系列・将来予測」は、定義が揃っていないとダッシュボードをまたいで比べられない。

### 2.2 媒体横断の用語対応がエージェントのプロンプト頼み（B）

DI-MCP は媒体ごとのレポートツール（`google_ads_*` / `meta_ads_*` / `ga4_*` 等）を提供しているが、**媒体をまたいで「この指標はどの列か」「CV の定義は媒体ごとにどう違うか」を引くツールがない**。そのため、各エージェントのプロンプトや各案件の AGENTS.md に定義を書くことになる。論文の言う「静的注入」の状態で、長くなるほど他の指示と競合する。

### 2.3 retro の提案に「効くか」の事前確認がない（D）

現行の CLAUDE.md §7 と `harness-retro.md` では、改善案は「diff + 根拠ログ + 期待効果」を書き、人間が承認する。

- **期待効果は予想で、修正前後を比べた実測がない**。論文ではゲートがループ全体で最も効いている部品（−11.2）。
- **却下した提案の記録先が決まっていない**。同じ案が再び出てきても気づけない。
- 1 つの提案が CLAUDE.md・skills・ツール設定を同時に変えることがあり、**どの変更が効いたのか切り分けられない**。

---

## 3. 提案 B: DI-MCP にオントロジーツールを追加

### 3.1 ツール（DI-MCP の命名規約 `<媒体>_<動作>_<対象>` に合わせる）

| ツール | 引数 | 返り値 |
|---|---|---|
| `ontology_browse_terms` | `query: str`, `kind?: "metric"\|"dimension"\|"entity"`, `media?: str[]`, `limit=10` | 意味的に近い用語の ID・名前・一行説明 |
| `ontology_resolve_terms` | `ids: str[]`, `include?: ("mappings"\|"constraints"\|"evidence"\|"relations")[]` | 用語の詳細。媒体ごとの列（Mapping）、制約、確認結果（Evidence） |
| `ontology_get_manifest` | なし | 使える媒体と用語の件数、使い方の短い説明（セッションの最初に 1 回） |

- 書き込み用ツールは**エージェントに公開しない**。更新は §3.3 のゲートを通したバッチだけが行う。
- ACL: 閲覧は既存の媒体レポート権限に合わせる（媒体 X のレポート権限がない利用者には、X の Mapping を返さない）。

### 3.2 データ例（ノードの種類は論文の 4 種類に揃える）

```yaml
term: cv
name: コンバージョン
kind: metric
mappings:
  google_ads: { report: campaign, field: metrics.conversions }
  meta_ads:   { report: insights, field: actions[action_type=<account設定のCVイベント>] }
  ga4:        { report: events, field: keyEvents }
constraints:
  - 媒体ごとに計測の定義が違う。媒体をまたいで単純に合計しない
  - Meta の CV イベントはアカウント設定で決まる。推測で埋めない（DI-MCP の既存規約と同じ）
evidence:
  - { checked_at: 2026-09-XX, probe: "google_ads_report で列の存在と型を確認", result: "float, 非負" }
relations:
  - { type: derivation, to: cpa, formula: "cost / cv" }
```

### 3.3 Evidence と秘密の扱い（`secret-isolation.md` ルール2・6）

- Evidence には**列の存在・型・値の範囲や分布の要約だけ**を入れる。実際の値、アカウント ID、クライアント名は入れない。
- 確認クエリの実行はサーバー側で行い、LLM には要約だけを返す（DI-MCP の現在の方式と同じ）。

### 3.4 初期構築

1. 既存ダッシュボード（§2.1）とヨシケイ CR レポートの列定義から、候補になる用語を集める
2. 媒体ごとに確認クエリを実行し、**確かめられた候補だけ**を採用する（論文の Evidence-Grounded Commitment）
3. 最初は **Google 広告・Meta 広告・GA4 の 3 媒体、指標 10 個前後**（CV / CPA / ROAS / CTR / CVR / 費用 / IMP / クリック / 売上 / セッション）に絞る

---

## 4. 提案 C: ダッシュボードの KPI 定義を共通の定義ストアに寄せる

### 4.1 方針

- ダッシュボードの**実行時**には DI-MCP を呼ばない（本番の画面が MCP の可用性に依存しないようにするため）。
- **ビルド時**に `ontology_resolve_terms` で定義を取得し、各 repo の `lib/kpi-definitions.generated.ts` に書き出す。生成したファイルはコミットする。
- 目標値（`TARGET_CPA` 等）はクライアントや案件ごとの設定なので、定義ストアには入れず、repo 側に残す。

### 4.2 パイロット: `ad-performance-dashboard`

```diff
- export function cpaOf(c: Campaign, p: Period): number {
-   return c.cv[p] ? Math.round((c.spend[p] * 10000) / c.cv[p]) : 0;
- }
+ import { KPI } from "./kpi-definitions.generated";
+ export function cpaOf(c: Campaign, p: Period): number {
+   // spend は万円単位（現行実装の ×10000 を単位変換として明示）
+   return KPI.cpa.compute({ cost_jpy: c.spend[p] * 10000, cv: c.cv[p] });
+ }
```

（`-` 側は現行の `lib/data.ts` の `cpaOf` そのまま。2026-09-28 時点）

> 補足: 現行コードでは `spend` が**万円単位**で、`cpaOf` の中で ×10000 して円に直している。
> こうした単位の前提はコードを読まないと分からず、ダッシュボード間で定義がずれる典型例になる。
> 定義ストアでは `cpa` の Constraint に「cost は円単位」と書き、単位変換は呼び出し側で明示させる。

### 4.3 受け入れ条件

- 生成した定義で計算した値が、現在の画面の値と一致する（一致しない場合は、どちらの定義が正しいかを人間が決める）
- `npm run build` が通る
- 本番反映は PR のマージ後、Cursor / 人間が行う

### 4.4 B を保留にした場合

DI-MCP を使わず、`_projects/dashboard-template` に `kpi-definitions.ts` を置いて各 repo からコピーする形に縮小する。ただし、この形では定義が再びずれていくため、暫定措置とする。

---

## 5. 提案 D: harness-retro に「採否ゲート」を追加する

`.claude/rules/harness-retro.md` の末尾に「提案8」として追記する。

```diff
+ ## 提案8: 改善提案の採否ゲートと却下ログ（arXiv:2609.15779）
+
+ > **起源**: 提案 `harness-proposals/2026-09-28-evoontology-gated-ontology-layer.md`（提案 D）
+ > **承認**: YYYY-MM-DD 人間承認済み
+
+ 実証結果: 失敗ログから出した修正候補を、修正前と同じ検証セットで比べて改善したものだけ採用すると、
+ 改善が積み上がる。このゲートを外すと効果が最も大きく落ちた（−11.2pt）。原因の層を決めずに修正すると −6.3pt。
+
+ ### ルール
+
+ - **D-1 修正前後の比較（ゲート）**: `harness-proposals/` の提案には、人間に回す前に
+   「修正前」と「修正後」で同じ検証タスクを流した結果を添付する。
+   - 検証タスクは直近の `harness-logs/` から、その提案が直そうとしている失敗を含むものを最低5件選ぶ
+     （`task.json` の `purpose: "validation"` で管理し、Worker には渡さない。judge-rubric.md の「検証タスクの書き方」と同じ）
+   - 判定は `judge-rubric.md` の rubric で行い、同じ `rubric_version` どうしで比べる
+   - 改善しなかった提案も、結果を添えて人間に回してよい（採否を決めるのは人間）。ただし「期待効果」欄は実測値で書く
+ - **D-2 1提案1層**: 提案ごとに、変える層を1つだけ宣言する。
+   - `content`（CLAUDE.md / AGENTS.md / skills の本文）
+   - `tool`（Worker の allowed/disallowed tools、MCP ツール、スクリプト）
+   - `schema`（ログや review.json の形式、フォルダ規約）
+   - 層ごとに効果を切り分けられない変更は、提案を分ける。
+   - どの層か迷ったら `tool` から検討する（提案4と同じ）
+ - **D-3 却下ログ**: 却下した提案は削除せず、`harness-proposals/rejected/<date>-<slug>.md` に移し、
+   冒頭に「却下理由・ゲート結果・元になった失敗パターン」を追記する（memory-curation.md ルール3: 削除しない）。
+   retro は新しい提案を出す前に `rejected/` を検索し、同じ失敗パターンへの同じ修正を再提案しない。
+ - **D-4 モデル変更時の再評価**: Worker / Reviewer のモデルを替えたら、次の retro で、
+   採用済みの提案のうち直近5件について D-1 の比較をやり直す。
+   別のモデル向けに育てた改善は効果が落ちうる（論文では −6.6〜−10.9pt）。
```

### 5.1 検証タスクを作れない場合

- 起動したばかりで `harness-logs/` に該当する失敗が5件ない場合、D-1 は「実施不可」と書いて人間に回してよい。
- その提案が採用された場合は、該当する失敗が5件たまった時点の retro で、事後に D-1 を実施する。

---

## 6. 期待効果と測り方

| 提案 | 測るもの | 目安 |
|---|---|---|
| B | 媒体横断タスクで、列の特定を誤って再試行した回数（`retries.log`） | 導入前 10 タスクと導入後 10 タスクを比べる |
| C | ダッシュボード間で同じ KPI の式が一致している割合 | パイロット後に、CPA / ROAS を使う repo を grep で比べる |
| D | 採用した提案が次の retro で問題の再発を減らした割合、`rejected/` からの再提案件数 | 再提案 0 件、同じ `escalation_reason` の再発が減る |

## 7. 未解決の論点

- **P-1**: B の定義ストアの置き場所（DI-MCP の Supabase か、別の repo の YAML か）。既定案: DI-MCP の Supabase（ACL を既存のものと揃えられるため）
- **P-2**: D-1 の検証タスク5件分を毎回実行するコスト。既定案: 提案1件につき5件。コストが問題になったら最初の2〜3回の retro の実績で見直す
- **P-3**: B の自動修正（進化ループ）までやるか、初期構築と人手更新に留めるか。既定案: **最初は初期構築と人手更新のみ**。自動修正は D のゲートが運用で回るようになってから検討する
