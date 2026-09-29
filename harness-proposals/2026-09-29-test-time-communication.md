# Harness 改善提案: 並列 Worker の「通信あり / 独立」をスコアの有無で切り替える

- **日付**: 2026-09-29
- **slug**: `test-time-communication`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）
- **根拠資料**: Park, Kontonis, Garg, Krishnamurthy, Papailiopoulos, *Scaling Discovery through Test-Time Communication*, arXiv:2609.21032v1 [cs.LG], 2026-09-17（UC Berkeley / Microsoft Research）
  - https://arxiv.org/abs/2609.21032
  - 実装・プロンプト・タスク: https://github.com/jerryjonghopark/test-time-communication
  - 本文は第三者の著作物なので repo には保存しない。以下の「§」は論文の節番号

> ⚠️ **適用対象外の確認**: 本提案は「禁止事項」「コミット規約 / ブランチ運用」「Plans.md の cc:* マーカー」には触れない（CLAUDE.md §7 の自動改善対象外リストを尊重）。breezing の NG-1（cc:* マーカーは Lead が持つ）・NG-3（Worker は Agent を呼ばない）もそのまま残す。対象は**並列の方式を選ぶルールと、通信ありモードの共有ファイルの約束事**だけ。
>
> ⚠️ **提案の性質**: 論文の実験は、1体あたり数時間〜96時間、出力トークンは数百万〜数千万という規模。本ハーネスの通常タスクはこれより桁違いに小さく、論文の言う「最初のコスト（coordination tax）」の方が大きくなる可能性が高い。そのため本提案は**既定を変えない opt-in の実験**として出す。既定の breezing（独立 Worker・タスク分割）は変えない。

## TL;DR（3行要約）

- **主張**: 同じ目的のエージェント k 体に共有ディレクトリで途中経過を共有させると、独立に k 体走らせて最良を選ぶより大きく勝つことがある（ARC-AGI-3 で team@5 が独立33体と同等、MNIST 圧縮で人間の最良解を 20% 下回る）。ただし**途中で何度も測れる客観スコアがあること**と、**1体あたりの予算が十分なこと**が条件。どちらかが欠けると独立並列の方が勝つ（Terminal-Bench 2.0、低予算時）。
- **提案**: ① 並列の方式（`solo` / `independent` / `team`）を、task.json の事実から**コードで**選ぶ規則を作る（A）② `team` のときの共有ワークスペースの約束事を決める（B）③ retro に「群がり（herding）」と「最初のコスト」の確認を足す（C）④ Worker 定義（plugin 側）への追記は人間が反映する（D）。
- **効果**: スコアで測れる最適化タスク（表示速度・バンドルサイズ・クエリ速度・テスト通過数など）で、同じ予算のまま結果を伸ばせる見込み。スコアが無いタスクで無駄にチームを組むことも防げる。まず shadow で1〜2件試して実測する。

### 承認で決まること（決裁事項）

- ✅ 提案 A・B を新しいルールファイル [`.claude/rules/parallel-mode-selection.md`](../.claude/rules/parallel-mode-selection.md) として作る（§3 diff 1）
- ✅ 提案 C を [`.claude/rules/harness-retro.md`](../.claude/rules/harness-retro.md) に提案9として追記する（§3 diff 2）
- ✅ task.json に任意項目 `scorer` / `budget` / `parallel_mode` を足す（無ければ今までどおり）
- ❌ 既定の breezing の挙動は変えない。`team` は Lead または人間が明示したときだけ
- ❌ Worker / Lead のエージェント定義（plugin 側の `claude-code-harness-worker` 等）は本 repo の管理外。diff 3 は**人間が反映**する
- ❌ 論文の数値（4.3倍・6.6倍など）を本ハーネスの期待値として使わない。規模が違うため、実測で決める

**却下・保留する場合**: 提案単位で可。A だけ採る（方式の選び方だけ決めて、`team` は使わない）ことも可能。B・C は A に依存する。

