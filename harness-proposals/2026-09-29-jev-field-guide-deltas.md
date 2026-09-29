# Harness 改善提案: 判断レシートの差分補強 —「リトライの種別・証拠の出典・止め方」

- **日付**: 2026-09-29
- **slug**: `jev-field-guide-deltas`
- **起案**: Claude Code (Worker)
- **ステータス**: **2026-09-29 人間承認済み** — 提案 E〜H を承認。§5 の論点 Q-1〜Q-4 は既定案で確定（Q-4 により提案 I は保留）。
  - 反映済み（Claude）: E・F → [`.claude/rules/decision-boundaries.md`](../.claude/rules/decision-boundaries.md)、G → [`.claude/rules/judge-rubric.md`](../.claude/rules/judge-rubric.md)「迷いの原因」＋ `route_mode` 3値の追記、H → [`.claude/rules/harness-retro.md`](../.claude/rules/harness-retro.md) 提案9
  - 人間が反映: diff 5（グローバル CLAUDE.md §7 の `retries.log` 行）
  - [更新: 2026-09-29] diff 5 をグローバル CLAUDE.md §7 に反映済み（ユーザー指示により Claude が反映）
  - 旧ステータス: 人間承認待ち（DRAFT）[更新: 2026-09-29]
- **根拠資料**: *2026 Field Guide to Jev and Language Models — How to Use Jev with LLMs*（2026-09、全12ページ。TypeSafe の公開ドキュメントをもとにした独立ガイド、非公式・非承認と明記）
  - 入手元: ユーザー共有の Google Drive PDF（https://drive.google.com/file/d/1naKboOcnXfB_9Zq4pKfeTVtM0UFucM0l/view）
  - 本文は第三者の著作物のため repo には保存しない。以下の章番号（§I〜§XI）はガイドの章番号
- **前提となる提案**: [`2026-09-28-typed-decision-receipts.md`](2026-09-28-typed-decision-receipts.md)（承認・反映済み）。**本提案はその差分だけを扱う**

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。
>
> ⚠️ **提案の性質**: 根拠資料は査読論文ではなく、特定ベンダーの判断モデル（Jev）を前提にした実務ガイド。速度・コストの数値（約10倍など）は例示であり、**本提案は採用しない**。Jev の導入も提案しない。採るのは製品に依存しない運用原則だけ。

## TL;DR（3行要約）

- **主張**: 前回の提案で「判断・権限・証拠を分ける」「レシートを残す」「リトライのたびに新しい情報を得る」は入った。残っている穴は、**リトライの種別が1つに混ざっていること**、**証拠に出典が無いこと**、**低確信の原因が残らないこと**、**shadow を外すときの止め方と比べ方が決まっていないこと**。
- **提案**: ① 通信リトライとワークフローリトライを別に数える（E）② context に出典（取得元・時刻・検証済みか生成物か）を付ける（F）③ `uncertain: true` に原因の分類を付ける（G）④ shadow を外す前にキルスイッチと観測期間の凍結規則を決める（H）⑤ mode ごとの経路契約を1か所に宣言する（I・参考）。
- **効果**: いずれもルール文書と記録項目の追加だけで実装できる。新しい基盤もモデル変更も要らない。

### 承認で決まること（決裁事項）

- ✅ 提案 E・F を `.claude/rules/decision-boundaries.md` に追記してよい
- ✅ 提案 G を `.claude/rules/judge-rubric.md` に追記してよい（任意項目の追加なので `rubric_version` は上げない）
- ✅ 提案 H を `.claude/rules/harness-retro.md` に追記してよい
- ❌ グローバル `C:\Users\hiroshi_takizawa\CLAUDE.md` §7 は本 repo の管理外。diff 5 は**人間が手で反映**する
- ❌ 提案 I（mode 別経路契約）は Worker エージェント定義（プラグイン側・本 repo 外）に関わるため、本提案では**参考として示すだけ**。反映は別途判断
- ❌ `route_mode: shadow` を外すこと自体は対象外（P-2 のとおり、実測後に別提案で決める。本提案 H はその**準備**だけ）

**却下・保留する場合**: 提案単位で可（E〜I は互いに独立）。

