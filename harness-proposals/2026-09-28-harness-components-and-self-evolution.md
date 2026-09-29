# Harness 改善提案: ハーネス部品の条件付き選択と、自己改善ループの評価の分離

- **日付**: 2026-09-28
- **slug**: `harness-components-and-self-evolution`
- **起案**: Claude Code (Worker)
- **ステータス**: **2026-09-29 人間承認済み** — 提案 A〜E すべて承認。§5 の論点 P-1〜P-4 は既定案で確定。
  - 反映済み（Claude）: A・C・E → [`.claude/rules/harness-components.md`](../.claude/rules/harness-components.md)（新設）、B → [`.claude/rules/decision-boundaries.md`](../.claude/rules/decision-boundaries.md) ルール1「機械的な検出」、D → [`.claude/rules/harness-retro.md`](../.claude/rules/harness-retro.md) 提案11
  - 人間が反映: diff 4（グローバル CLAUDE.md §7）、diff 5（本 repo 以外の各案件の settings.json の hook。本 repo は反映済み）、diff 6（plugin 側 Worker 定義）
  - hook スクリプト `identical-call-guard.sh` の実装は別タスク（未着手）→ [更新: 2026-09-29] 実装済み（§3 diff 5 の注記）。本 repo の settings.json への登録も人間の指示で Claude が反映済み
  - 旧ステータス: 人間承認待ち（DRAFT）[更新: 2026-09-29]
- **根拠論文**:
  1. *An Empirical Study of Harness Design for Coding Agents* — Fan, Zhang, Ma ほか（UMass Amherst / Emory / UNC Charlotte / Zoom）— arXiv:2609.20804v1 [cs.AI], 2026-09-17（以下「論文1」）
  2. *StudyBench: Can Self-Evolution Squeeze Textbooks for Olympiad Capability?* — Chen, Chen, He ほか（清華大学 / 浙江大学）— arXiv:2609.00787v2 [cs.AI], 2026-09-07（以下「論文2」）。コード: https://github.com/thunlp/StudyBench
  - 論文1は arXiv 非独占ライセンス、論文2は CC BY 4.0。本文は repo に保存しない（URL と節番号で引く）

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。対象は **Worker の構成（ツールセット・計画・コンテキスト管理）の記録と選び方、リトライの機械的な検出、retro の改善案の評価方法**のみ。
>
> ⚠️ **提案の性質**: 論文1はオープンウェイトモデル（Nemotron-3 30B/120B/550B、Mistral-Medium-3.5）での実験で、Claude 系モデルでの数値は測られていない。**数値は移植せず、「部品の効果はモデル・予算・タスクの種類で変わる」という構造と、測り方を採る**。論文2は物理の自己進化手法の評価だが、Opus 4.7 + Claude Code を被験モデルに含むため、本ハーネスの自己改善ループ（harness-retro）に近い条件の実測として扱う。

## TL;DR（3行要約）

- **主張**: ① ハーネスの部品（ツールセット・計画・コンテキスト管理）は、どれも「入れれば良い」ものではない。モデルの強さ・コンテキスト予算・タスクの種類によって、精度の支えにもコスト削減にも逆効果にもなる（論文1）。② 自己改善ループの改善は「元にしたのと同種の問題」にとどまりやすく、序盤で頭打ちになる。同じ知識を推論時に手引きとして渡す方がずっと効く（論文2）。
- **提案**: ① Worker の構成を `task.json` に記録し、部品は1つずつ、同じタスク群で対応のある比較をしてから替える（A）② 同じツール呼び出しの連続をコードで検出し、ルール1を機械的に守らせる（B）③ 計画とコンテキスト管理の既定値をモデルの強さで分ける（C）④ retro の改善案を「元ログと同種」と「未知の種類」の2つの評価集合で測り、回帰フィクスチャを改善案の作成側から隠す（D）⑤ 改善を「覚えさせる」より「該当箇所を context に入れる」方を優先する（E）。
- **効果**: A・C・D・E は**ルール文書と `task.json` の項目追加だけ**で実装できる。B は hook の追加が要るため、settings.json の変更は人間が反映する。

### 承認で決まること（決裁事項）