---

## 1. 背景: 論文の要点と本ハーネスとの対応

| 論文の知見 | 節 | 本ハーネスの現状 | ギャップ |
|---|---|---|---|
| 同じ予算なら、通信する k 体（team@k）は独立 k 体の最良（best@k）より良い。チームが大きいほど差が広がる | §3.1, 表2 | breezing は**タスクを分割して**並列に回す。同じタスクを複数 Worker で解く方式はない | 分割できないタスクを並列で解く方法がない |
| 効くのは**途中で何度も測れる検証器**があるとき（verified progress sharing）。最後に一度だけ判定されるタスクでは効かない | §3.4, 表3 | 検証は `validation_commands`（主に合否） | 「途中で測れる数値スコアがあるか」を task に書く欄がない |
| 予算が少ないとチームは負ける（1体あたり 0.2倍の予算では単体にも負けた） | §3.1, 図3・4 | 予算の概念は effort と自動修正の回数だけ | 方式を選ぶときに予算を見ない |
| 全員が同じ方向に群がると、k 体が実質 g 群（g < k）に減って効果が消える | §3.4 | 該当なし | 群がりを検出する手段がない |
| 乗り換えは測って再現できた優位があるときだけ。乗り換えても違いを1つ残す | §2, 付録 A.2 | `judge-rubric.md` ルール4（自己申告を証拠にしない）は判定器向け | エージェント同士の採用基準がない |
| 3回続けて改善しなければ、パラメータ調整ではなく構造的に違う手法の系統へ移る | 付録 A.2 | `decision-boundaries.md` ルール1（リトライのたびに新しい情報を得る） | **ほぼ同じ考え方**。team では「系統を変える」を明示する |
| 採点データはエージェントの環境の外に置き、スコアだけ返す | §2.1, 付録 A.4・A.5 | `secret-isolation.md` ルール2（値はツール側で読む） | **同じ考え方**（diff 不要） |
| プロンプトでインターネットと秘密の利用を禁止 | 付録 A.2 | `secret-isolation.md`、`.claude/settings.json` の deny | **ギャップなし** |

**含意**: 本ハーネスに足りないのは「同じタスクを複数体で解く方式」そのものより、**どの方式を選ぶかの基準**。論文の一番大事な結果は「条件がそろわないと通信は損」という否定的な部分で、ここはコードで判定できる（`decision-boundaries.md` ルール2「条件を厳密に守らせるならコード」）。

## 2. 現行運用の不足点

### 2.1 並列の方式を選ぶ基準がない
breezing はタスクを分割して回す。分割できない最適化タスク（1つの数値をひたすら良くする作業）を並列で速く進める手段がなく、使うとしても「何となく複数回やって一番良いものを選ぶ」になる。どちらが得かを判断する基準がない。

### 2.2 Worker 間で途中経過を共有する場所がない
Worker は各自の worktree で動き、Lead が結果を cherry-pick する。ある Worker が見つけた改善（または「この方向は行き止まり」という結果）が、まだ走っている他の Worker に届かない。論文 §1 が指摘する「独立試行では、1つの run の発見が他の run の探索に使えない」状態そのもの。

### 2.3 スコアがあるかどうかを task に書く欄がない
`validation_commands` は主に合否の確認に使われる。「途中で何度でも実行できて、数値や段階で進み具合を返すコマンド」があるかどうかが task.json から読めないので、方式を選ぶ入力にできない。

### 2.4 Worker の「止まる」規則が最適化タスクに合わない
Worker 定義の「同じ原因の自動修正は最大3回 → escalated」はエラー復旧の規則。最適化タスクでは「動いているが、もっと良くできる」状態が続くので、どこで止めるかの規則が別に要る（論文は「時間が尽きるまで止まらない」「3回伸びなければ系統を変える」）。

## 3. 提案と diff

### 提案 A: 並列の方式を task.json の事実からコードで選ぶ

