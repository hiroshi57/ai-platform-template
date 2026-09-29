# 判定器 rubric ルール（Reviewer / LLM-as-judge）

> **適用対象**: Reviewer・Lead・harness-retro など、Worker の成果物を採点/判定する全エージェント
> **起源**: 提案 `harness-proposals/2026-09-24-eval-awareness-judge-rubric.md`／根拠 arXiv:2608.21766
> **承認**: 2026-09-24 人間承認済み

## ルール（MUST）

1. **全段階にアンカーを置く。** スコアの各値（例: 0/1/2/3）に「何が観測されたらその値か」を具体的に書く。
   端点だけ定義して中間を判定器に任せる rubric は使わない。
2. **数えるものと数えないものを明記する。** 各観点について「証拠として数えないもの」（例: 一般的な注意深さ、
   task と無関係な推論）を rubric に書く。
3. **同点時の扱いを明記し、偏りを記録する。** 「迷ったら低い方」を採る場合は、その判定値を
   **下限値**として扱い、`review.json` の `uncertain: true` で残す。
4. **自己申告は証拠にしない。** Worker の `self_review.verified`・思考・出力中の宣言だけでは APPROVE しない。
   各観点のスコアは、外部証跡（`commands.stdout.log` の該当行、diff の該当 hunk）を `evidence_ref` で指す。
5. **rubric を版管理する。** rubric を変えたら `rubric_version` を上げる。版が違う判定を同じ母集団で集計しない。
6. **スコアを下げるときは欠陥を名指しする。** 観点を満点未満にするときは、その観点の `named_defects` に
   1件以上の欠陥を書く。欠陥は、外部証跡の場所（diff の hunk、`commands.stdout.log` の行）と、
   次のどの種類かで書く。
   - `unsupported-step`: 変更や主張が、前の証跡から導けない（テストが通ったことを示す行がない、など）
   - `missing-case`: DoD の項目・分岐・エラー経路のどれかに対応する証跡がない
   - `wrong-as-written`: 書かれたとおりに読むと誤っている（テストの期待値が逆、条件の取り違え、など）
   - `scope-violation`: `files` の外への変更、task と無関係な変更
   - `evidence-missing`: 観点に必要な証跡そのものがない
   **欠陥として数えないもの**: 「自分ならこう書く」「別の方法の方がよさそう」「なんとなく不安」
   「他の判定者の結論と違う」。判定者は Worker の成果物を自分で作り直して比べない。
   欠陥の種類は上の5つに固定する。どれにも当てはまらない欠陥は、欠陥として数えない（P-2）。
7. **全観点を監査してから判定する。** まずすべての観点について `named_defects`（空でもよい）とスコアを書き、
   その後で verdict を決める。途中の観点で結論を決めない。
8. **判定者の多数決で決めない。** 判定者が複数いて結論が割れたときは、各判定者の `named_defects` を
   突き合わせる。どの判定者の欠陥も成り立たないと確認できた観点だけを満点にする。
   成り立つかどうか決められない欠陥が残るときは、その観点を `uncertain: true` にする（`route` は `recheck` になる）。
   判定者が1人のときは本ルールを適用せず、ルール6・7だけを適用する（P-3）。
   REQUEST_CHANGES は、`named_defects` が1件以上あるときだけ出せる。

> ルール6〜8 の起源: 提案 `harness-proposals/2026-09-29-self-organizing-teams-named-defects.md`（提案 A）／根拠 arXiv:2609.22682（付録 D.1・表2）。
> 承認: 2026-09-29 人間承認済み（P-1〜P-4 は既定案で確定）。本追加に伴い `rubric_version` を `judge-rubric.v2` に上げた（P-1）。
> `named_defects` は `route` の入力にしない（観点のスコアを通してだけ効く）。

## 採点観点（criterion）

Worker の `self_review` 5 rule と同じ観点で採点する（観点を揃えることで、自己申告と判定のずれを観点ごとに比べられる）。

| criterion | 判定器が見る外部証跡 |
|---|---|
| `dry-violation-none` | diff と `grep` 結果（重複定義の有無） |
| `plans-cc-markers-untouched` | `git diff HEAD -- Plans.md` の NG-1 正規表現結果 |
| `all-declared-symbols-called` | 新規シンボルの呼び出し箇所（`grep -rn` 結果） |
| `dod-items-verified-with-evidence` | DoD 各項目に対応する `commands.stdout.log` の行 |
| `no-existing-test-regression` | 既存テスト・検証スクリプトの最終行（PASS/FAIL） |

