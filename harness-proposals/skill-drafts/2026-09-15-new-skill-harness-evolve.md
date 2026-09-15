# 新規スキル提案: harness-evolve（ハーネス自己進化ループ・承認ゲート付き）

- **日付**: 2026-09-15
- **slug**: `new-skill-harness-evolve`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— skills は人間承認を経ずに設置しない。本提案は worktree 内の下書き。
- **根拠論文**: ECDYSIS (arXiv:2609.11677) Algorithm 1 / Meta-Harness (arXiv:2603.28052) / HarnessDev (arXiv:2609.01437)
- **自律度**: **A（承認ゲート付き）** で確定（利用者選択）。完全自律(C)は憲法に抵触するため不採用。

## 何を作るか

ECDYSIS の進化ループ（Algorithm 1）を回す**司令塔スキル** `harness-evolve` を新設する。
論文から2点変える:
1. **完全自律 → 承認ゲート付き**: 候補の自動採用・自動凍結はせず、採用の最終判断と実反映は人間。
2. **多ラウンド自動継続 → 1サイクル回し切り（single-pass）**: 1回の「試す→測る→採用/棄却」を
   回し切ったら報告して止まる。続けるかは人間が判断して再実行する。

ボトルネックの診断（②③④）は既存 `harness-retro`（旧）に委譲し、本スキルは
**①いつ回すか・⑤検証・⑥採用会計** を担う合成スキル。**旧は「診断器」として残し、新はそれを1回回す。**

## なぜ新スキルにするか（harness-retro に足さない理由）

- harness-retro は「1回の診断→提案」で完結する診断器。ループ駆動・検証・採用/棄却/凍結の
  **会計（複数ラウンドをまたぐ状態管理）**を足すと責務が二重になり、description も肥大化する。
- 役割分担を明確化: **retro=診断、evolve=ループ駆動**。evolve が retro を呼ぶ包含関係にする。

## 設置内容

```
.claude/skills/harness-evolve/
└── SKILL.md   ← harness-proposals/skill-drafts/harness-evolve/SKILL.md をコピー
```

承認後の反映手順（可逆）:
```bash
SK="C:/Users/hiroshi_takizawa/.claude/skills/harness-evolve"
mkdir -p "$SK"
cp harness-proposals/skill-drafts/harness-evolve/SKILL.md "$SK/SKILL.md"
# 原状復帰: rm -rf "$SK"
```

## 憲法との整合（重要）

| 論文 Algorithm 1 | 本スキルでの扱い |
|---|---|
| 候補が train score を改善したら**自動採用** | 人間承認を得てから採用（Step5） |
| 最終ハーネスを**自動凍結** | 承認後に台帳へ凍結記録（Step6） |
| harness を coding-agent が**自動編集** | diff は harness-retro が提案、実反映は承認ゲート |
| **R ラウンドを自動継続** | **1サイクル回し切り（single-pass）**。次サイクルは人間が再実行 |
| 生ログにフルアクセス | `harness-evolution-log.md` 台帳に要約せず記録（Meta-Harness 思想） |

「完全自律の自己改変」は CLAUDE.md §7「必ず人間の承認を経てから反映」と禁止事項「スコープ外の作業」に
抵触するため採らない。**自律度を A に落とし、かつ1サイクル回し切りにして、ループの知見だけ活かす**のが本提案の肝。

## Jtrain 代理指標（この環境固有の工夫）

論文は受理基準 `Jtrain(candidate) > Jtrain(previous)` を持つが、本環境に自動ベンチは無い。
代わりに harness-logs から「成功率代理（非escalated率）／横断再発件数／turns・tokens」を集計し、
**適用前後 N=10 タスクで比較**する。ノイズがあるため、採用は「別タスクでも改善が見えるとき」に限る
（HarnessDev チェック④＝過学習回避、ECDYSIS の汎化条件）。

## リスク / 副作用

- 暴走防止: **1サイクル回し切り（自動で次へ進まない）**、1サイクル1変更理由（帰属不能化を防ぐ）。
  複数の改善を入れたいときは人間が都度再実行し、1本ずつ効果を確認する。
- 検証の「適用」は一時的で必ず `.bak` 退避＝可逆。棄却時は原状復帰。
- 指標がノイジーで誤って採用するリスク → 「別タスクでも成り立つ」条件と人間承認の二重ゲートで抑制。

## 適用対象外の確認

- [x] 「禁止事項」セクションを変更していない
- [x] コミット規約・ブランチ運用ルールを変更していない
- [x] Plans.md の cc:* マーカーに触れていない
- [x] ライブの skills / CLAUDE.md / AGENTS.md を直接編集していない（worktree 内の下書きのみ）
- [x] 自動採用・自動凍結・自動ファイル書換を一切含まない（全て承認ゲート）

## 承認で決まること

- ✅ `harness-evolve` スキルを `.claude/skills/` に設置してよい（旧 harness-retro は診断器として残す）
- ✅ 進化サイクルの駆動時、harness-retro を内部で呼ぶ合成関係を採用する
- ✅ 1回の実行は**1サイクルで止まる**。続けるかは人間が判断して再実行する
- ❌ 承認しても、サイクルが harness 本体を自動反映することはない（採用は常に別途承認）
