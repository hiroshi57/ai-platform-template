# Harness 改善提案: 評価認識（Evaluation Awareness）由来「判定器 rubric の全段階アンカー化＋人手照合」

- **日付**: 2026-09-24
- **slug**: `eval-awareness-judge-rubric`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— CLAUDE.md §7 の運用に従い、承認前は本体ファイル（CLAUDE.md / `.claude/rules/*` / skills）へ反映しない
- **根拠論文**: *Evaluation Awareness in Language Models: Representation, Verbalization, and Control*
  - Heidari, Memarian, Rabusseau（Mila / Université de Montréal）— arXiv:2608.21766v1 [cs.CL], 2026-08-22
  - コード: https://github.com/evaluation-awareness/evaluation-awareness

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。対象は **判定器（Reviewer / Lead / retro）の rubric と `review.json` の記録項目**、および検証タスクの書き方のみ。
>
> ⚠️ **提案の性質**: 論文はオープンウェイト LLM（7B〜49B）の内部表現を調べた研究で、本ハーネスへは**判定設計の教訓として移植**する。論文の数値（AUROC・κ 等）が本ハーネスでも再現する保証はない。価値は「判定のぶれの可視化」と「自己申告に頼った APPROVE の防止」にある。

## TL;DR（3行要約）

- **主張**: モデルは「評価されている」ことを内部では区別しているが、それを口に出すこととはほぼ無相関。また、基準の違う2つの LLM 判定器は同じ出力に対してほとんど一致しなかった（κ ≤ 0.09）。
- **提案**: ① rubric の全段階にアンカーを置き、版管理する（A）② 自己申告を判定の根拠にせず外部証跡を必須にする（B）③ retro で判定器と人間の一致度を測る（C）④ 検証タスクから「テストです」という枠付けを外す（D）。
- **効果**: いずれも**ルール文書と `review.json` の項目追加だけで実装でき**、新しい基盤やモデル変更は要らない。効果は §4 で実測する。

### 承認で決まること（決裁事項）

- ✅ 提案 A〜D を §3 の diff どおりに反映してよい（`.claude/rules/judge-rubric.md` の新規作成、`.claude/rules/harness-retro.md` への追記）
- ✅ `review.json` に `rubric_version`・観点別スコア・`uncertain`・`evidence_ref` を追加する（review.v1 の拡張）
- ❌ グローバル `C:\Users\hiroshi_takizawa\CLAUDE.md` は本 repo の管理外。diff 3 は**人間が手で反映**する（本 repo からは変更しない）
- ❌ Reviewer の判定モデルそのものの変更は本提案の対象外

**却下・保留する場合**: 提案単位で可（A〜D は相互に独立して実装できる。ただし C は A の `rubric_version` がある方が集計しやすい）。

---

## 1. 背景: 論文の要点と本ハーネスとの対応

論文は 6 つのオープンウェイトモデルで「評価されている自覚」を 3 つの方法で測り、結果が食い違うことを示した。

| 論文の発見 | 数値 | 本ハーネスでの含意 |
|---|---|---|
| 全モデルが内部で評価/本番を区別している | 最良層で AUROC > 0.7 | 検証タスクが「テストっぽい」と、Worker は本番と違う状態で動きうる |
| ただし口に出すことはまれで、内部状態ともほぼ無相関 | 出力の 93.9% 以上が判定 0、\|ρ\| < 0.19、MI < 0.04 nats | **自己申告（self_review・宣言）は内部状態の代理にならない** |
| 内部方向を操作すると言語化は増える | 0〜3 スケールで +0.2〜1.5 | 言語化は内部状態と無関係ではないが、1対1ではない |
| rubric の違う2つの判定器は一致しない | Cohen's κ ≤ 0.09 | **Reviewer の rubric が曖昧だと判定がぶれる** |
| 端点だけ定義した判定器は無関係な推論に高得点を付けた | 「ペルソナを守る」系の推論に ≈98/100 | 中間段階の定義が無いと、判定器が勝手に基準を作る |
| 「迷ったら低い方」の指示は数値を偏らせる | 論文自身が「下限値として読む」と明記 | 同点時の扱いは rubric に書き、判定結果にも残す |

**含意**: 本ハーネスは既に「evidence 必須の self_review」「生ログ保存」を持つ。欠けているのは **判定器側の rubric 規律**（アンカー・版管理・一致度の測定）である。

## 2. 現行運用の不足点

### 2.1 Reviewer の rubric が明文化されていない
`review.json` には「APPROVE / REQUEST_CHANGES と理由」しか記録されていない。どの基準で、どの段階の判断だったかが残らないため、判定器や rubric を変えても前後を比べられない。

### 2.2 自己申告の扱いが判定側で規定されていない
Worker 側には「evidence が空なら差し戻し」があるが、判定側で「自己申告だけでは APPROVE しない」とは書かれていない。evidence 欄に書かれた文言そのもの（「PASS を確認」など）も自己申告であり、生ログの該当行と突き合わせる規律が要る。