task.json に任意項目を3つ足す。

- `scorer`: 途中で何度でも実行できて、数値（または段階）を返すコマンド。例 `{ "command": "npm run bench:bundle", "direction": "minimize", "unit": "bytes" }`。合否しか返さないコマンドはここに書かない
- `budget`: Worker 1体あたりの予算。`{ "turns": 60 }` または `{ "hours": 2 }`
- `parallel_mode`: 選ばれた方式。Lead が下の規則で決めて書く。**LLM が選ばない**

方式の決め方（上から順に評価）:

| 条件 | parallel_mode |
|---|---|
| `scorer` が無い、かつタスクを分割できる | `solo`（既存の breezing の分割で並列化） |
| `scorer` が無い、かつ分割できない | `independent`（k 体を独立に走らせ、最後の検証で最良を1つ選ぶ）。k=1 なら `solo` |
| `scorer` がある、かつ 1体あたりの予算で `scorer` を**最低 N 回**回せる（N は P-1） | `team`（提案 B の共有ワークスペースを使う） |
| `scorer` はあるが予算が足りない | `independent` または `solo` |
| どれにも決められない（`scorer` の出力が数値にならない、予算が不明 など） | `escalate`（人間に聞く。`decision-boundaries.md` ルール3の逃げ道） |

- `team` と `independent` の比較は**同じ1体あたり予算**で行う（論文の team@k 対 best@k と同じ条件）。
- 分割できるかどうかは、今までどおり Lead が判断する（本提案では変えない）。

### 提案 B: `team` の共有ワークスペースの約束事

論文 §2 と付録 A.2 の仕組みを、本ハーネスの worktree 運用に合わせて置き換える。

**置き場所**: `.claude/state/team/<task_id>/`（メイン checkout 側。全 Worker の worktree から絶対パスで参照する。P-3）

| ファイル | 中身 | 書き方 |
|---|---|---|
| `slots/slot-<n>/approach` | 各 Worker が取る手法と、あえて前提にしないこと | `mkdir` で早い者勝ちに取る（原子的） |
| `findings.log` | 目立った進展。スコア・再現手順・commit・コスト | 追記のみ。時刻と slot を付ける |
| `disconfirm.log` | 反証・行き止まり・失敗した方向 | 追記のみ |
| `scores.log` | すべての試行のスコア（`[slot n 時刻] score=... family=...`） | 追記のみ |
| `coordination.md` | 衝突したときに Worker が決めた約束事 | 空で始める。衝突した Worker が書き、以後それに従う |

**Worker の規則**（論文のプロンプトの考え方を本ハーネスの言葉で書き直したもの）:

1. 最初にスロットを取り、既に取られた手法と**違う**手法を宣言する。早い段階で他に合わせない。
2. 変更のたびに `scorer` で測り、`scores.log` に残す。測らない変更は進展として数えない。
3. 目立った進展は `findings.log` に、スコア・再現手順・commit 付きで書く。弱い根拠の主張は「弱い」と書く。他の Worker に真似させるためだけの文章は書かない。
4. 主導的な手法（自分のものも含む）を反証しようとする時間を取り、否定的な結果は `disconfirm.log` に残す。
5. 他の Worker の手法に乗り換えるのは、**`scorer` で測って再現できた優位**があるときだけ。乗り換えても、パラメータ・対象範囲・表現のどれか1つの違いを最後まで残す。
6. `scores.log` 上で自分の最良スコアが3回続けて伸びなければ、パラメータ調整をやめて**構造的に違う系統**に移る。他の Worker が今いない系統を選ぶ。伸び悩んでいる Worker への乗り換えは進展ではない。
7. `budget` が残っている限り止まらない。「もう上限」は反証すべき主張として扱う。これは最適化の繰り返しの規則で、**エラー復旧の「最大3回」とは別に数える**（エラー復旧の規則はそのまま残す）。
8. 共有ファイルに秘密・クライアントの生データを書かない（`secret-isolation.md` ルール6）。

