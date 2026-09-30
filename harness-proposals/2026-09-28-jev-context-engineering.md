# Harness 改善提案: Jev 設計メモ由来「権限ポリシー／条件付き指示／小さな引き継ぎ文脈／トークン実測」

- **日付**: 2026-09-28
- **slug**: `jev-context-engineering`
- **起案**: Claude Code (Worker)
- **ステータス**: 提案 C・D は **2026-09-28 承認・実装済み**（`.claude/rules/context-handoff.md`、`.claude/rules/harness-retro.md` 提案6、`scripts/token_breakdown.py`）。提案 A・B は人間承認待ち（DRAFT）— CLAUDE.md §7 に従い、承認前は本体ファイル（CLAUDE.md / AGENTS.md / skills / `.claude/rules/` / settings / hooks）へ反映しない
- **根拠資料**: *JEV ENGINEERING FOR CODING AGENTS — The TypeSafe Founder's Blueprint for Building with Jev*（2026-09、12p）
  - TypeSafe 創業者 Diogo Almeida の設計メモを第三者が学習用に再構成した working note。**TypeSafe 公式ではなく、査読・実験論文でもない**
  - 章別要約訳: 第三者資料の派生物のため、公開リポジトリには置かない（非公開で別管理）

> ⚠️ **適用対象外の確認**: 本提案は「コミット規約／ブランチ運用」「Plans.md の cc:* マーカー」には触れない。
> **提案 A（権限ポリシー）は CLAUDE.md §1「セキュリティ設定の変更」禁止に該当するため、Claude は実装しない。** 本書は設計案の提示に留め、採用・実装・有効化は人間が行う。
>
> ⚠️ **提案の性質**: 元資料は設計思想のメモで、トークン配分表は「例示の推定値」、価格は当時の定価。数値は本ハーネスに転用保証しない。価値は §4 で実測して確かめる。

## TL;DR（3行要約）

- **主張**: エージェントのループ自体は単純で、効くのは「毎ターン何を文脈に置くか」。KV キャッシュ前提の追記型トランスクリプトが、ルーティング失敗・ツール過多・盲目的な圧縮・サブエージェント不発などを生む。トークンの大半は**コードを書くことではなく読む／探すこと**に使われる。
- **提案**: A. 実行前にコマンドの中身まで見る**権限ポリシー**（人間実装）／B. AGENTS.md を**条件付き読み込み＋ディレクトリ別 GOTCHAS.md** に分割／C. Lead→Worker→Lead の**引き継ぎ文脈を小さく保つ**ルール／D. retro に**トークン消費の内訳実測**と**読み取り専用タスクの検索結果共有**を追加。
- **効果**: どれもモデル変更なし。常時文脈の削減、Worker 往復コストの抑制、機密ファイルの事故防止を狙う。§4 の指標で採否を判断する。

### 承認で決まること（決裁事項）

- ✅ 提案 B → C → D の順でフェーズ実装してよい（各フェーズ完了時に §4 指標で効果を確認）
- ✅ 提案 A は**設計案として受理**するだけ。実装・有効化は人間が行う（Claude は hooks / settings を書かない）
- ❌ 承認しても、本体ファイルへの反映は各フェーズごとに**別途レビュー**を経る（一括反映の許可ではない）
- ❌ 自動修正3回・相談3回の上限、禁止事項、cc:* マーカーは対象外

**却下・保留する場合**: 提案単位で可（A〜D は互いに独立）。

---

## 1. 背景: 資料の論点と本ハーネスの対応

| 資料の論点（章） | 本ハーネスの現状 | ギャップ |
|---|---|---|
| IV-A プログラム可能な権限（コマンド名でなく中身を検査） | `settings.local.json` は allow リストのみ。拒否ポリシーなし | 秘密情報・クライアントデータへの誤アクセスを機械的に止めていない |
| VIII 条件付き指示（コンパクションで消えない） | グローバル CLAUDE.md にデプロイ表・ヨシケイ固有手順まで常時読み込み | 無関係な案件でも毎ターン消費。長いセッションでは圧縮で消える恐れ |
| II-A / VI ルーティングは「文脈の作り直しコスト」で評価せよ | breezing の Worker 入力は `task/files/contract` と小さい（◎）。一方、Lead が Worker の結果をどこまで読み直すかは未規定 | 戻り側の再読み込みコストが無制限 |
| III トークンの大半は読み込み・検索。コード記述は1割未満 | worker-report に `turns_used` はあるが、トークンの内訳は取っていない | 「どこを削れば効くか」を判断するデータがない |
| X 読み取り専用のバックグラウンドタスクは検索を1回で共有 | codex-companion review などは各自で対象を探し直す | 同じ差分・関連ファイル探索を重複実行している |

