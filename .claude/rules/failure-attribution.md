# 失敗の根本原因帰属ルール（attribution test）

> **適用対象**: 失敗を分類し reason_code / escalation_reason を選ぶ全 Worker / Lead
> **起源**: 提案 `harness-proposals/2026-09-15-organizational-second-brain.md`（提案A）／根拠 Meta "Organizational Second Brain: Building an AI That Learns From Experts"（engineering.fb.com 2026-09-02, Diagnosis 節）
> **承認**: 2026-09-15 人間承認済み

## 背景

失敗を「会話の形式」で分類すると根本原因を取り違える。Meta の実証では、専門家が
情報を与えたか軌道修正したかは根本原因の悪い代理指標であり、結論を修正する専門家は
knowledge gap・procedure 欠陥・真の曖昧さのいずれをも露呈しうる。**抽出と分類を分離し、
単一の帰属テストで切り分ける**ことで、無駄な skill 改変や誤った memory 追加を減らせる。

## ルール（MUST）

Worker / Lead が retry / escalate の理由を決めるとき、会話の形式（情報提供か軌道修正か）で
判断してはならない。次の単一テストを適用する。

> **帰属テスト**: エージェントは手元の材料（memory / skill / context / 検証出力）から
> 正しい結論に到達できたか?

| 判定 | 根本原因 | 対処 |
|------|----------|------|
| 材料に正解あり かつ 誤った | **procedure 問題** | skill / recipe を編集する。memory は変えない |
| 材料に正解なし | **knowledge gap** | memory を追加する。skill は変えない |
| 人間同士で正解が割れる | **ambiguity** | human へ escalate。自動修正しない |

- `worker-report` / `advisor-request` の `reason_code`、および `escalation_reason` は
  この帰属に基づいて選ぶ。
- 分類の前に、まず**エージェントの知識マニフェスト**（どのファイルをいつ・どう読み込んだか）を
  抽出し、実際の材料を読んでから帰属テストを当てる。会話ログの見た目だけで即断しない。

## harness-retro との連携

- 本帰属により `escalation_reason` / `reason_code` が「knowledge か procedure か」で
  正しく束ねられ、`harness-retro.sh --check`（直近10タスク中3回で再発検知）の精度が上がる。
- ambiguity は自動改善対象にせず、人間の議論へ回す（`.claude/rules/harness-retro.md` の
  「禁止事項は人間のみ変更」原則と整合）。

## 例外

- 帰属が判定不能なほど材料が不足している場合は、無理に procedure / knowledge へ寄せず
  `ambiguity` 扱いで human へ escalate する。
