// frontend/visual-tests/dashboard.visual.spec.js
//
// J3: ビジュアルリグレッションテスト(スクリーンショット比較)。
//
// 正直な注記: スクリーンショットのピクセル比較は、フォントレンダリングがOSごとに
// 異なる(Windows/macOS/Linuxで同じ"sans-serif"でもアンチエイリアシングが変わる)ため、
// 「ローカルで生成したベースラインをそのままLinux版GitHub Actionsランナーで比較する」
// 構成は、実際のUI崩れではなくOS差分で誤検知(false positive)を起こしやすいことが
// 知られている。そのためこのスペックは、
//   - 実行環境(このリポジトリではWindows)でベースラインを生成・比較するローカル/手動の
//     視覚回帰確認ツールとして位置づける(npm run test:fact-check-dashboard:visual)
//   - CI(.github/workflows/ci.yml)には組み込まない(ベースライン生成環境と比較実行環境が
//     異なるとCIが恒常的に赤くなり、本来のCI運用を壊すため)
// という前提で実装している。CIで自動化したい場合は、Dockerコンテナ等でベースライン生成環境
// と比較実行環境を完全一致させる追加インフラが必要(将来の拡張候補、J3の備考にも明記)。
//
// 実行方法:
//   cd frontend
//   npm run test:fact-check-dashboard:visual:update   # 初回・意図的なUI変更後にベースライン更新
//   npm run test:fact-check-dashboard:visual           # ベースラインとの比較
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE_URL = 'file://' + path.resolve(__dirname, '..', 'fact-check-dashboard.html').replace(/\\/g, '/');

async function agreeToConsent(page) {
  const checkbox = page.locator('#consent-checkbox');
  if (await checkbox.count()) {
    await checkbox.check();
    await page.click('#consent-agree');
    await page.waitForTimeout(150);
  }
}

async function seedSampleData(page) {
  await page.evaluate(() => {
    const w = window;
    const mk = (id, monthsAgo, verdict, result) => {
      const d = new Date(); d.setMonth(d.getMonth() - monthsAgo);
      return w.normalizeItem({
        id, createdAt: d.toISOString(), updatedAt: d.toISOString(),
        mediaType: 'text', sourceCategory: 'sns', claimTitle: '見本案件' + id, claimText: 'サンプル本文' + id,
        verdict, officialCheck: { result }
      });
    };
    w.state.items = [
      mk('v1', 0, 'true', 'match'),
      mk('v2', 1, 'mixed', 'partial'),
      mk('v3', 2, 'false', 'mismatch')
    ];
    w.persist();
  });
}

test.describe('fact-check-dashboard.html 主要画面のビジュアル回帰(手動/ローカル実行用、CI非対象)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'ベースラインはChromiumのみで管理する(ブラウザ間差分まで含めると比較対象が増えすぎるため)');

  test('同意ゲート画面', async ({ page }) => {
    await page.goto(FILE_URL);
    await expect(page).toHaveScreenshot('consent-gate.png', { maxDiffPixelRatio: 0.02 });
  });

  test('チェック一覧(空状態)', async ({ page }) => {
    await page.goto(FILE_URL);
    await agreeToConsent(page);
    await page.click('button[data-tab="list"]');
    await page.waitForTimeout(150);
    await expect(page).toHaveScreenshot('list-empty.png', { maxDiffPixelRatio: 0.02 });
  });

  test('ダッシュボード(サンプルデータあり)', async ({ page }) => {
    await page.goto(FILE_URL);
    await agreeToConsent(page);
    await seedSampleData(page);
    await page.click('button[data-tab="dashboard"]');
    await page.waitForTimeout(250);
    await expect(page).toHaveScreenshot('dashboard-with-data.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
  });
});
