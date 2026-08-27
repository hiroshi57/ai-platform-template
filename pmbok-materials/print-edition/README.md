# print-edition／印刷・配布用一括版（TASK-16）

`pmbok-materials/` 直下の `01`〜`15` 番ファイルを番号順に連結した、
印刷・PDF配布用の単一Markdownファイルをここに置く。

## ファイル

- [build.sh](build.sh) — 連結スクリプト。個別ファイルを更新したら必ず再実行する
- `PMBOK_v8_training_materials_full.md` — 生成物（**直接編集しない**）

## 再生成方法

```bash
cd pmbok-materials/print-edition
bash build.sh
```

## PDF化する方法

このリポジトリの実行環境には `pandoc` が入っていないため、PDF自体の生成は
本セッションでは未実施（`task-lists.md` TASK-16は「単一ファイル化」までを完了、
「PDF変換」は利用者側の環境で実施する前提）。以下いずれかの方法で変換できる。

### 方法A：pandoc + LaTeX（日本語対応）

```bash
pandoc PMBOK_v8_training_materials_full.md \
  -o PMBOK_v8_training_materials_full.pdf \
  --toc --toc-depth=2 --pdf-engine=xelatex \
  -V documentclass=ltjsarticle
```

`ltjsarticle`（LuaTeX-ja／XeLaTeX日本語クラス）が使える TeX 環境が必要。

### 方法B：Markdown → HTML → ブラウザ印刷（手軽）

```bash
pandoc PMBOK_v8_training_materials_full.md \
  -o PMBOK_v8_training_materials_full.html --toc
```

生成したHTMLをブラウザで開き、印刷機能から「PDFに保存」する。
日本語フォントの扱いで最もトラブルが少ない方法。

### 方法C：Markdownエディタ／VS Code拡張機能

VS Codeの `Markdown PDF` 拡張機能等でも変換可能。CI/CDに組み込まない
一度きりの配布であれば最も手軽。

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-08-27 | 初版生成（15ファイル、1,450行）。TASK-16対応。PDF変換は未実施（環境依存のため利用者側で実施） |