**成果の取り込み**: 各 Worker は自分の worktree・ブランチで commit する（breezing の既存運用のまま）。他の Worker の成果を使うときは `findings.log` の commit を cherry-pick するか、説明から実装し直す（論文 §3.2.1 では、実装し直した方が良くなった例がある）。Lead は最後に `scores.log` の最良スコアの commit を取り込む。`scorer` を Lead が取り込む前にもう一度実行し、スコアを再現できることを確かめる。

**ログの保存**: `.claude/state/team/<task_id>/` は、タスク終了時に `harness-logs/<project>/<YYYYMM>/<task_id>/team/` へ**逐語のまま**コピーする（`memory-curation.md` ルール4）。

### 提案 C: retro に team の健全性チェックを足す

- **群がり**: `scores.log` の `family` の種類が、終盤に1つへ潰れていないか。潰れていたら規則 1・5・6 が守られていない疑い
- **最初のコスト**: team の最良スコアが independent に追いついた時点（時間・ターン・トークン）。追いつく前に予算が尽きたタスクが多ければ、P-1 の N を上げる
- **スコアの再現**: Lead の取り込み時に `scorer` を再実行したスコアと `findings.log` の報告値の差

### diff 1: `.claude/rules/parallel-mode-selection.md`（新規）

```diff
--- /dev/null
+++ b/.claude/rules/parallel-mode-selection.md
@@ -0,0 +1,54 @@
+# 並列方式の選択ルール（solo / independent / team）
+
+> **適用対象**: Lead（breezing で Worker を割り当てる側）、および `parallel_mode: team` で動く Worker
+> **起源**: 提案 `harness-proposals/2026-09-29-test-time-communication.md`（提案 A・B）／根拠 arXiv:2609.21032
+> **承認**: （承認日を記入）
+
+## ルール1: 方式はコードで選ぶ（MUST）
+
+task.json の `scorer`（途中で何度でも実行でき、数値か段階を返すコマンド）と `budget`（Worker 1体あたりの予算）から、
+次の表を上から順に評価して `parallel_mode` を決める。LLM に選ばせない（`decision-boundaries.md` ルール2）。
+
+| 条件 | parallel_mode |
+|---|---|
+| `scorer` が無い、かつ分割できる | `solo`（既存 breezing の分割並列） |
+| `scorer` が無い、かつ分割できない | `independent`（k 体独立。最後の検証で最良を1つ選ぶ） |
+| `scorer` があり、1体あたりの予算で `scorer` を N 回以上回せる | `team` |
+| `scorer` はあるが予算が足りない | `independent` または `solo` |
+| どれにも決められない | `escalate` |
+
+- N の既定値は 10（暫定。retro の実測で見直す）。
+- 合否しか返さないコマンドは `scorer` にしない。最後に一度だけ判定されるタスクでは team は効かない（根拠 §3.4）。
+- `team` は既定では使わない。Lead または人間が task.json に明示したときだけ使う。
+
+## ルール2: team の共有ワークスペース（MUST）
+
+置き場所は `.claude/state/team/<task_id>/`。
+
+| ファイル | 中身 |
+|---|---|
+| `slots/slot-<n>/approach` | 取る手法と、あえて前提にしないこと（`mkdir` で早い者勝ち） |
+| `findings.log` | 進展。スコア・再現手順・commit・コスト（追記のみ） |
+| `disconfirm.log` | 反証・行き止まり（追記のみ） |
+| `scores.log` | 全試行のスコア `[slot n 時刻] score=... family=...`（追記のみ） |
+| `coordination.md` | 衝突時に Worker が決めた約束事（空で始める） |
+
+## ルール3: team の Worker の振る舞い（MUST）
+
+1. スロットを取り、既に取られた手法と違う手法を宣言する。早い段階で他に合わせない。
+2. 変更のたびに `scorer` で測り、`scores.log` に残す。測らない変更は進展として数えない。
+3. 進展は `findings.log` にスコア・再現手順・commit 付きで書く。弱い主張は「弱い」と書く。真似させるためだけの文章は書かない。
+4. 主導的な手法（自分のものも含む）を反証する時間を取り、否定的な結果を `disconfirm.log` に残す。
+5. 乗り換えは `scorer` で測って再現できた優位があるときだけ。乗り換えても違いを1つ残す。
+6. 自分の最良スコアが3回続けて伸びなければ、構造的に違う系統に移る。他の Worker が今いない系統を選ぶ。
+7. `budget` が残る限り止まらない。この繰り返しはエラー復旧の「最大3回」とは別に数える。
+8. 共有ファイルに秘密・クライアントの生データを書かない（`secret-isolation.md` ルール6）。
+
+## ルール4: 取り込みとログ（MUST）
+
+- 各 Worker は自分の worktree・ブランチで commit する（breezing の既存運用）。
+- Lead は `scores.log` の最良スコアの commit を、`scorer` を再実行してスコアを再現できた場合だけ取り込む。
+  Worker の報告値だけで取り込まない（`judge-rubric.md` ルール4）。
+- タスク終了時に `.claude/state/team/<task_id>/` を `harness-logs/<project>/<YYYYMM>/<task_id>/team/` へ逐語でコピーする
+  （`memory-curation.md` ルール4）。
+- Plans.md の cc:* マーカーは今までどおり Lead だけが変える（NG-1）。
```