### 2.3 判定のぶれを測っていない
retro は escalation_reason / reason_code の再発を数えるが、**判定そのものが安定しているか**（人間や別の判定器と一致するか）は測っていない。判定がぶれていれば、再発率の集計自体が信用できない。

### 2.4 検証タスクの枠付けが規定されていない
回帰チェックや動作確認のタスクに「テスト」「評価」と書くと、論文が示すとおりモデルが内部で評価状況と認識する可能性がある。

## 3. 提案と diff

### 提案 A / B / D: 新規ルール `.claude/rules/judge-rubric.md`
- **A**: 全段階アンカー・数えないものの明記・同点時の扱い・`rubric_version` による版管理（MUST 1〜3・5）
- **B**: 自己申告は証拠にせず、`evidence_ref` で生ログの該当行を指す（MUST 4）
- **D**: 検証タスクに評価の枠付けを入れない（SHOULD）

#### diff 1（新規ファイル）

```diff
--- /dev/null
+++ b/.claude/rules/judge-rubric.md
@@ -0,0 +1,42 @@
+# 判定器 rubric ルール（Reviewer / LLM-as-judge）
+
+> **適用対象**: Reviewer・Lead・harness-retro など、Worker の成果物を採点/判定する全エージェント
+> **起源**: 提案 `harness-proposals/2026-09-24-eval-awareness-judge-rubric.md`／根拠 arXiv:2608.21766
+> **承認**: （未承認・DRAFT）
+
+## ルール（MUST）
+
+1. **全段階にアンカーを置く。** スコアの各値（例: 0/1/2/3）に「何が観測されたらその値か」を具体的に書く。
+   端点だけ定義して中間を判定器に任せる rubric は使わない。
+2. **数えるものと数えないものを明記する。** 各観点について「証拠として数えないもの」（例: 一般的な注意深さ、
+   task と無関係な推論）を rubric に書く。
+3. **同点時の扱いを明記し、偏りを記録する。** 「迷ったら低い方」を採る場合は、その判定値を
+   **下限値**として扱い、`review.json` の `uncertain: true` で残す。
+4. **自己申告は証拠にしない。** Worker の `self_review.verified`・思考・出力中の宣言だけでは APPROVE しない。
+   各観点のスコアは、外部証跡（`commands.stdout.log` の該当行、diff の該当 hunk）を `evidence_ref` で指す。
+5. **rubric を版管理する。** rubric を変えたら `rubric_version` を上げる。版が違う判定を同じ母集団で集計しない。
+
+## 検証タスクの書き方（SHOULD）
+
+- 検証・回帰チェック用のタスクは、実案件と同じ書式・語調で出す。「これはテストです」「評価します」
+  「ベンチマーク」などの評価を示す枠付けは入れない（モデルは評価の枠付けを内部で区別しており、
+  言語化しないまま振る舞いが変わりうる）。
+
+## review.json の必須フィールド（review.v1 追加分）
+
+```json
+{
+  "rubric_version": "judge-rubric.v1",
+  "verdict": "APPROVE | REQUEST_CHANGES",
+  "scores": [
+    { "criterion": "dod-items-verified-with-evidence", "score": 2, "max": 3,
+      "uncertain": false, "evidence_ref": "commands.stdout.log:L120-L134" }
+  ],
+  "judge": { "model": "<model-id>", "temperature": 0 }
+}
+```
+
+## 一致度の確認（`.claude/rules/harness-retro.md` 提案6）
+
+- 判定器のモデル・rubric を変えたときと retro のたびに、最低10件を人間が同じ rubric で再採点し、Cohen's κ を記録する。
+- κ < 0.4 のときは、判定器モデルを強化する前にアンカー定義を直す。
```

### 提案 C: retro に判定器の一致度チェックを追加

#### diff 2: `.claude/rules/harness-retro.md`

```diff
--- a/.claude/rules/harness-retro.md
+++ b/.claude/rules/harness-retro.md
@@ -47,3 +47,20 @@
 - 1・2 が崩れた（削除・作り直しが起きた）場合は `.claude/rules/memory-curation.md` の保存ルール違反。
   内容欠落がないか diff で確認する。
 - 3 が悪化した場合、taxonomy を守れる強い管理エージェントに切り替えるか、ツールセット（提案4）を見直す。
+
+## 提案6: 判定器（Reviewer / LLM-as-judge）の健全性チェック（arXiv:2608.21766）
+
+実証結果: 採点スケール・同点時の扱い・アンカーの置き方が違う2つの LLM 判定器は、
+同じ出力に対して Cohen's κ ≤ 0.09 しか一致しなかった。端点しか定義しない判定器は、
+「ペルソナを守る」といった無関係な推論に最高点近くを付けた。
+
+### チェック項目（retro 実行時 / `/harness-release` 前）
+
+4. **判定器の一致度**: 直近の `review.json` から最低10件をサンプルし、人間（または別系統の判定器）が
+   同じ rubric で再採点する。Cohen's κ < 0.4 なら rubric を見直す（`.claude/rules/judge-rubric.md`）。
+5. **rubric_version の記録漏れ**: `review.json` に `rubric_version` が無いレコードは、集計（再発率・APPROVE 率）から除外する。
+   rubric が異なるレコードの判定を同じ母集団として比較しない。
+
+### 判断（追記）
+
+- 4 が閾値を下回ったら、判定器モデルを強化する前に、まず rubric のアンカー定義とツールセット（提案4）を見直す。
```