---

## 1. 背景: 前回の反映状況との差分

| ガイドの原則 | 章 | 前回（2026-09-28）で反映済みか | 本提案 |
|---|---|---|---|
| 判断・権限・証拠を分ける／判断は許可ではない | §I-E, §VII-A, §X-A | ✅ `decision-boundaries.md` ルール2 | — |
| 選択肢に no-match / escalate を入れる | §III-G, §IV-C | ✅ 同 ルール3 | — |
| 同じ状態・同じ質問のリトライは回復策ではない | §VII-E | ✅ 同 ルール1 | — |
| 判断レシート・状態の digest・shadow モード | §VI-F, §VII-C, §VIII-E | ✅ `judge-rubric.md`「判断レシート」 | — |
| インシデントを回帰資産にする | §X-H | ✅ `harness-retro.md` 提案8 | — |
| **通信リトライとワークフローリトライを別カウンタにする** | §VIII-I | ❌ | **E** |
| **状態のフィールドに出典（取得元・時刻・版・検証済みか生成物か）を付ける** | §III-H, §III-E | ❌（ルール5 は「結論でなく事実」を求めるが、形式が無い） | **F** |
| **低確信の原因（証拠不足・選択肢の重なり・課題の不適合・ラベル定義の揺れ）を記録する** | §VII-F, §IV-G | ❌（`uncertain: true` はあるが原因が無い） | **G** |
| **観測期間中は契約（質問文言）を凍結し、期間後に仮説つきの修正を1つだけ入れる** | §XI-C | ❌ | **H** |
| **自動化だけを止めて観測・記録は続けるキルスイッチ／ロールバックを普通の操作にする** | §X-G, §X-J | ❌ | **H** |
| **フォールバック経路も主経路と同じ指標で観測する** | §VII-H | ❌（advisor / escalated の後の結果を追っていない） | **H** |
| **経路（route）はモデル名ではなく契約（許可データ・ツール・予算・最大リトライ・検証計画・フォールバック）を選ぶ** | §V-H | 一部（mode ごとの規則は Worker 定義に散在） | **I（参考）** |

## 2. 現行運用の不足点

### 2.1 リトライの種別が混ざる（→ E）
`retry-threshold`（同じ原因の失敗が2回）と「自動修正は最大3回」は、ネットワーク・レート制限・一時的なツール障害によるやり直しと、仮説や証拠を変えたやり直しを区別しない。通信障害が続くだけで advisor-request や `escalated` に達しうる。逆に retro で「コストがどこから来たか」（通信か、不確実さか、再生成か）を切り分けられない（§VIII-I）。

### 2.2 context の事実に出典が無い（→ F）
ルール5 は「結論ではなく観測できる事実を渡す」と定めたが、その事実が**いつ・どこから取った・検証済みか**が書かれない。retro の診断順序 #1（状態）で「証拠が古かった」のか「生成物が事実のふりをしていた」のかを区別できない（§III-H）。

### 2.3 `uncertain: true` の原因が残らない（→ G）
同じ `uncertain: true` でも、直す場所が違う。証拠不足なら状態、選択肢の重なりなら rubric のアンカー、人間同士でも割れるならラベル定義。原因が残らないと、retro は判定器モデルを疑う方向に流れやすい（§VII-F。提案8 の診断順序と同じ問題）。

### 2.4 shadow を外すときの手順が無い（→ H）
P-2 で「最低20件かつ retro 2回分」は決まったが、(a) 観測中に rubric を変えてよいか、(b) 外した後に問題が出たら何を止めるか、(c) advisor / escalated に回ったケースの結果を同じ指標で見るか、が決まっていない。観測中に rubric を変えると、挙動の変化が入力の変化か契約の変化か区別できない（§XI-C）。

## 3. 提案と diff

### 提案 E: 通信リトライとワークフローリトライを分ける

#### diff 1: `.claude/rules/decision-boundaries.md`（ルール1 に追記）