### diff 2: `.claude/rules/harness-retro.md`（末尾に追記）

```diff
--- a/.claude/rules/harness-retro.md
+++ b/.claude/rules/harness-retro.md
@@ (末尾) @@
+
+## 提案9: team モードの健全性チェック（arXiv:2609.21032）
+
+> **起源**: 提案 `harness-proposals/2026-09-29-test-time-communication.md`（提案 C）
+> **承認**: （承認日を記入）
+
+`parallel_mode: team` のタスクが1件以上あった retro で実施する。
+
+### チェック項目
+
+7. **群がり**: `team/scores.log` の `family` の種類数を、前半と後半で比べる。後半で1種類に潰れていたら、
+   `parallel-mode-selection.md` ルール3の 1・5・6 が守られていない疑い。
+8. **最初のコスト**: team の最良スコアが、同じタスクの independent（または過去の solo）の最良に追いついた時点
+   （ターン・時間・トークン）を記録する。追いつく前に予算が尽きたタスクが多ければ、ルール1の N を上げる。
+9. **スコアの再現**: Lead の取り込み時に再実行したスコアと、`findings.log` の報告値の差を記録する。
+   差が繰り返し出る場合は、`scorer` の決定性（乱数・計測ノイズ）を先に疑う（提案8 の診断順序「契約」の層）。
```

### diff 3（人間が反映）: plugin 側の Worker 定義

Worker 定義（`claude-code-harness-worker`）は本 repo の管理外なので、反映は人間が行う。追記する位置は「モード別ルール」の `mode: breezing` の下。

```diff
 ### `mode: breezing`
 
 1. commit 前に必ず `git branch --show-current` を実行する
 ...
 4. Lead が `REQUEST_CHANGES` を返した場合だけ `git commit --amend` を使う
+5. 入力に `parallel_mode: team` がある場合は、`.claude/rules/parallel-mode-selection.md` ルール2〜4 に従う。
+   `scorer` による最適化の繰り返しは「エラー復旧」の最大3回とは別に数え、`budget` が尽きるまで続ける。
```

## 4. 効果測定（承認後に実測）

最初は shadow（既定の方式と並べて、比べるためだけに走らせる）で、`scorer` があるタスク1〜2件から始める。

