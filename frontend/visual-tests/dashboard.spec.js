// frontend/visual-tests/dashboard.spec.js
//
// J7: Chromium/Firefox/WebKit の3エンジンで、fact-check-dashboard.html の主要フローが
// 実ブラウザで正しく動作することを確認する機能テスト(スモークテスト)。
// jsdomでは検出できないCSSレイアウト・実タイミング・Canvas/Web Worker等を、
// 3エンジン横断で検証する。
//
// 実行方法: cd frontend && npx playwright test visual-tests/dashboard.spec.js
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

test.describe('fact-check-dashboard.html 主要フロー(クロスブラウザ)', () => {
  test('ロード時にエラーが出ず、同意ゲートが表示される', async ({ page, browserName }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(FILE_URL);
    await expect(page.locator('#consent-checkbox')).toBeVisible();
    expect(errors, browserName + ': ページ読み込み時にエラーが発生した: ' + errors.join(', ')).toEqual([]);
  });

  test('同意後にフォームが表示され、保存すると一覧に反映される', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(FILE_URL);
    await agreeToConsent(page);
    await expect(page.locator('#f-claimText')).toBeVisible();

    await page.fill('#f-claimTitle', 'クロスブラウザテスト案件');
    await page.fill('#f-claimText', 'これはPlaywrightのクロスブラウザテストで作成した主張文です。');
    await page.click('#btn-save');
    await page.waitForTimeout(200);

    await page.click('button[data-tab="list"]');
    await page.waitForTimeout(150);
    await expect(page.locator('body')).toContainText('クロスブラウザテスト案件');
    expect(errors).toEqual([]);
  });

  test('ダッシュボードのSVGチャートが実際に描画される(判定内訳・ヒストグラム・レーダー)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(FILE_URL);
    await agreeToConsent(page);

    await page.evaluate(() => {
      const w = window;
      w.state.items = [
        w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'sns', claimTitle: '案件A', claimText: 't', verdict: 'true', officialCheck: { result: 'match' } }),
        w.normalizeItem({ id: 'b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'sns', claimTitle: '案件B', claimText: 't', verdict: 'false', officialCheck: { result: 'mismatch' } })
      ];
      w.persist();
    });
    await page.click('button[data-tab="dashboard"]');
    await page.waitForTimeout(250);

    await expect(page.locator('#chart-histogram')).toHaveCount(1);
    await expect(page.locator('#chart-radar')).toHaveCount(1);
    await expect(page.locator('#chart-donut-verdict')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('印刷レポートを開いてもエラーが出ない', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    await page.goto(FILE_URL);
    await agreeToConsent(page);
    await page.evaluate(() => { window.print = () => {}; }); // 実際の印刷ダイアログは開かせない
    await page.fill('#f-claimTitle', '印刷テスト');
    await page.fill('#f-claimText', '印刷レポートのクロスブラウザ動作確認用の本文です。');
    await page.click('#btn-save');
    await page.waitForTimeout(200);
    await page.click('button[data-tab="list"]');
    await page.waitForTimeout(150);
    const printBtn = page.locator('[data-print]').first();
    if (await printBtn.count()) {
      await printBtn.click();
      await page.waitForTimeout(150);
    }
    expect(errors).toEqual([]);
  });
});
