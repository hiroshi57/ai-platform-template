# harness-retro ルール（ツールセット・ストア健全性）

> **適用対象**: harness-retro（自己改善ループ）を回す Lead / 運用者
> **起源**: 提案 `harness-proposals/2026-09-11-filesystem-memory-findings.md`（提案4・5）／根拠 arXiv:2607.26637 RQ5・RQ4
> **承認**: 2026-09-11 人間承認済み

## 提案4: ツールセットを retro の第一級レバーに（RQ5）

実証結果: **ツールを1個足しても挙動は変わるが結果は変わらない。ツールセットを丸ごと替えると
ストアの形自体が変わる（モデル差し替えと同等のインパクト）**。

### ルール

- メモリ/skills のストアが劣化した（検索コスト増、taxonomy 崩れ、重複増）と判断したら、
  **モデル強度を上げる前に、まずツールセットを見直す**。対象:
  - Worker の `allowedTools` / `disallowedTools` 構成
  - 検索ツール（grep/検索エージェントの粒度）
  - file 操作 API 群（memory-tool 系の関数セット）
- ツールセット変更は安価でインパクトが大きい。モデル変更（高コスト）は最後の手段。
- ※本ルールをグローバル `CLAUDE.md` セクション7「改善提案のルール」本文にも反映する場合は、
  当該ファイルが存在する環境で人間が別途追記する（保護対象のため本 repo からは変更しない）。

## 提案5: 成長前提のストア健全性チェック（RQ4）

実証結果: ストアは成長するほど有用になり、健全性は保たれる（初期記憶は削除されず in-place 編集で生存）。
ただし **taxonomy（命名・フォルダ規約）の遵守は、最強の管理エージェント以外では成長とともに崩れる**。

### チェック項目（`bash scripts/harness-retro.sh --check` 拡張案 / 手動運用可）

retro 実行時、または `/harness-release` 前に以下を確認する。

1. **初期記憶の生存**: 初期に作られた記憶ファイルが後の再編成後も残っているか（削除ゼロを期待）。
   ```bash
   # 記憶ファイルの削除履歴を確認（削除があれば要調査）
   git log --diff-filter=D --name-only -- .claude/agent-memory | head
   ```
2. **in-place 更新か**: 更新が既存ファイルの編集で行われ、wholesale な作り直し（全削除→再作成）に
   なっていないか。
   ```bash
   git log --diff-filter=A --name-only -- .claude/agent-memory | head   # 再作成の兆候
   ```
3. **taxonomy 逸脱の増加**: フォルダ命名規約から外れたファイル/フォルダが成長とともに増えていないか
   （劣化の早期警告）。逸脱が増え始めたら、人手 or 強いモデルでの再整理をトリガーする。

### 判断

- 1・2 が崩れた（削除・作り直しが起きた）場合は `.claude/rules/memory-curation.md` の保存ルール違反。
  内容欠落がないか diff で確認する。
- 3 が悪化した場合、taxonomy を守れる強い管理エージェントに切り替えるか、ツールセット（提案4）を見直す。

## 提案6: ツール使用の内訳を測り、検索結果を共有する（Jev 設計メモ III・X）

> **起源**: 提案 `harness-proposals/2026-09-28-jev-context-engineering.md`（提案 D）
> **承認**: 2026-09-28 人間承認済み（P-3 = フェーズ1は Worker の自己申告で確定）

背景: コーディングエージェントのトークンの大半は、コードを書くことではなく読み込み・検索・コマンド出力に
使われる（元資料の推定で約3分の2、コード記述は1割未満）。どこを削れば効くかを判断するため、内訳を測る。

### 保存と実測（Lead が Worker の結果を受け取るたびに行う）

> [追加: 2026-10-01] これまで harness-logs に書き込む仕組みが無く、集計が0件だったため追加した。

1. **いつ**: Worker の結果（worker-report）を受け取ったとき。review を出したときも同じコマンドで足す。
2. **何をするか**: 生のファイルをそのまま保存し、Worker のトランスクリプトがあればツール呼び出しを実測する。
   ```bash
   python scripts/harness_log.py save --project <slug> --task-id <task_id>      --task task.json --worker-report worker-report.json --stdout-log commands.stdout.log      [--review review.json] [--retries retries.log] [--advisor advisor.json]      [--transcript <Worker のトランスクリプト .jsonl>] [--sidechain-only]
   ```
   - 2件目の worker-report / review は `<名前>.<n>.json` で残り、上書きされない（§7 提案10）
   - `commands.stdout.log` / `retries.log` は区切り行付きで追記される
   - `--transcript` を付けると `tool-usage.measured[.<n>].json` が候補の隣にできる。
     数とファイルパスだけを残し、メッセージ・コマンド・出力の中身とトランスクリプト本体は保存しない
   - トランスクリプトは Claude Code が `~/.claude/projects/<作業フォルダを変換した名前>/` に JSON Lines で残す。
     サブエージェントの記録が親と同じファイルに入っている場合は `--sidechain-only` で Worker 側だけを数える
   - **Worker の記録がどこに残るかは、最初の1回で必ず確かめる**:
     ```bash
     python scripts/harness_log.py locate          # 作業フォルダのトランスクリプトを調べる（数だけ・中身は読まない）
     ```
     | `layout` | 意味 | `save` の指定 |
     |---|---|---|
     | `separate-files` | Worker の記録が別ファイル（`subagents/` や `agent-*.jsonl`） | `--transcript <その別ファイル>` |
     | `sidechain-in-main` | 親のファイルに `isSidechain` の行として入っている | `--transcript <親のファイル> --sidechain-only` |
     | `launched-but-not-recorded` | 起動の記録はあるが、Worker 側の記録が無い | 実測できない。自己申告の扱いになる |
     | `no-subagent-yet` | まだ一度も Worker が動いていない | Worker を1回動かしてから再確認する |
   - [確認: 2026-10-01] この PC では `no-subagent-yet`。全128件のトランスクリプトに Worker の起動・記録が無く、
     置き場所は未確定。初めて Worker を動かしたら `locate` を実行し、結果をこの行に追記する
