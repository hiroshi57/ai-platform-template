# patches

ハーネスのプラグインなど、このリポジトリの外にあるファイルへ当てる変更です。
プラグインを更新すると上書きされて消えるので、更新後に当て直します。

## 2026-09-28-worker-tool-usage.patch

claude-code-harness プラグインの `agents/worker.md` に、`tool_usage`（ツール使用の内訳の自己申告）の記入指示を足します。
集計は `scripts/token_breakdown.py`、使い方は `.claude/rules/harness-retro.md` 提案6。

- 作成時の版: claude-code-harness 4.3.1（2026-09-28 に適用済み）
- 当てる場所: `~/.claude/plugins/cache/Chachamaru127-claude-code-harness/claude-code-harness/<version>/`

```bash
cd ~/.claude/plugins/cache/Chachamaru127-claude-code-harness/claude-code-harness/<version>
patch -p1 --dry-run < <ai-platform-template>/harness-proposals/patches/2026-09-28-worker-tool-usage.patch  # 当たるか確認
patch -p1 < <ai-platform-template>/harness-proposals/patches/2026-09-28-worker-tool-usage.patch
```

- 当たらない（上流で worker.md が変わった）場合は、パッチを見ながら手で追記する
- marketplace 側のコピー（`~/.claude/plugins/marketplaces/...`）には当てていない。再インストールすると消える
- 消えたことに気づく仕組みはない。プラグインを更新したら `grep -c tool_usage <version>/agents/worker.md` で確認する（0 なら消えている）

## settings.harness-log-hook.json（ログ保存の自動化・人間が入れる）

`scripts/harness_log.py hook` を Claude Code のフックから呼ぶ設定例です。入れると、次が自動で残ります。

- **Stop**（返答が終わるたび）: セッション全体のツール呼び出しを数え、
  `.claude/harness-logs/<プロジェクト>/<YYYYMM>/session-<セッションID>/tool-usage.measured.json` を累計で更新
- **SubagentStop**（Worker が終わるたび）: その Worker の記録を数え、`agent-<ID>/tool-usage.measured.json` に置く

入れ方（どちらか1つ）:
- このリポジトリだけ: `.claude/settings.json` の `"hooks"` に、この JSON の `"hooks"` の中身を足す
- すべてのリポジトリ: `~/.claude/settings.json` に足す（`scripts/harness_log.py` が無いリポジトリでは、フックは失敗するがセッションは止まらない）

注意:
- 設定の変更なので、Claude からは入れない（CLAUDE.md の禁止事項「セキュリティ設定の変更」に当たりうるため、人間が判断する）
- フックは失敗しても必ず終了コード 0 で返し、セッションを止めない。理由は stderr に `harness_log hook: skipped (...)` と出る
- 止めたいときは環境変数 `HARNESS_LOG_DISABLE=1`。プロジェクト名を固定したいときは `HARNESS_LOG_PROJECT=<名前>`
- 残すのは回数とファイルパスだけ。メッセージ・コマンド・出力の中身とトランスクリプト本体は保存しない
- Windows でのフックの実行シェルによっては `$CLAUDE_PROJECT_DIR` が展開されないことがある。入れた後に1回返答させ、
  上のファイルができたか確かめる（できなければ `command` をフルパスに書き換える）
- worker-report・review・検証ログの逐語保存は自動にならない。必要なら従来どおり `save` を使う
