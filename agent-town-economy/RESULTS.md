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

## 実LLM接続について（未実行の理由）

- 実行環境の `GEMINI_API_KEY` は無効（`API key not valid`）だったため、実LLMでの
  意思決定ランは**このセッションでは未実行**。
- LLMアダプタ（`sim/llm_backend.py` / `sim/policy.LLMPolicy`）自体は動作検証済み:
  - リクエスト構築・認証ヘッダ・レスポンス解析・不正出力のフォールバックを単体テストで確認
  - Gemini の OpenAI 互換エンドポイントは疎通（401/400 で認証段階まで到達を確認）
- **有効な API キー（または自己ホスト vLLM）を渡せば即実行可能**:

  ```bash
  export LLM_API_KEY=<valid-key>
  python run.py --condition baseline --pulses 60 \
      --llm-base-url https://generativelanguage.googleapis.com/v1beta/openai \
      --llm-model gemini-2.0-flash --osm-geojson data/lakeside.geojson
  ```

  これで論文が未検証とした問い「賃上げを促すモデルなら伝播失敗は崩れるか」を
  実LLM×実地理で検証できる。
