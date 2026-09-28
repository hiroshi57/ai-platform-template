# Harness 改善提案: 履歴ではなく「実行状態」で長い手順を回す — SKILL.state 方式の導入

- **日付**: 2026-09-28
- **slug**: `skill-state-runtime`
- **起案**: Claude Code (Worker)
- **ステータス**: **一部承認済み（2026-09-28）** — 提案 B・C・D を承認・反映済み。提案 A・E は人間承認待ち（DRAFT）。
  - 反映済み（Claude）:
    - B・C → `agent-harness/src/state-patch.mjs`（新設）、`state.mjs` / `context.mjs` / `harness.mjs`、`agent-harness/test/state-patch.test.mjs`（新設）
    - B・C・D → [`.claude/rules/skill-state.md`](../.claude/rules/skill-state.md)（新設）
    - D → [`.claude/rules/harness-retro.md`](../.claude/rules/harness-retro.md) 提案9
  - 未反映: A（ヨシケイ orchestrator。別リポジトリ `yosikei-agents` のため本 repo からは書き込まない）、E（第三者データの取り込み）
- **根拠論文**: *SKILL.state: Scalable Long-Horizon Agent Skills*
  - Badhe, Tiwari, Chung（Google LLC / Purdue University）— arXiv:2608.26263v3 [cs.AI], 2026-09-02
  - https://arxiv.org/abs/2608.26263

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない。
> グローバル CLAUDE.md / AGENTS.md への直接の書き込みは行わない。
>
> ⚠️ **提案の性質**: 論文の数値は主に Gemini-3-Flash のもので、誤記もいくつかある（モデル名「Qwen-38B」と「Qwen 3-8b」、
> 表5の予算が文字数なのかトークン数なのか）。**トークン削減の効果は堅いが、正解率の向上幅は環境・モデルで大きく変わる**という前提で採用する。

## TL;DR（3行要約）

- **主張**: 各ステップでモデルに渡すものを「手順書 P・構造化した状態 σ・最新の観測 O」だけに限り、推論は状態パッチを出した後に捨てる。
  こうすると、1回のプロンプトは一定の大きさに収まり（O(1)）、総トークンは O(T²) から O(T) になる。正解率も維持または向上した。
- **提案**: B 再試行ループに `tested_hypotheses` を持たせ、履歴全文を渡さない ／ C 状態パッチの検証とマージをランタイムに持たせる
  （上書き事故・型違反を rollback）／ D 生ログ保存や retro とぶつからない適用範囲を明文化 ／ A・E 業務への展開（保留）。
- **効果**: 同じ修復を繰り返すことが減る。小型モデルで多い「状態の上書き事故」を仕組みで防げる。retro の材料（生ログ）は減らない。

### 承認で決まること（決裁事項）

- ✅ B・C・D を反映する（2026-09-28 承認・反映済み）
- ❌ A（ヨシケイ）と E は本承認に含まない。別途判断する
- ❌ グローバル CLAUDE.md §7 への追記が必要になった場合は、人間が反映する

---

## 1. 背景: 論文の要点（要約）

### 1.1 手法

1. 最新の観測 O_t を受け取る
2. (P, σ_t, O_t) だけでプロンプトを組む。過去の観測・行動・推論は入れない
3. モデルは「推論・状態パッチ δ_t（JSON。null で削除）・行動 a_t」を出す
4. ランタイムが δ_t を決まった手順で検証し、σ_{t+1} = σ_t ⊕ δ_t で状態を更新する
5. 推論は捨てる

状態のスキーマは領域ごとに1回だけ作る。例: CTF の100問すべてで、同じ5項目（発見したフラグ・試した仮説・作業中のファイル・作業ディレクトリ・コマンド要約）を使い回した。

### 1.2 主な結果

| 実験 | 結果 | 本ハーネスへの含意 |
|---|---|---|
| 長さを伸ばす（倉庫、T=100） | 総トークン: LangGraph 型 106万 → 本手法 6.5万（16.2分の1） | 長い手順ほど効果が大きい |
| 外部から状態が変わる | 履歴型は5〜14ターン古い事実に従って誤る。本手法は0ターン | 人間が途中で成果物を編集する業務に効く |
| CTF（100問） | pass@1 54.2%（最良の比較手法＋7.8pt、トークン60%減） | **試した仮説を状態に持つと、同じ失敗を繰り返さない** → 提案B |
| 予算を揃えた比較（T=100） | スライディングウィンドウ 0.18、LLMLingua 0.22、要約上限 0.52、本手法 0.94 | 効いているのは「短さ」ではなく「構造化」 |
| 小型モデルの失敗内訳 | 既存キーの上書き・削除 68%、型の取り違え 20%、JSON 文法 12% | ボトルネックは推論力ではなく構造化出力 → 提案C |