- ✅ 提案 A・C・E を §3 の diff 1 どおり `.claude/rules/harness-components.md`（新規）として反映してよい
- ✅ 提案 B を §3 の diff 2 どおり `.claude/rules/decision-boundaries.md` ルール1に追記してよい
- ✅ 提案 D を §3 の diff 3 どおり `.claude/rules/harness-retro.md` に提案11として追記してよい
- ✅ `task.json` に `harness_config`（モデル・ツールセット・計画・コンテキスト方針）を任意項目として追加する
- ❌ グローバル `C:\Users\hiroshi_takizawa\CLAUDE.md` は本 repo の管理外。diff 4 は**人間が手で反映**する
- ❌ `.claude/settings.json` への hook 追加（diff 5）と plugin 側 Worker 定義の変更（diff 6）は**人間が反映**する（本 repo に settings.json・agent 定義が無く、hook の追加は実行権限に関わるため）
- ❌ Worker を bash だけの構成に切り替えることは、本提案の対象外（A の比較で効果が確かめられてから、別の提案で決める）

**却下・保留する場合**: 提案単位で可（A〜E は互いに独立。ただし C の既定値を見直すには A の `harness_config` の記録がある方がよい）。

---

## 1. 背景: 論文の要点と本ハーネスとの対応

### 1.1 論文1: 部品ごとの効果は条件付き

実行ループを固定し、計画・行動空間（ツールセット）・コンテキスト管理の3部品だけを替えて、176設定を比べた（SWE-Bench Verified / Terminal-Bench 2.1）。成功率の差は、同じタスクでの対応のある検定（McNemar の正確検定＋Benjamini–Hochberg 補正）で判定している（§3.1）。

| 論文の知見 | 根拠（論文1の表・節） | 本ハーネスの現状 | ギャップ |
|---|---|---|---|
| ツールセットの最適はモデルで逆転する。bash が得意なモデルは bash だけの方が安くて同等以上、苦手なモデルは専用ツールがないと大きく落ちる | 表3: Nemotron-550B は bash だけで 69.4%（専用ツール 65.8%）、コスト $1.11（$2.33）。Mistral は 68.6% → 45.4%、Nemotron-30B は 25.2% → 10.2% | 提案4「ツールセットを第一級のレバーに」 | **どのモデルでどの構成が良いかを測る手順と、構成の記録がない** |
| 計画は、弱いモデルには精度の支え、強いモデルにはコスト削減（精度はわずかに下がる） | 表3: Nemotron-30B は計画なしで 25.2% → 13.6%。強いモデルでは、計画によって編集後の確認が減る（§4） | Plans.md・TodoWrite はモデルに関係なく同じ運用 | **モデルの強さによる使い分けがない** |
| コンテキスト管理の効果の大半は「溢れて途中終了する」のを防ぐこと。予算が小さいほど効く | 表3: 32k で管理なしだと Nemotron-550B は 6.4%、T4 だと 55.6%。128k では差が小さい | Claude Code 本体の auto-compact に任せている | ギャップ小（下の2点を明文化する） |
| ルールによる省略を先に、LLM 要約を後にする（T4）のがコスト最安 | 図4・図5: 8パネル中7つで最安 | — | 明文化だけ |
| 省略した内容を読み戻す仕組み（`recall_event`）はほとんど使われず、精度も上がらない | T2 と T1 の比較は 15勝14敗3分。64設定中36設定で一度も呼ばれない（§3.2, 表13） | — | **実行中のコンテキストに凝った読み戻し機構を作らない**、と明文化する |
| 同じ呼び出しが5回続いたら1回だけ注意、同じ失敗が8回続いたら終了 | §2.4, §3.1 | decision-boundaries.md ルール1（リトライのたびに新しい情報を得る） | **ルール1の遵守を Worker の自己申告に任せている**。コードで検出していない |
| 編集のたびに ruff などの診断をツール結果に付ける | §2.4 | なし | 案件側の hook の話なので、付録 B で扱う |

### 1.2 論文2: 自己改善は「似た問題」にとどまり、早く頭打ちになる

