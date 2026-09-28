# Harness 改善提案: 判断・権限・証拠の分離 —「判定を判断レシートとして残す」

- **日付**: 2026-09-28
- **slug**: `typed-decision-receipts`
- **起案**: Claude Code (Worker)
- **ステータス**: **2026-09-28 人間承認済み** — 提案 A〜D すべて承認。§5 の論点 P-1〜P-4 は既定案で確定。
  - 反映済み（Claude）: A → [`.claude/rules/judge-rubric.md`](../.claude/rules/judge-rubric.md)「判断レシート」、B → [`.claude/rules/harness-retro.md`](../.claude/rules/harness-retro.md) 提案8、C・D → [`.claude/rules/decision-boundaries.md`](../.claude/rules/decision-boundaries.md)（新設）
  - 人間が反映: diff 4（グローバル CLAUDE.md §7）
  - 旧ステータス: 人間承認待ち（DRAFT）[更新: 2026-09-28]
- **根拠資料**: *Jev Engineering for Production Agents — A Practical Handbook on Typed Semantic Decisions*（2026-09, Independent study edition）
  - 入手元: ユーザー共有の Google Drive PDF（https://drive.google.com/file/d/1V8jNU28GRveLAXByn5bkNRhffC54DkiX/view）、全12ページ
  - 元記事: Rari, "Jev Engineering: Stop Using LLMs for Every Decision", X Article, 2026-09-21
  - 本文は第三者の著作物のため repo には保存しない。以下で引く章番号（§I〜§XI）はハンドブックの章番号

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。対象は **`review.json` の記録項目・retro の診断手順・リトライと判断境界のルール**のみ。
>
> ⚠️ **提案の性質**: 根拠資料は査読論文ではなく、特定ベンダー（TypeSafe AI の判断モデル「Jev」）を前提にした実務ハンドブックで、非公式・未承認と明記されている。レイテンシ・コストの数値はベンダーの公称値で、**本提案は採用しない**。Jev 自体の導入も提案しない。採るのは製品に依存しない**設計原則**（判断・権限・証拠を分けること、判断レシート、診断の順序、リトライで新しい情報を得ること）だけ。

## TL;DR（3行要約）

- **主張**: エージェントの中の「判断」（ルーティング・採点・はい/いいえ・停止）は、生成とも厳密なルールとも別の部品として扱い、**判断の根拠になった状態・分布・閾値・経路をレシートとして残す**べき。誤った判断の多くは、モデルではなく状態・選択肢・契約・閾値の不備から生まれる。
- **提案**: ① `review.json` を判断レシートに拡張する。経路（route）はコードがスコアから決め、当面はシャドーモードで記録だけする（A）② retro の不具合診断を「状態 → 選択肢 → 契約 → 閾値 → ツールセット → モデル」の順に固定し、インシデントを回帰フィクスチャにする（B）③ リトライのたびに新しい証拠か方針の変更を必須にする（C）④ 判断と権限の境界テストと逃げ道（stop / escalate）を明文化する（D）。
- **効果**: いずれも**ルール文書と `review.json` の項目追加だけで実装できる**。新しい基盤もモデル変更も要らない。既存の [`judge-rubric.md`](../.claude/rules/judge-rubric.md)・[`harness-retro.md`](../.claude/rules/harness-retro.md) 提案4・[`secret-isolation.md`](../.claude/rules/secret-isolation.md) と同じ方向で、それらを補う。

### 承認で決まること（決裁事項）

- ✅ 提案 A〜D を §3 の diff どおりに反映してよい（`.claude/rules/judge-rubric.md` への追記、`.claude/rules/harness-retro.md` への追記、`.claude/rules/decision-boundaries.md` の新規作成）
- ✅ `review.json` に `state_ref`・`route`・`route_mode` を追加する（review.v1 に任意項目として追加。`rubric_version` は上げない — rubric のアンカーは変えないため）
- ❌ グローバル `C:\Users\hiroshi_takizawa\CLAUDE.md` は本 repo の管理外。diff 4 は**人間が手で反映**する
- ❌ route による自動 APPROVE の有効化は本提案の対象外（シャドーモードでの記録だけ。有効化は §4 の実測を見てから別の提案で決める）
- ❌ Jev（TypeSafe AI）など外部の判断モデルの導入は対象外

