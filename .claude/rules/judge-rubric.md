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
  [更新: 2026-09-29] `route_mode` は `shadow` / `active` / `off` の3値。`off` は「route を使った自動処理を止め、記録は続ける」。
  `active` にする前提条件は `harness-retro.md` 提案10 を参照（提案 `2026-09-29-jev-field-guide-deltas.md` 提案 H・Q-3）。
- 自己申告の確信度（「自信あり」「おそらく」など）は `route` の入力にしない（ルール4）。
- 本節は rubric のアンカーを変えないので `rubric_version` は上げない。

### 迷いの原因（review.v1 追加分・任意項目）

> **起源**: 提案 `harness-proposals/2026-09-29-jev-field-guide-deltas.md`（提案 G）
> **承認**: 2026-09-29 人間承認済み

- `uncertain: true` の観点には、`uncertain_cause` を次から1つ付ける。原因ごとに直す場所が違うため。

  | `uncertain_cause` | 観測されること | 直す場所（`harness-retro.md` 提案8 の層） |
  |---|---|---|
  | `missing_evidence` | 必要な証跡が `commands.stdout.log` や diff に無い | 1 状態 |
  | `stale_evidence` | 証跡はあるが、判定対象（`state_ref`）より古い | 1 状態 |
  | `overlapping_anchors` | 2つの段階のアンカーのどちらにも当てはまる | 3 契約 |
  | `out_of_scope` | 観点がこのタスクに当てはまらない | 2 選択肢 |
  | `other` | 上のどれでもない（理由を1行書く） | — |

- `uncertain_cause` は route の計算には使わない（route の規則は変えない）。retro の集計にだけ使う。
- 任意項目の追加なので `rubric_version` は上げない。

```json
{ "criterion": "dod-items-verified-with-evidence", "score": 2, "max": 3,
  "uncertain": true, "uncertain_cause": "missing_evidence",
  "evidence_ref": "commands.stdout.log:L120-L134" }
```

## 一致度の確認（`.claude/rules/harness-retro.md` 提案7）

- **retro のたびに**（`/harness-release` 前の必須 retro を含む）、最低10件を人間が同じ rubric で再採点し、Cohen's κ を記録する。
  判定器のモデル・rubric を変えた直後の retro では必ず実施する。
- κ < 0.4 のときは、判定器モデルを強化する前にアンカー定義を直す。0.4 は暫定値で、最初の 2〜3 回の retro の実測で見直す。