教科書11冊を学習素材にして、「同じ教科書の章末問題（Application Set）」と「教科書より難しい五輪問題（Transfer Set）」で自己進化手法を測った。Transfer Set は「教科書の該当箇所を手引きとして渡せば解ける」ことを確かめた問題だけにしてある（到達可能性の保証、§2.1）。

| 論文の知見 | 根拠（論文2の表・節） | 本ハーネスへの読み替え |
|---|---|---|
| 同種の問題での伸びは、難しい問題に移らない | 表2: Qwen3-8B で GEPA は Application を 17.05% → 34.85% に伸ばしたが、Transfer は 7.04% | retro の改善案は、元にしたログと**同種のタスク**でしか効かないことがある。同種のタスクだけで効果を測ると、効果を過大評価する |
| 推論時に手引きを渡すと、ほとんどの問題が解ける（Guidance Gap） | 表4: 学習後のモデルでも、手引きを渡すと Transfer は 88.9〜90.0%（手引きなしは 3〜7%） | 知識を「覚えさせる」より、タスクごとに**該当箇所を context に入れる**方がずっと効く |
| **Opus 4.7 + Claude Code でも同じ傾向**。手引き書の蒸留（ACE）は Transfer を下げた | 表3: Transfer は素のまま 40.00%、ACE 33.33%、GEPA 41.11%、EvoSkill 43.33%、手引きを渡すと 63.33% | 本ハーネスの skills（手順の蒸留）を増やしても、未知のタスクには効かない、または悪化しうる。蒸留層を増やすより、**必要な箇所を検索して渡す**方を優先する |
| どの手法も序盤で伸びが止まり、長く回しても伸びない（Compute Plateau） | §4.2, 図2: ACE は序盤で上がり、その後は横ばい | retro を頻繁に回しても改善は続かない。横ばいになったら、回数ではなく**ループの入力と手順**を変える |
| 汚染対策: テストに使う問題と解答を、学習素材から削除する | §2.3, 付録 H | 回帰フィクスチャ（提案8）を、改善案を作る側に見せると「フィクスチャに合わせた改善」になる |
| 強化学習の報酬にはルールベースの検証器だけを使い、LLM 判定器は使わない | §2.2 | decision-boundaries.md ルール2、judge-rubric.md ルール4 と同じ考え方（diff 不要） |

**含意**: 本ハーネスには、ツールセットを見直す方針（提案4）、リトライの規律（ルール1）、回帰フィクスチャ（提案8）が既にある。足りないのは、**どの構成で何を測ったかを残すこと**（A）、**規律をコードで守らせること**（B）、**改善案を元のログから切り離した評価集合で測ること**（D）の3つ。

## 2. 現行運用の不足点

### 2.1 Worker の構成が記録されず、比べられない
`task.json` にはタスクの入力はあるが、どのモデル・ツールセット・計画の有無・コンテキスト方針で走ったかが残らない。そのため、提案4に従ってツールセットを見直しても、見直しの前後で何が変わったかを同じタスク群で比べられない。論文1が示すように、構成の良し悪しはモデルごとに逆転するので、記録がないまま全体の平均で判断すると誤る。

### 2.2 ルール1の遵守を自己申告に任せている
decision-boundaries.md ルール1は「リトライのたびに新しい情報を得る」を MUST にしている。しかし、守れたかどうかは Worker が `retries.log` に書く1行に頼っている。同じツールを同じ引数で繰り返しているかどうかは、コードで厳密に判定できる条件であり、decision-boundaries.md ルール2の「コードで書く」側に当たる。

### 2.3 計画の運用がモデルの強さに関係なく同じ
強いモデルでは、計画が編集後の確認を減らしてコストを下げる一方、精度がわずかに下がる。弱いモデルでは、計画がないと編集の前に投げ出す。Haiku 系と Opus 系の Worker で同じ運用をすると、どちらかで損をする。

### 2.4 retro の改善案を「元にしたログと同種のタスク」でしか確かめていない
提案8の回帰フィクスチャは、インシデントを起こしたタスクを再生する仕組み。これは論文2の Application Set（同種の問題）に当たり、改善が未知の種類のタスクにも効くか（Transfer）を測る集合がない。さらに、改善案を作るエージェントがフィクスチャを読めるので、フィクスチャだけに合わせた改善を見分けられない。