資料 V の「質問が分かる前の要約は必要な情報を捨てる」は、既存の `memory-curation.md`（要約しない・生ログは逐語保存）の追加根拠になる。本提案はその方針と矛盾しない。

---

## 2. 提案

### 提案 A: 実行前ポリシー（PreToolUse フック）— **人間実装・設計案のみ**

- **資料根拠**: IV-A（`deny if command touches ~/.ssh or .env*` / `ask if command writes outside repo root` の例）、IX（ファイルの機密度に応じたルーティング）
- **狙い**: コマンド名での許可ではなく、**対象パスとスクリプトの中身**で判断する。特にヨシケイ案件の `data/`・`config/secrets.yaml`（どちらも gitignored のクライアントデータ／秘密情報）への誤操作を防ぐ。
- **設計案**（人間が採用する場合の雛形。Claude はこのファイルを作らない）:

```diff
# .claude/settings.json（人間が追加）
+{
+  "hooks": {
+    "PreToolUse": [
+      {
+        "matcher": "Bash|Read|Edit|Write",
+        "hooks": [{ "type": "command", "command": "python .claude/hooks/policy_exec.py" }]
+      }
+    ]
+  }
+}
```

```diff
# .claude/hooks/policy_exec.py（人間が追加・判定ロジックの骨子）
+# stdin の tool_input からパス／コマンドを取り出して判定
+# deny : ~/.ssh, **/.env*, **/config/secrets.yaml に触れる
+# deny : 実行対象 .sh/.py の中身に curl/wget/requests 等の外部送信があり、task が deploy でない
+# ask  : リポジトリ root の外への書き込み
+# ask  : git add で data/ 配下（クライアントデータ）が stage される
+# allow: 読み取り専用コマンド（git status/log/diff, ls, cat, grep 等）
+# 判定結果は exit code / JSON で返す（拒否理由を必ず添える）
```

- **未確定点**: フックの入出力仕様（exit code／JSON の形式）は、導入時に Claude Code の現行ドキュメントで確認すること（バージョンで変わりうる）。
- **運用**: 最初は `ask` 中心で1〜2週間試し、誤検知を見てから `deny` に上げる。

### 提案 B: 条件付き指示 ＋ ディレクトリ別 GOTCHAS.md

- **資料根拠**: VIII（`*.tsx` → スタイルガイド、`billing/` → `billing/GOTCHAS.md`。各サブディレクトリに落とし穴ファイルを置くことを推奨。条件が成り立つたびに読み直されるのでコンパクションで消えない）
- **変更案 B-1**: グローバル CLAUDE.md の**案件固有の節を各リポジトリへ移す**（内容は逐語で移送し、要約しない＝`memory-curation.md` 準拠）

```diff
# C:\Users\hiroshi_takizawa\CLAUDE.md（人間が反映）
-## ヨシケイ開発 CRレポート自動化 — データ管理フォルダ構成
-（フォルダ構成・月次手順・orchestrator コマンド・重要事項 … 全文）
+## 案件固有の手順
+案件ごとの手順は各リポジトリの CLAUDE.md / GOTCHAS.md を参照（例: yosikei-agents/CLAUDE.md）。
```

```diff
# C:\Users\hiroshi_takizawa\yosikei-agents\CLAUDE.md（新規 or 追記・上の節を逐語で移送）
+## データ管理フォルダ構成
+（グローバル CLAUDE.md から移した本文をそのまま）
```

- **変更案 B-2**: 落とし穴ファイルの規約を追加

```diff
# AGENTS.md または .claude/rules/gotchas.md（新規・人間承認後）
+## GOTCHAS.md 規約
+- 事故が起きやすいディレクトリに GOTCHAS.md を置く（例: data/, config/, infra/, billing/）
+- 1項目 = 「何をするとどう壊れるか」＋「正しい手順」＋「発見日」。3〜10行
+- 古くなった項目は消さず `[更新: YYYY-MM-DD]` を追記（memory-curation.md の in-place 更新）
+- 同じ落とし穴で2回以上失敗したら、retro がその GOTCHAS.md への追記を提案する
```

- **変更案 B-3**: `.claude/rules/` の各ファイルに**パス条件**を付け、該当ファイルを触るときだけ読み込む（Claude Code のパス条件付きルールの frontmatter 仕様は、導入時に現行ドキュメントで確認すること）
- **注意**: デプロイ表（§5）は複数案件をまたぐので、グローバルに残してよい。移すのは「1案件でしか使わない手順」だけ。