**却下・保留する場合**: 提案単位で可（A〜D は互いに独立。ただし B のインシデント再生は A の `state_ref` がある方がやりやすい）。

---

## 1. 背景: 資料の要点と本ハーネスとの対応

ハンドブックは、エージェントの仕事の担当を3つに分ける。**生成LLM**（新しい成果物を作る）、**判断**（答えの形は決まっているが意味が曖昧なもの）、**コード**（厳密なルールと外部への権限）。

| 資料の原則 | 章 | 本ハーネスの現状 | ギャップ |
|---|---|---|---|
| 判断ごとに、契約の版・状態の参照・分布全体・閾値・経路・結果をレシートに残す | §III-D, §VI-D | `review.json` に `rubric_version`・観点別 `scores`・`uncertain`・`evidence_ref` がある | **何を判定したか（状態の参照）と、判定後にどこへ回したか（route）が残らない**。インシデント時に再生できない |
| 確信度は3つの経路に分ける（自動 / 状態を改善 / 人間）。閾値は影響の重さごとに決める | §V-A〜C | verdict は APPROVE / REQUEST_CHANGES の2値 | 「追加検証すれば通りそう」と「人間が見るべき」が区別されない |
| 自動化はシャドーモードで比較してから、最も安全な分岐1つずつ | §IX-D, F | 該当なし | 導入手順がない |
| 誤判断では、まず状態・選択肢・指示・閾値を疑い、モデル能力は最後 | §X-I, M | 提案4（ツールセットを先に）、提案7（rubric を先に） | 診断の**順序**としては固定されていない |
| インシデントの状態を恒久的な回帰フィクスチャにする | §X-O | `harness-logs/` に生ログはある | 回帰に使う運用がない |
| 同じ証拠でのリトライは何も学ばない。リトライのたびに証拠を足すか、契約を変えるか、選択肢を絞るか、エスカレーションする | §V-B, §X-E | Worker の「同じ原因の自動修正は最大3回」「2回連続で advisor」 | 回数の上限はあるが、**各回で何が新しくなったか**を問わない |
| 選択肢には逃げ道（none / stop / escalate）を入れる。stop は失敗ではなく正式な結果 | §II-A, §VIII-G | Worker には `escalated` がある | 判定側（Reviewer / Lead）には明文化されていない |
| 確信度は許可ではない。判断 → コードのポリシー確認 → 実行 → 記録 | §I-E, §VII-B | DI-MCP の `needs_confirmation`、本番デプロイ禁止、NG-1〜3 | **ギャップなし**（今の設計を裏付けるだけ。diff 不要） |
| 状態パケットは最小権限（秘密・個人情報を入れない） | §IV-C | `secret-isolation.md` ルール4・5 | **ギャップなし**（diff 不要） |

**含意**: 本ハーネスは既に「判定と権限の分離」と「生ログの逐語保存」を持っている。足りないのは、**判定を後から再生・比較できる形で残すこと**（A）と、**不具合を正しい層に割り当てる手順**（B・C）。

## 2. 現行運用の不足点

### 2.1 `review.json` から判定を再生できない
`rubric_version` と観点別スコアはあるが、どのコミット・diff を判定したかが必須になっていない。判定の後に「差し戻し」「追加検証」「人間」のどれに回したかも残らない。そのため、APPROVE 後に不具合が出ても「判定器が見落とした」のか「判定対象が違った」のか区別できない（§III-G）。

### 2.2 verdict が2値なので、中間の経路がない
スコアが境界にある、または `uncertain: true` の観点があるとき、Lead は APPROVE か REQUEST_CHANGES に丸めるしかない。ハンドブックの言う「状態を改善する経路」（追加の検証コマンドを実行する、Worker に具体的な証拠を求める）がない（§V-B）。

### 2.3 retro の不具合の割り当て先が揺れる
提案4（ツールセット優先）と提案7（rubric 優先）はそれぞれ「モデルより先に X を疑え」と言うが、状態（Worker に渡した task / context）と選択肢（`files` の範囲、許可ツール）を先に見る手順はない。その結果、プロンプトを長くする・モデルを強くする方向に流れやすい（§X-I）。