### 2.5 改善を「覚えさせる」方向に寄りやすい
retro の改善案は、skills やルールに手順を書き足す形（蒸留）になりやすい。論文2では、Opus 4.7 + Claude Code でも手引き書の蒸留（ACE）が未知の問題の成績を下げ、該当箇所を推論時に渡す方がずっと効いた。

## 3. 提案と diff

### 提案 A・C・E: ハーネス部品の選び方（新規ルール）

#### diff 1（新規ファイル）: `.claude/rules/harness-components.md`

```diff
--- /dev/null
+++ b/.claude/rules/harness-components.md
@@ -0,0 +1,68 @@
+# ハーネス部品の選び方（ツールセット・計画・コンテキスト管理・手引き）
+
+> **適用対象**: Lead（Worker の構成を決める人）、harness-retro を回す運用者
+> **起源**: 提案 `harness-proposals/2026-09-28-harness-components-and-self-evolution.md`（提案 A・C・E）
+> **根拠**: arXiv:2609.20804（ハーネス部品の分解実験）、arXiv:2609.00787（StudyBench）
+
+## ルール1: 構成を記録し、部品は1つずつ替える（MUST）
+
+部品の効果は、モデルの強さ・コンテキスト予算・タスクの種類で逆転する。平均では判断しない。
+
+- `task.json` に `harness_config` を残す。
+  ```json
+  "harness_config": {
+    "model": "<model-id>",
+    "toolset": "predefined | bash-only | <名前>",
+    "planning": "on | off",
+    "context_policy": "auto-compact | <名前>"
+  }
+  ```
+- 部品を替えるときは、1回に1つだけ替える。ほかの部品とモデルは固定する。
+- 替える前と後を、**同じタスク群**（最低20件）で比べる。成功・失敗の対（同じタスクの前後）で比べ、
+  件数が少ないうちは差を結論にしない。比較は成功率とコスト（トークン数）の両方で行う。
+- 比較の結果はモデルごとに記録する。あるモデルで良かった構成を、ほかのモデルの既定値にしない。
+
+## ルール2: 計画の既定値はモデルの強さで分ける（SHOULD）
+
+| Worker のモデル | 計画（Plans.md のサブタスク分解・TodoWrite） | 理由 |
+|---|---|---|
+| 弱いモデル（Haiku 系など） | **必須**。着手前に計画を作らせ、毎ターン参照させる | 計画がないと、編集の前に投げ出しやすい |
+| 強いモデル（Opus 系など） | **任意**。使う場合も、編集後の確認は `validation_commands` に限る | 計画の主な効果はコスト削減。確認の回しすぎが減る |
+
+- 既定値はルール1の比較で見直す。「強い」「弱い」の線引きは、モデル名ではなく比較の結果で決める。
+
+## ルール3: 実行中のコンテキスト管理（SHOULD）
+
+- 効果の大半は、コンテキストが溢れて途中で終わるのを防ぐこと。予算に余裕があるタスクで凝った仕組みを足さない。
+- 縮めるときは、**古いツール出力の省略を先に、LLM 要約を後に**する（要約の呼び出しが減り、安い）。
+- 省略した内容を読み戻す専用の仕組みは作らない。使われず、精度も上がらないことが実測されている。
+  必要になったら、元のファイルやコマンドをもう一度読めばよい。
+- 本ルールは**実行中のコンテキスト**の話で、保存するストア（`.claude/agent-memory/`・`harness-logs/`）には適用しない。
+  ストアは `memory-curation.md` ルール1・4（逐語保存）に従う。
+
+## ルール4: 改善は「覚えさせる」より「該当箇所を渡す」を優先する（SHOULD）
+
+- retro の改善案が「skills やルールに手順を書き足す」形になったら、先に次を検討する:
+  Lead が Worker に渡す context に、**そのタスクに関係するルール・skill・過去ログの該当箇所**を入れれば足りないか。
+- 手順の蒸留（skills の追加）は、同種のタスクでは効くが、未知の種類のタスクでは効かない、または悪化しうる。
+  蒸留を足すときは `harness-retro.md` 提案11の Transfer 集合でも確かめる。
+- 渡す該当箇所は、結論ではなく原文（逐語）にする（`decision-boundaries.md` ルール5）。
+
+## 判断
+
+- ツールセットの見直し（`harness-retro.md` 提案4）は、本ルール1の手順で行う。
+- Worker を bash だけの構成にするなど大きな構成変更は、ルール1の比較結果を添えた別の提案で決める。
```