```diff
--- a/.claude/rules/decision-boundaries.md
+++ b/.claude/rules/decision-boundaries.md
@@ ルール1: リトライのたびに新しい情報を得る（MUST） @@
 - `retries.log` の各試行に「前回から新しくなったもの」を1行残す（上の4つのどれか）。
 - どれも伴わない試行は、同じ原因の失敗として数える（Worker の `retry-threshold` 判定に使う。P-4）。
+
+### リトライの種別（MUST）
+
+> **起源**: 提案 `harness-proposals/2026-09-29-jev-field-guide-deltas.md`（提案 E）
+
+リトライは2種類に分け、別々に数える。
+
+| 種別 | 中身 | 数え方 |
+|---|---|---|
+| `transport` | 同じ入力のまま、通信・レート制限・タイムアウト・一時的なツール障害をやり直す | 上限回数と待ち時間（backoff）を決めて数える。**`retry-threshold` と「自動修正は最大3回」には数えない** |
+| `workflow` | 証拠・仮説・範囲・経路のどれかを変えてやり直す（上の4つ） | `retry-threshold` と「最大3回」の対象 |
+
+- `retries.log` の各試行に `kind: transport | workflow` を残す。
+- `transport` が上限に達したら、`workflow` のリトライに切り替えず、そのまま `escalated`（または advisor-request）にする。
+  通信障害を「仮説を変えた」ことにしない。
+- `transport` のつもりで入力を変えた場合は `workflow` として数える。
```

### 提案 F: context の事実に出典を付ける

#### diff 2: `.claude/rules/decision-boundaries.md`（ルール5 に追記）

```diff
--- a/.claude/rules/decision-boundaries.md
+++ b/.claude/rules/decision-boundaries.md
@@ ルール5: 判断の入力は証拠にする（SHOULD） @@
 - 判定器・Worker に渡す context には、結論（「たぶん十分」「問題なさそう」）ではなく、
   観測できる事実（件数・検証済みかどうか・未解決の項目）を書く。前の段の結論を、そのまま次の段の事実にしない。
+
+### 事実には出典を付ける（SHOULD）
+
+> **起源**: 提案 `harness-proposals/2026-09-29-jev-field-guide-deltas.md`（提案 F）
+
+- context に書く事実のうち、判断を左右するものには次の3つを添える。
+
+  | 項目 | 例 |
+  |---|---|
+  | 取得元 | `git log -1`、`bash tests/validate-plugin.sh` の出力、ファイルパス:行、前タスクの `review.json` |
+  | 取得時点 | commit SHA または日時 |
+  | 種別 | `verified`（コマンド出力・diff で確認済み）／ `generated`（LLM が書いた要約・推測） |
+
+- `generated` の事実は、判定器が APPROVE の根拠にしない（`judge-rubric.md` ルール4「自己申告は証拠にしない」と同じ扱い）。
+- 取得時点より後に対象ファイルが変わった事実は古いものとして扱い、取り直す（`state_ref` と同じ考え方）。
+- 出典に秘密を書かない（`secret-isolation.md` ルール6）。
```

### 提案 G: 低確信の原因を記録する

#### diff 3: `.claude/rules/judge-rubric.md`（「判断レシート」節に追記）

```diff
--- a/.claude/rules/judge-rubric.md
+++ b/.claude/rules/judge-rubric.md
@@ 判断レシート（review.v1 追加分） @@
 - 自己申告の確信度（「自信あり」「おそらく」など）は `route` の入力にしない（ルール4）。
 - 本節は rubric のアンカーを変えないので `rubric_version` は上げない。
+
+### 迷いの原因（review.v1 追加分・任意項目）
+
+> **起源**: 提案 `harness-proposals/2026-09-29-jev-field-guide-deltas.md`（提案 G）
+
+- `uncertain: true` の観点には、`uncertain_cause` を次から1つ付ける。原因ごとに直す場所が違うため。
+
+  | `uncertain_cause` | 観測されること | 直す場所（`harness-retro.md` 提案8 の層） |
+  |---|---|---|
+  | `missing_evidence` | 必要な証跡が `commands.stdout.log` や diff に無い | 1 状態 |
+  | `stale_evidence` | 証跡はあるが、判定対象（`state_ref`）より古い | 1 状態 |
+  | `overlapping_anchors` | 2つの段階のアンカーのどちらにも当てはまる | 3 契約 |
+  | `out_of_scope` | 観点がこのタスクに当てはまらない | 2 選択肢 |
+  | `other` | 上のどれでもない（理由を1行書く） | — |
+
+- `uncertain_cause` は route の計算には使わない（route の規則は変えない）。retro の集計にだけ使う。
+- 任意項目の追加なので `rubric_version` は上げない。
```

