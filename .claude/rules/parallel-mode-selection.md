# 並列方式の選択ルール（solo / independent / team）

> **適用対象**: Lead（breezing で Worker を割り当てる側）、および `parallel_mode: team` で動く Worker
> **起源**: 提案 `harness-proposals/2026-09-29-test-time-communication.md`（提案 A・B）／根拠 arXiv:2609.21032
> **承認**: 2026-09-29 人間承認済み（P-1〜P-4 は既定案で確定）

## ルール1: 方式はコードで選ぶ（MUST）

task.json の `scorer`（途中で何度でも実行でき、数値か段階を返すコマンド）と `budget`（Worker 1体あたりの予算）から、
次の表を上から順に評価して `parallel_mode` を決める。LLM に選ばせない（`decision-boundaries.md` ルール2）。

| 条件 | parallel_mode |
|---|---|
| `scorer` が無い、かつ分割できる | `solo`（既存 breezing の分割並列） |
| `scorer` が無い、かつ分割できない | `independent`（k 体独立。最後の検証で最良を1つ選ぶ） |
| `scorer` があり、1体あたりの予算で `scorer` を N 回以上回せる | `team` |
| `scorer` はあるが予算が足りない | `independent` または `solo` |
| どれにも決められない | `escalate` |

- N の既定値は 10（暫定。retro の実測で見直す）。
- 合否しか返さないコマンドは `scorer` にしない。最後に一度だけ判定されるタスクでは team は効かない（根拠 §3.4）。
- `team` は既定では使わない。Lead または人間が task.json に明示したときだけ使う。

## ルール2: team の共有ワークスペース（MUST）

置き場所は `.claude/state/team/<task_id>/`。

| ファイル | 中身 |
|---|---|
| `slots/slot-<n>/approach` | 取る手法と、あえて前提にしないこと（`mkdir` で早い者勝ち） |
| `findings.log` | 進展。スコア・再現手順・commit・コスト（追記のみ） |
| `disconfirm.log` | 反証・行き止まり（追記のみ） |
| `scores.log` | 全試行のスコア `[slot n 時刻] score=... family=...`（追記のみ） |
| `coordination.md` | 衝突時に Worker が決めた約束事（空で始める） |

## ルール3: team の Worker の振る舞い（MUST）

1. スロットを取り、既に取られた手法と違う手法を宣言する。早い段階で他に合わせない。
2. 変更のたびに `scorer` で測り、`scores.log` に残す。測らない変更は進展として数えない。
3. 進展は `findings.log` にスコア・再現手順・commit 付きで書く。弱い主張は「弱い」と書く。真似させるためだけの文章は書かない。
4. 主導的な手法（自分のものも含む）を反証する時間を取り、否定的な結果を `disconfirm.log` に残す。
5. 乗り換えは `scorer` で測って再現できた優位があるときだけ。乗り換えても違いを1つ残す。
6. 自分の最良スコアが3回続けて伸びなければ、構造的に違う系統に移る。他の Worker が今いない系統を選ぶ。
7. `budget` が残る限り止まらない。この繰り返しはエラー復旧の「最大3回」とは別に数える。
8. 共有ファイルに秘密・クライアントの生データを書かない（`secret-isolation.md` ルール6）。

## ルール4: 取り込みとログ（MUST）

- 各 Worker は自分の worktree・ブランチで commit する（breezing の既存運用）。
- Lead は `scores.log` の最良スコアの commit を、`scorer` を再実行してスコアを再現できた場合だけ取り込む。
  Worker の報告値だけで取り込まない（`judge-rubric.md` ルール4）。
- タスク終了時に `.claude/state/team/<task_id>/` を `harness-logs/<project>/<YYYYMM>/<task_id>/team/` へ逐語でコピーする
  （`memory-curation.md` ルール4）。
- Plans.md の cc:* マーカーは今までどおり Lead だけが変える（NG-1）。