> 注: 行数の `@@ -0,0 +1,68 @@` は目安。反映時に実ファイルの行数で書き直す。

### 提案 B: 同じ呼び出しの連続をコードで検出する

#### diff 2: `.claude/rules/decision-boundaries.md`（ルール1の末尾に追記）

```diff
--- a/.claude/rules/decision-boundaries.md
+++ b/.claude/rules/decision-boundaries.md
@@ ## ルール1: リトライのたびに新しい情報を得る（MUST） @@
 - `retries.log` の各試行に「前回から新しくなったもの」を1行残す（上の4つのどれか）。
 - どれも伴わない試行は、同じ原因の失敗として数える（Worker の `retry-threshold` 判定に使う。P-4）。
+
+### 機械的な検出（提案 `2026-09-28-harness-components-and-self-evolution.md` 提案 B）
+
+「同じツールを同じ引数で繰り返しているか」はコードで厳密に判定できるので、LLM の自己申告に頼らない（ルール2）。
+
+| 条件（連続回数） | 動作 |
+|---|---|
+| 同じツール名・同じ引数の呼び出しが **5回** 連続 | 「やり方を変える」注意を1回だけ Worker の context に入れる |
+| 同じツール名・同じ引数で**失敗した**呼び出しが **5回** 連続 | 同上 |
+| 同じツール名・同じ引数で**失敗した**呼び出しが **8回** 連続 | 実行を止め、`status: escalated`（`escalation_reason: "identical-failing-calls"`）で返す |
+
+- 回数（5 / 8）は根拠論文の設定値で、暫定。最初の 2〜3 回の retro の実測で見直す。
+- 検出は hook（PreToolUse / PostToolUse）で行う。hook の追加は人間が反映する（提案書 diff 5）。
+  hook が入るまでは、Lead が `retries.log` と生ログで同じ条件を確認する。
+- 注意の挿入や停止の回数は `retries.log` に1行残す。
```

### 提案 D: retro の改善案を、元のログから切り離した集合で測る

#### diff 3: `.claude/rules/harness-retro.md`（末尾に追記）

```diff
--- a/.claude/rules/harness-retro.md
+++ b/.claude/rules/harness-retro.md
@@ 末尾（提案10「判断」の後） @@
 - 候補カバレッジが低い（正しい候補がそもそもない）ときは、生成側を直す。診断順序の 1（状態）と 2（選択肢）から確認する。
 - 対象タスクが10件未満の retro では、率ではなく件数と個別の事例だけを記録する（率で判断しない）。
+
+## 提案11: 改善案の評価集合を分け、改善案の作成側から隠す（arXiv:2609.00787）
+
+> **起源**: 提案 `harness-proposals/2026-09-28-harness-components-and-self-evolution.md`（提案 D）
+
+実証結果: 自己改善で伸びるのは、元にした問題と同種の問題だけになりやすく、より難しい問題や未知の問題には移りにくい。
+また、改善は序盤で頭打ちになり、長く回しても伸びない。Opus 4.7 + Claude Code でも同じ傾向だった。
+
+### 評価集合
+
+改善案を採用する前に、次の2つの集合で、改善前と改善後を比べる（`harness-components.md` ルール1の手順）。
+
+| 集合 | 中身 | 測ること |
+|---|---|---|
+| **Application** | 改善案の根拠になったログと同種のタスク（同じ案件・同じ種類の失敗） | 改善案が狙った失敗を直せたか |
+| **Transfer** | 根拠ログに含まれない案件・種類のタスク。直近の APPROVE 済みタスクから選ぶ | 改善案がほかのタスクを悪化させていないか。未知のタスクにも効くか |
+
+- 採用の条件: Application で改善し、**かつ** Transfer で悪化しないこと。Application だけで判断しない。
+- 集合に入れるタスクは、ベースの構成で失敗したもの、または成功が不安定なものを優先する
+  （すでに毎回通るタスクでは、改善の効果が見えない）。
+
+### 回帰フィクスチャの隔離
+
+- 評価集合と提案8の回帰フィクスチャは、**改善案を作るエージェントに読ませない**。
+  改善案の作成側には根拠ログだけを渡し、評価は別の実行で行う。
+  フィクスチャを見せると、フィクスチャにだけ合わせた改善になり、評価として意味がなくなる。
+
+### チェック項目（retro のたびに実施）
+
+11. **頭打ちの検出**: 直近3回の retro で、採用した改善案の Application の改善幅が毎回小さくなっていないか。
+   横ばいになったら、retro の回数を増やさず、ループの入力（何のログを読ませるか）や手順を変える提案を出す。
+
+### 判断（追記）
+
+- Transfer で悪化した改善案は、Application で改善していても採用しない。
+- 改善案が skills・ルールへの手順の書き足し（蒸留）なら、先に `harness-components.md` ルール4（該当箇所を渡す）で足りないかを検討する。
```

