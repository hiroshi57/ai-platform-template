#!/usr/bin/env node
/**
 * J4: Lighthouse CIでパフォーマンス/アクセシビリティスコアを継続計測する。
 *
 * fact-check-dashboard.html は単一HTMLファイル(file://で直接開く配布物)だが、
 * Lighthouseは file:// をあまり想定しておらず(一部の監査がhttp(s)前提)、
 * 実運用でも `npx serve` 等のHTTP配信で動作確認する運用(FACT-CHECK-DASHBOARD.md参照)
 * のため、ここでも簡易な静的HTTPサーバーを一時的に立てて計測する。
 *
 * 実行方法:
 *   cd frontend
 *   node scripts/lighthouse-check.mjs
 *
 * しきい値を下回った場合は非ゼロ終了コードを返す(CIにそのまま組み込める)。
 * レポート(HTML/JSON)は frontend/.lighthouse/ に出力する。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '..');
const TARGET_FILE = 'fact-check-dashboard.html';
const OUT_DIR = path.join(FRONTEND_DIR, '.lighthouse');

// J4: 現実的な最低ライン。100点を要求すると些細な変更で赤くなりすぎるため、
// 「プロフェッショナルサービスとして恥ずかしくない水準」を下限として設定する。
const THRESHOLDS = {
  performance: 70,
  accessibility: 90,
  'best-practices': 80,
  seo: 60, // 単一HTMLの記録ツールでSEO最適化は本質的な目的ではないため、他より緩め
};

function startStaticServer(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(dir, urlPath === '/' ? '/' + TARGET_FILE : urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath);
        const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer(FRONTEND_DIR);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/${TARGET_FILE}`;

  const chromePath = process.env.CHROME_PATH || chromeLauncher.Launcher.getFirstInstallation();
  if (!chromePath) {
    console.error('[lighthouse-check] Chromeの実行ファイルが見つかりません。CHROME_PATH環境変数を設定してください。');
    server.close();
    process.exit(1);
  }

  const chrome = await chromeLauncher.launch({ chromePath, chromeFlags: ['--headless=new', '--no-sandbox'] });
  try {
    const runnerResult = await lighthouse(url, {
      port: chrome.port,
      output: ['html', 'json'],
      onlyCategories: Object.keys(THRESHOLDS),
      logLevel: 'error',
    });

    const { lhr } = runnerResult;
    const htmlReport = Array.isArray(runnerResult.report) ? runnerResult.report[0] : runnerResult.report;
    const jsonReport = Array.isArray(runnerResult.report) ? runnerResult.report[1] : JSON.stringify(lhr, null, 2);
    fs.writeFileSync(path.join(OUT_DIR, 'report.html'), htmlReport);
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), jsonReport);

    console.log('\n[lighthouse-check] fact-check-dashboard.html のスコア:');
    let failed = false;
    Object.keys(THRESHOLDS).forEach((key) => {
      const score = Math.round((lhr.categories[key]?.score ?? 0) * 100);
      const threshold = THRESHOLDS[key];
      const ok = score >= threshold;
      if (!ok) failed = true;
      console.log(`  ${ok ? 'OK  ' : 'NG  '} ${key}: ${score} (しきい値 ${threshold} 以上)`);
    });
    console.log(`\nレポート: ${path.join(OUT_DIR, 'report.html')}`);

    if (failed) {
      console.error('\n[lighthouse-check] しきい値を下回った項目があります。');
      process.exitCode = 1;
    }
  } finally {
    await chrome.kill();
    server.close();
  }
}

main().catch((e) => {
  console.error('[lighthouse-check] 実行に失敗しました:', e);
  process.exitCode = 1;
});