### 提案 B（グローバル反映分）: `review.json` の必須項目と自己申告ルール

グローバル `C:\Users\hiroshi_takizawa\CLAUDE.md` §7 は本 repo の管理外。承認後に**人間が手で反映**する。

#### diff 3: `C:\Users\hiroshi_takizawa\CLAUDE.md`（参考・人間が反映）

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -166,7 +166,7 @@
 |---|---|
 | `task.json` | Worker Agentへの入力（task/task_id/files/mode/contract） |
 | `worker-report.json` | self_review を含む Worker の完全な出力 |
-| `review.json` | Reviewer / Lead の判定（APPROVE / REQUEST_CHANGES と理由） |
+| `review.json` | Reviewer / Lead の判定（APPROVE / REQUEST_CHANGES と理由）。`rubric_version`・観点別スコア・`uncertain` フラグ・根拠となる証跡（コマンド出力の行番号）を必須とする（`.claude/rules/judge-rubric.md`） |
 | `commands.stdout.log` | 検証コマンドの生出力全文 |
 | `retries.log` | エラー復旧記録（最後の失敗コマンド／エラー／修正3行 × 試行回数） |
 | `advisor.json` | advisor-request が発生した場合のみ |
@@ -181,6 +181,7 @@
 
 - 提案は必ず `harness-proposals/<date>-<slug>.md` に diff 形式＋根拠ログへのリンク＋期待効果として出力する
 - ストア（メモリ/skills）の形が劣化した場合、モデル強度より先に **ツールセット**（Worker の allowed/disallowed tools、検索ツール、file 操作 API 群）の見直しを検討する。ツールセット変更はモデル変更と同等にストア形状を変える（根拠: arXiv:2607.26637 RQ5）
+- Worker の自己申告（`self_review.verified` や思考・出力中の宣言）は判定の根拠にしない。外部証跡（検証コマンドの生出力・diff）とセットのときだけ有効とする（根拠: arXiv:2608.21766 — 内部状態と言語化はほぼ無相関）
 - 本ファイル（CLAUDE.md / AGENTS.md）や各案件の skills への直接書き込みは行わず、必ず人間の承認を経てから反映する
 - 次の項目は自動改善の対象外（人間のみが変更可能）:
   - 「禁止事項」セクション全般（本番デプロイ禁止・セキュリティ設定変更禁止 等）
```

## 4. 効果測定（承認後に実測）

| 指標 | 測定方法 | 期待方向 |
|---|---|---|
| 判定器と人間の一致度 | 直近 10 件以上を人間が同じ rubric で再採点し Cohen's κ を算出 | 導入前をベースラインとして上昇（目標 κ ≥ 0.4） |
| `evidence_ref` の充足率 | `review.json` の観点別スコアのうち `evidence_ref` が生ログの実在行を指す割合 | 100% |
| `uncertain` 率 | `uncertain: true` の観点の割合 | 可視化（高止まりする観点は rubric のアンカーを直す） |
| 差し戻し後の再発 | APPROVE 後に同じ不具合で再修正になったタスクの割合（導入前後 各20タスク） | 低下（自己申告だけの APPROVE を防げている） |

- 効果が確認できない提案は、その時点で止めて撤回してよい（各提案は独立）。

## 5. 未解決論点（反映前に個別確定）

- **P-1**: Reviewer の観点（criterion）の一覧をどう定義するか。Worker の self_review 5 rule と揃えるのが最も簡単だが、判定側独自の観点（設計妥当性など）を足すか。
- **P-2**: 人手照合の担当と頻度（retro ごと／`/harness-release` 前のみ）。10 件の再採点コストが見合うか。
- **P-3**: κ の閾値 0.4 は一般的な「中程度の一致」の目安で、本ハーネス向けに検証した値ではない。最初の 2〜3 回の retro で実測してから見直す。
- **P-4**: 検証タスクの枠付けを外すと、ログ上で「検証タスクか実タスクか」が区別しにくくなる。`task.json` のメタデータ（本文ではなく）に `purpose: validation` を持たせる案で両立できるか。

## 付録: 根拠と関連

- 根拠論文: arXiv:2608.21766（§3 内部表現と言語化の不一致、§4 ステアリング、付録 C.1 判定器の rubric、付録 D 判定器の頑健性）
- 関連ルール: `.claude/rules/harness-retro.md`（提案4: ツールセットを先に見直す — 本提案 C の「判定器モデルより先に rubric を直す」と同じ考え方）/ `.claude/rules/memory-curation.md`（生ログの逐語保存 — `evidence_ref` が指す先の前提）
- 関連提案: [`2026-09-17-ngu-effort-reallocation.md`](2026-09-17-ngu-effort-reallocation.md)（密な評価シグナル＝self_review evidence を単一の APPROVE より重視する方向で一致）
