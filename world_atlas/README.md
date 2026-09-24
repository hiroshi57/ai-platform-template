# せかい3Dデジタル図鑑

国連(UNDP・UNHCR)・世界銀行・CIA World Factbook・世界の大学(オックスフォード / フローニンゲン /
ヨーテボリ / ウプサラ)の公開データを集め、**200か国以上を3D地球儀と図鑑ページで比べられる**
中学生・高校生向けのデジタル図鑑です。データは週1回自動で取り直します。

> 背景: 日本は島国で、世界の出来事の情報に触れる機会が少なくなりがち。世界の事実データを
> 地図帳のように「比べる・分ける・考える」形で共有し、社会問題を自分ごととして考えるきっかけにする。

## できること

| モード | 中身 |
|---|---|
| 🌐 地球儀 | 指標で国を色分けし、**値の大きさで国を立体的に持ち上げる3D表示**。年スライダーと ▶ 再生で過去から現在へ(歴史の章は紀元前1万年から) |
| 📘 図鑑ページ | 国旗・基本情報・日本語の概要(Wikipedia)・CIA Factbook の地理/気候/言語/宗教/政治・**世界全体との差・順位・S〜D評価・10年の推移・2030年予測・総評** |
| 🏆 ランキング | 地域で絞り込み、世界全体の値の線付き |
| ⚖️ くらべる | 最大4か国の推移(予測の点線付き)・章ごとのレーダー・指標表 |
| 🧩 分類 | 地域/所得グループ別の分布と中央値・2指標の散布図(相関係数と読み方)・「データが似ている国」 |
| 📜 ビジュアル年表 | 古代〜現代の97件。**歴史上の人物をオリジナルのキャラクターで描き**(60件)、関係する国が3D地球儀で光り、その国の上にキャラクターが立つ。背景に世界人口の推移 |
| 🎯 SDGs | 17目標のタイルと国別スコア・目標ごとの関連指標・上位/下位の国・スコアを地球儀で表示 |
| 📚 出典 | 全指標の出典・期間・取得状態・注意事項 |

章立て(10章・62指標): 地理・地形 / 人口 / 気候・環境 / 生き物・自然(生物学) / 経済・くらし /
健康・医療 / 教育・科学 / 平和・紛争 / 人間開発(UNDP) / 歴史のデータ(大学の長期推計)。
全体の計画とタスクの進み具合は [Task-lists.md](Task-lists.md) を参照。

## 開き方(ローカル)

データは `site/data/` に同梱しています。JSON を読み込むため、ファイルを直接開かずローカルサーバー経由で開いてください。

```bash
python -m http.server 8765 --directory world_atlas/site
```

ブラウザで http://127.0.0.1:8765/ を開きます(3D地球儀と国旗は CDN から読み込むため、インターネット接続が必要です)。
URL の `#m=globe&i=life_exp&c=JPN` のように、モード・指標・国を指定して共有できます。

## データの更新

```bash
python -m world_atlas.pipeline.build_data                  # 全ソースを取り直す(10分前後)
python -m world_atlas.pipeline.build_data --only wb,undp   # 指標ソースを限定
python -m world_atlas.pipeline.build_data --skip wiki      # 付帯情報(factbook,wiki,geo)を省略
```

- 標準ライブラリだけで動きます(追加の pip パッケージ不要)。
- 取得に失敗したソースは**前回のファイルを残します**。結果は `site/data/meta.json` と画面の「出典」に出ます。
- `.github/workflows/world-atlas-data.yml` が毎週月曜 03:00 JST に取り直し、差分があれば **PR を作成**します
  (main へ直接は書き込みません)。PR 作成には、リポジトリ設定で「Allow GitHub Actions to create and approve pull requests」を有効にする必要があります。

## 構成

```
world_atlas/
├── pipeline/
│   ├── indicators.py     指標カタログ(章・中高生向け解説・SDGs対応・望ましい向き)
│   ├── analytics.py      予測・整形の純粋関数(tests/test_world_atlas_pipeline.py)
│   ├── build_data.py     取得・整形・出力
│   ├── timeline_ja.json  世界史年表と人物キャラクターの定義
│   ├── names_ja.json     日本語国名(gen_names_ja.mjs で Node の Intl から生成)
│   └── gen_names_ja.mjs
└── site/                 静的サイト(ビルド不要)
    ├── index.html / style.css
    ├── js/app.js         画面本体
    ├── js/analytics.js   順位・評価・総評の計算(analytics.test.mjs)
    ├── js/charts.js      SVG グラフ(折れ線・レーダー・散布図・横棒)
    ├── js/characters.js  歴史人物キャラクターの SVG 描画
    └── data/             生成データ(series/ は指標ごとの時系列、latest.json は軽量サマリ)
```

テスト:

```bash
python -m pytest -q tests/test_world_atlas_pipeline.py
```

```bash
node --test world_atlas/site/js/analytics.test.mjs
```

## 注意・免責

- 数値は各機関の公表値・推計です。国によって調査年や方法が異なります。
- 2030年予測は過去10年の傾向をそのまま伸ばした参考値です。
- S〜D評価・章スコア・SDGsスコアは本図鑑が順位から計算した目安で、国連などの公式評価ではありません。
- 国境や国・地域の名称は特定の立場を示すものではありません(データ提供元の区分に従います)。
- 年表の人物は本図鑑オリジナルのデフォルメ・キャラクターで、実際の顔とは異なります。宗教の開祖は信仰への配慮から顔を描かず、シンボルで表しています。
- Wikipedia の文章は CC BY-SA 4.0。各国の概要には出典リンクを付けています。
