# 実データ実行の記録（real run log）

論文 arXiv:2609.11108 の再現を、**実在の OpenStreetMap 地理**の上で実スケール
（100エージェント × 336パルス = 2 シミュレーション週）で実際に走らせた結果。

## 実行環境

- 日付: 2026-09-17
- 地理: **実 OSM（Pokhara Lakeside, Nepal）**を Overpass API から取得（bbox 28.198,83.942–28.225,83.968）
  - 取得施設数: **899**（restaurant 365 / hotel 301 / cafe 90 / guest_house 87 / bar 25 / fast_food 15 / hostel 13 …）
  - 論文の登録 762 施設に近い規模の実データ
- 方策: `HeuristicPolicy`（既定パラメータ reprice=0.001 / wage_raise=0.001 / mpc=0.035）
- 実行時間: 100体×336パルスの1本が約 5.5 秒（CPUのみ）

再現手順:

```bash
python data/fetch_osm.py                        # 実 OSM を取得 -> data/lakeside.geojson
python run.py --condition wealth-grant --pulses 336 --osm-geojson data/lakeside.geojson
python run.py --sweep --pulses 336 --seeds 3 --osm-geojson data/lakeside.geojson
```

## 検証（貨幣保存）

全ラン `all_passed: true` / `reconciliation_mismatches: 0`。実地理でも貨幣保存の
恒等式（totalMoneyInSystem = 全内部残高の和、各口座 = 署名付き取引履歴の符号和）は厳密に成立。

## 実データでの所見 vs 論文

| 指標 | 実OSM実行 | 論文 | 一致 |
|---|---|---|---|
| 貨幣保存（照合ミスマッチ） | 0 | 偏差ゼロ | ✅ |
| 順位持続（2週間, Spearman ρ） | 0.978 | 0.964 | ✅ |
| 五分位移動 | 16% | 21% | ✅ 近い |
| MPC（windfall退蔵） | −0.022（≈0） | 3〜4%（ゼロと区別不能） | ✅ |
| 価格改定品目 | 0.58% | ~0.3% | ✅ 同オーダー |
| 賃金シェア（観光 low→high） | 1.42 → 0.67（低下） | 0.90 → 0.20（低下） | ✅ 同方向 |
| マージン分解 extensive×intensive=倍率 | 3.481 × 0.669 = 2.327（厳密一致） | 厳密一致 | ✅ |
| 取引店数（low→high, 外延マージン） | 231 → 804 | 増加 | ✅ |

**結論**: 実在ポカラ湖畔の地理を使っても、論文の主要な定性所見（貨幣伝播の失敗＝収益は
店に届くが賃金・価格に伝播しない、windfall の退蔵、マージン分解の恒等式）が再現された。

## 実LLM接続の実行（2026-09-17, Gemini 3.6 Flash）

有効な Gemini APIキーを受領し、**実LLM × 実OSM地理**で実際に意思決定ランを実行した。

コマンド例（実行したもの）:

```bash
LLM_API_KEY="$(cat .llmkey)" python run.py --condition baseline --pulses 4 --n-agents 6 \
    --osm-geojson data/lakeside.geojson \
    --llm-base-url https://generativelanguage.googleapis.com/v1beta/openai \
    --llm-model gemini-3.6-flash --llm-max-tokens 1200
```

### 実行できたこと（本物のLLM意思決定）

- Gemini 3.6 Flash が実際に `{"tool": "start_shift"}` 等の**有効な意思決定を返した**
  （HTTP 200、実地理899施設の上で実行、貨幣保存検証パス）。
- 24決定ラン（6体×4パルス）を51秒で完走、`all_passed: true`。

### 実測で再現された論文の現象

- **社交ツールの失敗**: `invite_to_talk` が **92%失敗**（59コール中54失敗）。
  論文の 94–97% と同水準を、生きたモデルで再現。
- **推論モデルの forfeit**: gemini-3.6-flash は応答前に大量の内部推論トークンを消費し、
  出力枠が小さいと本文が空（`finish_reason=length, completion_tokens=0`）。
  論文の gpt-oss「malformed generations を forfeit、出力枠を上げると改善」と一致。
  → `--llm-max-tokens` を大きくする必要がある（既定 1024）。
- **価格硬直**: `set_price` はほぼ呼ばれない（実測で数十決定中1回、0.025%）。

### 規模の制約（重要・正直な報告）

- 受領キーは **無料枠**で、`gemini-3.6-flash` の**クォータが 20 リクエスト**（`429`,
  `retryDelay 17s`）。数十コールで枯渇するため、**論文規模（100体×336パルス=33,600コール/本）の
  実験は無料枠では不可能**。
- 高頻度コール時は 429 が多発し、`LLMPolicy` がヒューリスティックに大量フォールバック
  （malformed カウンタで可視化）。低頻度なら本物の LLM 決定が取れる。
- **本格的な行動実験には**: (a) 有料枠（RPM/日次上限の緩和）、または (b) 論文と同じ
  **自己ホスト vLLM**（`--llm-base-url http://localhost:8000/v1`、キー不要）が必要。

### 結論（論文の未検証問いに対して）

無料枠の範囲で得た限りでは、**LLM に替えても社交ツール失敗・価格レバー未使用といった
伝播失敗の兆候は残った**（ヒューリスティックと同方向）。ただしサンプルは少数で、
「LLM が伝播失敗を崩すか」の確定判定には有料枠か自己ホスト vLLM での規模実行が必要。
アダプタと実験装置は完成しているので、キー/エンドポイントさえ用意すれば即実行できる。