### 提案 A（グローバル反映分）: `task.json` の説明と改善案のルール

グローバル `C:\Users\hiroshi_takizawa\CLAUDE.md` §7 は本 repo の管理外。承認後に**人間が手で反映**する。

#### diff 4: `C:\Users\hiroshi_takizawa\CLAUDE.md`（参考・人間が反映）

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ §7 ログ保存先の表 @@
-| `task.json` | Worker Agentへの入力（task/task_id/files/mode/contract）。メタデータ `purpose`（`validation` / `delivery`）を持つ。`purpose` は Worker へのプロンプトに含めない |
+| `task.json` | Worker Agentへの入力（task/task_id/files/mode/contract）。メタデータ `purpose`（`validation` / `delivery`）と、実行した構成 `harness_config`（モデル・ツールセット・計画・コンテキスト方針）を持つ。`purpose` は Worker へのプロンプトに含めない |
@@ §7 改善提案のルール @@
 - 提案は必ず `harness-proposals/<date>-<slug>.md` に diff 形式＋根拠ログへのリンク＋期待効果として出力する
+- 改善案は、根拠ログと同種のタスク（Application）と、根拠ログに含まれないタスク（Transfer）の両方で改善前後を比べてから採用する。評価に使うタスクは、改善案を作るエージェントに読ませない（根拠: arXiv:2609.00787）
```

> 注: グローバル CLAUDE.md の §7 には、既に別提案の diff（`2026-09-24-eval-awareness-judge-rubric.md` の diff 3、`2026-09-28-typed-decision-receipts.md` の diff 4）が人間による反映待ちで出ている。行番号がずれるため、セクション名で位置を示した。

### 提案 B（人間が反映）: hook と Worker 定義

#### diff 5: 各案件の `.claude/settings.json`（参考・人間が反映）

本 repo には `.claude/settings.json` が無い。hook を入れる案件で、人間が次を追加する。スクリプトは、呼び出しごとに「ツール名＋引数の hash」と成否を1行ずつ追記し、末尾の連続回数を数えるだけの処理でよい（LLM を呼ばない）。

> [更新: 2026-09-29] main の取り込み後、本 repo にも `.claude/settings.json`（秘密ファイルの `permissions.deny`）が入った。hook は既存の `permissions` と並べて `hooks` を足す形で反映する。失敗した呼び出しは PostToolUseFailure で届くことがあるため、両方のイベントに登録する。

```diff
--- a/.claude/settings.json
+++ b/.claude/settings.json
@@ {
   "permissions": {
     "deny": [ ... 既存のまま ... ]
-  }
+  },
+  "hooks": {
+    "PostToolUse": [
+      { "matcher": "*", "hooks": [{ "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/identical-call-guard.sh\"" }] }
+    ],
+    "PostToolUseFailure": [
+      { "matcher": "*", "hooks": [{ "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/identical-call-guard.sh\"" }] }
+    ]
+  }
 }
