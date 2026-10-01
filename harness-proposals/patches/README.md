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