### 2.4 リトライの「中身」を問わない
「最大3回」は回数の上限でしかない。同じ仮説・同じ証拠のまま3回繰り返しても規則上は正しい。`retries.log` の「試した修正の要約」にも、前回から何が新しくなったかの欄がない（§X-E）。

## 3. 提案と diff

### 提案 A: `review.json` を判断レシートに拡張（シャドーモード）

- `state_ref`: 判定対象の特定（task_id・commit・diff の hash）
- `route`: スコアから**コードが決める**経路（`auto` / `recheck` / `human`）。LLM 判定器の自己申告の確信度は使わない（`judge-rubric.md` ルール4「自己申告は証拠にしない」と整合）
- `route_mode: "shadow"`: 当面は記録だけ。実際の経路（`verdict`）は今までどおり Lead が決める

#### diff 1: `.claude/rules/judge-rubric.md`

```diff
--- a/.claude/rules/judge-rubric.md
+++ b/.claude/rules/judge-rubric.md
@@ -43,15 +43,45 @@
 ## review.json の必須フィールド（review.v1 追加分）
 
 ```json
 {
   "rubric_version": "judge-rubric.v1",
   "verdict": "APPROVE | REQUEST_CHANGES",
   "scores": [
     { "criterion": "dod-items-verified-with-evidence", "score": 2, "max": 3,
       "uncertain": false, "evidence_ref": "commands.stdout.log:L120-L134" }
   ],
-  "judge": { "model": "<model-id>", "temperature": 0 }
+  "judge": { "model": "<model-id>", "temperature": 0 },
+  "state_ref": { "task_id": "43.3.1", "commit": "<sha>", "diff_sha256": "<git diff の hash>" },
+  "route": "auto | recheck | human",
+  "route_mode": "shadow"
 }
 ```
 
+## 判断レシート（review.v1 追加分・任意項目）
+
+> **起源**: 提案 `harness-proposals/2026-09-28-typed-decision-receipts.md`（提案 A）
+
+`review.json` は、後から判定を**再生**できる判断レシートとして書く。
+
+- **`state_ref`**: 何を判定したか。task_id・判定時点の commit・`git diff` の hash を残す。
+  インシデント時に同じ入力で判定を再実行し、判定器の問題か入力の問題かを切り分けるために使う。
+- **`route`**: 判定の後の経路。**判定器（LLM）が選ぶのではなく、`scores` から次の規則でコードが決める**。
+
+  | 条件（上から順に評価） | route |
+  |---|---|
+  | score が 0 の観点がある、または `plans-cc-markers-untouched` が満点でない | `human` |
+  | `uncertain: true` の観点がある、または `evidence_ref` が空の観点がある | `recheck` |
+  | 全観点が満点 | `auto` |
+  | それ以外 | `recheck` |
+
+  - `recheck` の中身は「追加の検証コマンドを実行する」「Worker に特定の証拠を求める」のどれかに限る。
+    同じ入力で判定器にもう一度聞くのは `recheck` ではない（新しい情報が増えないため）。
+- **`route_mode`**: `shadow` のあいだ、`route` は記録専用。実際の判定（`verdict`）は今までどおり Lead が決める。
+  `shadow` を外して `route` に従わせるかどうかは、retro の実測（`route` と `verdict` の一致率）を見て別の提案で決める。
+- 自己申告の確信度（「自信あり」「おそらく」など）は `route` の入力にしない（ルール4）。
+- 本節は rubric のアンカーを変えないので `rubric_version` は上げない。
+
 ## 一致度の確認（`.claude/rules/harness-retro.md` 提案7）
```

### 提案 B: retro の診断順序とインシデントの回帰フィクスチャ化

#### diff 2: `.claude/rules/harness-retro.md`（末尾に追記）

