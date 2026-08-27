#!/usr/bin/env bash
# pmbok-materials/print-edition/build.sh
#
# pmbok-materials/ 直下の 01〜15 番ファイルを番号順に連結し、
# 印刷・配布用の単一Markdownファイルを生成する（TASK-16）。
#
# 使い方:
#   cd pmbok-materials/print-edition
#   bash build.sh
#
# PDF化する場合（pandoc が導入済みの環境で）:
#   pandoc PMBOK_v8_training_materials_full.md \
#     -o PMBOK_v8_training_materials_full.pdf \
#     --toc --toc-depth=2 --pdf-engine=xelatex \
#     -V documentclass=ltjsarticle   # 日本語対応LaTeXエンジンが必要
#
# もしくは、Markdown→HTML→PDF（ブラウザの印刷機能でPDF化）の方が
# 日本語環境では手軽な場合が多い:
#   pandoc PMBOK_v8_training_materials_full.md -o PMBOK_v8_training_materials_full.html --toc
#   （生成したHTMLをブラウザで開き、印刷 → PDFに保存）

set -euo pipefail
cd "$(dirname "$0")"

OUT="PMBOK_v8_training_materials_full.md"
SRC_DIR="../"

{
  echo "# PMBOK まとめ資料集 — プロマネ育成キット（第8版対応）｜印刷用一括版"
  echo
  echo "> このファイルは \`print-edition/build.sh\` によって \`pmbok-materials/01〜15\` を"
  echo "> 番号順に自動連結した生成物。個別ファイルを直接編集した場合は、本ファイルも"
  echo "> \`bash build.sh\` を再実行して再生成すること（本ファイル自体は直接編集しない）。"
  echo
  echo "生成日時（UTC）: $(date -u +"%Y-%m-%d %H:%M:%S")"
  echo
  echo "---"
  echo

  for f in $(ls "$SRC_DIR"/*.md | grep -E '/[0-9]{2}_' | sort); do
    name=$(basename "$f")
    echo
    echo "<!-- ============================================================ -->"
    echo "<!-- source: $name -->"
    echo "<!-- ページ区切り（PDF変換時） -->"
    echo
    echo '<div style="page-break-before: always;"></div>'
    echo
    cat "$f"
    echo
  done
} > "$OUT"

echo "生成完了: print-edition/$OUT"
wc -l "$OUT"