| 指標 | 測定方法 | 期待方向 |
|---|---|---|
| team 対 independent の最終スコア | 同じタスク・同じ1体あたり予算・同じ k で両方を走らせる（最低3組） | team が上回る。上回らなければ本提案の B を止める |
| 追いつくまでのコスト | 提案 C の 8 | 予算の 1/3 以内に追いつく |
| 群がり | 提案 C の 7 | 後半も2系統以上が残る |
| スコアの再現 | 提案 C の 9 | 差が計測ノイズの範囲 |
| `escalate` の件数 | ルール1で決められなかった件数 | 可視化（多ければ `scorer` / `budget` の書き方を見直す） |

- コストの記録には、既存の `worker-report.v1` の `turns_used` / `tool_usage` を使う。
- 効果が確認できなければ、B・C を撤回し A（方式の選び方）だけ残してよい。

## 5. 論点（人間が決める）

| # | 論点 | 既定案（決めなければこれで進める） | 他の選択肢 |
|---|---|---|---|
| P-1 | `team` を選ぶのに必要な `scorer` の実行回数 N | **10回**（暫定）。論文では、予算が少ない領域でチームが負けた | 5回／時間で決める（例: 1体2時間以上） |
| P-2 | 既定のチームの人数 k | **3**。論文の最小構成で、コストを抑えられる | 2（最小）／5（論文では倍率が大きくなったが高コスト） |
| P-3 | 共有ワークスペースの置き場所 | **メイン checkout の `.claude/state/team/<task_id>/`**（全 worktree から絶対パスで見える） | 各 worktree にシンボリックリンク／共有しない |
| P-4 | `team` を使ってよい人 | **Lead または人間が task.json に明示したときだけ** | ルール1が `team` を返したら自動で使う |

## 付録 A: 本提案で diff を出さない項目（既に満たしている）

- **採点データをエージェントに見せない**（論文 付録 A.4・A.5）: `secret-isolation.md` ルール2（値はツール側で読む）と同じ考え方。`scorer` もスコアだけを返すものにする。
- **インターネット・秘密を使わせない**（論文 付録 A.2）: `secret-isolation.md` と `.claude/settings.json` の deny で既に満たしている。
- **リトライのたびに新しい情報を得る**: `decision-boundaries.md` ルール1。team の規則6（系統を変える）はこれの最適化版。

## 付録 B: 使えそうな場面と使わない場面（参考）

| 使える（途中で測れる数値がある） | 使わない（合否が最後にしかわからない・主観） |
|---|---|
| ダッシュボードの表示速度・Lighthouse スコアの改善 | 通常の機能実装・UI 変更 |
| バンドルサイズ・画像サイズの削減 | 文章・広告クリエイティブの良し悪し（論文では検証していない） |
| SQL・集計処理の高速化（ベンチマークあり） | レビューや判定そのもの |
| フィクスチャが揃ったテスト群の通過数を上げる | 小さなタスク（最初のコストで負ける） |

## 付録 C: 根拠と関連

- 根拠: 論文 §2（共有ディレクトリの仕組み）、§3.1（ARC-AGI-3 のスケーリング、図3・4 の予算の比較）、§3.2・3.3（リレー型の改善の事例）、§3.4（verified progress sharing、Terminal-Bench 2.0 の否定的な結果、群がり）、付録 A.2（エージェントに渡すプロンプト）
- 関連ルール: [`decision-boundaries.md`](../.claude/rules/decision-boundaries.md)（ルール1・2・3）/ [`judge-rubric.md`](../.claude/rules/judge-rubric.md)（ルール4）/ [`secret-isolation.md`](../.claude/rules/secret-isolation.md)（ルール2・6）/ [`memory-curation.md`](../.claude/rules/memory-curation.md)（ルール4）/ [`harness-retro.md`](../.claude/rules/harness-retro.md)（提案4・8）
- 関連提案: [`2026-09-28-typed-decision-receipts.md`](2026-09-28-typed-decision-receipts.md)（方式を決める表を LLM ではなくコードに置く考え方は同提案 C・D と同じ）
