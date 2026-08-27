# リリース前チェックリスト(fact-check-dashboard.html)

> J8: 手動QA項目のドキュメント化。`APP_VERSION`を上げて配布する前に、このチェックリストを
> 上から順に実施する。すべて緑になってから配布(コミット・タグ付け・再配布案内)すること。
> 自動化できる項目にはコマンドを併記しているので、手動確認は自動化できない項目に絞ってよい。

## 1. コード品質(自動化済み・必須)

- [ ] 構文エラーが無い
  ```bash
  cd frontend
  node -e "const fs=require('fs');const html=fs.readFileSync('fact-check-dashboard.html','utf8');const m=html.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync('.tmp-check.js', m[1]);" && node --check .tmp-check.js && rm .tmp-check.js
  ```
- [ ] jsdomテストが全件PASSする(J1、CIでも自動実行される)
  ```bash
  npm run test:fact-check-dashboard
  ```
- [ ] クロスブラウザ・スモークテストが全件PASSする(J7、CIでも自動実行される)
  ```bash
  npm run test:fact-check-dashboard:e2e -- visual-tests/dashboard.spec.js
  ```

## 2. 実ブラウザでの目視確認(手動・jsdomでは検出できない項目)

> jsdomにはレイアウトエンジンが無いため、次の項目は実ブラウザ(Chrome/Edge等)を
> 実際に開いて確認すること。Playwright等でスクリーンショットを撮ってもよい。

- [ ] 同意ゲート → 新規登録 → 保存 → 一覧反映、の一連の流れがスムーズに動く
- [ ] ダッシュボードの全チャート(判定内訳ドーナツ・ヒートマップ・時系列・ヒストグラム・
      レーダー・前年同月比較)がデータありで正しく描画される
- [ ] モバイル幅(375px程度)でボトムナビ・テーブルの横スクロールが崩れていない
- [ ] 印刷プレビュー(Ctrl+P)でレイアウトが崩れておらず、チャートが用紙幅に収まる(C9)
- [ ] KPIカードのドラッグ並び替えが実際にマウス操作で機能する(C7)
- [ ] チャートのPNG保存ボタンで実際にファイルがダウンロードされる(C10)
- [ ] 大量データ(300件超)でのCSV/JSONエクスポート時にUIがフリーズしない(G6、Web Worker使用)
- [ ] ビジュアルリグレッションテストで差分が無い、または差分が意図した変更のみである(J3)
  ```bash
  npm run test:fact-check-dashboard:visual:update   # ベースラインが無い/古い場合
  npm run test:fact-check-dashboard:visual           # 比較
  ```
  ⚠ このスクリーンショット比較はローカル実行専用(OS間のフォントレンダリング差により
  CIでの自動比較には向かないため)。詳細は`visual-tests/dashboard.visual.spec.js`冒頭のコメント参照。

## 3. アクセシビリティ・パフォーマンス(自動計測+しきい値判定)

- [ ] Lighthouseスコアがしきい値を満たす(J4)
  ```bash
  node scripts/lighthouse-check.mjs
  ```
  既定のしきい値: performance 70 / accessibility 90 / best-practices 80 / seo 60
  (`scripts/lighthouse-check.mjs`内の`THRESHOLDS`で変更可能)

## 4. データ整合性・セキュリティ

- [ ] `SCHEMA_VERSION`を上げた場合、`normalizeItem()`等に旧データからの移行処理が入っている
- [ ] 新規追加したユーザー入力欄がすべて`esc()`経由でエスケープされている(K1)
- [ ] CSPのmetaタグに違反する新規リソース読み込みを追加していない(K4)。追加した場合は
      `<meta http-equiv="Content-Security-Policy">`のディレクティブを更新すること
- [ ] サーバー共有機能に変更を加えた場合、`di-tools-api.vercel.app`への実際の疎通確認を
      行っている(モックfetchのテストだけで済ませない)

## 5. ドキュメント・バージョニング(「常にアップできるループ」)

- [ ] `APP_VERSION`を上げた
- [ ] `CHANGELOG.md`に変更内容を追記した
- [ ] `Task-lists.md`の該当タスクに`[x]`を付け、実装・検証内容を書いた
- [ ] `Task-lists.md`の「進行ログ」に本セッションの作業内容を追記した
- [ ] (該当する場合)`FACT-CHECK-DASHBOARD.md`の使い方・制約事項を更新した

## 6. 配布(正規版ユーザーがいる場合)

- [ ] 変更後のファイルを配布方法(現状は手動配布)に沿って再配布する準備ができている
- [ ] 破壊的変更(データ形式の非互換な変更等)がある場合は、配布時の案内文に明記する

---

このチェックリストは`Task-lists.md`のJ区分と対応しています。項目の追加・変更が必要になった
場合は、実際に運用してみて「形骸化していないか」を定期的に見直してください。
