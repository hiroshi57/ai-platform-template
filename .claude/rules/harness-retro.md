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

### worker-report の任意フィールド `tool_usage`

Worker は取れる範囲で自己申告する。**任意項目で、未記入でも review で差し戻さない**。
既存のフィールドは変えない。

Worker 定義への追記（2026-09-28 適用済み）: claude-code-harness プラグイン（4.3.1）の `agents/worker.md` に、
`tool_usage` の記入指示を追加した。**プラグインを更新すると上書きされて消える**ので、更新後は次で当て直す。
```bash
cd ~/.claude/plugins/cache/Chachamaru127-claude-code-harness/claude-code-harness/<version>
patch -p1 --dry-run < <ai-platform-template>/harness-proposals/patches/2026-09-28-worker-tool-usage.patch  # 当たるか確認
patch -p1 < <ai-platform-template>/harness-proposals/patches/2026-09-28-worker-tool-usage.patch
```
当たらない（上流で worker.md が変わった）場合は、パッチを見ながら手で追記する。

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

4. **ツール使用の内訳**: 直近10タスクを集計する。
   ```bash
   python scripts/token_breakdown.py            # テキスト出力
   python scripts/token_breakdown.py --json     # タスク別の詳細つき
   ```
   読み込み＋検索＋コマンドの比率が 60% を超えたら、改善余地は「検索の賢さ」にある。
   モデルを強くする前に、ツールセット（提案4）を見直す。
5. **読み直し**: 複数タスクで同じファイルが読み直されていたら、そのディレクトリに GOTCHAS.md
   または要点メモを置くことを検討する。
6. **自己申告の確かさ**: `--json` の `per_task` で、`largest_output_lines` と
   `commands.stdout.log` の行数（`stdout_log_lines`）を見比べる。大きくずれるタスクが続くなら、
   自己申告をやめてフックでの自動計測に切り替えるかを人間が判断する（フック追加は設定変更のため人間の作業）。

### 読み取り専用タスクの検索結果の共有

codex-companion review やクロスレビューなど、コードを書かないバックグラウンドタスクは、
Worker の `files_changed` と `git diff --stat` を共通の入力として受け取る。
各タスクがリポジトリ全体を探し直さない。

### 判断

- `scripts/token_breakdown.py` の出力は advisory（通知のみ）。ハーネスを自動で変更しない。
- 集計はトークン数ではなく呼び出し回数による近似。傾向を見るために使い、細かい数値の差で判断しない。