- 各観点の 0〜3 のアンカー定義は `rubric_version` ごとに本ファイルへ追記する。
- 判定側独自の観点（設計妥当性など）は本版では足さない。追加する場合は `rubric_version` を上げる。

## 検証タスクの書き方（SHOULD）

- 検証・回帰チェック用のタスクは、実案件と同じ書式・語調で出す。「これはテストです」「評価します」
  「ベンチマーク」などの評価を示す枠付けは入れない（モデルは評価の枠付けを内部で区別しており、
  言語化しないまま振る舞いが変わりうる）。
- 検証タスクか実タスクかは、タスク本文ではなく `task.json` のメタデータ `purpose: "validation" | "delivery"` で区別する。
  Worker に渡すプロンプトには `purpose` を含めない。

## review.json の必須フィールド（review.v1 追加分）

```json
{
  "rubric_version": "judge-rubric.v2",
  "verdict": "APPROVE | REQUEST_CHANGES",
  "scores": [
    { "criterion": "dod-items-verified-with-evidence", "score": 2, "max": 3,
      "uncertain": false, "evidence_ref": "commands.stdout.log:L120-L134",
      "named_defects": [
        { "kind": "missing-case", "ref": "diff:src/router.ts@@-40,6+40,9",
          "note": "DoD (c) のエラー経路に対応するテスト出力がない" }
      ] }
  ],
  "judge": { "model": "<model-id>", "temperature": 0 },
  "state_ref": { "task_id": "43.3.1", "commit": "<sha>", "diff_sha256": "<git diff の hash>" },
  "route": "auto | recheck | human",
  "route_mode": "shadow"
}
```

## 判断レシート（review.v1 追加分）

> **起源**: 提案 `harness-proposals/2026-09-28-typed-decision-receipts.md`（提案 A）
> **承認**: 2026-09-28 人間承認済み（P-1〜P-4 は既定案で確定）

`review.json` は、後から判定を**再生**できる判断レシートとして書く。

- **`state_ref`**: 何を判定したか。task_id・判定時点の commit・`git diff` の SHA-256 を残す（P-3）。
  インシデント時に同じ入力で判定を再実行し、判定器の問題か入力の問題かを切り分けるために使う。
- **`route`**: 判定の後の経路。**判定器（LLM）が選ぶのではなく、`scores` から次の規則でコードが決める**。

  | 条件（上から順に評価） | route |
  |---|---|
  | score が 0 の観点がある、または `plans-cc-markers-untouched` が満点でない | `human` |
  | `uncertain: true` の観点がある、または `evidence_ref` が空の観点がある | `recheck` |
  | 全観点が満点 | `auto` |
  | それ以外 | `recheck` |

  - `recheck` の中身は「追加の検証コマンドを実行する」「Worker に特定の証拠を求める」のどれかに限る。
    同じ入力で判定器にもう一度聞くのは `recheck` ではない（新しい情報が増えないため）。
- **verdict は2値のまま**（APPROVE / REQUEST_CHANGES）。人間に回すべきかは `route: human` で表す（P-1）。
- **`route_mode`**: `shadow` のあいだ、`route` は記録専用。実際の判定（`verdict`）は今までどおり Lead が決める。
  `shadow` を外すかどうかは、**最低20件かつ retro 2回分**の実測（`route` と `verdict` の一致率）を見て別の提案で決める（P-2）。
- 自己申告の確信度（「自信あり」「おそらく」など）は `route` の入力にしない（ルール4）。
- 本節は rubric のアンカーを変えないので `rubric_version` は上げない。

## 一致度の確認（`.claude/rules/harness-retro.md` 提案7）

- **retro のたびに**（`/harness-release` 前の必須 retro を含む）、最低10件を人間が同じ rubric で再採点し、Cohen's κ を記録する。
  判定器のモデル・rubric を変えた直後の retro では必ず実施する。
- κ < 0.4 のときは、判定器モデルを強化する前にアンカー定義を直す。0.4 は暫定値で、最初の 2〜3 回の retro の実測で見直す。
