---
name: ai-words-ja-textlint
description: Use when writing, editing, translating, or reviewing Japanese Markdown text (README, docs, arxiv paper translations, PMBOK materials) to detect AI-like wording deterministically with textlint-rule-preset-ai-words-ja and rewrite it into natural Japanese.
---

# ai-words-ja-textlint

日本語の文章から「AI が書いた文章に出がちな単語・言い回し」を **決定論的に** 検出する
textlint プリセット [`textlint-rule-preset-ai-words-ja`](https://github.com/p1ass/textlint-rule-preset-ai-words-ja)
をこのプロジェクトで使うためのスキル。同じ文章なら常に同じ結果が返るので、翻訳や
ドキュメントの日本語クオリティを一定に保てる。

## いつ使うか

- 日本語の Markdown（`README.md` / `pmbok-materials/**/*.md` など）を書く・直す・翻訳するとき
- arxiv 論文の和訳をレビューして「AI っぽさ」を抜くとき
- 新しいリポジトリに同じチェックを導入するとき（末尾「新規プロジェクトへの導入」）

## 背景: 生成AI前後で日本語はどう変わったか（実証データ）

<!-- textlint-disable ai-words-ja/no-ai-words -->

なぜ「AI っぽい日本語」を気にするのか。逆瀬川ちゃん (@gyakuse) が Qiita の約7万記事
（2019〜2026年 各年8月）を数えた分析
[生成AI以前と以後でエンジニアの文章はどう変わったのか](https://nyosegawa.com/posts/qiita-writing-before-after-ai/)
（2026-09-11）が、単語だけでなく **文章の組み立て方** も定量的に変わったことを示している。
辞書ベースの単語チェックを補う観点として押さえておく。

### 構造の変化（2019〜2022 → 2026、いずれも予測値との差で中〜大）

| 指標 | AI以前 | 2026年 | 変化 |
|---|---|---|---|
| 地の文の文字数 | 976字 | 1,914字 | 約2倍 |
| 太字（1,000字あたり） | 1.26個 | 3.83個 | 約3倍 |
| 箇条書きの割合 | 8.9% | 16.4% | 約1.8倍 |
| 1文あたりの読点 | 0.63個 | 0.95個 | 増加 |

- **文の長さ**（35→39字）は AI 以前からの伸びの延長で、AI だけの影響とは言い切れない。
- 一方 **地の文が長く・太字と箇条書きが急増** したのは AI 以後にはっきり出た変化。
- 教訓: 単語を直すだけでなく、**過剰な太字・箇条書き・水増しされた長文** も AI っぽさの信号。

### 語彙の変化（AI以前はまれ→2026年に急増した代表語）

これらは英語表現の直訳的な言い回しとして日本語技術記事に入ってきたと推測されている
（例:「静かに壊れる」← silently break、「正本」← source of truth、「〜した瞬間」← the moment）。

- **確認・懐疑**: 実測、疑う、照合、見落とす、突き合わせる、断定、取り違える
- **位置・役割を物にたとえる**: 入口、土台、道具、核心、主役、構図、線引き
- **状態・比喩動詞**: 効く（2%→22%）、瞬間、壊れる、境界、静か、黙って
- **手順→仕組み説明へ**: 2026年は「設計・判断・検証・整理・運用・レビュー」等が増え、
  AI以前は「インストール・コマンド・設定・クリック」等の手順語が多かった。

`textlint-rule-preset-ai-words-ja` の内蔵辞書はこうした語の多くを既に収録している。

<!-- textlint-enable ai-words-ja/no-ai-words -->

## このプロジェクトでの構成（導入済み）

| ファイル | 役割 |
|---|---|
| `.textlintrc.json` | `preset-ai-words-ja` 有効化 + `comments` フィルタ + カスタム辞書配線 |
| `textlint-ai-words.custom.json` | ドメイン語の追加辞書（`append` モード。初期は空） |
| `.claude/settings.json` | `PostToolUse` hook。md を Write/Edit するたび自動 lint |
| `.claude/hooks/textlint-md.mjs` | hook 本体（jq 非依存・node 実装・Windows 対応） |
| `package.json` | `lint:text` / `lint:text:fix` script |

## 手順

### 1. チェックする

```bash
npm run lint:text
```

個別ファイルは `npx textlint "path/to/file.md"`。exit 1 = 指摘あり（正常）。

### 2. 指摘を直す

指摘された語は、AI が多用する語彙。文脈に合う自然な言い換えに書き換える。
機械的な置換は避け、意味が通る語を選ぶ。

<!-- textlint-disable ai-words-ja/no-ai-words -->
（例:「土台」→「基盤／前提」、「照合」→「突き合わせ／確認」は文脈次第）
<!-- textlint-enable ai-words-ja/no-ai-words -->

太字・箇条書きが過剰なら、それ自体も減らす（背景セクション参照）。

### 3. どうしても残したい箇所だけ無効化する

辞書から語ごと外すほどではなく、その段落だけ止めたいときはコメントで囲む
（`textlint-filter-rule-comments` を導入済み）:

```markdown
<!-- textlint-disable ai-words-ja/no-ai-words -->

この段落では指摘されません。

<!-- textlint-enable ai-words-ja/no-ai-words -->
```

ファイル・フォルダ全体を対象外にするなら `.textlintignore` を使う。

### 4. ドメイン語を辞書に足す

このリポジトリ特有の避けたい語は `textlint-ai-words.custom.json` の `entries` に追加する。
`basic_form` で書くと活用形もまとめて検出できる:

```json
{
  "entries": [
    {
      "message": "\"醸成\" は避けたい表現です。",
      "tokens": [{ "pos": "名詞", "basic_form": "醸成" }]
    }
  ]
}
```

条件に使えるトークンのプロパティ: `surface_form` / `pos` / `pos_detail_1` / `basic_form`。
設定変更は不要（`.textlintrc.json` が既にこのファイルを `append` で読み込む）。

## エージェントの自動修正ループ

`PostToolUse` hook が md 保存のたびに textlint を実行し、指摘があれば exit 2 で内容を返す。
Claude はその指摘を読んで自分で書き直せる。人が毎回指示しなくてよい。

## 新規プロジェクトへの導入

```bash
npm install --save-dev textlint textlint-rule-preset-ai-words-ja textlint-filter-rule-comments
```

`.textlintrc.json`（最小構成）:

```json
{
  "filters": { "comments": true },
  "rules": { "preset-ai-words-ja": true }
}
```

hook を使う場合は `.claude/settings.json` の `PostToolUse` に
`node .claude/hooks/textlint-md.mjs` を登録し、hook スクリプトをコピーする。

## 参考

- プリセット: https://github.com/p1ass/textlint-rule-preset-ai-words-ja
- 紹介記事: https://blog.p1ass.com/posts/textlint-rule-preset-ai-words-ja/
- 実証分析（逆瀬川ちゃん, 2026-09-11）: https://nyosegawa.com/posts/qiita-writing-before-after-ai/
- v1.2.0 内蔵辞書は約50語。最新一覧はプリセット README を参照。
