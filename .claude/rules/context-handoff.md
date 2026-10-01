# 引き継ぎ文脈ルール（Lead ⇄ Worker / サブエージェント）

> **適用対象**: Worker やサブエージェントにタスクを渡す Lead、および結果を受け取る Lead / Reviewer
> **起源**: 提案 `harness-proposals/2026-09-28-jev-context-engineering.md`（提案 C）／根拠 Jev 設計メモ II-A・VI
> **承認**: 2026-09-28 人間承認済み（P-2 = 300行で確定）

## 背景

安いモデルやサブエージェントに作業を振っても、安くなるとは限らない。振った先が文脈を読み込み直し、
戻ってきた結果を上位モデルがまた読み直すと、その2回分のコストが単価の差を上回る
（元資料の試算では、上位モデルだけで進めた場合 4.15 に対し、振った場合 6.19）。
振り分けが得になるのは、**行きに小さな専用の文脈だけを渡し、戻りで全部を読み直さない**ときだけ。

## 行き（Lead → Worker / サブエージェント）

1. 渡すのは `task` / `files` / `contract` と、関係する GOTCHAS.md のパスだけ。会話履歴は渡さない。
   （GOTCHAS.md は提案 B が未実装のため、置かれているディレクトリだけが対象）
2. 「念のため」の追加資料は付けない。必要なら Worker が `files` の範囲で自分で読む。

## 戻り（Worker → Lead）

1. Lead はまず worker-report.v1（`summary` / `files_changed`）と、検証コマンドの生出力を読む。
2. 全文 diff を読むかは、**外部の証跡だけ**で決める。Worker の自己申告（`self_review.verified` など）は
   判定に使わない（CLAUDE.md §7「自己申告は判定の根拠にしない」）。次のどれかに当てはまれば全文を読む。
   - (a) 検証コマンドの生出力（`commands.stdout.log`）が無い・空・失敗を含む
   - (b) Reviewer が指摘した
   - (c) contract が security-sensitive、**または**変更したパスが認証・秘密情報・権限・CI・インフラに当たる
     （印の付け忘れに頼らない）
   - (d) 生成ファイル（`dist/` `build/` 配下、`*.lock`、`package-lock.json`、`pnpm-lock.yaml`、`*.min.*`）を
     除いた変更行数が **300 行**を超える
   どれにも当たらなければ `git diff --stat` とレポートで判断する。
3. 判定はスクリプトで行う。手で数えない。
   ```bash
   python scripts/needs_full_diff.py --stdout-log <harness-logs の commands.stdout.log>
   # 基準を変えるとき: --base <ref>（既定は origin/main との merge-base）
   # Reviewer の指摘・contract の印: --reviewer-flagged / --security-sensitive
   ```
   証跡が足りないときは「読む」側に倒す（ログを渡さなければ必ず「読む」になる）。
   - [更新: 2026-10-01] 旧 (a)「`self_review` に `verified: false` がある」は削除した。自己申告に頼る条件で、
     しかも `verified: false` のレポートは Worker 契約上 Lead に届く前に自動で差し戻されるため、発動しなかった。
     旧 3 の行数コマンドは、先頭にある `dist/` を除外できず（`--numstat` の出力ではパスの前がタブのため）、
     `$BASE` も未定義だったので、スクリプトに置き換えた。
4. 生ログは `harness-logs/` に逐語で残す（要約しない。`memory-curation.md` ルール4）。
   「Lead が読むか」と「ログに残すか」は別の判断で、読まないログも消さない。

## 振り分けの判断

1. 安いモデルやサブエージェントに振るかは、トークン単価ではなく
   「**渡す文脈の量＋戻りで読み直す量**」で見積もる。
2. 渡す文脈が親セッションの大半になるなら振らない。上位モデルのまま進める方が安い。

## 変えないもの

- Worker 契約（effort は呼び出し側が決める、Worker は Agent を起動しない、自動修正3回・相談3回の上限）
- review の判定基準（APPROVE / REQUEST_CHANGES）。本ルールが決めるのは Lead の**読み方**だけ

## 見直し

20タスクほど運用したら、提案書 §4 の「全文 diff 読み込み率」と、APPROVE 後の手戻り率を確認する。
手戻りが増えていれば、閾値（300行）を下げるか条件を足す。
