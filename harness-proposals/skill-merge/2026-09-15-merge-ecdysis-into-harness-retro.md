# スキルマージ提案: ECDYSIS を harness-retro に統合（companion ファイル方式 A）

- **日付**: 2026-09-15
- **slug**: `merge-ecdysis-into-harness-retro`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— skills は CLAUDE.md §7・harness-retro 自身のルールで
  「人間承認を経ずに直接書き換え禁止」。本提案は worktree 内の下書きで、ライブスキルは未変更。
- **根拠論文**: ECDYSIS (arXiv:2609.11677) / 既存 HarnessDev (arXiv:2609.01437) / Meta-Harness (arXiv:2603.28052)

## 結論

新規スキルは作らない。既存 `C:\Users\hiroshi_takizawa\.claude\skills\harness-retro\` に、
`harnessdev-checklist.md` と同じ companion ファイル方式で **参照ファイル1本を追加**し、
`SKILL.md` に参照を数行足すだけ。差分最小・可逆。

## 先行提案との関係（重複ではない）

本リポジトリには既に別の ECDYSIS 提案がコミット済み（[2026-09-14-ecdysis-cross-instance.md](../2026-09-14-ecdysis-cross-instance.md)）。
役割分担は次のとおりで、内容は重複しない。

| 提案 | 対象 | 何を変えるか |
|---|---|---|
| 2026-09-14（先行） | **CLAUDE.md §7 の運用ルール** | harness-retro の起動条件・ログスキーマ・self_review 等の「仕組み」 |
| 2026-09-15（本提案） | **harness-retro スキルの診断ガイド** | retro 実行時に「どう切り分け・診断するか」の思考手順 |

先行提案が「いつ・何を記録し、いつ発火するか」を定め、本提案が「発火後にどう診断するか」を補う。
両者を合わせると ECDYSIS の知見が運用と診断の両面でハーネスに入る。

## 追加するファイル（本体は同フォルダに同梱）

```
.claude/skills/harness-retro/
├── SKILL.md                      ← 下記 diff を適用
├── harnessdev-checklist.md       ← 既存（変更なし）
└── ecdysis-cross-instance.md     ← ★新規（harness-proposals/skill-merge/ecdysis-cross-instance.md をコピー）
```

承認後の反映手順（既存ファイルを退避してから反映＝可逆）:
```bash
SK="C:/Users/hiroshi_takizawa/.claude/skills/harness-retro"
# 1. SKILL.md を退避（diff 手適用前のバックアップ）
cp "$SK/SKILL.md" "$SK/SKILL.md.bak"
# 2. companion ファイルを配置（新規なので上書き対象なし。既にあれば .bak 退避）
[ -f "$SK/ecdysis-cross-instance.md" ] && cp "$SK/ecdysis-cross-instance.md" "$SK/ecdysis-cross-instance.md.bak"
cp harness-proposals/skill-merge/ecdysis-cross-instance.md "$SK/ecdysis-cross-instance.md"
# 3. SKILL.md は下記 diff を手適用（または承認ターンで Edit）
# 原状復帰したい場合: SKILL.md.bak を戻し、ecdysis-cross-instance.md を削除
```

## SKILL.md への diff（3箇所）

### (1) frontmatter description の末尾に1文追加

```diff
 ...HarnessDev論文(arXiv:2609.01437)の4つの落とし穴チェックリスト(harnessdev-checklist.md)を診断に用いる。
+さらに ECDYSIS論文(arXiv:2609.11677)の横断的失敗集約・失敗帰属ガイド(ecdysis-cross-instance.md)で、
+「別タスクでも再発する失敗か」「model固有適応かharness欠陥か」を切り分ける。
 CLAUDE.md/AGENTS.md/skillsを直接書き換えることは絶対にしない。
```

### (2) Step 3 の冒頭、harnessdev-checklist を当てた直後に ECDYSIS ガイドを追加

```diff
 **このステップに入る前に、必ず同ディレクトリの `harnessdev-checklist.md` を開き、
 4項目のチェックリストを上から順に当てること**（HarnessDev論文 arXiv:2609.01437 の知見を
 実務チェックに変換したもの。難しい理論は読まなくてよい）。特に:
 ①死にコード（発火していない機能、特にstate/memory/checkpoint）を消す/繋ぐ提案を優先、
 ②「テスト追加」で誤魔化さず具体的失敗→原因→1修正→再検証にする、
 ③モデル固有のハードコード上限（max_steps等）を埋め込まない、
 ④見えているスコアだけで全体ルールに昇格させない。
+
+**続けて同ディレクトリの `ecdysis-cross-instance.md` を当てること**（ECDYSIS論文 arXiv:2609.11677）。
+HarnessDevが「何が壊れるか」なら、ECDYSISは「どう切り分け・直すか」を与える。特に:
+A その失敗は別タスクでも再発しているか（単一タスクのみは弱い証拠→保留）、
+B その修正は harness欠陥か model固有適応か（modelなら skill を歪めない）、
+C タスク固有の暗記でなく再利用可能な runtime 制約に抽象化できているか、
+D 複数の再発をバッチで1本にまとめ、診断→実装の順で Critic 4点の自己批判を通したか。
```

### (3) Step 4 の提案フォーマットに「失敗帰属」欄を追加

```diff
 ## 提案する変更
 - 対象ファイル: <CLAUDE.md / AGENTS.md / skills/xxx.md のどれか、セクション名>
+- 失敗帰属: <harness / model / ambiguous>（ECDYSISチェックB。modelならグローバル昇格しない）
+- 横断再発: <この失敗が出た異なる task_id を列挙。2件以上で体系的欠陥の証拠>
 - diff:
   ```diff
   + 追加したい行
   - 削除したい行
   ```
```

## なぜマージが妥当か（重複でなく補完）

| ECDYSIS の追加軸 | harness-retro 既存要素 | 関係 |
|---|---|---|
| 横断再発（別タスク2件以上、チェックA） | Step2「最低2件以上の根拠」/ checklist④ | 定量化・強化 |
| 失敗帰属 harness/model/ambiguous（B） | checklist③co-adaptation / ④過学習 | 新しい切り分け軸を追加 |
| runtime 制約への抽象化（C） | checklist④「別文脈でも効くか」 | 具体化 |
| バッチ集約＋FDCR自己批判（D） | Step3〜4 の提案生成 | 生成プロセスを構造化 |

## リスク / 副作用

- SKILL.md の description が既に長い。追加は1文に抑え、詳細は companion ファイルへ委譲（肥大化回避）。
- companion ファイルが2本になるが、当てる順（HarnessDev→ECDYSIS）を「まとめ」に明記済み。
- ライブスキルはリポジトリ外。反映は承認後に手コピー＋SKILL.md手適用（可逆：ファイル削除と diff 戻しで原状復帰）。

## 適用対象外の確認

- [x] 「禁止事項」セクションを変更していない
- [x] コミット規約・ブランチ運用ルールを変更していない
- [x] Plans.md の cc:* マーカーに触れていない
- [x] ライブの skills / CLAUDE.md / AGENTS.md を直接編集していない（worktree 内の下書きのみ）
