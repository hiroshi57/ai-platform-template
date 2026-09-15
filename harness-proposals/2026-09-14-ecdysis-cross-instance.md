# Harness 改善提案: ECDYSIS 由来の「横断的失敗集約」＋「失敗の帰属分類」

- **日付**: 2026-09-14
- **slug**: `ecdysis-cross-instance`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— 本提案は CLAUDE.md §7 の運用に従い、承認前は本体ファイルへ反映しない
- **根拠論文**: ECDYSIS: Efficient and Effective Training of Runtime Harnesses for LLM Agents
  - arXiv:2609.11677 (2026-09-10, cs.SE)
  - コード: https://github.com/cuiyu-ai/Ecdysis

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約/ブランチ運用」「Plans.md の cc:* マーカー」には一切触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。対象は harness-retro / worker self_review / ログスキーマの運用改善のみ。

## TL;DR（3行要約）

- **課題**: 現行 harness-retro は「失敗の帰属（モデル固有のクセ vs ハーネスの体系欠陥）」を分けず、単一タスクの再試行でも改善提案が発火しうる → 特定モデルへの過剰適合で汎化が壊れる。
- **提案**: ①横断再発（別タスク2件以上）だけを改善対象にする（A）②失敗帰属フィールドを必須化（B）③提案生成をFDCR多役割診断にする（C）④Worker自己点検にモデル固有適応の検知ルールを常時追加（D）。
- **効果（論文値）**: 訓練最大1.84×高速化・精度+18.56%・改善コスト最大−70%・クロスモデル汎化向上。※本ハーネスは軽量移植のため同値は保証せず、§4で実測する。

### 確定した調整（2026-09-14 レビュー反映）

| 項目 | 決定 | 補足 |
|---|---|---|
| A-1 横断タスク閾値 | **2** | 別 task_id 2 件以上で「横断再発」 |
| B-2 帰属の記入者 | **全員必須** | Worker が暫定自己申告 → Reviewer/Lead が確定 |
| B-6 帰属フィールド | **必須** | 記入なしは review 差し戻し |
| C-3 FDCR 適用範囲 | **全プロジェクト** | コスト増を許容。C-2 往復は 2 回で開始 |
| D-1 self_review ルール | **常時確認・advisory** | 毎タスク点検。違反は警告のみ（自動差し戻ししない） |

その他のツマミは既定値（A-2=直近10 / A-3=3回 / A-4=retries.logのみ / A-5=task_id完全一致 / B-1=3値 / B-3=review.json / B-4=modelはプロンプト微調整のみ / B-5=ambiguousは無期限保留 / C-1=4役 / C-2=2往復）を採用。**C-5 のみ調整: Critic の必須検査を 4 点に増やし論文（§3.4/L135）準拠**（runtime 契約違反を追加）。

### 承認で決まること（決裁事項）

このドキュメントを承認すると、以下が確定する。**コード/本体ファイルの変更はまだ発生しない**（承認は各フェーズ着手の GO サイン）。

- ✅ 提案 A〜D を **フェーズ 1→2→3→4 の順で実装してよい**（各フェーズ完了時に §4 の指標で効果を確認し、次へ進む）
- ✅ §1 で定義した**用語・帰属分類（harness / model / ambiguous）を共通語彙として採用**する
- ✅ §6 の未解決論点は**フェーズ着手前に個別確定**する（承認＝論点を潰す作業の開始許可）
- ❌ 承認しても、CLAUDE.md / AGENTS.md / skills への反映は各フェーズごとに**別途レビューを経る**（本承認は一括反映の許可ではない）

**却下・保留する場合**: フェーズ単位で可（例「B/A/D は承認、C は保留」）。提案は相互に独立実装可能（依存関係は §3 参照）。

---

## 1. 背景と課題

現行の Self-Tuning Harness Loop（CLAUDE.md §7、元ネタ arXiv:2603.28052）は、
生ログを蓄積し harness-retro で改善提案を出す設計になっている。起動条件は既に
「同一 `escalation_reason` / `reason_code` が直近10タスク中3回以上再発」であり、
**再発パターン重視**という思想は正しい方向にある。