```diff
--- a/.claude/rules/harness-retro.md
+++ b/.claude/rules/harness-retro.md
@@ -90,3 +90,33 @@
 ### 判断（追記）
 
 - 4 が閾値を下回ったら、判定器モデルを強化する前に、まず rubric のアンカー定義とツールセット（提案4）を見直す。
+
+## 提案8: 不具合の診断順序とインシデントの回帰フィクスチャ化
+
+> **起源**: 提案 `harness-proposals/2026-09-28-typed-decision-receipts.md`（提案 B）
+
+誤判定・誤実装が起きたら、目に見える最後の失敗ではなく、**最初に間違った境界**を探す。
+モデルの能力を疑うのは最後にする。プロンプトを長くする・モデルを強くする・呼び出しを増やす対処は、
+間違った境界を残したままコストだけを増やす。
+
+### 診断順序（上から順に確認し、最初に該当した層を原因とする）
+
+| # | 層 | 確認すること | 証跡 |
+|---|---|---|---|
+| 1 | 状態 | Worker / 判定器に渡した task・context・files に、必要な証拠があったか。結論（「おそらく十分」）が証拠のふりをして入っていなかったか | `task.json` |
+| 2 | 選択肢 | 取りうる行動（`files` の範囲・許可ツール・`escalated` / stop）が揃っていたか。古くなっていなかったか | `task.json`, `worker-report.json` |
+| 3 | 契約 | DoD・rubric のアンカーが、正解と不正解を区別できる書き方だったか | sprint-contract, `judge-rubric.md` |
+| 4 | 閾値・経路 | スコアから経路への対応（`route`）は正しかったか | `review.json` |
+| 5 | ツールセット | 提案4 | — |
+| 6 | モデル | 1〜5 がすべて正しいときだけ | — |
+
+### インシデントの回帰フィクスチャ化
+
+- APPROVE 後に不具合が見つかったタスクは、`harness-logs/.../<task_id>/` を**そのまま**回帰フィクスチャとして残す
+  （逐語保存。`memory-curation.md` ルール4）。対策の後は、同じ入力（`state_ref`）で判定を再生し、
+  期待する route / verdict になることを確認する。
+- 対策が無関係なケースの判定を悪化させていないかも、直近の `review.json` で確認する。
+
+### チェック項目（retro のたびに実施）
+
+6. **route と verdict の一致率**（`route_mode: shadow` の期間）: `route` が `auto` なのに REQUEST_CHANGES、
+   または `human` なのに APPROVE になったレコードを数え、理由を確認する。
```

### 提案 C・D: 判断境界のルール（新規）

- **C**: リトライのたびに新しい情報を必須にする。同じ仮説・同じ証拠のリトライは、Worker の「同じ原因の失敗が2回続いた」（`retry-threshold`）に数える
- **D**: 新しく自動化する判断の境界テスト（生成 / 判断 / コード）と逃げ道の明文化

#### diff 3（新規ファイル）

