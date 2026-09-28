# スキル更新提案: HarnessDev 再精読による harness-retro / harness-evolve の機能向上

- **日付**: 2026-09-28
- **slug**: `harnessdev-refresh`
- **起案**: Claude Code (Worker)
- **ステータス**: 人間承認待ち（DRAFT）— skills は人間承認を経てから反映。worktree 内の下書きのみ。
- **根拠論文**: HarnessDev (arXiv:2609.01437) を原文再精読（既存 harnessdev-checklist.md の出典と同一）
- **根拠テキスト**: scratchpad 抽出済み（数値は原文照合で全て一致を確認）

## 背景

HarnessDev は既に `harness-retro/harnessdev-checklist.md` の元ネタ。原文の数値（108中18死にコード /
checkpoint 26,679回0発火 / テスト相関0.13–0.26・revision 0.57 / 120ステップ崩壊 / ±4.75・53.1%）は
**全て原文どおり正確**だった。ただし当時の4項目に入れ切れていない発見が3つあり、これを反映して機能向上する。

## 変更 A: harnessdev-checklist.md に「チェック5」を追加（診断最優先・プローブ不信）

**新発見（原文 §RQ2）**: 進化工程で失敗診断が最弱。専用トレース調査は9系統で2回のみ、明示調査は
0.5〜40.2%。小さなプローブは本評価と食い違う（5プローブ全通過でも本セット0.584）。新規169関数の
うち25は呼び出し無し・31は死にコード経由。

```diff
+## チェック5: 診断を最優先にし、簡易プローブの合格を信じすぎていないか
+- 提案の根拠が「軽いチェック／少数抜き取りで通った」だけになっていないか。実トレースを直接読むのを最優先。
+- 追加する新コードが本当に実行経路から呼ばれるか、呼び出し元を1行で説明できるか（示せなければ死にコード提案）。
```

## 変更 B: harnessdev-checklist.md チェック2 に「意味的完了ゲート」を追記

**新発見（原文 §Creation）**: 検証が構文的すぎ、中身の壊れた出力を素通し
（Data 2,325中441が、どのハーネスも検出できない退化出力）。良い例＝Opus の「99/100成功report
なのに実際48合格→completion gate 追加」。

```diff
 ## チェック2: ...
+**意味的な完了ゲートがあるか**を見る。「成功と report したか」ではなく「実際に合格したか」で
+完了判定しているか。成功報告を鵜呑みにする実装は、早すぎる完了・退化出力を見逃す。
```

（あわせてチェック1に Writing 587中124死にコード、チェック3に「Opus製が Gemini で崩壊」の明示など、
原文照合で得た補足を反映。まとめの自問を4→5項目に更新。）

## 変更 C: harness-evolve Step5 に「採用判断のガード」を追加（本命）

**新発見（原文 §Stability and final-version selection）**: 宣言版の 2/9 しか held-out 最良でない。
可視スコアと未知スコアが同方向なのは 53.1% だけ。＝**"見えてるスコア最良の版を選ぶ"のが一番外す**。

```diff
 ## Step 5: 採用・棄却・凍結の判断材料提示
+> 採用判断のガード（HarnessDev）: 可視スコア最良の版が未知タスク最良とは限らない。
+> - 採用は「適用タスクで良くなった」だけでは不十分。別タスクでも改善が観測されることを必須にする。
+> - スコア差が小さい（±数点）ときはノイズと明記し、安易に採用を勧めない（もう1サイクル観察 or 棄却）。
+> - 可視スコアは局所探索の手がかりで、最終採用の根拠にしない。
```

この C が本命。harness-evolve の中核（採用/凍結判断）を、論文が「一番外しやすい」と実証した
ポイントに対してガードで補強する。既存の Step4 受理条件（別タスクでの改善）と整合。

## 反映するファイル（承認後・可逆）

```bash
SK_RETRO="C:/Users/hiroshi_takizawa/.claude/skills/harness-retro"
SK_EVOLVE="C:/Users/hiroshi_takizawa/.claude/skills/harness-evolve"
# A+B: チェックリスト差し替え（退避してから）
cp "$SK_RETRO/harnessdev-checklist.md" "$SK_RETRO/harnessdev-checklist.md.bak"
cp harness-proposals/skill-updates/harnessdev-checklist.md "$SK_RETRO/harnessdev-checklist.md"
# C: evolve SKILL.md 差し替え（退避してから）
cp "$SK_EVOLVE/SKILL.md" "$SK_EVOLVE/SKILL.md.bak"
cp harness-proposals/skill-drafts/harness-evolve/SKILL.md "$SK_EVOLVE/SKILL.md"
# 原状復帰: 各 .bak を戻す
```

## 期待効果

| 変更 | 効果 |
|---|---|
| A | 診断の質向上。プローブ盲信・死にコード追加を予防（診断=最弱工程を補強） |
| B | 早すぎる完了・退化出力の見逃しを予防（意味的ゲート） |
| C | evolve の採用判断が論文の最重要教訓で裏打ちされ、過学習採用を防ぐ（本命） |

## リスク / 副作用

- チェックリストが4→5項目に増えるが、当てるのは grep ベースで負荷は小。まとめも同期更新済み。
- C は既存 Step4 の「別タスクでも改善」条件を"採用必須条件"に格上げする形で、挙動の方向は変えず強化のみ。
- 全て可逆（.bak 退避）。ライブ反映は承認後。

## 適用対象外の確認

- [x] 「禁止事項」セクションを変更していない
- [x] コミット規約・ブランチ運用ルールを変更していない
- [x] Plans.md の cc:* マーカーに触れていない
- [x] ライブの skills / CLAUDE.md / AGENTS.md を直接編集していない（worktree 内の下書きのみ）
