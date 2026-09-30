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
2. 「念のため」の追加資料は付けない。必要なら Worker が `files` の範囲で自分で読む。

## 戻り（Worker → Lead）

1. Lead はまず worker-report.v1（`summary` / `self_review` の evidence / `files_changed`）を読む。
2. 全文 diff を読むのは、次のどれかに当てはまるときだけ。それ以外は `git diff --stat` とレポートで判断する。
   - (a) `self_review` に `verified: false` がある
   - (b) Reviewer が指摘した
   - (c) security-sensitive なタスク
   - (d) 生成ファイルを除いた変更行数が **300 行**を超える
3. (d) の行数は次のコマンドで数える。`*.lock` / `package-lock.json` / `dist/` / `*.min.*` は数えない。
   ```bash
   git diff --numstat "$BASE"...HEAD \
     | grep -vE '(\.lock|package-lock\.json|(^|/)dist/|\.min\.)' \
     | awk '{a+=$1; d+=$2} END {print a+d}'
   ```
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