ECDYSIS はこの方向性を理論・実験で裏付けたうえで、現行運用に欠けている 2 点を指摘する。

> **用語**: 本書では「モデル固有適応（model-specific accommodation）」を、ハーネスを特定モデルの
> クセに合わせて歪める修正の意で用いる（論文用語に統一。以下「忖度」等の口語は用いない）。
> **t** = coding-agent が出した全修正判断のうち、モデル固有適応が占める割合（§3.1）。t が高いほど過剰適応。

1. **失敗の帰属（attribution）が未分離**
   観測された失敗には 2 種類ある（ECDYSIS §3.1 / L15, L29）:
   - `model-specific accommodation`（モデル固有適応）: そのモデル固有のクセ由来 → ハーネスをそれに合わせて歪めるべきでない
   - `harness-level repair`（ハーネス修復）: ハーネス機構自体の体系的欠陥 → これを直すべき
   個別失敗に反応して直すと、モデル固有適応が過剰になり**汎化が壊れる**。
   実測でモデル固有適応の割合 t は Self-Evolution=60.0% に対し ECDYSIS=45.5%（-14.5pt, §8.3 / L446）。

2. **「単一タスクの繰り返し」と「複数タスク横断の再発」を区別していない**
   ECDYSIS は「**2つ以上の異なるタスクで再発した失敗**のみを体系的欠陥の強い証拠」とする
   （§3.3 / L118: "prioritizes groups that cover at least two distinct tasks"）。
   現行の「10タスク中3回」は同一タスクの再試行3回でも発火しうる。

### 期待効果（論文実測値）

| 指標 | ECDYSIS 効果 | 出典 |
|---|---|---|
| ハーネス訓練の高速化 | 最大 **1.84×**（w/ FDCR）/ 3.23×（w/o FDCR） | §5.3, Table 6 / L432 |
| 推論精度 | **+18.56%**（5モデル3データセット平均、SE比） | §6.1 / L202 |
| 改善 API コスト削減 | 最大 **-70.71%** | §7.2, Table 4 / L409 |
| クロスモデル汎化 | Qwen3-8Bで進化→他モデルに転移 | §6.1 / L202 |
| 推論トークン削減 | **-12.19%** | §6.2 / L205 |
| 訓練データ | **1/4** でフル訓練と同等 | §8.2 / L443 |

> ⚠️ **数値の注意**: 上表はいずれも **ECDYSIS 論文の実測値**（Qwen3/MiniMax/Llama × τ²-Bench/AgentBench 環境）であり、
> 本ハーネス（Claude Code + 本リポジトリ運用）は論文手法の**軽量移植**のため同等の効果を保証しない。
> 実際の効果は §4 の検証方法に従い、導入前後で自前計測して判断する。

---

## 2. 提案する変更（すべて人間承認後に適用）

### 提案 A（フェーズ2）— harness-retro の起動条件に「横断タスク要件」を追加

**対象**: `scripts/harness-retro.sh --check` の閾値判定（CLAUDE.md §7「改善提案の起動条件」）

```diff
 起動条件（改善前）:
-- 同一プロジェクトで同じ escalation_reason / advisor reason_code が
-  直近10タスク中3回以上再発したとき
+起動条件（改善後 / ECDYSIS §3.3 に準拠）:
+- 同一 escalation_reason / reason_code が直近10タスク中3回以上（A-3=3回維持）、
+  かつそのうち **2つ以上の異なる task_id（別タスク）** で再発したとき（A-1=2、横断再発）
+- task_id は完全一致で「別タスク」判定する（A-5。43.3.1 と 43.3.2 は別物として数える）
+- 観測ウィンドウは直近10タスク（A-2、現行踏襲）
+- 単一 task_id の再試行のみで 3 回に達した場合は「弱い証拠」として
+  harness-proposals には出さず retries.log に記録するだけに留める（A-4）
```

