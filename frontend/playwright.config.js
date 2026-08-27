// frontend/playwright.config.js
//
// fact-check-dashboard.html は単一HTMLファイルの配布物であり、通常のWebサーバー起動を
// 前提にしない(file://で直接開かれる想定)。そのためbaseURLやwebServerは使わず、
// 各テストがpage.goto('file://...')で直接開く方式にしている。
//
// J7: Chromium/Firefox/WebKit(Safari相当)の3エンジンでクロスブラウザテストを実行する。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  testDir: path.join(__dirname, 'visual-tests'),
  timeout: 30000,
  fullyParallel: true,
  // ローカル/CIどちらでも同じ結果になるよう、リトライは行わない
  // (リトライで誤魔化すと本質的なタイミング依存バグを見逃す)
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 1400 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
};