```

- `identical-call-guard.sh` の仕様: 連続5回で注意文を出力（1回だけ）、失敗の連続8回で Worker を止める。記録ファイルはタスクごとに分け、秘密を含みうる引数の中身は保存せず hash だけ残す（`secret-isolation.md` ルール6）。
- ~~スクリプト本体の実装は、承認後に別タスクで作る（本提案には含めない）。~~ [更新: 2026-09-29] 実装済み: [`.claude/hooks/identical-call-guard.sh`](../.claude/hooks/identical-call-guard.sh)（入口）＋ [`.claude/hooks/identical_call_guard.py`](../.claude/hooks/identical_call_guard.py)（判定の本体）、テスト [`tests/test_identical_call_guard.py`](../tests/test_identical_call_guard.py)。実装時に仕様を次のとおり確定した:
  - **止め方**: 当初は「終了コード 2 で止める」としていたが、PostToolUse の終了コード 2 はツール実行後にエラー文を Claude に見せるだけで、実行は止まらない。実装では `{"continue": false, "stopReason": ...}` を返して止める（注意も停止も終了コードは 0）。
  - **失敗の判定**: `hook_event_name == "PostToolUseFailure"`、上位の `error`、`tool_response` の `is_error` / `success: false` / `error` / 0 以外の終了コードのどれかがあれば失敗として数える。
  - **記録先**: `$CLAUDE_PROJECT_DIR/.claude/state/identical-call-guard/<session_id>.jsonl`（`.gitignore` 済み、直近50件だけ保持）。環境変数 `HARNESS_RETRIES_LOG` を設定すると、注意と停止を `retries.log` に1行ずつ追記する（引数の中身は書かない）。
  - **安全側**: 壊れた入力・例外・Python が見つからない場合は何も出さずに通す（hook の不具合でツールを止めない）。
  - **文字コード**: Windows でも日本語の引数で壊れないよう、標準入出力は UTF-8 のバイト列で扱う。

#### diff 6: plugin 側 Worker 定義（参考・人間が反映）

```diff
--- a/agents/claude-code-harness-worker.md
+++ b/agents/claude-code-harness-worker.md
@@ ## エラー復旧 @@
 - 同じ原因での自動修正は最大 3 回
 - 3 回目で直らなければ `status: escalated` を返す
