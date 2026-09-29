# plugin への再適用用パッチ

外部 plugin（`Chachamaru127/claude-code-harness`）のファイルに、承認済みの提案をローカルで反映した分のパッチ。
plugin の cache は git 管理外で、plugin を更新すると上書きされて消える。**plugin を更新したら、ここのパッチを当て直す。**

| パッチ | 対象 | 提案 | 反映日 |
|---|---|---|---|
| `worker-md-diff3-parallel-mode.patch` | `agents/worker.md`（`mode: breezing` の節に5項目めを追加） | [`2026-09-29-test-time-communication.md`](../2026-09-29-test-time-communication.md) diff 3 | 2026-09-29（cache 4.3.1） |

## 当て直す手順

```bash
cd ~/.claude/plugins/cache/Chachamaru127-claude-code-harness/claude-code-harness/<version>
patch -p1 --dry-run < <この repo>/harness-proposals/patches/worker-md-diff3-parallel-mode.patch
patch -p1 < <この repo>/harness-proposals/patches/worker-md-diff3-parallel-mode.patch
```

- 先に `--dry-run` で当たるか確かめる。上流で該当の節が変わって当たらない場合は、パッチの `+` 行を
  `### \`mode: breezing\`` の節の末尾に手で足す。
- 注意: 4.3.1 の cache には、上流に無いローカル追記（`tool_usage`）が既に入っている。
  このパッチはそれを含む状態を基準に作っているが、該当の hunk は `tool_usage` とは離れた位置なので、
  `tool_usage` の有無に関係なく当たるはず。