```diff
--- /dev/null
+++ b/.claude/rules/decision-boundaries.md
@@ -0,0 +1,48 @@
+# 判断境界ルール（生成・判断・権限の分離）
+
+> **適用対象**: Lead / Worker / Reviewer、および harness に新しい自動判断を足す人
+> **起源**: 提案 `harness-proposals/2026-09-28-typed-decision-receipts.md`（提案 C・D）
+> **承認**: 2026-09-28 人間承認済み（P-1〜P-4 は既定案で確定）
+
+## ルール1: リトライのたびに新しい情報を得る（MUST）
+
+同じ入力で同じことを繰り返しても、何もわからない。自動修正・再判定の各試行は、次のどれかを必ず伴う。
+
+- **証拠を足す**: 新しい検証コマンドの出力、読んでいなかったファイル、再現手順
+- **仮説を変える**: 前回と違う原因を想定して、違う修正をする
+- **範囲を絞る**: 失敗しているテスト・関数を1つに限定する
+- **エスカレーションする**: advisor-request / `escalated`
+
+- `retries.log` の各試行に「前回から新しくなったもの」を1行残す（上の4つのどれか）。
+- どれも伴わない試行は、同じ原因の失敗として数える（Worker の `retry-threshold` 判定に使う）。
+
+## ルール2: 新しく自動化する判断は、3つの問いで分ける（SHOULD）
+
+harness に新しい自動判断（ルーティング・採点・可否判定など）を足すときは、分岐ごとに次を問う。
+
+| 問い | yes のとき |
+|---|---|
+| 出力そのものを新しく作る必要があるか | 生成（LLM）に任せる |
+| 意味は曖昧だが、答えの形（選択肢・段階・はい/いいえ）は決まっているか | 判断（LLM 判定器 / 分類）に任せる |
+| 条件を厳密に守らせる必要があるか（回数・日付・金額・許可リスト・文字列一致） | コードで書く。LLM に判断させない |
+
+- 3つとも当てはまりそうな分岐は、生成 → 判断 → コードの確認 の段に分ける。
+- 判断の結果は**権限ではない**。外部への副作用（公開・購入・削除・権限変更・送信・DB 書き込み）の可否は、
+  判断の後にコードと人間の承認で決める（DI-MCP の `needs_confirmation`、本番デプロイ禁止と同じ考え方）。
+
+## ルール3: 選択肢には逃げ道を入れる（MUST）
+
+- 判定器に選択肢から1つを選ばせるときは、`none`（どれも当てはまらない）、`stop`（完了・安全な行動がない）、
+  `escalate`（人間へ）のうち、起こりうるものを必ず選択肢に入れる。
+  逃げ道が無いと、全部が不正解でも「いちばんましな不正解」が高い確信度で選ばれる。
+- stop / escalate は失敗ではなく、正式な結果として記録する。
+
+## ルール4: 段階評価の書き方（SHOULD）
+
+- 段階は3〜5段階。段階が多いほど、見かけの精度は上がるが評価者間の一致は下がる。
+- 段階は数値ではなく、観測できる証拠の違いで書く（`judge-rubric.md` ルール1と同じ）。
+- スコアの中間値（例: 1.6）は「2つの段階の間」という意味で、比率や割合として読まない。
+
+## ルール5: 判断の入力は証拠にする（SHOULD）
+
+- 判定器・Worker に渡す context には、結論（「たぶん十分」「問題なさそう」）ではなく、
+  観測できる事実（件数・検証済みかどうか・未解決の項目）を書く。前の段の結論を、そのまま次の段の事実にしない。
```

### 提案 A（グローバル反映分）: `review.json` と `retries.log` の説明

グローバル `C:\Users\hiroshi_takizawa\CLAUDE.md` §7 は本 repo の管理外。承認後に**人間が手で反映**する。

#### diff 4: `C:\Users\hiroshi_takizawa\CLAUDE.md`（参考・人間が反映）

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ §7 ログ保存先の表 @@
-| `review.json` | Reviewer / Lead の判定（APPROVE / REQUEST_CHANGES と理由） |
+| `review.json` | Reviewer / Lead の判定（APPROVE / REQUEST_CHANGES と理由）。判定対象（`state_ref`）とスコアから決めた経路（`route`）を判断レシートとして残す（`.claude/rules/judge-rubric.md`） |
 | `commands.stdout.log` | 検証コマンドの生出力全文 |