```json
{ "criterion": "dod-items-verified-with-evidence", "score": 2, "max": 3,
  "uncertain": true, "uncertain_cause": "missing_evidence",
  "evidence_ref": "commands.stdout.log:L120-L134" }
```

### 提案 H: shadow を外す前の準備（観測期間の凍結・キルスイッチ・フォールバックの観測）

#### diff 4: `.claude/rules/harness-retro.md`（提案8 の後に追記）

```diff
--- a/.claude/rules/harness-retro.md
+++ b/.claude/rules/harness-retro.md
@@ 提案8 チェック項目の後 @@
 6. **route と verdict の一致率**（`route_mode: shadow` の期間）: `route` が `auto` なのに REQUEST_CHANGES、
    または `human` なのに APPROVE になったレコードを数え、理由を確認する。
+
+## 提案9: 自動化を広げる前の準備（観測期間・停止・フォールバック）
+
+> **起源**: 提案 `harness-proposals/2026-09-29-jev-field-guide-deltas.md`（提案 H）
+
+### 観測期間の凍結（MUST）
+
+- `route_mode: shadow` の観測期間（P-2: 最低20件かつ retro 2回分）の間は、`rubric_version` とアンカー定義を変えない。
+  変えた場合は、その時点から件数を数え直す。
+- 観測期間の終わりに入れる修正は**1つだけ**にし、「何を変えると、どの指標がどちらに動くはずか」を1行の仮説で書く。
+  修正後は、同じ `state_ref` の過去レコードで判定を再生して（提案8）、狙った指標だけが動いたことを確認する。
+
+### 止め方を先に決める（MUST・shadow を外す提案の前提条件）
+
+- `route_mode` は `shadow` / `active` / `off` の3値とし、`off` は「route を使った自動処理を止め、記録は続ける」を意味する。
+- `active` にする提案には、`off` に戻す条件（例: `route=auto` の後に REQUEST_CHANGES 相当の不具合が見つかった）と、
+  戻す操作をする人を書く。コードや rubric の変更なしで戻せることを確認してから `active` にする。
+
+### フォールバックも同じ指標で見る（SHOULD）
+
+7. **フォールバック後の結果**: advisor-request / `escalated` / `route=human` に回ったタスクについても、
+   最終的な verdict・かかった試行回数・人間の対応時間を、主経路と同じ表で集計する。
+   フォールバックの結果が見えないと、最初の段の失敗が後ろの高コストな段に隠れる。
+8. **人間レビューの処理量**: `route=human` の件数が retro 間で増え続け、人間の処理が追いつかない場合は、
+   閾値を下げて件数を減らすのではなく、自動化の範囲を狭める。
```

### 提案 A 補足（グローバル反映分）: `retries.log` の列