### 1.3 限界（論文 §7）

1. 事前にスキーマが決められないとき
2. 観測の時点では重要と分からず、状態に書き込まれなかった情報があるとき
3. **履歴そのものが目的のタスク**（監査・原因追跡・過去の行動の説明）

複数エージェントが同時に書き込む場合の競合解決は未検証。

---

## 2. 現行運用の不足点

### 2.1 再試行が「何を試したか」を持っていない

`agent-harness` のループは会話全文を渡さない設計で、すでに SKILL.state に近い（`context.mjs`）。
ただし、状態が持っているのは直近の証拠 `last_evidence` だけで、**過去の試行でどの修復を試し、どのチェックで落ちたか**が残らない。
2回目以降の修復で同じ仮説を繰り返しても、ランタイム側では検知できない。

### 2.2 状態の更新が直接代入になっている

`harness.mjs` は `state.completed.push(...)` や `state.status = ...` のように、状態を直接書き換えている。
モデルが状態を書く構成に移ると、論文で 68% を占めた「既存キーを落とす上書き」をランタイムで止める手段がない。

### 2.3 「推論を捨てる」と「生ログを逐語保存する」がぶつかって見える

CLAUDE.md §7 と `memory-curation.md` ルール4 は、生ログを逐語で保存すると定めている。
一方、論文は推論を捨てる。何を捨てるのか（プロンプトから外すのか、保存もやめるのか）を定めないと、
retro の材料が減る方向へ誤って運用される恐れがある。

---

## 3. 提案

### 提案 A: ヨシケイ月次 orchestrator に状態スキーマを入れる（保留・DRAFT）

- 状態の例: `processed_media`（媒体ごとの処理状況）・`stop_gates`（STOP①②③ の通過状況）・`open_errors`・`output_paths`
- STOP で人間が Excel を編集することは、論文の「外部から状態が変わる」実験にあたる。再開時は状態を正とし、ファイルを読み直して状態を更新する。
- **保留理由**: 実装先が別リポジトリ（`yosikei-agents`）であり、本 repo からは書き込まない（`agent-harness/README.md` の安全規則）。

### 提案 B: 再試行ループに `tested_hypotheses` を持たせる（✅ 反映済み）

- 状態に `tested_hypotheses`（試行番号・行動・落ちたチェック）を追加し、コンテキストに載せる。
- 過去の推論や観測の全文は、引き続き渡さない。

```diff
 // agent-harness/src/state.mjs  initState()
     open_risks: [],
+    // 提案B（arXiv:2608.26263）: 試した仮説と結果。履歴全文の代わりにこれだけを次の試行へ渡す
+    tested_hypotheses: [],
     repairs: 0,
```

```diff
 // agent-harness/src/context.mjs  buildContext()
     `open_risks: ${state.open_risks.join(", ") || "(none)"}`,
+    `tested_hypotheses: ${JSON.stringify(state.tested_hypotheses ?? [])}`,
     `last_evidence: ${JSON.stringify(state.last_evidence ?? null)}`,
```

```diff
 // agent-harness/src/harness.mjs  検証失敗時
       console.log(`  ❌ 失敗: ${JSON.stringify(result.failed)}`);
+      const names = result.failed.map((c) => c.name).join(", ");
+      commit({
+        tested_hypotheses: [
+          { attempt: state.repairs + 1, action: request.name, failed_checks: names },
+        ],
+      });
```

- Worker（Claude Code）向けの運用は [`.claude/rules/skill-state.md`](../.claude/rules/skill-state.md) ルール1。

### 提案 C: 状態パッチの検証とマージをランタイムに持たせる（✅ 反映済み）

