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
  "rubric_version": "judge-rubric.v1",
  "verdict": "APPROVE | REQUEST_CHANGES",
  "scores": [
    { "criterion": "dod-items-verified-with-evidence", "score": 2, "max": 3,
      "uncertain": false, "evidence_ref": "commands.stdout.log:L120-L134" }
  ],
  "judge": { "model": "<model-id>", "temperature": 0 }
}
```

## 一致度の確認（`.claude/rules/harness-retro.md` 提案6）

- **retro のたびに**（`/harness-release` 前の必須 retro を含む）、最低10件を人間が同じ rubric で再採点し、Cohen's κ を記録する。
  判定器のモデル・rubric を変えた直後の retro では必ず実施する。
- κ < 0.4 のときは、判定器モデルを強化する前にアンカー定義を直す。0.4 は暫定値で、最初の 2〜3 回の retro の実測で見直す。