+- hook から「同じ呼び出しが続いている」注意を受けたら、次の試行では `decision-boundaries.md` ルール1の4つ
+  （証拠を足す・仮説を変える・範囲を絞る・エスカレーション）のどれかを必ず選ぶ
+- hook が実行を止めた場合は `status: escalated`、`escalation_reason: "identical-failing-calls"` を返す
@@ ## 出力 / 完了時 (`worker-report.v1`) @@
+  "harness_config": { "model": "...", "toolset": "...", "planning": "on | off", "context_policy": "..." },
```

## 4. 効果測定（承認後に実測）

| 指標 | 測定方法 | 期待方向 |
|---|---|---|
| `harness_config` の充足率 | `task.json` のうち `harness_config` の4項目がそろっている割合 | 100% |
| 構成比較の件数 | ルール1の手順（1つずつ替える・同じタスク群・最低20件）で行った比較の数と、モデル別の結果 | 可視化（提案4の見直しに実測が付くようになる） |
| 同じ呼び出しの連続による停止 | hook による注意・停止の回数（導入前は生ログから同じ条件で数える） | 停止までの無駄な試行が減る。停止後のエスカレーションが早くなる |
| 計画の使い分けの効果 | 弱いモデル・強いモデルの Worker ごとに、計画ありとなしでの成功率とトークン数 | 弱いモデル: 成功率が上がる／強いモデル: トークン数が下がり、成功率はほぼ同じ |
| 改善案の Transfer での悪化率 | 採用候補の改善案のうち、Transfer 集合で悪化したものの割合 | 可視化（これまで見えていなかった副作用を検出できる） |
| 改善幅の推移 | retro ごとの、採用した改善案の Application の改善幅 | 横ばいを早く検出できる（チェック項目11） |

- 効果が確認できない提案は、その時点で止めて撤回してよい（各提案は独立）。

## 5. 論点の決定（2026-09-29 人間決定済み — 全て既定案で確定）

| # | 論点 | 既定案 | 他の選択肢 |
|---|---|---|---|
| P-1 | ルール1の比較に使うタスク数 | **最低20件**（typed-decision-receipts P-2 の件数と揃える） | 10件（速いが、差の判定が不安定）／50件 |
| P-2 | 同じ呼び出しの検出の閾値 | **注意5回・停止8回**（根拠論文の設定値、暫定） | 3回・5回（厳しめ。正当な繰り返し、例えばテストの再実行を誤検知しやすい） |
| P-3 | Transfer 集合の作り方 | **直近の APPROVE 済みタスクから、根拠ログと別の案件・別の種類を選ぶ** | 検証専用のタスクを別に作る（`judge-rubric.md` の「検証タスクの書き方」に従う必要がある） |
| P-4 | 計画の既定値の線引き | **Haiku 系は必須、Opus 系は任意**で始め、ルール1の比較で見直す | 全モデル必須のまま（今の運用） |

## 付録 A: 本提案で diff を出さない項目（既に満たしている）

- **報酬・合否判定にはルールベースの判定を使い、LLM 判定器に任せない**（論文2 §2.2）: decision-boundaries.md ルール2、judge-rubric.md ルール4 で既に満たしている。
- **汚染対策の考え方**（論文2 §2.3）: 提案11の「回帰フィクスチャの隔離」に取り込んだ。それ以外は diff 不要。
- **read-before-write**（論文1 §2.4）: Claude Code の Edit / Write ツールが既に強制している。
- **ワークスペース外のパスの拒否**（論文1 §2.4）: Claude Code の権限設定と Worker の `files` 制約で既に満たしている。

## 付録 B: 本 repo の対象外だが応用できる先（参考）

ハーネス本体ではなく各案件の設定の話なので、本提案の diff には含めない。着手するなら各案件で別に計画する。

| 対象 | 使い方 | 最初の一歩 |
|---|---|---|
| Python 案件（ヨシケイ CRレポート自動化など） | 編集のたびに `ruff check <file>` を走らせ、結果をツール結果に付ける（論文1 §2.4 の編集後診断） | PostToolUse hook（Edit / Write）で ruff を呼ぶ。settings.json の変更なので人間が反映 |
| TypeScript 案件（各ダッシュボード） | 同じく `tsc --noEmit` や eslint を編集後に走らせる | 同上。全体の型検査が重い案件では、変更ファイルだけにする |
| ナレッジAIサーチ | 論文2の「該当箇所を推論時に渡すと大きく効く」を、回答生成の設計根拠にする | 検索で取った原文を、要約せずにそのまま渡す構成と、要約して渡す構成を比べる |

## 付録 C: 根拠と関連

- 論文1（arXiv:2609.20804）: §2.1（計画）、§2.2（行動空間、表1）、§2.3（コンテキスト管理 T0〜T4、アルゴリズム1）、§2.4（安全・編集後診断・同じ呼び出しの検出）、§3.1（設定値・検定方法）、§3.2（表3・表4、図4・図5）、§4（軌跡の分析）、§6（結論と限界）
- 論文2（arXiv:2609.00787）: §2.1（能力ギャップ・到達可能性の保証）、§2.2（評価と検証器）、§2.3（汚染対策）、表2・表3（主結果、Opus 4.7 + Claude Code を含む）、§4.1（Guidance Gap、表4）、§4.2（Compute Plateau、図2）、§6（結論と限界）
- 関連ルール: [`harness-retro.md`](../.claude/rules/harness-retro.md)（提案4 ツールセット、提案8 回帰フィクスチャ）/ [`decision-boundaries.md`](../.claude/rules/decision-boundaries.md)（ルール1 リトライ、ルール2 コードで判定、ルール5 判断の入力は証拠）/ [`memory-curation.md`](../.claude/rules/memory-curation.md)（ストアの逐語保存、提案3 記憶の提供形式）/ [`judge-rubric.md`](../.claude/rules/judge-rubric.md)（検証タスクの書き方）/ [`secret-isolation.md`](../.claude/rules/secret-isolation.md)（ルール6 ログのマスク）
- 関連提案: `2026-09-11-filesystem-memory-findings.md`（提案4 の起源。本 repo には未収録。本提案 A は、ツールセットを見直す手順を足す）/ [`2026-09-28-typed-decision-receipts.md`](2026-09-28-typed-decision-receipts.md)（提案 C = リトライの規律。本提案 B は、それをコードで検出する）