### 提案 C: 引き継ぎ文脈を小さく保つ（Lead ⇄ Worker）

- **資料根拠**: II-A の試算。単価を基準に「Opus→Sonnet→Opus」と振ると、安いモデルの文脈読み込み（3X）と上位モデルの読み直し（5(Y+Z)）が加わり、**4.15 → 6.19 と約1.5倍に高くなる**。成り立つのは「安い側に小さな専用文脈を渡し、戻りで全部を読み直させない」場合だけ（VI）。
- **現状評価**: 行き（Lead→Worker）は `task/files/contract` 形式で既に小さい。欠けているのは**戻り（Worker→Lead）**の規律。
- **変更案**（新規 `.claude/rules/context-handoff.md`・人間承認後）:

```diff
+# 引き継ぎ文脈ルール
+## 行き（Lead → Worker / サブエージェント）
+- 渡すのは task / files / contract / 必要な GOTCHAS.md のパスだけ。会話履歴は渡さない
+- 「念のため」の追加資料は付けない。必要なら Worker が files 内で自分で読む
+## 戻り（Worker → Lead）
+- Lead は worker-report.v1（summary / self_review evidence / files_changed）をまず読む
+- 全文 diff を読むのは (a) self_review に verified:false がある (b) Reviewer が指摘した
+  (c) security-sensitive (d) 生成ファイルを除いた変更行数が 300 行を超える ときだけ。
+  それ以外は `git diff --stat` とレポートで判断する
+- (d) の行数は `git diff --numstat` で数え、*.lock / package-lock.json / dist/ / *.min.* は除く
+- 生ログは harness-logs に逐語で残す（要約しない）。Lead が「読むか」と「残すか」は別の判断
+## 振り分けの判断
+- 安いモデル・サブエージェントに振るかは、トークン単価ではなく「渡す文脈量＋戻りの読み直し量」で見積もる
+- 渡す文脈が親セッションの大半になるなら振らない（上位モデルのまま進める方が安い）
```

- **既存ルールとの整合**: Worker 契約（effort は呼び出し側が決める、Agent 起動禁止）は変えない。Lead 側の読み方を決めるだけ。

### 提案 D: retro にトークン内訳の実測と検索結果の共有を追加

- **資料根拠**: III（読み込み 30〜40%・検索 10〜18%・コマンド出力 10〜20% に対し、コード記述は 4〜10%。fastcontext の報告では読み込み・検索がツール使用ターンの56.2%）、X（読み取り専用タスクで検索を共有するのが最大の節約）
- **変更案 D-1**: worker-report に任意フィールドを追加（**既存フィールドは変えない**）

```diff
 {
   "schema_version": "worker-report.v1",
   ...
   "turns_used": 12,
+  "tool_usage": {                // 任意。取れる範囲で記録
+    "read_calls": 0, "search_calls": 0, "bash_calls": 0, "edit_calls": 0,
+    "largest_output_lines": 0,   // 1回で最大の出力行数（肥大化の兆候）
+    "reread_files": []           // 同じファイルを2回以上読んだもの
+  },
```

- **変更案 D-2**: `harness-retro.md` の健全性チェックに項目を追加

```diff
 # .claude/rules/harness-retro.md（人間承認後）
 ## 提案5: 成長前提のストア健全性チェック（RQ4）
 ...
+4. **トークン内訳**: 直近10タスクの tool_usage を集計し、読み込み＋検索＋コマンド出力の比率を出す。
+   比率が高い＝改善の余地は「検索の賢さ」にある（モデル強化より先に、提案4のツールセット見直しへ）。
+5. **読み直し**: `reread_files` に同じファイルが頻出するなら、そのディレクトリの GOTCHAS.md
+   または要点メモ化を検討する（提案 B と連動）。
```

- **変更案 D-3**: 読み取り専用のバックグラウンドタスク（codex-companion review、クロスレビュー等）は、**Worker が作った `files_changed` と `git diff --stat` を共通の入力**として受け取り、各自でリポジトリ全体を探し直さない。
- **既存ルールとの整合**: `harness-retro.md` 提案4（モデルより先にツールセットを見直す）の判断材料になる。

---

## 3. 採用しなかった論点（参考）

| 資料の論点 | 見送り理由 |
|---|---|
| V チャンクごとの表示段階（全文〜非表示）を毎ターン判定 | Claude Code 側の文脈組み立てを制御できないため再現不可。考え方は提案 C の「戻りで全部読まない」に反映 |
| VII ツールの3段階開示 | skills（説明だけ先読み）と deferred tools で既に近い挙動。追加の仕組みは不要 |
| IX 機密度ルーティング（④） | 今回のスコープ外（ユーザー指定で①②③⑤のみ）。提案 A のポリシーで部分的に代替 |