3. **どう確かめるか**: `python scripts/token_breakdown.py` で `measured_records` が増えていること。
4. `.claude/harness-logs/` は `.gitignore` 対象。生ログには検証コマンドの出力がそのまま入るので、push しない。

### worker-report の任意フィールド `tool_usage`

Worker は取れる範囲で自己申告する。**任意項目で、未記入でも review で差し戻さない**。
既存のフィールドは変えない。

Worker 定義への記入指示は、使っているハーネスのプラグイン側に入れる必要がある。入れ方と、
プラグイン更新後の当て直し手順は `harness-proposals/patches/README.md` を参照（環境ごとのパスはそちらに置く）。
- [更新: 2026-10-01] 当て直し手順（プラグインのパス・版つき）をここから `patches/README.md` に移した。
  共通ルールに特定環境のパスを混ぜないため（CLAUDE.md §7「共通ルールへの diff に案件専用の記述が混ざっていないか」）。

```json
"tool_usage": {
  "read_calls": 0,             // Read・cat など、ファイルを読んだ回数
  "search_calls": 0,           // Grep・Glob・find など、探した回数
  "bash_calls": 0,             // 検索以外のコマンドを実行した回数
  "edit_calls": 0,             // Edit・Write など、書いた回数
  "largest_output_lines": 0,   // 1回で最大の出力行数（肥大化の兆候）
  "reread_files": []           // 同じタスク内で2回以上読んだファイル
}
```

### チェック項目（提案5のチェック 1〜3 に続けて行う）

4. **ツール使用の内訳（傾向）**: 直近10件を集計し、月ごとの変化を見る。
   ```bash
   python scripts/token_breakdown.py            # テキスト出力
   python scripts/token_breakdown.py --json     # 形の違う項目・読めなかったファイルの一覧つき
   ```
   読み込み＋検索＋コマンドの割合が**月を追って上がり続けている**なら、検索の賢さに改善余地がある。
   モデルを強くする前に、ツールセット（提案4）を見直す。割合の高さそのものでは判断しない
   （テストの実行もコマンドに数えるので、健全なタスクでも高くなる）。
5. **読み直し**: 複数タスクで同じファイルが読み直されていたら、そのディレクトリに GOTCHAS.md
   または要点メモを置くことを検討する。
6. **実測か自己申告かを確かめる**: 出力の `data_source` が `measured`（トランスクリプトからの実測）なら外部の証跡として
   使える。`self_report` / `mixed` のときは、自己申告の分を判定の根拠にしない。
   - [更新: 2026-10-01] `scripts/harness_log.py --transcript` による実測を追加し、実測があればそちらを優先するようにした。
     以下は自己申告しか無い場合の扱い。
   `tool_usage` は Worker の自己申告で、出力にも `data_source: self_report` と出る。
   判定や合否の根拠にはしない（CLAUDE.md §7）。数字をきちんと使いたくなったら、フックでの自動計測
   （PostToolUse でツール名を数えてログに追記する）に切り替える。フックの追加は設定変更なので人間が行う。
   - [更新: 2026-10-01] 旧チェック6（`largest_output_lines` と `commands.stdout.log` の行数を見比べる）は削除した。
     前者は全ツールで1回の最大出力、後者は検証コマンドの出力の合計で、測っているものが違い、申告の確かさを確かめられなかった。
   - [更新: 2026-10-01] 旧チェック4の「60% を超えたら」の閾値は削除した。元資料の「約3分の2」はトークンの割合で、
     こちらは呼び出し回数の割合のため、同じ閾値で比べられなかった（典型的な TDD タスクで78%になり、毎回通知が出た）。
7. **ログが書かれているか**: `.claude/harness-logs/` に worker-report が保存されていなければ、集計は0件になる。
   0件が続くときは、Lead が `scripts/harness_log.py save` を実行しているかを先に確かめる。
   - [更新: 2026-10-01] 保存の仕組み（`scripts/harness_log.py`）を追加した。毎回の実行は Lead の手順で、自動ではない。
     自動にするなら SubagentStop などのフックから呼ぶ（フックの追加は設定変更なので人間が行う）。

### 読み取り専用タスクの検索結果の共有

codex-companion review やクロスレビューなど、コードを書かないバックグラウンドタスクは、
Worker の `files_changed` と `git diff --stat` を共通の入力として受け取る。
各タスクがリポジトリ全体を探し直さない。

### 判断

- `scripts/token_breakdown.py` の出力は傾向の表示だけ。通知や判定はせず、ハーネスを自動で変更しない。
- 候補が複数あるタスク（`worker-report.<n>.json`）も1件ずつ数える。
- 集計はトークン数ではなく呼び出し回数による近似。傾向を見るために使い、細かい数値の差で判断しない。