#### diff 5: `C:\Users\hiroshi_takizawa\CLAUDE.md`（参考・人間が反映）

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ §7 ログ保存先の表 @@
-| `retries.log` | エラー復旧記録（最後の失敗コマンド／エラー／修正3行／前回から新しくなったもの × 試行回数） |
+| `retries.log` | エラー復旧記録（種別 `transport`/`workflow`／最後の失敗コマンド／エラー／修正3行／前回から新しくなったもの × 試行回数） |
```

### 提案 I（参考・diff なし）: mode ごとの経路契約

ガイド §V-H は「経路を選ぶとは、モデル名ではなく契約を選ぶこと」と言う。本ハーネスでは mode（solo / codex / breezing）が経路にあたるが、各 mode の制約は Worker エージェント定義・`skills/harness-work/SKILL.md`・`scripts/codex-loop.sh` に散っている。次の表を1か所（例: `.claude/rules/mode-contracts.md`）にまとめると、mode を追加・変更したときの抜けを防げる。

| 項目 | solo | codex | breezing |
|---|---|---|---|
| 実装手段 | Write / Edit / Bash | `scripts/codex-companion.sh` のみ | Write / Edit / Bash |
| commit 先 | main 可 | （Worker 定義に準拠） | feature branch 必須 |
| Plans.md cc:* 更新 | APPROVE 時のみ可 | 既存契約 | 不可（NG-1） |
| `workflow` リトライ上限 | 3 | 3 | 3 |
| `transport` リトライ上限 | 未定（要決定） | 未定 | 未定 |
| フォールバック | escalated / advisor-request | 同左 | 同左 |

- Worker エージェント定義は本 repo の外（プラグイン側）にあるため、表の正しさは反映時に人間が確認する。本提案では diff を出さない。

## 4. 効果測定（承認後に実測）

| 指標 | 測定方法 | 期待方向 |
|---|---|---|
| 通信障害による誤エスカレーション | `escalated` / `retry-threshold` のうち、試行がすべて `transport` だったものの件数（導入前後 各20タスク） | 0 件 |
| 出典の充足率 | `task.json` の context で判断を左右する事実のうち、取得元・時点・種別が揃っている割合 | 上昇 |
| `uncertain_cause` の分布 | retro ごとの原因別件数 | 可視化（`missing_evidence` が多ければ状態、`overlapping_anchors` が多ければ rubric を直す） |
| 観測期間中の rubric 変更回数 | 観測期間中に `rubric_version` が変わった回数 | 0 回 |
| フォールバック後の結果の把握率 | advisor / escalated / `route=human` のうち、最終 verdict が記録されている割合 | 100% |

- 効果が確認できない提案は、その時点で撤回してよい（各提案は独立）。

## 5. 未解決の論点（人間の決定待ち）

| # | 論点 | 既定案（決めなければこれで進める） | 他の選択肢 |
|---|---|---|---|
| Q-1 | `transport` リトライの上限 | **3回・指数 backoff**。超えたら `escalated` | 上限を mode ごとに変える（提案 I で決める） |
| Q-2 | 出典（提案 F）を MUST にするか | **SHOULD**（書式が定着するまで） | 最初から MUST |
| Q-3 | `route_mode` に `off` を足すか | **足す**（3値にする） | `shadow` に戻すことで代用する（記録の意味が混ざる） |
| Q-4 | 提案 I を別 rule ファイルにするか | **保留**（Worker 定義の所在を人間が確認してから） | 本提案に含めて新設 |

## 付録 A: 本提案で採らないもの

- **Jev（TypeSafe）そのものの導入**: テキストの状態しか受け付けず、得意な言語は英語とガイド自身が書いている（§X-F）。日本語の業務にそのまま使う根拠が無い。
- **速度・コストの数値**（まとめて聞くと約10倍など、§VIII-A）: ガイド自身が「例であって一般的なベンチマークではない」としている。
- **キャッシュキーの規則**（§VIII-C）: 本ハーネスには判定結果のキャッシュが無いので対象外。キャッシュを入れるときに、状態・rubric_version・判定器モデルをすべてキーに含める原則として参照する。
- **プロバイダアダプタの契約**（§IX-H）: 途中で切れた応答を成功扱いしない、という原則は `scripts/codex-companion.sh` の出力処理に当てはまりうるが、実装を確認していないため本提案では扱わない。

## 付録 B: 根拠と関連

- 根拠資料: 上記ガイド §III-E・H（状態の版と出典）、§IV-G（質問の品質測定）、§V-H（経路の契約）、§VII-F・H（迷いの原因・フォールバックの観測）、§VIII-I（リトライの種別）、§X-G・I・J（ロールバック・レビュー経路の保護・運用の担当）、§XI-C（最初の1週間）
- 関連ルール: [`decision-boundaries.md`](../.claude/rules/decision-boundaries.md) / [`judge-rubric.md`](../.claude/rules/judge-rubric.md) / [`harness-retro.md`](../.claude/rules/harness-retro.md) / [`secret-isolation.md`](../.claude/rules/secret-isolation.md)
- 関連提案: [`2026-09-28-typed-decision-receipts.md`](2026-09-28-typed-decision-receipts.md)（本提案の前提）