**判定ロジック（擬似）**:
```
count      = 直近10タスクでの同一 reason_code の発生回数
distinct   = そのうちの異なる task_id 数
if count >= 3 and distinct >= 2:  → harness-proposals 候補（横断再発）
elif count >= 3 and distinct == 1: → retries.log にのみ記録（弱い証拠）
else: 何もしない
```

**根拠**: ECDYSIS §3.3 / L118「repeated failures from a single task alone do not establish
that the underlying failure mechanism generalizes across tasks」。
**期待効果**: モデル固有クセへの過剰適合を抑え、CLAUDE.md/skills の不要な改変を減らす。

---

### 提案 B（フェーズ1）— worker-report / review に「失敗帰属」フィールドを追加

**対象**: CLAUDE.md §7 のログスキーマ（`worker-report.json` / `review.json`）

```diff
 worker-report.json（改善後、Worker が暫定自己申告）:
 {
   ...
+  "failure_attribution_provisional": "harness | model | ambiguous"
 }

 review.json（改善後、Reviewer/Lead が確定・必須フィールド）:
 {
   "verdict": "REQUEST_CHANGES",
   "reason": "...",
+  "failure_attribution": "harness | model | ambiguous",   // 必須（B-6）
+  "attribution_confirmed_by": "reviewer | lead",           // 確定者（B-2）
+  "cross_task_recurrence": {
+    "reason_code": "retry-threshold",
+    "distinct_task_ids": ["43.3.1", "44.2.0"],   // 別タスクで再発したか
+    "single_task_repeats": 1
+  }
 }
```

- **記入フロー（B-2＝全員必須）**:
  1. Worker は worker-report に `failure_attribution_provisional` を**必ず**記入（暫定・自己申告）
  2. Reviewer/Lead は review.json の `failure_attribution` を**必ず**確定記入（権威値）
  3. Worker の暫定値は参考情報。確定は必ず Reviewer/Lead が行う（自己申告バイアス回避のため自己申告を最終値にしない）
- **必須化（B-6）**: `failure_attribution` が空の review は不備として差し戻し。
- `failure_attribution` の意味:
  - `harness` = skill / CLAUDE.md / スクリプトの体系的欠陥（→ harness-proposals 候補）
  - `model` = Opus 固有のクセ（→ ハーネスをモデルに合わせて歪めない。プロンプト微調整に留める。B-4）
  - `ambiguous` = 証拠不足（→ 横断再発するまで無期限に修正を保留。B-5）
- 記録先は review.json（B-3）。worker-report には暫定値のみ。

**根拠**: ECDYSIS §3.1 / L15,L29 の attribution 概念、§8.3 / L445-446 の t（モデル固有適応の割合）分析。
**期待効果**: 特定モデルへの過剰適合（harness evolution drift）の予防。監査可能な形で「なぜ直さなかったか」を残せる。

---

### 提案 C（フェーズ4）— harness-proposals 生成を FDCR 構成に（診断と実装の分離）

**対象**: CLAUDE.md §7「改善提案のルール」の生成プロセス

ECDYSIS の FDCR（§3.4 / L134-141）を軽量に写す。既存の「人間承認を経てから反映」ルールとは矛盾しない。

```diff
 改善提案の生成（改善後）:
+1. [診断] 横断再発した失敗グループを入力に、多役割で分析する
+   - Analyst : ハーネス欠陥を特定し最小限の修正案を提案
+   - Critic  : 過剰トリガー / 正当動作の阻害 / runtime 契約違反 / 既存タスクのリグレッションを検査
+   - Moderator: 保守的に統合し「構造化された修正仕様」を出力（diff は書かない）
+2. [実装] 上記仕様＋根拠ログを元に diff 形式の改善案を harness-proposals/ に出力
 3. 本体ファイル（CLAUDE.md / AGENTS.md / skills）への直接書き込みは行わず、
    必ず人間の承認を経てから反映する（← 既存ルール維持）
```

**適用範囲（C-3＝全部）**: FDCR を全プロジェクトの harness-proposals 生成に適用する。
役割は 4 役（Analyst/Critic/Engineer/Moderator、C-1）、リファインメント往復は 2 回で開始（C-2）、
Critic の必須検査は「過剰トリガー / 正当動作の阻害 / runtime 契約違反 / 既存タスクのリグレッション」の 4 点
（C-5、ECDYSIS §3.4 / L135 に準拠）。