---

## 4. 効果測定（承認後・各フェーズで実測）

| 指標 | 測定方法 | 期待方向 |
|---|---|---|
| 常時読み込みの指示量 | グローバル CLAUDE.md＋AGENTS.md の行数（B の前後） | 減少（ヨシケイ節の移送で約40行減の見込み） |
| 同じ落とし穴での再発 | retries.log で同一 error_signature が別タスクで出た回数 | 減少（GOTCHAS.md 導入後） |
| Lead の全文 diff 読み込み率 | review.json に「全文 diff を読んだか」を記録（C の前後 各20タスク） | 減少。ただし APPROVE 後の手戻り率は悪化しないこと |
| 読み込み＋検索の比率 | D-1 の tool_usage 集計 | ベースライン把握 → ツールセット改善後に減少 |
| ポリシーの誤検知（A・人間運用） | ask / deny の発火ログのうち誤りだった件数 | 1〜2週間で deny に上げられる水準か判断 |

効果が確認できない提案は、その時点で止めて撤回してよい。

## 5. 論点の決定（P-1〜P-4 すべて 2026-09-28 確定）

- **P-1**: ✅ **確定（2026-09-28）**: 移す範囲は次のとおり（行数はグローバル CLAUDE.md 252行の実測）
  - **移す**: 「ヨシケイ開発 CRレポート自動化」節（54行）→ `yosikei-agents/CLAUDE.md`
  - **移す**: §5 のうち1案件専用の詳細表 — hermes_agent_dashboard（13行）・AuraSense（14行）・UI Parts Design Dictionary（16行）→ 各リポジトリの CLAUDE.md
  - **残す**: §5 に1案件1行の索引（名前・本番URL・リポジトリ）。UI Parts は「社内限定・一般公開不可」を索引行にも残す（他リポジトリからの誤デプロイ防止）
  - **残す**: 社内ダッシュボード5本の表（5本共通の仕様なので横断情報）、ダッシュボード品質基準（全プロジェクト共通）
  - 見込み: 約97行を移し、索引など約7行を足して **252行 → 約160行（約37%減）**
  - 移送は逐語（`memory-curation.md` 準拠）。グローバル CLAUDE.md の書き換えは人間が行う（§7）
- **P-2**: ✅ **確定（2026-09-28）**: 閾値あり・**300行**。生成ファイル（*.lock / package-lock.json / dist/ / *.min.*）は数えない。§4 の「全文 diff 読み込み率」と手戻り率を20タスクほど見て見直す
- **P-3**: ✅ **確定（2026-09-28）**: **フェーズ1は Worker の自己申告**で始める
  - 理由: フックでの自動計測は設定変更に当たり人間の作業になる。自己申告なら提案 D だけで今すぐ始められる
  - `tool_usage` は任意項目のまま。未記入でも review で差し戻さない
  - 信頼性の確認: `largest_output_lines` は `commands.stdout.log` の実際の行数と突き合わせる。ずれが大きければ自己申告をやめる判断材料にする
  - フェーズ2（任意）: 20タスク分集計して有用と分かったら、人間がフックでの自動計測に切り替えるか判断する
- **P-4**: ✅ **確定（2026-09-28）**: **ai-platform-template で先に試し、その後 yosikei-agents に広げる**
  - 手順: ① ai-platform-template で「確認（ask）」だけで2週間運用 → ② 誤検知を直して「拒否（deny）」に上げる → ③ yosikei-agents に展開
  - 同時に入れない理由: yosikei-agents には月次運用（STOP①②③の手作業あり）があり、誤検知で作業が止まると影響が大きい。展開は月次の締め作業期間を避ける
  - yosikei-agents では `data/` の stage 確認と `config/secrets.yaml` の拒否を最優先で入れる（クライアントデータ保護の効果が最も大きい）
  - 実装・有効化は人間（提案 A の前提どおり）

---

## 付録: 関連

- 章別要約訳: 非公開で別管理（公開リポジトリには置かない）
- 関連ルール: [`.claude/rules/memory-curation.md`](../.claude/rules/memory-curation.md)（逐語保存）／[`.claude/rules/harness-retro.md`](../.claude/rules/harness-retro.md)（ツールセット優先）
- 姉妹提案: [`2026-09-17-ngu-effort-reallocation.md`](2026-09-17-ngu-effort-reallocation.md)（effort の配分）。本提案は「何を文脈に置くか」を扱い、NGU 提案は「どこに計算を割くか」を扱う。両者は相補的