- `agent-harness/src/state-patch.mjs` を新設する。
  - `applyPatch(state, patch, schema)`:
    - パッチに書かれていないキーは残す
    - 削除は `nullable` なキーへの `null` の明示だけ受け付ける
    - `merge: "append"` の配列は追加分だけを受け付ける
    - 型違反・未知のキー・`immutable` なキーが1つでもあれば、**状態を一切変えずに差し戻す**（部分適用しない）
  - `parseStepOutput(text)`: ```json ブロックから `{state_patch, action}` だけを取り出す。推論は返さない。構文エラーは retry 可能なエラーとして返す。
  - `WORKER_STATE_SCHEMA`: 領域ごとに1回だけ定義するスキーマ
- `harness.mjs` の状態更新は、すべて `commit(patch)` → `applyPatch` 経由にした。

```diff
-    if (!state.artifacts.includes(ARTIFACT)) state.artifacts.push(ARTIFACT);
-    if (!state.decisions.includes(DECISION)) state.decisions.push(DECISION);
+    commit({ artifacts: [ARTIFACT], decisions: [DECISION] });
 ...
-      if (!state.completed.includes("implementation")) state.completed.push("implementation");
-      if (!state.completed.includes("verification")) state.completed.push("verification");
-      state.status = "verified";
+      commit({ completed: ["implementation", "verification"], status: "verified" });
```

- 小型モデルに状態を書かせる場合は、JSON Schema による出力制約を併用する（`skill-state.md` ルール4）。

### 提案 D: 適用範囲を明文化する（✅ 反映済み）

- 捨てるのは「次のプロンプトに入れる推論」だけ。`harness-logs/` への生ログ保存は続ける（`skill-state.md` ルール6）。
- retro・監査・原因追跡・スキーマを決められない探索的なタスクには適用しない（同ルール7、`harness-retro.md` 提案9）。
- 状態には秘密を書かない。状態は毎ステップ必ずコンテキストに入るため（同ルール5、`secret-isolation.md` と整合）。
- 観測の取りこぼしが疑われる失敗が出たら、履歴方式に戻すのではなく、スキーマに項目を足す（同ルール8）。

### 提案 E: ノイズの多い第三者データの取り込み（保留・DRAFT）

- 広告レポートや GA4 の生データを読むタスクでは、状態パッチを作る段階で必要な値だけを残し、生データを次のステップへ持ち越さない（論文の実験②）。
- **保留理由**: 対象の業務タスクがまだ本ハーネスに無い。A と合わせて判断する。

---

## 4. 検証結果（反映時）

| 項目 | コマンド | 結果 |
|---|---|---|
| 新規テスト | `node --test agent-harness/test/*.test.mjs` | pass 10 / fail 0 |
| デモ出力が変わらないこと | `node agent-harness/src/harness.mjs` を変更前後で diff | 差分なし |
| orchestrate が変わらないこと | `node agent-harness/src/orchestrate.mjs` を変更前後で diff（run_id 行を除く） | 差分なし |
| accept 経路 | fixture を LF にして `harness.mjs` を実行 | README の期待出力どおり（`completed: [implementation, verification]`） |

> 補足（既存の問題）: Windows で `core.autocrlf=true` のとき、`checks/fixture.csv` の作業コピーが CRLF になり、
> `fixture_match` が `\r` の差で落ちてデモが escalate で終わっていた。
> [更新: 2026-09-28] 本ブランチで直下に `.gitattributes`（`*.csv text eol=lf`）を足したが、main 側の #31（`agent-harness/.gitattributes` と改行非依存の `verify.mjs`）と重複するため取り下げた。main の修正で README の期待出力どおり通過する。

## 5. 期待効果と測り方

- **同じ修復の繰り返し**: `tested_hypotheses` に同じ `failed_checks` が連続して現れる回数を、retro で数える。
- **状態の上書き事故**: `applyPatch` が差し戻した件数を理由別に数える（`未知のキー` / `型が不正` / `削除できないキー`）。
- **トークン**: 再試行ループ1回あたりのプロンプト長を、導入前後で比べる。

## 6. 未解決の論点

- P-1: 本物の LLM を Worker にしたとき、`parseStepOutput` の差し戻しを何回まで再試行するか。
  既定案: Worker 定義の「同じ原因の自動修正は最大3回」に合わせる。
- P-2: 複数の Worker が同じ状態に書き込む場合の競合解決。論文でも未検証。今は1つの状態の書き手は1つの Worker に限る。