**根拠**: ECDYSIS §3.4 / L140-141「FDCR diagnoses ... whereas the coding agent performs
the actual harness modification. This separation keeps failure analysis structured」。
**期待効果**: 提案の質向上（精度 +4.67%相当の FDCR 上乗せ、§5.2 / L197）とリグレッション事前検知。
**コスト注記**: FDCR は精度志向で追加コストがかかる（§5.3 / L199、往復 2 回・4 役ぶんのモデル呼び出し）。
全適用のため、コスト超過が観測された場合の縮退策として **C-2 を往復 1 回に落とす／C-1 を 3 役(Engineer 省略)に減らす**
を事後調整の逃げ道として用意する（初期値は 2 往復・4 役）。

---

### 提案 D（フェーズ3）— worker self_review に「横断再発チェック」ルールを追加（常時確認・advisory）

**対象**: worker-report.v1 の `self_review`（harness.toml `[worker.self_review]` の override 経由）

**位置づけ（D-1）**: 毎タスクで**常に**自己点検する standing ルールとして追加する。ただし
既存の必須 5 ルールとは分け、**advisory（助言）扱い**とする。すなわち `verified:false` でも
**自動 REQUEST_CHANGES にはせず、警告として記録**する（D-4＝警告のみ）。適用は全 mode（D-2）。

```diff
 self_review（advisory ルールを常時追加）:
+{ "rule": "failure-not-model-overfit",
+  "advisory": true,                // 必須5ルールと区別。verified:false でも自動差し戻ししない
+  "verified": true,
+  "evidence": "本修正は単一タスク固有のモデルクセ回避ではなく、別タスクでも再発する
+               harness 欠陥に対処している（該当 task_id を明記）。該当しない場合は
+               attribution=model として skill を書き換えない" }
```

- **常時確認**: このルールは毎回 self_review に含め、evidence の記入を求める（記入自体は必須）。
- **advisory の意味**: 判定が `verified:false` でも Lead は自動差し戻しをせず、warning として review に残す。
  Lead が内容を見て必要と判断したときのみ REQUEST_CHANGES にできる（人間/Lead の裁量に委ねる）。
- 提案 B の `failure_attribution_provisional` とセットで機能（Worker がここで model と自認したら skill 改変を避ける）。

**根拠**: ECDYSIS §8.3 / L445「removes a legitimate action option to avoid a specific model
error ... shrink the valid action space」= 有効行動空間を狭める過剰適合の警告。
**期待効果**: Worker 段階でモデル固有適応型の修正を自己検知（強制はせず、気づきを与える）。

---

## 3. 段階導入プラン

| フェーズ | 内容 | 依存 | リスク | 可逆性 |
|---|---|---|---|---|
| 1 | 提案 B（ログスキーマ拡張・必須帰属）— Worker暫定→Reviewer/Lead確定 | なし（基盤） | 小（記入負荷） | ◎ フィールド追加のみ。停止＝記入をやめるだけ |
| 2 | 提案 A（起動条件に横断要件 A-1=2）— 誤発火を減らす方向 | B推奨（帰属集計に依存） | 小 | ◎ 閾値ロジックを旧条件に戻せる |
| 3 | 提案 D（self_review・常時 advisory）— 警告のみ、自動差し戻しなし | B推奨 | 小 | ◎ ルール1行の追加/削除 |
| 4 | 提案 C（FDCR 生成・全プロジェクト適用）| なし（Aと独立） | 中（コスト増、縮退策あり） | ○ 生成プロセス切替。旧単段生成に戻せる |

- **依存関係**: B は帰属フィールドを定義する**基盤**で、A・D はその集計/自己申告値を活用するため B 先行が望ましい（必須ではない）。C は A/B/D と独立に単独導入可能。
- **可逆性**: 全フェーズが可逆。挙動が悪化したら該当フェーズのみ切り戻せる（他フェーズを巻き込まない）。
- **フェーズ4の縮退策**: コスト超過が出たら C-2（往復 2→1）／C-1（4役→3役）で段階的に縮退する（§2 提案 C に併記）。