-| `retries.log` | エラー復旧記録（最後の失敗コマンド／エラー／修正3行 × 試行回数） |
+| `retries.log` | エラー復旧記録（最後の失敗コマンド／エラー／修正3行／前回から新しくなったもの × 試行回数） |
```

> 注: グローバル CLAUDE.md の §7 には既に別提案の diff（`2026-09-24-eval-awareness-judge-rubric.md` の diff 3）が人間による反映待ちで出ている。行番号がずれるため、ここではセクション名で位置を示した。

## 4. 効果測定（承認後に実測）

| 指標 | 測定方法 | 期待方向 |
|---|---|---|
| `state_ref` の充足率 | `review.json` のうち `state_ref.commit` が実在するコミットを指す割合 | 100% |
| route と verdict の一致率（シャドー） | `route_mode: shadow` の期間、`route=auto` かつ APPROVE／`route=human` かつ REQUEST_CHANGES の割合（最低20件） | 可視化。一致率が高く、不一致に説明がつくなら `shadow` を外す別提案の根拠になる |
| 診断の割り当て先 | retro で扱った不具合が、診断順序のどの層に割り当てられたかの分布 | 可視化（「モデル」への割り当てが減り、状態・契約への割り当てが増えるのが期待） |
| 情報を伴わないリトライの割合 | `retries.log` の各試行のうち「新しくなったもの」が空の割合 | 低下（目標 0%） |
| エスカレーションまでの試行回数 | `escalated` / `retry-threshold` になったタスクの平均試行回数（導入前後 各20タスク） | 低下（無駄なリトライを早く止められる） |

- 効果が確認できない提案は、その時点で止めて撤回してよい（各提案は独立）。

## 5. 論点の決定（2026-09-28 人間決定済み — 全て既定案で確定）

| # | 論点 | 既定案（決めなければこれで進める） | 他の選択肢 |
|---|---|---|---|
| P-1 | verdict に3つ目の値（`ESCALATE`）を足すか | **足さない**。人間に回すべきかは `route: human` で表現し、verdict は2値のまま | verdict に `ESCALATE` を足す（`rubric_version` と review のスキーマの版上げが要る） |
| P-2 | シャドーモードを外す条件 | **最低20件、かつ retro 2回分の実測を見てから**別提案で決める | 件数だけで決める／外さない |
| P-3 | `state_ref` の中身 | **task_id・commit・`git diff` の SHA-256** | commit だけ（簡単だが、未コミットの diff を判定した場合に再生できない） |
| P-4 | 情報を伴わないリトライを `retry-threshold` に数えるか | **数える**（ルール1） | 記録だけして数えない |

## 付録 A: 本提案で diff を出さない項目（既に満たしている）

- **判断は権限ではない**（§I-E, §VII-B）: DI-MCP の `needs_confirmation` / `confirm_token`、本番デプロイ禁止、Worker の NG-1〜3 で既に満たしている。decision-boundaries.md ルール2 はこれを言葉にしただけで、運用は変えない。
- **状態パケットの最小権限**（§IV-C）: `secret-isolation.md` ルール4・5 で既に満たしている。

## 付録 B: 本 repo の対象外だが応用できる先（参考）

ハーネスではなく業務プロダクト側の話なので、本提案の diff には含めない。着手するなら各案件で別に計画する。

| 対象 | 使い方 | 最初の一歩 |
|---|---|---|
| タスクマーケット | タスクの振り分けを「選択肢から1つ＋`none`」の判断にする | 今の振り分け結果と並べてシャドーモードで記録 |
| ナレッジAIサーチ | 検索結果の関連度を言葉で定義した段階評価にする | 上位 N 件の関連度をレシートとして記録 |
| AIマネージャー | エスカレーションの要否を「はい/いいえ」の判断にし、閾値は影響の重さごとに分ける | 影響の重さの区分を先に定義 |
| ヨシケイ CRレポート | 媒体データの分類・異常値判定 | クライアントデータを外部 API に送らない前提（`secret-isolation.md` ルール2・4）を先に確認 |

## 付録 C: 根拠と関連

- 根拠資料: 上記ハンドブック §I（担当の分け方）、§II（選択肢・段階評価・はい/いいえ、逃げ道）、§III（判断契約と判断レシート）、§IV（証拠と結論の区別）、§V（3つの経路・閾値の管理）、§IX（シャドーモード）、§X（失敗の分類と診断順序、インシデントの回帰フィクスチャ化）
- 関連ルール: [`judge-rubric.md`](../.claude/rules/judge-rubric.md)（ルール1・4 — 全段階アンカー、自己申告を証拠にしない）/ [`harness-retro.md`](../.claude/rules/harness-retro.md)（提案4・7 — モデルより先にツールセットと rubric を見直す）/ [`secret-isolation.md`](../.claude/rules/secret-isolation.md)（最小権限）/ [`memory-curation.md`](../.claude/rules/memory-curation.md)（生ログの逐語保存 — 回帰フィクスチャの前提）
- 関連提案: [`2026-09-24-eval-awareness-judge-rubric.md`](2026-09-24-eval-awareness-judge-rubric.md)（`review.json` の観点別スコア — 本提案 A はその上に経路と判定対象を足す）