---

## 4. 検証方法（提案採用後）

各フェーズは以下の**成功指標**を満たせば次へ進み、**撤回基準**に触れたら §3 の可逆性に従い切り戻す。
比較のベースラインは導入前の直近実績、枠組みは ECDYSIS §4.1（Direct / Human-Aug. / Self-Evolution / ECDYSIS）を参照。

| 提案 | 成功指標（改善の判定） | 撤回基準（悪化の判定） | データ源 |
|---|---|---|---|
| B | 帰属フィールド記入率 ≥ 95%、`ambiguous` 比率が時間とともに低下 | review 差し戻しが記入漏れ起因で常態化（運用が回らない） | review.json 集計 |
| A | 単一タスク由来の提案発火が減り、発火した提案の採用率が向上 | 横断要件のせいで本来直すべき欠陥を取りこぼす（見逃し増） | harness-proposals / retries.log |
| D | `failure-not-model-overfit` が false のまま反映された修正がクロスモデルで回帰しない | advisory が形骸化（毎回コピペ evidence で意味を成さない） | worker-report / review.json |
| C | 「後で撤回された harness 修正」件数が導入前より減少 | 提案生成コストが便益に見合わない（§6-4 の基準超過） | harness-proposals / API コストログ |
| 全体 | `failure_attribution=harness` とラベルした修正が**別プロジェクトでも再利用**された実績（汎化の証拠） | 特定モデル専用の修正が増える（t 相当の指標が上昇） | harness-logs 横断集計 |

**計測タイミング**: 各フェーズ導入後、最低 10 タスク or 1 か月のいずれか早い方で一次評価。全体指標は四半期ごと。

---

## 5. 根拠ログへのリンク

- 論文全文（抽出テキスト、恒久保存済み）: `harness-proposals/evidence/arxiv-2609.11677-ecdysis.txt`
- 主要引用箇所: L15, L29（attribution）/ L118（2タスク以上要件）/ L134-141（FDCR）/
  L197,L199（FDCR 効果とコスト）/ L202,L205（汎化・トークン）/ L432（速度）/ L443（1/4データ）/ L446（t=45.5%）
- 関連する既存設計: `C:\Users\hiroshi_takizawa\CLAUDE.md` §7 Self-Tuning Harness Loop（元ネタ arXiv:2603.28052）

---

## 6. 未解決の論点（Open Questions）

承認前後に決める必要がある宿題。実装着手前に方針を確定する。

1. **t（モデル固有適応の割合）を自前でどう測るか**
   論文は手動分析で t を算出（§8.3）。本運用では review.json の `failure_attribution` 集計で近似できるが、
   coding-agent の「修正判断」単位をどう数えるか（提案1件＝1判断か、diff hunk 単位か）は要定義。
2. **advisory ルール（提案 D）の警告をどこまで運用に効かせるか**
   `verified:false` が続いても自動差し戻ししない設計だが、放置を防ぐため
   「直近 N 件で M 回 false なら Lead へ通知」等の二次トリガーを設けるか要検討。
3. **B-5 の無期限保留の棚卸し**
   `ambiguous` を無期限保留にすると滞留する。定期棚卸し（例: harness-retro 実行時に一覧提示）の要否。
4. **提案 C のコスト実測とスコープ**
   全プロジェクト適用だが、コスト超過ラインをどこに置き、いつ縮退（C-2 往復2→1／C-1 4→3役）するかの基準値は未定。
5. **既存 harness-logs との後方互換**
   帰属フィールド追加前の過去ログは `failure_attribution` 欠損。集計時に「欠損＝ambiguous扱い」でよいか。

---

## 7. この提案の適用スコープ確認（NG チェック）

- [x] CLAUDE.md / AGENTS.md / skills を直接編集していない（提案ドキュメントのみ）
- [x] 「禁止事項」「コミット/ブランチ規約」「Plans.md cc:* マーカー」に触れていない
- [x] 人間承認前提のドラフトであることを明記
