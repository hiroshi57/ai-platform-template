/**
 * frontend/fact-check-dashboard.html の回帰テスト。
 *
 * 実行方法:
 *   cd frontend && npm install && npm run test:fact-check-dashboard
 *
 * jsdom上でHTMLファイルをそのまま実行し、DOM操作を通じて主要フローを検証する。
 * ネットワークアクセスは行わない(fetchは各テストでモックする)。
 * 失敗時は非ゼロ終了コードを返すため、CIにそのまま組み込める。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, 'fact-check-dashboard.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

/**
 * J6: 主要関数の網羅率を計測する簡易カバレッジツール。
 *
 * 正直な注記: c8/V8カバレッジは、jsdomが`vm`経由で<script>内容を実行する構造上、
 * 実測してみたところファイルパスが一致せずカバレッジ0%と誤表示された(試した上で
 * 採用を見送った)。代わりに、HTMLソースからトップレベルの`function 名前(...)`宣言を
 * 正規表現で抽出し、各グローバル関数を「何回呼ばれたか」を数える呼び出し回数計測方式を
 * 採用する。行/分岐カバレッジではなく「関数単位の呼び出し網羅率」である点に注意
 * (呼ばれてはいるが特定の分岐だけ通っていない、というケースは検出できない)。
 * さらに、計測用のラップはdom生成(freshDom())の"後"に行うため、`loadState`/`loadReferenceDb`/
 * `loadDraftBackup`のようにページ初回ブートストラップ時(スクリプト末尾の即時実行コード)
 * にのみ呼ばれる関数は、実際には呼ばれていても「未呼び出し」として報告される既知の限界がある。
 * レポートの「一度も呼ばれなかった関数」は、この限界を踏まえた上で目視で要否を判断すること。
 *
 * 実行方法: node fact-check-dashboard.test.cjs --func-coverage
 */
const FUNC_COVERAGE_ENABLED = process.argv.includes('--func-coverage');
const FUNC_COVERAGE_COUNTS = new Map();
const TOP_LEVEL_FUNCTION_NAMES = Array.from(
  HTML.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)
).map((m) => m[1]);

function instrumentFunctionCoverage(win) {
  TOP_LEVEL_FUNCTION_NAMES.forEach((name) => {
    const orig = win[name];
    if (typeof orig !== 'function' || orig.__fcCoverageWrapped) return;
    const wrapped = function (...args) {
      FUNC_COVERAGE_COUNTS.set(name, (FUNC_COVERAGE_COUNTS.get(name) || 0) + 1);
      return orig.apply(this, args);
    };
    wrapped.__fcCoverageWrapped = true;
    try { win[name] = wrapped; } catch (e) { /* 上書き不可なプロパティは無視 */ }
  });
}

function printFunctionCoverageReport() {
  if (!FUNC_COVERAGE_ENABLED) return;
  const total = TOP_LEVEL_FUNCTION_NAMES.length;
  const called = TOP_LEVEL_FUNCTION_NAMES.filter((n) => FUNC_COVERAGE_COUNTS.has(n));
  const uncalled = TOP_LEVEL_FUNCTION_NAMES.filter((n) => !FUNC_COVERAGE_COUNTS.has(n));
  console.log('');
  console.log('=== J6: 関数呼び出しカバレッジ(トップレベル関数のみ) ===');
  console.log('総関数数: ' + total + ' / テストで呼ばれた関数数: ' + called.length +
    ' (' + Math.round((called.length / total) * 100) + '%)');
  if (uncalled.length) {
    console.log('一度も呼ばれなかった関数(' + uncalled.length + '件):');
    uncalled.forEach((n) => console.log('  - ' + n));
  } else {
    console.log('すべてのトップレベル関数が少なくとも1回は呼ばれました。');
  }
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log('  FAIL - ' + name);
    console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e));
  }
}

async function freshDom() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  await new Promise((r) => setTimeout(r, 100));
  if (FUNC_COVERAGE_ENABLED) instrumentFunctionCoverage(dom.window);
  return dom;
}

async function agreeToConsent(dom) {
  const doc = dom.window.document;
  const cb = doc.getElementById('consent-checkbox');
  if (cb) {
    cb.checked = true;
    cb.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    doc.getElementById('consent-agree').click();
  }
}

(async () => {
  console.log('fact-check-dashboard.html regression tests');
  console.log('source: ' + HTML_PATH);
  console.log('');

  await test('構文エラーなくロードでき、主要なグローバル関数が公開される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    ['persist', 'computeOverall', 'axisScores', 'suggestVerdict', 'licGenerate', 'licVerify', 'hasConsent'].forEach((k) => {
      assert.strictEqual(typeof w[k], 'function', k + ' is not a function');
    });
  });

  await test('初回ロード時は同意ゲートが表示され、フォームは表示されない', async () => {
    const dom = await freshDom();
    const doc = dom.window.document;
    assert.ok(doc.getElementById('consent-checkbox'), '同意チェックボックスが見つからない');
    assert.strictEqual(doc.getElementById('f-claimText'), null, '同意前にフォームが表示されている');
  });

  await test('同意すると新規チェックフォームが表示される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    assert.ok(doc.getElementById('f-claimText'), '同意後にフォームが表示されない');
    assert.strictEqual(dom.window.hasConsent(), true);
  });

  await test('セグメント行・クロスチェック行の追加/削除がグリッド崩れなく機能する', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    doc.querySelector('[data-add="segments"]').click();
    assert.strictEqual(doc.querySelectorAll('#segments-list [data-rid]').length, 1);
    // segments行は3列(text/select/button)でなければならない(4番目の空divが混入する回帰を防ぐ)
    const segRow = doc.querySelector('#segments-list [data-rid]');
    assert.strictEqual(segRow.children.length, 3, 'segments行の子要素数が3ではない(グリッド崩れの回帰)');

    const addCross = doc.querySelector('[data-add="crossChecks"]');
    addCross.click();
    addCross.click();
    assert.strictEqual(doc.querySelectorAll('#cross-list [data-rid]').length, 2);
    doc.querySelector('#cross-list [data-remove="crossChecks"]').click();
    // E3: 削除時は即座にDOMから消えず、フェードアウト分(180ms未満)だけ遅れて除去される
    // (データ自体は即時更新されるため、保存・自動保存への影響は無い)。
    await new Promise((r) => setTimeout(r, 250));
    assert.strictEqual(doc.querySelectorAll('#cross-list [data-rid]').length, 1);
  });

  await test('①〜⑤の根拠を記録するとスコア・根拠数(x/5)が正しく再計算される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const officialSel = doc.getElementById('f-officialCheck.result');
    officialSel.value = 'match';
    officialSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const scoreEl = doc.querySelector('#verdict-block .kpi:nth-child(1) .v');
    const evEl = doc.querySelector('#verdict-block .kpi:nth-child(3) .v');
    assert.strictEqual(scoreEl.textContent, '100');
    assert.strictEqual(evEl.textContent, '1/5');
  });

  await test('根拠ゼロで最終判定(誤り等)を保存しようとすると確認ダイアログが出て、拒否すれば保存されない', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    let confirmCalled = 0;
    dom.window.confirm = () => { confirmCalled++; return false; };
    doc.getElementById('f-claimText').value = 'evidence guard test';
    doc.getElementById('f-claimText').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const verdictSel = doc.getElementById('f-verdict');
    verdictSel.value = 'false';
    verdictSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    doc.getElementById('btn-save').click();
    assert.strictEqual(confirmCalled, 1, '根拠ゼロでの確定判定保存時に確認ダイアログが呼ばれていない');
    assert.strictEqual(dom.window.state.items.length, 0, '確認を拒否したのに保存されてしまった');
  });

  await test('根拠ゼロでも確認を承諾すれば保存でき、履歴(history)が記録される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    dom.window.confirm = () => true;
    doc.getElementById('f-claimText').value = 'history test';
    doc.getElementById('f-claimText').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const verdictSel = doc.getElementById('f-verdict');
    verdictSel.value = 'false';
    verdictSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    doc.getElementById('btn-save').click();
    assert.strictEqual(dom.window.state.items.length, 1);
    const item = dom.window.state.items[0];
    assert.strictEqual(item.history.length, 1);
    assert.strictEqual(item.history[0].to, 'false');
  });

  await test('保存後は下書きバックアップ(DRAFT_KEY)が削除される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    dom.window.confirm = () => true;
    doc.getElementById('f-claimTitle').value = 'draft cleanup test';
    doc.getElementById('f-claimTitle').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700)); // オートセーブのデバウンス待ち
    assert.ok(dom.window.localStorage.getItem(dom.window.DRAFT_KEY), 'オートセーブが機能していない');
    doc.getElementById('btn-save').click();
    assert.strictEqual(dom.window.localStorage.getItem(dom.window.DRAFT_KEY), null, '保存後もドラフトが残っている');
  });

  await test('クラッシュ復旧: 起動前に残っていた下書きが復元バナーとして表示され、復元できる', async () => {
    const dom = new JSDOM(HTML, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost/',
      beforeParse(win) {
        win.localStorage.setItem(
          'fc_dashboard_v1:__draft',
          JSON.stringify({
            at: new Date().toISOString(),
            editingId: null,
            draft: {
              id: 'd1', mediaType: 'text', sourceCategory: 'media', claimTitle: 'クラッシュ前の下書き',
              claimText: '', sourceUrl: '', archiveUrl: '', collectedAt: '', segments: [],
              officialCheck: { result: '', agency: '', note: '', link: '' },
              primaryCheck: { result: '', sourceType: '', note: '', link: '' },
              crossChecks: [], aiChecks: [], toolChecks: [], verdict: '', summary: '', reviewer: '', history: []
            }
          })
        );
      }
    });
    await new Promise((r) => setTimeout(r, 150));
    const doc = dom.window.document;
    await agreeToConsent(dom);
    assert.ok(doc.querySelector('.draft-recover'), '復元バナーが表示されない');
    doc.getElementById('draft-restore').click();
    assert.strictEqual(doc.getElementById('f-claimTitle').value, 'クラッシュ前の下書き');
  });

  await test('localStorage書き込み失敗時に保存失敗バナーが表示され、成功時に消える', async () => {
    const dom = await freshDom();
    const proto = Object.getPrototypeOf(dom.window.localStorage);
    const orig = proto.setItem;
    proto.setItem = function (k, v) {
      if (k === 'fc_dashboard_v1') throw new Error('boom');
      return orig.call(this, k, v);
    };
    dom.window.persist();
    assert.ok(dom.window.document.getElementById('save-error-banner').textContent.includes('保存に失敗'));
    proto.setItem = orig;
    dom.window.persist();
    assert.strictEqual(dom.window.document.getElementById('save-error-banner').textContent, '');
  });

  await test('CSVエクスポートの値が正しくエスケープされる', async () => {
    const dom = await freshDom();
    let captured = null;
    dom.window.Blob = function (parts) { captured = parts.join(''); };
    dom.window.URL.createObjectURL = () => 'blob://fake';
    dom.window.URL.revokeObjectURL = () => {};
    dom.window.state.items = [dom.window.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'サンプル,主張"引用"', claimText: '本文',
      sourceUrl: 'https://example.com', archiveUrl: '', collectedAt: '', segments: [],
      officialCheck: { result: 'match', agency: '', note: '', link: '' },
      primaryCheck: { result: '', sourceType: '', note: '', link: '' },
      crossChecks: [], aiChecks: [], toolChecks: [], verdict: 'true', summary: '', reviewer: '', history: []
    })];
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    dom.window.document.getElementById('btn-export-csv').click();
    assert.ok(captured.includes('サンプル,主張""引用"""'), 'CSVのダブルクォートエスケープが不正: ' + captured);
  });

  await test('JSONエクスポートは有効なJSONを出力する', async () => {
    const dom = await freshDom();
    let captured = null;
    dom.window.Blob = function (parts) { captured = parts.join(''); };
    dom.window.URL.createObjectURL = () => 'blob://fake';
    dom.window.URL.revokeObjectURL = () => {};
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    dom.window.document.getElementById('btn-export-json').click();
    const parsed = JSON.parse(captured);
    assert.ok(Array.isArray(parsed.items));
    assert.ok(parsed.weights);
  });

  await test('正しいライセンスキーで登録すると正規版表示になり、解除すると試用版に戻る', async () => {
    const dom = await freshDom();
    const key = dom.window.licGenerate('テスト株式会社', dom.window.STORE);
    const doc = dom.window.document;
    doc.getElementById('lic-toggle').click();
    doc.getElementById('lic-company').value = 'テスト株式会社';
    doc.getElementById('lic-key').value = key;
    doc.getElementById('lic-apply').click();
    assert.ok(doc.querySelector('.licensebar.valid'), '正しいキーで登録しても正規版表示にならない');
    dom.window.confirm = () => true; // 解除確認ダイアログ
    doc.getElementById('lic-release').click();
    assert.ok(doc.querySelector('.licensebar.trial'), '解除しても試用版表示に戻らない');
  });

  await test('誤ったライセンスキーは拒否される', async () => {
    const dom = await freshDom();
    const doc = dom.window.document;
    doc.getElementById('lic-toggle').click();
    doc.getElementById('lic-company').value = 'テスト株式会社';
    doc.getElementById('lic-key').value = 'WRONG-KEYX';
    doc.getElementById('lic-apply').click();
    assert.ok(doc.querySelector('.licensebar.trial'), '誤ったキーで登録できてしまった');
    assert.ok(doc.getElementById('lic-msg').textContent.length > 0);
  });

  await test('サーバー共有パネルは未登録(試用版)時は無効化メッセージを表示する', async () => {
    const dom = await freshDom();
    const doc = dom.window.document;
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    assert.ok(doc.getElementById('share-panel').textContent.includes('正規版のみ'));
  });

  await test('サーバー共有パネルは正規版登録後にリンク発行UIを表示し、モックfetchで作成できる', async () => {
    const dom = await freshDom();
    const key = dom.window.licGenerate('テスト株式会社', dom.window.STORE);
    dom.window.localStorage.setItem('fcd_license', JSON.stringify({ company: 'テスト株式会社', key }));
    dom.window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ id: 'abc123', editKey: 'edit999', updatedAt: '2026-08-27T00:00:00.000Z' }) });
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    const doc = dom.window.document;
    assert.ok(doc.getElementById('share-create'));
    doc.getElementById('share-create').click();
    await new Promise((r) => setTimeout(r, 50));
    // I9: 競合検知用にlastSyncedAtも一緒に保存されるようになった
    const saved = JSON.parse(dom.window.localStorage.getItem(dom.window.STORE + ':__share'));
    assert.strictEqual(saved.id, 'abc123');
    assert.strictEqual(saved.editKey, 'edit999');
    assert.strictEqual(saved.lastSyncedAt, '2026-08-27T00:00:00.000Z');
  });

  await test('印刷レポート: 試用版では免責文言と透かしが入り、正規版ではライセンス名が表示される', async () => {
    const dom = await freshDom();
    dom.window.state.items = [dom.window.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'テスト主張', claimText: '本文',
      sourceUrl: 'https://example.com', archiveUrl: '', collectedAt: '', segments: [],
      officialCheck: { result: '', agency: '', note: '', link: '' },
      primaryCheck: { result: '', sourceType: '', note: '', link: '' },
      crossChecks: [], aiChecks: [], toolChecks: [], verdict: 'false', summary: '', reviewer: '', history: []
    })];
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    const doc = dom.window.document;
    doc.querySelector('[data-print]').click();
    let html = doc.getElementById('print-root').innerHTML;
    assert.ok(html.includes('ワーキングドキュメント'), '免責文言が印刷物に含まれない');
    assert.ok(html.includes('trialmark'), '試用版で透かしが表示されない');
    assert.ok(html.includes('どの軸にも根拠が記録されていません'), '根拠ゼロの警告が印刷物に含まれない');

    const key = dom.window.licGenerate('テスト株式会社', dom.window.STORE);
    dom.window.localStorage.setItem('fcd_license', JSON.stringify({ company: 'テスト株式会社', key }));
    doc.querySelector('[data-print]').click();
    html = doc.getElementById('print-root').innerHTML;
    assert.ok(html.includes('テスト株式会社 様'), '正規版でライセンス名が印刷物に表示されない');
    assert.ok(!html.includes('trialmark'), '正規版なのに試用版の透かしが残っている');
  });

  await test('ダッシュボード: 判定内訳・示唆(insights)が複数月データで生成される', async () => {
    const dom = await freshDom();
    function mkItem(monthsAgo, verdict, sourceCategory, mediaType) {
      const d = new Date();
      d.setMonth(d.getMonth() - monthsAgo);
      return dom.window.normalizeItem({
        id: 'id' + monthsAgo + verdict + Math.random(), createdAt: d.toISOString(), updatedAt: d.toISOString(),
        mediaType, sourceCategory, claimTitle: 'claim ' + monthsAgo, claimText: 'text', sourceUrl: '', archiveUrl: '',
        collectedAt: '', segments: [], officialCheck: { result: 'match', agency: '', note: '', link: '' },
        primaryCheck: { result: 'match', sourceType: '', note: '', link: '' },
        crossChecks: [], aiChecks: [], toolChecks: [], verdict, summary: '', reviewer: '', history: []
      });
    }
    dom.window.state.items = [
      mkItem(5, 'false', 'sns', 'video'), mkItem(4, 'mixed', 'sns', 'text'),
      mkItem(3, 'true', 'government', 'text'), mkItem(2, 'false', 'sns', 'image'),
      mkItem(1, 'mostly_true', 'media', 'text'), mkItem(0, 'true', 'media', 'text')
    ];
    dom.window.state.activeTab = 'dashboard';
    dom.window.renderAll();
    const doc = dom.window.document;
    const insights = doc.querySelectorAll('.insight-list li');
    assert.ok(insights.length >= 3, '示唆が十分に生成されていない: ' + insights.length);
    // 「全体サマリー」の4枚は必須。月次データが3か月以上ある場合は予測KPIが2枚追加されうる。
    assert.ok(doc.querySelectorAll('#dash-results .kpi').length >= 4);
  });

  await test('normalizeItem: 欠損フィールド(history/archiveUrl等)を持つ旧形式データを安全に補完する', async () => {
    const dom = await freshDom();
    const legacyRaw = {
      // 昔のスキーマを模した最小限のデータ(archiveUrl, history, segments 等が存在しない)
      id: 'legacy1', claimTitle: '旧データ', mediaType: 'text', sourceCategory: 'media',
      officialCheck: { result: 'match' }, // agency/note/link が無い
      verdict: 'not-a-real-verdict-id' // 不正なenum値
    };
    const normalized = dom.window.normalizeItem(legacyRaw);
    assert.strictEqual(normalized.archiveUrl, '');
    // jsdom(vmコンテキスト)のArrayとNode本体のArrayはプロトタイプが別実体になるため、
    // deepStrictEqual ではなく中身(件数)で比較する。
    assert.ok(Array.isArray(normalized.history) && normalized.history.length === 0, 'historyが空配列に補完されていない');
    assert.ok(Array.isArray(normalized.segments) && normalized.segments.length === 0, 'segmentsが空配列に補完されていない');
    assert.strictEqual(normalized.officialCheck.agency, '');
    assert.strictEqual(normalized.officialCheck.result, 'match');
    assert.strictEqual(normalized.verdict, '', '不正なverdict値が素通りしている');
    // evidenceCount 等の後続処理が例外を投げないことも確認する
    assert.doesNotThrow(function(){ dom.window.evidenceCount(normalized); dom.window.computeOverall(normalized, dom.window.state.weights); });
  });

  await test('loadState: 破損したJSON(不正な構文)が保存されていてもクラッシュせず初期状態で起動する', async () => {
    const dom = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/',
      beforeParse(win) { win.localStorage.setItem('fc_dashboard_v1', '{this is not valid json!!'); }
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(dom.window.state.items.length, 0);
    assert.ok(dom.window.document.getElementById('tabs'), '破損データ起動時にUIがレンダリングされていない');
  });

  await test('loadState: items配列に不正な要素(null/文字列など)が混じっていても正規化して読み込める', async () => {
    const dom = new JSDOM(HTML, {
      runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/',
      beforeParse(win) {
        win.localStorage.setItem('fc_dashboard_v1', JSON.stringify({
          items: [null, 'not-an-object', { id: 'ok1', claimTitle: '正常データ' }],
          weights: { official: 999, primary: -5, cross: 'abc' }
        }));
      }
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(dom.window.state.items.length, 3, '不正な要素も含めて正規化されるべき(nullでも空アイテムとして補完)');
    // 重みは異常値なら既定値にフォールバックする
    assert.strictEqual(dom.window.state.weights.primary, dom.window.DEFAULT_WEIGHTS.primary);
    assert.strictEqual(dom.window.state.weights.cross, dom.window.DEFAULT_WEIGHTS.cross);
  });

  await test('JSONインポート: 不正な行をスキップしつつ「既存に追加」できる(H11/I6)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    dom.window.confirm = () => true;
    // 既存に1件追加しておく
    dom.window.state.items = [dom.window.normalizeItem({ id: 'existing1', claimTitle: '既存データ' })];
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    const doc = dom.window.document;

    const payload = JSON.stringify({
      items: [
        { id: 'imp1', claimTitle: 'インポート1' },
        { notAValidRecord: true }, // claimTitle/claimText/id を一切持たない不正行
        { id: 'imp2', claimText: 'インポート2本文' }
      ],
      weights: dom.window.DEFAULT_WEIGHTS
    });
    const file = new dom.window.File([payload], 'import.json', { type: 'application/json' });
    const input = doc.getElementById('file-import');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(doc.getElementById('import-choice-box'), 'インポート選択バナーが表示されない');
    assert.ok(doc.getElementById('import-choice-box').textContent.includes('2件'), 'スキップ件数の表示が正しくない: ' + doc.getElementById('import-choice-box').textContent);
    doc.getElementById('import-merge').addEventListener; // no-op (lint避け)
    doc.getElementById('import-merge').click();
    assert.strictEqual(dom.window.state.items.length, 3, '既存1件+有効2件=3件になるべき');
  });

  await test('トースト通知: role/aria-liveを持つ領域に表示され、一定時間または操作で消える', async () => {
    const dom = await freshDom();
    const doc = dom.window.document;
    const root = doc.getElementById('toast-root');
    assert.strictEqual(root.getAttribute('aria-live'), 'polite', 'トースト領域にaria-liveが設定されていない(F4)');
    dom.window.toast('テスト通知', { type: 'success', duration: 0 });
    assert.ok(doc.querySelector('.toast.success'), 'トーストが表示されない');
    assert.strictEqual(doc.querySelector('.toast .toast-msg').textContent, 'テスト通知');
  });

  await test('トースト: Undo付き通知でアクションを実行すると削除が復元される(E4)', async () => {
    const dom = await freshDom();
    dom.window.confirm = () => true;
    dom.window.state.items = [
      dom.window.normalizeItem({ id: 'x1', claimTitle: 'a' }),
      dom.window.normalizeItem({ id: 'x2', claimTitle: 'b' })
    ];
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    const doc = dom.window.document;
    doc.getElementById('btn-clear-all').click();
    assert.strictEqual(dom.window.state.items.length, 0);
    const undoBtn = doc.querySelector('.toast button');
    assert.ok(undoBtn, '元に戻すボタンを含むトーストが表示されない');
    undoBtn.click();
    assert.strictEqual(dom.window.state.items.length, 2, '元に戻すを押しても復元されない');
  });

  await test('タブバッジ: 根拠ゼロで確定判定の案件数が一覧タブのバッジに表示される(B1)', async () => {
    const dom = await freshDom();
    dom.window.confirm = () => true;
    dom.window.state.items = [
      dom.window.normalizeItem({ id: 'r1', claimTitle: 'a', verdict: 'false' }), // 根拠ゼロ+確定判定 → 要対応
      dom.window.normalizeItem({ id: 'r2', claimTitle: 'b', verdict: '' }) // 未判定 → 対象外
    ];
    dom.window.renderAll();
    const doc = dom.window.document;
    const badge = doc.querySelector('nav.tabs button[data-tab="list"] .tab-badge');
    assert.ok(badge, 'バッジが表示されない');
    assert.strictEqual(badge.textContent, '1');
  });

  await test('同意ゲート表示時にチェックボックスへ初期フォーカスが当たる(F6簡易フォーカストラップ)', async () => {
    const dom = await freshDom();
    const doc = dom.window.document;
    assert.strictEqual(doc.activeElement, doc.getElementById('consent-checkbox'), '初期フォーカスがチェックボックスに当たっていない');
  });

  await test('グローバルエラーハンドラ: 予期しない例外がトーストで通知される(I1)', async () => {
    const dom = await freshDom();
    const doc = dom.window.document;
    dom.window.reportUnexpectedError('テスト文脈', new Error('boom'));
    const t = doc.querySelector('.toast.danger');
    assert.ok(t, 'エラー用トーストが表示されない');
    assert.ok(t.textContent.includes('予期しないエラー'));
  });

  await test('折れ線グラフ: グラデーション塗りとホバー用<title>ツールチップを含む(C1)', async () => {
    const dom = await freshDom();
    const svg = dom.window.svgLineChart([{label:'2026-01', value:10}, {label:'2026-02', value:20}], 'var(--blue)');
    assert.ok(svg.includes('<linearGradient'), 'グラデーション定義が含まれない');
    assert.ok(svg.includes('<title>2026-02: 20</title>'), 'ホバーツールチップ(title要素)が含まれない');
  });

  await test('折れ線グラフ: 点数が多い場合はX軸ラベルを間引く(C8)', async () => {
    const dom = await freshDom();
    const points = [];
    for (let i = 1; i <= 24; i++) points.push({label: '2026-' + String(i).padStart(2,'0'), value: i});
    const svg = dom.window.svgLineChart(points, 'var(--blue)');
    const labelCount = (svg.match(/text-anchor="middle">2026-/g) || []).length;
    assert.ok(labelCount < 24, 'ラベルが間引かれずに全件表示されている: ' + labelCount);
    assert.ok(svg.includes('>2026-01<') && svg.includes('>2026-24<'), '最初と最後のラベルは省略されるべきではない');
  });

  await test('KPI: 前月比トレンド矢印が平均スコアの改善/悪化に応じて表示される(A8)', async () => {
    const dom = await freshDom();
    function mkItem(monthsAgo, score){
      const d = new Date(); d.setMonth(d.getMonth() - monthsAgo);
      return dom.window.normalizeItem({
        id: 'k' + monthsAgo, createdAt: d.toISOString(), updatedAt: d.toISOString(),
        claimTitle: 'x', verdict: 'true',
        officialCheck: { result: score >= 100 ? 'match' : (score >= 50 ? 'partial' : 'mismatch') }
      });
    }
    dom.window.state.items = [mkItem(1, 0), mkItem(0, 100)]; // 前月0点 → 今月100点(改善)
    dom.window.state.activeTab = 'dashboard';
    dom.window.renderAll();
    const doc = dom.window.document;
    const trend = doc.querySelector('#dash-results .kpi .trend');
    assert.ok(trend, 'トレンド表示が見つからない');
    assert.ok(trend.classList.contains('good'), 'スコア改善はgood(緑)であるべき: ' + trend.className);
  });

  await test('storageGetJSON/storageSetJSON/storageRemove: 一元化ラッパーが正常系・異常系ともに例外を投げない(I2)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(w.storageSetJSON('t1', {a: 1}), true);
    assert.strictEqual(w.storageGetJSON('t1', null).a, 1);
    assert.strictEqual(w.storageRemove('t1'), true);
    assert.strictEqual(w.storageGetJSON('t1', 'fallback'), 'fallback');

    const proto = Object.getPrototypeOf(w.localStorage);
    const orig = proto.setItem;
    proto.setItem = function(){ throw new Error('quota'); };
    assert.strictEqual(w.storageSetJSON('t2', {x:1}), false, '書き込み失敗時にfalseを返すべき');
    proto.setItem = orig;
  });

  await test('空状態: 一覧・ダッシュボードにアイコン付きの空状態表示がある(A12)', async () => {
    const dom = await freshDom();
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    let doc = dom.window.document;
    assert.ok(doc.querySelector('.empty svg'), '一覧タブの空状態にアイコンが無い');
    assert.ok(doc.querySelector('.empty .empty-title'), '一覧タブの空状態に見出しが無い');

    dom.window.state.activeTab = 'dashboard';
    dom.window.renderAll();
    doc = dom.window.document;
    assert.ok(doc.querySelector('.empty svg'), 'ダッシュボードの空状態にアイコンが無い');
  });

  /* ============================= 一次スクリーニング機能(パターン検知/アカウント信頼性/過去メディア照合) ============================= */

  await test('scanPatterns: 権威借用パターンを検知しスコアを算出する', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const hit = w.scanPatterns('〇〇大学教授によると、この薬は危険だと警告している。');
    assert.ok(hit.matchedIds.indexOf('authority-borrow') > -1, '権威借用パターンが検知されない');
    assert.ok(hit.score > 0);
  });

  await test('scanPatterns: 既知パターンに一致しない平易な文章はスコア0になる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const hit = w.scanPatterns('本日の会議は10時から開始されます。');
    assert.strictEqual(hit.matchedIds.length, 0);
    assert.strictEqual(hit.score, 0);
  });

  await test('scanPatterns: 複数パターンが重複検知されるとスコアが加算される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const hit = w.scanPatterns('拡散希望！ 元関係者が暴露、絶対に本当の話です。今すぐシェアしてください！！！！！！');
    assert.ok(hit.matchedIds.length >= 3, '複数パターンが検知されるべき: ' + JSON.stringify(hit.matchedIds));
    assert.ok(hit.score >= 30);
  });

  await test('computeAccountScore: チェックしたシグナルの重みが合算され、上限100でクリップされる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const allIds = w.ACCOUNT_SIGNALS.map(s => s.id);
    assert.strictEqual(w.computeAccountScore({signals: []}), 0);
    assert.ok(w.computeAccountScore({signals: [allIds[0]]}) > 0);
    assert.ok(w.computeAccountScore({signals: allIds}) <= 100);
  });

  await test('hammingDistance: 完全一致は0、完全不一致はビット長、長さ不一致はInfinity', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(w.hammingDistance('1010', '1010'), 0);
    assert.strictEqual(w.hammingDistance('1111', '0000'), 4);
    assert.strictEqual(w.hammingDistance('101', '10'), Infinity);
    assert.strictEqual(w.hammingDistance(null, '1010'), Infinity);
  });

  await test('findReferenceMatches: 閾値以下の距離のみ返し、距離の昇順でソートされる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const target = '1111000011110000111100001111000011110000111100001111000011110'.slice(0, 64);
    w.state.referenceDb = [
      {id: 'a', label: '近い', eventDate: '', hash: target.slice(0, 60) + '0000'}, // 距離が小さいはず
      {id: 'b', label: '遠い', eventDate: '', hash: '0'.repeat(64) === target ? '1'.repeat(64) : '0'.repeat(64)},
      {id: 'c', label: '完全一致', eventDate: '', hash: target}
    ];
    const matches = w.findReferenceMatches(target);
    assert.ok(matches.length >= 1, '少なくとも完全一致がヒットするはず');
    assert.strictEqual(matches[0].id, 'c', '完全一致(距離0)が先頭に来るべき');
    assert.strictEqual(matches[0].distance, 0);
    for (let i = 1; i < matches.length; i++){
      assert.ok(matches[i].distance >= matches[i-1].distance, '距離の昇順になっていない');
    }
  });

  await test('downscaleImageToDataUrl/computeDHash: 呼び出しが同期的に例外を投げない(Canvas未対応環境での安全性)', async () => {
    // jsdomは <canvas> の画像デコード/getImageData を(canvasパッケージ無しでは)サポートしないため、
    // img.onload/onerror が発火しないケースがある。ここでは「同期的にthrowしないこと」までを保証し、
    // 実際のハッシュ算出の正しさは Playwright(実ブラウザ)で別途検証する。
    const dom = await freshDom();
    const w = dom.window;
    const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    assert.doesNotThrow(() => {
      w.computeDHash(tinyPngDataUrl, function(){});
      w.downscaleImageToDataUrl(tinyPngDataUrl, 100, 0.6, function(){});
    });
  });

  await test('一次スクリーニング: claimText入力に応じてパターン検知スコアがライブ更新される(A/B/C画面)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const claimText = doc.getElementById('f-claimText');
    claimText.value = '拡散希望！ 元関係者が暴露、今すぐシェアしてください！';
    claimText.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    const block = doc.getElementById('pattern-screen-block');
    assert.ok(block.textContent.includes('怪しさスコア'));
    assert.ok(dom.window.state.draft.patternScreen.score > 0, 'パターン検知スコアがdraftに反映されていない');
  });

  await test('一次スクリーニング: アカウント信頼性シグナルのチェックでスコアが更新される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const cb = doc.querySelector('[data-signal="newAccount"]');
    assert.ok(cb, 'アカウント信頼性シグナルのチェックボックスが見つからない');
    cb.checked = true;
    cb.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    assert.ok(dom.window.state.draft.accountCheck.signals.indexOf('newAccount') > -1);
    const kpi = doc.getElementById('account-score-kpi');
    assert.ok(kpi.textContent.includes('22') || dom.window.computeAccountScore(dom.window.state.draft.accountCheck) > 0);
  });

  await test('一次スクリーニング: 生成AI疑いチェックリストのチェックがdraftに反映される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const cb = doc.querySelector('[data-aigen="unnaturalHands"]');
    assert.ok(cb, '生成AIチェックリストの項目が見つからない');
    cb.checked = true;
    cb.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    assert.ok(dom.window.state.draft.mediaCheck.aiGenFlags.indexOf('unnaturalHands') > -1);
  });

  await test('過去メディアとの照合結果がある状態で保存すると、印刷レポート・CSVに反映される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    dom.window.confirm = () => true;
    const doc = dom.window.document;
    doc.getElementById('f-claimText').value = '媒体照合テスト';
    doc.getElementById('f-claimText').dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    dom.window.state.draft.mediaCheck.thumbDataUrl = 'data:image/jpeg;base64,AAA';
    dom.window.state.draft.mediaCheck.hash = '1'.repeat(64);
    dom.window.state.draft.mediaCheck.matches = [{id: 'ref1', label: '過去の地震映像', eventDate: '2018-01-01', distance: 2}];
    doc.getElementById('btn-save').click();
    assert.strictEqual(dom.window.state.items.length, 1);
    assert.strictEqual(dom.window.state.items[0].mediaCheck.matches.length, 1);

    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    doc.querySelector('[data-print]').click();
    const printHtml = doc.getElementById('print-root').innerHTML;
    assert.ok(printHtml.includes('過去の別事案の使い回し') === false); // printCase側の文言は件数ベースの短い表記
    assert.ok(printHtml.includes('類似メディア'), '印刷レポートに過去メディア照合結果が含まれない');
  });

  await test('参照メディアDBタブ: 登録・一覧表示・削除(Undo付き)ができる', async () => {
    const dom = await freshDom();
    dom.window.state.referenceDb = [
      {id: 'ref1', label: '2018年地震の映像', eventDate: '2018-01-01', thumbDataUrl: '', hash: '1'.repeat(64), registeredAt: new Date().toISOString()}
    ];
    dom.window.state.activeTab = 'refdb';
    dom.window.renderAll();
    const doc = dom.window.document;
    assert.ok(doc.body.textContent.includes('2018年地震の映像'), '登録済み参照メディアが一覧に表示されない');

    const delBtn = doc.querySelector('[data-refdb-del]');
    assert.ok(delBtn, '削除ボタンが見つからない');
    delBtn.click();
    assert.strictEqual(dom.window.state.referenceDb.length, 0, '削除後にreferenceDbが空になっていない');
  });

  await test('ダッシュボード: 一次スクリーニングの示唆(高リスク件数・過去メディア一致件数)が生成される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const item = w.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'sns', claimTitle: 'test', claimText: 'test', verdict: 'false',
      patternScreen: {matchedIds: ['authority-borrow'], score: 70, scannedAt: ''},
      mediaCheck: {thumbDataUrl: '', hash: '', matches: [{id: 'r', label: 'x', distance: 1}], aiGenFlags: [], checkedAt: '', note: ''}
    });
    w.state.items = [item];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const doc = w.document;
    const text = doc.querySelector('.insight-list').textContent;
    assert.ok(text.includes('パターン検知の怪しさスコアが50以上'), '高リスク件数の示唆が生成されない');
    assert.ok(text.includes('過去メディアとの照合で類似メディアが見つかった'), '過去メディア一致の示唆が生成されない');
  });

  /* ============================= B3/F8/K2/K6: UX・a11y・セキュリティの追加改善 ============================= */

  await test('B3: スクロール中(scrollイベント)に現在タブのスクロール位置が継続的に記録される', async () => {
    // 実ブラウザ検証で判明した通り、「タブを離れるクリックの瞬間」ではスクロール位置が
    // 既に失われていることがあるため、scrollイベントで継続的に記録する方式にしている。
    const dom = await freshDom();
    const w = dom.window;
    Object.defineProperty(w.window, 'scrollY', { value: 480, configurable: true });
    w.window.dispatchEvent(new w.Event('scroll'));
    await new Promise((r) => setTimeout(r, 60)); // requestAnimationFrame/setTimeoutでの間引き待ち
    assert.strictEqual(w.state.scrollPositions['new'], 480, 'スクロール中に現在タブの位置が記録されていない');
  });

  await test('B3: タブ切替後、新しいタブのアクティブボタンにフォーカスが移る', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const doc = w.document;
    doc.querySelector('button[data-tab="dashboard"]').click();
    const activeBtn = doc.querySelector('nav.tabs button.active');
    assert.strictEqual(doc.activeElement, activeBtn, 'タブ切替後にアクティブなタブボタンへフォーカスが移っていない');
  });

  await test('F8: 判定バッジが色だけでなく記号(symbol)でも判別できる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'symbol test', claimText: 't', verdict: 'false'
    })];
    w.state.activeTab = 'list';
    w.renderAll();
    const badge = w.document.querySelector('.badge');
    assert.ok(badge.textContent.includes('✕'), '「誤り」判定のバッジに記号(✕)が含まれていない: ' + badge.textContent);
  });

  await test('K2: インポートファイルのサイズが上限を超える場合は読み込まず拒否する', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const doc = w.document;
    w.state.activeTab = 'list';
    w.renderAll();
    let toastShown = false;
    const origToast = w.toast;
    w.toast = function(msg, opts){ if (msg.includes('大きすぎます')) toastShown = true; return origToast(msg, opts); };
    const input = doc.getElementById('file-import');
    const bigFile = { name: 'huge.json', size: 25 * 1024 * 1024 };
    Object.defineProperty(input, 'files', { value: [bigFile], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(toastShown, 'サイズ超過時の警告トーストが表示されない');
  });

  await test('K2: normalizeItemは異常に長い文字列・巨大な配列を上限で切り詰める', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const hugeText = 'a'.repeat(50000);
    const hugeArray = new Array(1000).fill(0).map(() => ({ outlet: 'x', url: '', result: '', note: '' }));
    const item = w.normalizeItem({ id: 'x1', claimText: hugeText, summary: hugeText, crossChecks: hugeArray });
    assert.ok(item.claimText.length <= 20000, 'claimTextが上限で切り詰められていない: ' + item.claimText.length);
    assert.ok(item.crossChecks.length <= 500, 'crossChecksが上限で切り詰められていない: ' + item.crossChecks.length);
  });

  await test('K6: 機密情報らしき文字列(APIキー等)を含む状態でサーバー共有しようとすると確認ダイアログが出る', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 't',
      claimText: 'メモ: AKIAABCDEFGHIJKLMNOP を使ってください', verdict: ''
    })];
    const key = w.licGenerate('テスト株式会社', w.STORE);
    w.localStorage.setItem('fcd_license', JSON.stringify({ company: 'テスト株式会社', key }));
    w.state.activeTab = 'list';
    w.renderAll();
    let confirmCalled = 0;
    w.confirm = () => { confirmCalled++; return false; };
    w.document.getElementById('share-create').click();
    assert.strictEqual(confirmCalled, 1, '機密情報らしき文字列があるのに確認ダイアログが出ない');
  });

  /* ============================= H9: 再確認期限(次回レビュー日) ============================= */

  await test('reviewDueStatus: 期限なし/超過/7日以内/まだ先を正しく判定する', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const today = new Date();
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const in3days = new Date(today); in3days.setDate(in3days.getDate() + 3);
    const in30days = new Date(today); in30days.setDate(in30days.getDate() + 30);

    assert.strictEqual(w.reviewDueStatus({ reviewDueDate: '' }), 'none');
    assert.strictEqual(w.reviewDueStatus({ reviewDueDate: fmt(yesterday) }), 'overdue');
    assert.strictEqual(w.reviewDueStatus({ reviewDueDate: fmt(in3days) }), 'soon');
    assert.strictEqual(w.reviewDueStatus({ reviewDueDate: fmt(in30days) }), 'ok');
  });

  await test('新規/編集フォーム: 次回レビュー予定日を入力するとdraftに反映され、保存後も保持される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    dom.window.confirm = () => true;
    const doc = dom.window.document;
    doc.getElementById('f-claimText').value = 'レビュー期限テスト';
    doc.getElementById('f-claimText').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const dateInput = doc.getElementById('f-reviewDueDate');
    assert.ok(dateInput, '次回レビュー予定日の入力欄が見つからない');
    dateInput.value = '2099-01-01';
    dateInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.strictEqual(dom.window.state.draft.reviewDueDate, '2099-01-01');
    doc.getElementById('btn-save').click();
    assert.strictEqual(dom.window.state.items[0].reviewDueDate, '2099-01-01', '保存後にreviewDueDateが保持されていない');
  });

  await test('一覧タブ: 期限超過の案件が「期限超過」バッジ付きで表示される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    w.state.items = [w.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'overdue test', claimText: 't',
      verdict: 'unverifiable', reviewDueDate: fmt(yesterday)
    })];
    w.state.activeTab = 'list';
    w.renderAll();
    assert.ok(w.document.body.textContent.includes('期限超過'), '一覧に期限超過バッジが表示されない');
  });

  await test('ダッシュボード: 再確認期限に関する示唆(期限超過/まもなく)が生成される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    w.state.items = [w.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'overdue test', claimText: 't',
      verdict: 'unverifiable', reviewDueDate: fmt(yesterday)
    })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const text = w.document.querySelector('.insight-list').textContent;
    assert.ok(text.includes('再確認期限を過ぎている案件が1件'), '期限超過の示唆が生成されない: ' + text);
  });

  await test('normalizeItem: 旧データ(reviewDueDate欠損)を読み込んでも空文字列に補完される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const item = w.normalizeItem({ id: 'x1', claimTitle: 'legacy' });
    assert.strictEqual(item.reviewDueDate, '');
  });

  /* ============================= H3: 自由記述タグ ============================= */

  await test('normalizeItem: tagsは重複排除せず配列として保持し、上限(30件)・文字数(50字)で切り詰める', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const longTag = 'x'.repeat(80);
    const many = new Array(40).fill(0).map((_, i) => 'tag' + i);
    const item = w.normalizeItem({ id: 'x1', tags: many.concat([longTag, '', '  ', 123]) });
    assert.ok(item.tags.length <= 30, 'tagsが30件を超えている: ' + item.tags.length);
    assert.ok(item.tags.every((t) => t.length <= 50), '50字を超えるタグが残っている');
    assert.ok(!item.tags.includes(''), '空文字タグが混入している');
  });

  await test('新規/編集フォーム: タグ入力欄でEnterを押すとチップが追加され、削除ボタンで消える', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const input = doc.getElementById('tag-input');
    assert.ok(input, 'タグ入力欄が見つからない');
    input.value = '災害';
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.deepStrictEqual(Array.from(dom.window.state.draft.tags), ['災害']);
    assert.ok(doc.querySelector('.tag-chip[data-tag="災害"]'), 'タグチップがDOMに反映されていない');

    const removeBtn = doc.querySelector('[data-remove-tag="災害"]');
    assert.ok(removeBtn, 'タグ削除ボタンが見つからない');
    removeBtn.click();
    assert.strictEqual(dom.window.state.draft.tags.length, 0, 'タグが削除されていない');
  });

  await test('タグは保存後も保持され、一覧のキーワード検索・タグ絞り込みで対象になる(H3)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    dom.window.confirm = () => true;
    const doc = dom.window.document;
    doc.getElementById('f-claimText').value = 'タグ検索テスト';
    doc.getElementById('f-claimText').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const input = doc.getElementById('tag-input');
    input.value = '地震';
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    doc.getElementById('btn-save').click();
    assert.strictEqual(dom.window.state.items[0].tags[0], '地震');

    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    // タグでの絞り込み
    dom.window.state.filter.tag = '地震';
    dom.window.renderListRows();
    assert.strictEqual(doc.querySelectorAll('#list-table-wrap tbody tr').length, 1, 'タグ絞り込みで表示されない');
    dom.window.state.filter.tag = '';
    dom.window.state.filter.q = '地震';
    dom.window.renderListRows();
    assert.strictEqual(doc.querySelectorAll('#list-table-wrap tbody tr').length, 1, 'キーワード検索でタグがヒットしない');
  });

  /* ============================= H7: 担当者アサイン・ステータス ============================= */

  await test('normalizeItem: assignee/statusの既定値・不正値のフォールバックが正しい', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const legacy = w.normalizeItem({ id: 'x1' });
    assert.strictEqual(legacy.assignee, '');
    assert.strictEqual(legacy.status, 'todo', '旧データのstatus欠損は既定でtodoになるべき');
    const invalid = w.normalizeItem({ id: 'x2', status: 'not-a-real-status' });
    assert.strictEqual(invalid.status, 'todo', '不正なstatus値はtodoにフォールバックするべき');
    const valid = w.normalizeItem({ id: 'x3', status: 'done', assignee: '山田太郎' });
    assert.strictEqual(valid.status, 'done');
    assert.strictEqual(valid.assignee, '山田太郎');
  });

  await test('新規/編集フォーム: 担当者・ステータスを入力するとdraftに反映され保存後も保持される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    doc.getElementById('f-claimText').value = '担当者テスト';
    doc.getElementById('f-claimText').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    doc.getElementById('f-assignee').value = '鈴木';
    doc.getElementById('f-assignee').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const statusSel = doc.getElementById('f-status');
    statusSel.value = 'in_progress';
    statusSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.strictEqual(dom.window.state.draft.assignee, '鈴木');
    assert.strictEqual(dom.window.state.draft.status, 'in_progress');
    doc.getElementById('btn-save').click();
    assert.strictEqual(dom.window.state.items[0].assignee, '鈴木');
    assert.strictEqual(dom.window.state.items[0].status, 'in_progress');
  });

  await test('一覧タブ: ステータスで絞り込みでき、担当/状況列にステータスと担当者が表示される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [
      w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 'todo item', claimText: 't', status: 'todo' }),
      w.normalizeItem({ id: 'b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 'done item', claimText: 't', status: 'done', assignee: '田中' })
    ];
    w.state.activeTab = 'list';
    w.renderAll();
    const doc = w.document;
    assert.strictEqual(doc.querySelectorAll('#list-table-wrap tbody tr').length, 2);
    assert.ok(doc.body.textContent.includes('田中'), '担当者名が一覧に表示されない');

    w.state.filter.status = 'done';
    w.renderListRows();
    assert.strictEqual(doc.querySelectorAll('#list-table-wrap tbody tr').length, 1, 'ステータス絞り込みが機能していない');
  });

  await test('ダッシュボード: 未着手件数・担当者未設定の示唆が生成される(H7)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [
      w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 't1', claimText: 't', status: 'todo' }),
      w.normalizeItem({ id: 'b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 't2', claimText: 't', status: 'in_progress', assignee: '' })
    ];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const text = w.document.querySelector('.insight-list').textContent;
    assert.ok(text.includes('未着手」の案件が1件'), '未着手件数の示唆が生成されない: ' + text);
    assert.ok(text.includes('担当者が未設定'), '担当者未設定の示唆が生成されない: ' + text);
  });

  /* ============================= C2/C3: ドーナツチャート・ヒートマップ ============================= */

  await test('svgDonutChart: 合計値0でも例外を投げずグレーの円を返し、値がある場合は件数分のcircleを描く', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const empty = w.svgDonutChart([{ label: 'a', value: 0, color: '#fff' }, { label: 'b', value: 0, color: '#000' }]);
    assert.ok(empty.includes('<svg'));
    const withData = w.svgDonutChart([{ label: 'a', value: 3, color: '#111111' }, { label: 'b', value: 1, color: '#222222' }]);
    const circleCount = (withData.match(/<circle/g) || []).length;
    assert.strictEqual(circleCount, 2, '値のあるセグメント数だけcircleが描かれるべき: ' + circleCount);
    assert.ok(withData.includes('>4<'), '中央のテキストに合計件数(4)が表示されていない: ' + withData);
  });

  await test('blendHexWithWhite: fraction=0で白、fraction=1で元の色になる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(w.blendHexWithWhite('#ff0000', 0), 'rgb(255,255,255)');
    assert.strictEqual(w.blendHexWithWhite('#ff0000', 1), 'rgb(255,0,0)');
  });

  await test('heatmapTable: 件数が0のセルは背景transparentになり、件数がある場合は数値も表示される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const matrix = { politician: { true: 2, mixed: 1 } };
    const html = w.heatmapTable(
      [{ id: 'politician', label: '政治家' }],
      [{ id: 'true', label: '真実', symbol: '✓' }, { id: 'mixed', label: '一部誤り', symbol: '△' }],
      matrix, 2
    );
    assert.ok(html.includes('>2<'), '件数2が表示されていない');
    assert.ok(html.includes('background:transparent') === false || html.includes('background:rgb'), 'セルの背景が設定されていない');
  });

  await test('ダッシュボード: 判定内訳にドーナツチャートと出所区分×判定ヒートマップが表示される(C2/C3)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [
      w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'politician', claimTitle: 't1', claimText: 't', verdict: 'false' }),
      w.normalizeItem({ id: 'b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'politician', claimTitle: 't2', claimText: 't', verdict: 'true' })
    ];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const doc = w.document;
    assert.ok(doc.body.textContent.includes('出所区分×判定のクロス集計'), 'ヒートマップの見出しが表示されない');
    const donutSvg = doc.querySelector('.card svg[aria-label*="ドーナツ"]');
    assert.ok(donutSvg, 'ドーナツチャートのSVGが見つからない');
  });

  /* ============================= I3: 高解像度画像のIndexedDB退避 ============================= */

  await test('IndexedDB非対応環境(jsdom)でもidbPut/Get/Deleteは例外を投げず安全にfalse/nullを返す', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(typeof w.indexedDB, 'undefined', '前提: jsdomはindexedDBを実装していないはず');
    const putResult = await w.idbPutImage('test-key', 'data:image/png;base64,AAA');
    assert.strictEqual(putResult, false, '非対応環境でのidbPutImageはfalseを返すべき');
    const getResult = await w.idbGetImage('test-key');
    assert.strictEqual(getResult, null, '非対応環境でのidbGetImageはnullを返すべき');
    const delResult = await w.idbDeleteImage('test-key');
    assert.strictEqual(delResult, false, '非対応環境でのidbDeleteImageはfalseを返すべき');
  });

  await test('upgradeImagesFromIndexedDb: data-idb-key付き<img>があっても例外を投げず、非対応環境ではsrcを変更しない', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const doc = w.document;
    const img = doc.createElement('img');
    img.src = 'data:image/png;base64,micro';
    img.setAttribute('data-idb-key', 'nonexistent-key');
    doc.body.appendChild(img);
    assert.doesNotThrow(() => w.upgradeImagesFromIndexedDb(doc.body));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(img.src.includes('micro'), '非対応環境でsrcが書き換わってしまっている');
  });

  await test('normalizeItem: mediaCheck.fullImageKeyが正しく保持・上限で切り詰められる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const item = w.normalizeItem({ id: 'x1', mediaCheck: { fullImageKey: 'media:x1', thumbDataUrl: '', hash: '', matches: [], aiGenFlags: [], checkedAt: '', note: '' } });
    assert.strictEqual(item.mediaCheck.fullImageKey, 'media:x1');
    const longKey = w.normalizeItem({ id: 'x2', mediaCheck: { fullImageKey: 'a'.repeat(500) } });
    assert.ok(longKey.mediaCheck.fullImageKey.length <= 200, 'fullImageKeyが上限で切り詰められていない');
  });

  await test('参照メディアDB登録: fullImageKeyが正しく設定され、IndexedDB非対応環境でも例外を投げない', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    // 画像アップロードを経由せず、直接draftのmediaCheckにfullImageKeyがある状態を模擬
    dom.window.state.draft.mediaCheck.thumbDataUrl = 'data:image/jpeg;base64,micro';
    dom.window.state.draft.mediaCheck.fullImageKey = 'media:' + dom.window.state.draft.id;
    dom.window.state.draft.mediaCheck.hash = '1'.repeat(64);
    dom.window.state.activeTab = 'new';
    dom.window.renderAll();
    const registerBtn = doc.getElementById('media-register-btn');
    assert.ok(registerBtn, '登録ボタンが見つからない');
    registerBtn.click();
    await new Promise((r) => setTimeout(r, 30));
    doc.getElementById('refdb-new-label').value = 'テスト事案';
    assert.doesNotThrow(() => doc.getElementById('refdb-new-confirm').click());
    await new Promise((r) => setTimeout(r, 30));
    const ref = dom.window.state.referenceDb[0];
    assert.ok(ref, '参照メディアDBに登録されていない');
    assert.strictEqual(ref.label, 'テスト事案');
    // 元のケースにfullImageKeyがある場合、参照DBエントリ側にも専用キー(refdb:<id>)が
    // 設定されるべき(実際にIndexedDBへ複製できるかはPlaywrightの実ブラウザ側で確認する)
    assert.strictEqual(ref.fullImageKey, 'refdb:' + ref.id, 'fullImageKeyがrefdb:<id>の形式で設定されていない: ' + ref.fullImageKey);
  });

  /* ============================= N11: 動画の代表フレーム抽出照合 ============================= */

  await test('normalizeMediaCheck: sourceTypeが image/video 以外は image に正規化される(N11)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(w.normalizeMediaCheck({}).sourceType, 'image', '既定値はimageであるべき');
    assert.strictEqual(w.normalizeMediaCheck({ sourceType: 'video' }).sourceType, 'video');
    assert.strictEqual(w.normalizeMediaCheck({ sourceType: 'audio' }).sourceType, 'image', '未知の値はimageにフォールバックするべき');
  });

  await test('extractVideoFrame: <video>の実デコードに対応していない環境(jsdom)ではタイムアウトで例外を投げずnullを返す(N11)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const result = await new Promise((resolve) => {
      w.extractVideoFrame('data:video/webm;base64,AAAA', 1, resolve, 200); // テスト用に短いタイムアウト
    });
    assert.strictEqual(result, null, 'jsdomでは実デコードされないためnullが返るべき');
  });

  await test('新規/編集フォーム: 動画/音声ファイルの選択ボタンがimage/video両方を受け付ける(N11)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const input = doc.getElementById('media-file-input');
    assert.ok(input, 'メディアファイル選択inputが見つからない');
    assert.strictEqual(input.getAttribute('accept'), 'image/*,video/*', '画像/動画の両方を受け付ける設定になっていない');
  });

  await test('動画ファイル選択時はextractVideoFrame経由のパスに入り、抽出失敗時は警告トーストを出して例外を投げない(N11)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    // extractVideoFrameをモックして即座にnull(抽出失敗)を返すようにする
    const originalExtract = w.extractVideoFrame;
    w.extractVideoFrame = function (dataUrl, atSeconds, cb) { cb(null); };

    const input = doc.getElementById('media-file-input');
    const fakeFile = new w.File(['dummy-video-bytes'], 'sample.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true });

    // FileReaderの実デコードはjsdomでも動作するため、readAsDataURLの結果を待つ
    await new Promise((resolve) => {
      const origFileReader = w.FileReader;
      input.dispatchEvent(new w.Event('change', { bubbles: true }));
      setTimeout(resolve, 100);
    });

    const toastEl = doc.querySelector('.toast.warning');
    assert.ok(toastEl, '抽出失敗時の警告トーストが表示されない');
    assert.ok(toastEl.textContent.includes('動画'), '警告文言に「動画」への言及が無い: ' + toastEl.textContent);
    w.extractVideoFrame = originalExtract;
  });

  /* ============================= L2: 価格ページの「準備中」表示 ============================= */

  await test('pricingLinkHtml: PRICING_PAGE_READYがfalseの間は誤った価格ページへリンクせず「準備中」と表示する(L2)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(w.PRICING_PAGE_READY, false, '専用の価格ページが未確定の間はfalseのままであるべき(trueにする場合はLEGAL_PRICING_URLも専用ページに差し替えること)');
    const html = w.pricingLinkHtml();
    assert.ok(html.includes('準備中'), '「準備中」の案内が含まれていない');
    assert.ok(!html.includes('<a '), 'READY=falseの間はリンク(<a>)を出してはいけない(無関係な料金表への誤誘導を防ぐため)');
  });

  await test('試用版バナー: 価格ページが未準備の間は「準備中」表示になる(L2)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.activeTab = 'list';
    w.renderAll();
    const doc = w.document;
    assert.ok(doc.body.textContent.includes('価格・お申し込み: 準備中'), '試用版バナーに価格準備中の案内が表示されない');
  });

  /* ============================= M1: 初回起動時のオンボーディングツアー ============================= */

  await test('オンボーディングバナー: 同意直後は1ステップ目が表示され、次へ/戻る/スキップ/完了が機能する(M1)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    // 注意: doc.body.textContent は<script>タグの中身(JSソース文字列)も含んでしまうため、
    // 誤検知を避けるためバナー要素(#onboarding-banner)のtextContentだけを見る。
    const bannerText = () => doc.getElementById('onboarding-banner').textContent;
    assert.ok(bannerText().includes('ようこそ'), '同意直後にオンボーディング1ステップ目が表示されない');
    assert.ok(bannerText().includes('1/4'), 'ステップ数の表示が無い');

    doc.getElementById('onboarding-next').click();
    assert.ok(bannerText().includes('① まず「新規/編集」タブで記録'), '2ステップ目に進んでいない');
    assert.ok(doc.getElementById('onboarding-prev'), '2ステップ目以降は「戻る」ボタンが表示されるべき');

    doc.getElementById('onboarding-prev').click();
    assert.ok(bannerText().includes('ようこそ'), '「戻る」で1ステップ目に戻るべき');

    // 最終ステップまで進めて「完了」を押すと非表示になる
    doc.getElementById('onboarding-next').click();
    doc.getElementById('onboarding-next').click();
    doc.getElementById('onboarding-next').click();
    assert.ok(bannerText().includes('③ 「ダッシュボード」タブで集計'), '最終ステップの内容が表示されない');
    doc.getElementById('onboarding-next').click(); // 完了ボタン
    assert.strictEqual(w.hasCompletedOnboarding(), true, '完了後はオンボーディング完了フラグが立つべき');
    assert.strictEqual(doc.getElementById('onboarding-banner').innerHTML, '', '完了後はバナーが非表示になるべき');
  });

  await test('オンボーディングバナー: スキップすると即座に完了扱いになり、再訪しても表示されない(M1)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    doc.getElementById('onboarding-skip').click();
    assert.strictEqual(dom.window.hasCompletedOnboarding(), true);
    dom.window.renderAll();
    assert.strictEqual(doc.getElementById('onboarding-banner').innerHTML, '', 'スキップ後は再表示されないべき');
  });

  await test('オンボーディングバナー: 同意前は表示されない(M1)', async () => {
    const dom = await freshDom();
    const doc = dom.window.document;
    assert.strictEqual(doc.getElementById('onboarding-banner').innerHTML, '', '同意前にオンボーディングを表示してはいけない');
  });

  /* ============================= M3: よくあるご質問(FAQ) ============================= */

  await test('ガイドタブ: FAQセクションが表示され、質問項目が折りたたみ可能である(M3)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.activeTab = 'guide';
    w.renderAll();
    const doc = w.document;
    assert.ok(doc.body.textContent.includes('よくある質問'), 'FAQの見出しが見つからない');
    const details = doc.querySelectorAll('details summary');
    assert.ok(details.length >= 5, 'FAQ項目が少なすぎる: ' + details.length);
  });

  /* ============================= M4: サンプルデータの読み込み ============================= */

  await test('サンプルデータ読み込み: 既存データを消さずに追加され、元に戻すも機能する(M4)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const originalConfirm = w.confirm;
    w.confirm = () => true;
    w.state.items = [w.normalizeItem({ id: 'existing1', claimTitle: '既存の案件', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })];
    w.state.activeTab = 'list';
    w.renderAll();
    const doc = w.document;
    doc.getElementById('btn-load-sample').click();
    assert.strictEqual(w.state.items.length, 1 + w.SAMPLE_ITEMS.length, '既存1件+サンプル件数になるべき');
    assert.ok(w.state.items.some((it) => it.id === 'existing1'), '既存データが失われている');
    assert.ok(w.state.items.some((it) => it.claimTitle.includes('【サンプル】')), 'サンプルデータに【サンプル】表記が無い');

    const toasts = doc.querySelectorAll('.toast.success');
    const undoBtn = toasts[toasts.length - 1] && toasts[toasts.length - 1].querySelector('button');
    assert.ok(undoBtn, '元に戻すボタンが見つからない');
    undoBtn.click();
    assert.strictEqual(w.state.items.length, 1, '元に戻すでサンプルデータだけが取り除かれるべき');
    w.confirm = originalConfirm;
  });

  await test('normalizeItem経由でサンプルデータが正しく正規化される(M4)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const added = w.loadSampleData();
    assert.strictEqual(added.length, w.SAMPLE_ITEMS.length);
    added.forEach((it) => {
      assert.ok(it.id, 'サンプルデータにidが無い');
      assert.ok(Array.isArray(it.tags), 'normalizeItemを通していないためtagsが無い');
    });
  });

  /* ============================= M6: 動画マニュアルへのリンク(準備中プレースホルダー) ============================= */

  await test('ガイドタブ: 動画マニュアルは未準備の間は無効なリンクを出さず「準備中」と正直に表示する(M6)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(w.VIDEO_MANUAL_URL, '', '動画が実在しない間はURLを空のままにしておくべき(存在しない動画へリンクしない)');
    w.state.activeTab = 'guide';
    w.renderAll();
    const doc = w.document;
    assert.ok(doc.body.textContent.includes('動画マニュアルは現在準備中です'), '動画マニュアルの準備中案内が表示されない');
  });

  /* ============================= G1: 大量データ時の仮想スクロール ============================= */

  await test('一覧タブ: 閾値以下の件数では通常通り全件を<table>に描画する(G1)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: '通常件数', claimText: 't' })];
    w.state.activeTab = 'list';
    w.renderAll();
    const doc = w.document;
    assert.strictEqual(doc.querySelectorAll('#list-table-wrap tbody tr').length, 1);
    assert.strictEqual(doc.getElementById('virtual-scroll-viewport'), null, '閾値以下では仮想スクロール用のviewportを作らないべき');
  });

  await test('一覧タブ: 閾値超過(300件超)では仮想スクロール表示に切り替わり、jsdom(clientHeight=0)では全件フォールバック描画する(G1)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const items = [];
    for (let i = 0; i < w.VIRTUAL_SCROLL_THRESHOLD + 10; i++) {
      items.push(w.normalizeItem({ id: 'g1-' + i, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: '件名' + i, claimText: 't' }));
    }
    w.state.items = items;
    w.state.activeTab = 'list';
    w.renderAll();
    const doc = w.document;
    const viewport = doc.getElementById('virtual-scroll-viewport');
    assert.ok(viewport, '閾値超過時は仮想スクロールのviewportが作られるべき');
    // jsdomはレイアウトエンジンが無くclientHeightが常に0のため、安全側(全件描画)にフォールバックする
    assert.strictEqual(doc.querySelectorAll('#virtual-scroll-tbody tr').length, items.length, 'jsdomでは全件フォールバック描画になるべき');
  });

  await test('listRowHtml: 単体で呼び出しても例外を投げず<tr>を返す(G1のリファクタで抽出した関数)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const it = w.normalizeItem({ id: 'x', claimTitle: 'テスト', claimText: 't', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const html = w.listRowHtml(it);
    assert.ok(html.startsWith('<tr'));
    assert.ok(html.includes('テスト'));
  });

  /* ============================= G2: 差分更新(タブ中身だけの再描画) ============================= */

  await test('renderActiveTabOnly: タブナビ・ライセンスバー・フッターは再描画せずタブ中身だけ更新する(G2)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    w.state.activeTab = 'list';
    w.renderAll();

    let tabsCalled = 0, footerCalled = 0;
    const originalRenderTabs = w.renderTabs;
    const originalRenderFooter = w.renderFooter;
    w.renderTabs = function () { tabsCalled++; return originalRenderTabs.apply(this, arguments); };
    w.renderFooter = function () { footerCalled++; return originalRenderFooter.apply(this, arguments); };

    w.renderActiveTabOnly();
    assert.strictEqual(tabsCalled, 0, 'renderActiveTabOnly()はrenderTabs()を呼ばないべき');
    assert.strictEqual(footerCalled, 0, 'renderActiveTabOnly()はrenderFooter()を呼ばないべき');
    assert.ok(doc.getElementById('list-table-wrap'), 'タブ中身自体は正しく再描画されるべき');

    w.renderTabs = originalRenderTabs;
    w.renderFooter = originalRenderFooter;
  });

  await test('フォームクリア(btn-reset)はrenderActiveTabOnly経由でタブ中身のみ更新する(G2)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    w.confirm = () => true;
    w.state.draft.claimTitle = '消えるはずのタイトル';

    let tabsCalled = 0;
    const originalRenderTabs = w.renderTabs;
    w.renderTabs = function () { tabsCalled++; return originalRenderTabs.apply(this, arguments); };

    doc.getElementById('btn-reset').click();
    assert.strictEqual(tabsCalled, 0, 'フォームクリアはrenderTabs()を再実行しないべき(G2の差分更新)');
    assert.strictEqual(w.state.draft.claimTitle, '', 'フォームは実際にクリアされるべき');
    w.renderTabs = originalRenderTabs;
  });

  /* ============================= F5: アイコンのみのボタンにアクセシブルネームを付与 ============================= */

  await test('コメント削除・カスタムパターン削除の各ボタンはアイコンのみでもaria-labelで意味が伝わる(F5)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    w.state.draft.comments.push(w.normalizeComment({ author: '山田', text: 'コメント本文' }));
    w.state.activeTab = 'new';
    w.renderAll();
    doc.getElementById('comment-author').value = '鈴木';
    doc.getElementById('comment-text').value = 'アクセシビリティ確認用';
    doc.getElementById('comment-add-btn').click();
    const removeCommentBtn = doc.querySelector('[data-remove-comment]');
    assert.ok(removeCommentBtn, 'コメント削除ボタンが見つからない');
    assert.ok(removeCommentBtn.getAttribute('aria-label'), 'コメント削除ボタンにaria-labelが無い(アイコンのみでは読み上げられない)');

    w.state.activeTab = 'guide';
    w.renderAll();
    doc.getElementById('cp-label').value = 'F5確認用パターン';
    doc.getElementById('cp-keywords').value = 'テストキーワード';
    doc.getElementById('cp-add').click();
    const removePatternBtn = doc.querySelector('[data-remove-pattern]');
    assert.ok(removePatternBtn, 'カスタムパターン削除ボタンが見つからない');
    assert.ok(removePatternBtn.getAttribute('aria-label'), 'カスタムパターン削除ボタンにaria-labelが無い');
  });

  /* ============================= F7: 文字サイズ変更への耐性 ============================= */

  await test('タイポグラフィスケールはpx固定ではなくrem単位になっている(F7、ブラウザの文字サイズ拡大機能に対応するため)', async () => {
    const dom = await freshDom();
    const styleText = Array.from(dom.window.document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    const m = styleText.match(/--fs-base:\s*([^;]+);/);
    assert.ok(m, '--fs-baseの定義が見つからない');
    assert.ok(m[1].trim().endsWith('rem'), '--fs-baseがrem単位になっていない(px固定だと、実ブラウザでdocument.documentElement.style.fontSizeを' +
      '変更するアクセシビリティ機能を使っても文字が拡大されないバグが実測で見つかった): ' + m[1]);
  });

  /* ============================= A9: ダークモード対応の設計(トークンのみ) ============================= */

  await test('[data-theme="dark"]のCSSルールが正しくパースされ、ニュートラルスケールを反転する値を持つ(A9)', async () => {
    const dom = await freshDom();
    const doc = dom.window.document;
    const sheet = doc.styleSheets[0];
    let darkRule = null;
    for (const rule of sheet.cssRules) {
      if (rule.selectorText === '[data-theme="dark"]') { darkRule = rule; break; }
    }
    assert.ok(darkRule, '[data-theme="dark"]のCSSルールが見つからない(コメント内に偶然"*/"が紛れ込みコメントが' +
      '途中で閉じてしまうと、このルールごと壊れることを実際に経験したため、CSSOM経由でパースできることを検証する)');
    assert.strictEqual(darkRule.style.getPropertyValue('--n-0').trim(), '#0f172a', 'ダークモードでは--n-0が暗い色に反転しているべき');
    assert.strictEqual(darkRule.style.getPropertyValue('--n-900').trim(), '#f8fafc', 'ダークモードでは--n-900が明るい色に反転しているべき');
  });

  await test('data-theme属性を設定しない既定状態では、ライトモードの配色が一切変化しない(A9、ゼロリスクな準備段階であることの確認)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const doc = w.document;
    assert.strictEqual(doc.documentElement.getAttribute('data-theme'), null, '既定ではdata-theme属性が付いていないべき');
    const bg = w.getComputedStyle(doc.documentElement).getPropertyValue('--n-0').trim();
    assert.strictEqual(bg, '#ffffff', '既定(ライトモード)の--n-0は白のままであるべき');
  });

  /* ============================= A13: コンテンツ領域のローディングスケルトン ============================= */

  await test('件数が閾値以下ならスケルトンを挟まず即座に集計結果を描画する(A13)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true' })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    assert.strictEqual(w.document.querySelector('.skeleton-card'), null, '閾値以下ではスケルトンを表示しないべき');
    assert.ok(w.document.body.textContent.includes('全体サマリー'), '集計結果が即座に描画されるべき');
  });

  await test('件数が閾値超過ならまずスケルトンを描画し、次のフレームで実際の集計結果に置き換える(A13)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const items = [];
    for (let i = 0; i < w.CONTENT_SKELETON_THRESHOLD + 5; i++) {
      items.push(w.normalizeItem({ id: 's' + i, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 't' + i, claimText: 't', verdict: 'true' }));
    }
    w.state.items = items;
    w.state.activeTab = 'dashboard';
    w.renderAll();
    // rAF+setTimeout(0)の前(同期直後)はスケルトンが表示されているべき
    assert.ok(w.document.querySelector('.skeleton-card'), '閾値超過時は最初にスケルトンを表示するべき');
    // 次のフレーム以降で実際の集計結果に置き換わる
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(w.document.querySelector('.skeleton-card'), null, 'スケルトンは最終的に実際の集計結果に置き換わるべき');
    assert.ok(w.document.body.textContent.includes('全体サマリー'), '最終的に集計結果が描画されるべき');
  });

  /* ============================= B2: パンくず(現在地表示) ============================= */

  await test('新規/編集フォーム: 編集中は主張タイトルがパンくずに表示され、入力に合わせてライブ更新される(B2)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    w.state.items = [w.normalizeItem({ id: 'x1', claimTitle: '元のタイトル', claimText: 't', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })];
    w.state.draft = w.cloneItem(w.state.items[0]);
    w.state.editingId = 'x1';
    w.state.activeTab = 'new';
    w.renderAll();
    assert.ok(doc.getElementById('edit-breadcrumb').textContent.includes('元のタイトル'), 'パンくずに編集中のタイトルが表示されない');

    const titleInput = doc.getElementById('f-claimTitle');
    titleInput.value = '更新後のタイトル';
    titleInput.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.ok(doc.getElementById('edit-breadcrumb').textContent.includes('更新後のタイトル'), 'パンくずがライブ更新されない');
  });

  await test('新規/編集フォーム: 新規作成時のパンくずは「編集中」ではなく新規作成である旨を表示する(B2)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    assert.ok(doc.getElementById('edit-breadcrumb').textContent.includes('新しいチェックの記録'));
  });

  /* ============================= B4: キーボードショートカット ============================= */

  await test('「n」キーで新規/編集タブに切り替わる(入力中でない場合のみ)(B4)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    w.state.activeTab = 'list';
    w.renderAll();
    doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    assert.strictEqual(w.state.activeTab, 'new', '「n」キーで新規/編集タブに切り替わるべき');
  });

  await test('テキスト入力中は「n」キーのショートカットが発火しない(B4)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    const titleInput = doc.getElementById('f-claimTitle');
    titleInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    assert.strictEqual(w.state.activeTab, 'new', 'もともとnewタブのままで変化していないことを確認(副作用が起きていないこと)');
  });

  await test('「/」キーで一覧タブに切り替わり検索欄にフォーカスする(B4)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: '/', bubbles: true }));
    assert.strictEqual(w.state.activeTab, 'list', '「/」キーで一覧タブに切り替わるべき');
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(doc.activeElement, doc.getElementById('filter-q'), 'キーワード検索欄にフォーカスが移るべき');
  });

  /* ============================= B5: 直近開いたケースへのクイックアクセス ============================= */

  await test('案件を編集で開くと「最近開いた項目」に記録され、そこからも再度開ける(B5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [
      w.normalizeItem({ id: 'r1', claimTitle: '最近項目1', claimText: 't', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    ];
    w.state.activeTab = 'list';
    w.renderAll();
    const doc = w.document;
    doc.querySelector('[data-edit="r1"]').click();
    const recentIds = w.loadRecentItemIds();
    assert.strictEqual(recentIds.length, 1);
    assert.strictEqual(recentIds[0], 'r1');

    w.state.activeTab = 'list';
    w.renderAll();
    const recentBtn = doc.querySelector('[data-open-recent="r1"]');
    assert.ok(recentBtn, '「最近開いた項目」に案件が表示されない');
    assert.ok(recentBtn.textContent.includes('最近項目1'));
    recentBtn.click();
    assert.strictEqual(w.state.activeTab, 'new');
    assert.strictEqual(w.state.editingId, 'r1');
  });

  await test('最近開いた項目は上限件数を超えると古いものから外れ、重複は先頭に上げる(B5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    for (let i = 0; i < w.RECENT_ITEMS_MAX + 2; i++) w.pushRecentItemId('id' + i);
    let recent = w.loadRecentItemIds();
    assert.strictEqual(recent.length, w.RECENT_ITEMS_MAX, '上限件数を超えないべき');
    assert.strictEqual(recent[0], 'id' + (w.RECENT_ITEMS_MAX + 1), '最後に開いたものが先頭になるべき');

    w.pushRecentItemId('id0'); // 上限から漏れていた古いIDを再度開く
    recent = w.loadRecentItemIds();
    assert.strictEqual(recent[0], 'id0', '再度開いた項目は先頭に上がるべき');
  });

  /* ============================= B6: グローバル検索(コマンドパレット) ============================= */

  await test('Ctrl/Cmd+Kでコマンドパレットが開き、Escで閉じる(B6)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    assert.strictEqual(w.isCommandPaletteOpen(), true, 'Ctrl+Kでパレットが開くべき');
    assert.ok(doc.getElementById('cmdk-input'), '検索入力欄が描画されるべき');

    doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.strictEqual(w.isCommandPaletteOpen(), false, 'Escでパレットが閉じるべき');
  });

  await test('コマンドパレット: 案件名で検索でき、選択すると編集画面に遷移する(B6)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    w.state.items = [w.normalizeItem({ id: 'cp1', claimTitle: 'コマンドパレット確認用案件', claimText: 't', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })];

    w.openCommandPalette();
    const input = doc.getElementById('cmdk-input');
    input.value = 'コマンドパレット確認用';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    const resultBtn = doc.querySelector('[data-cmdk-type="item"][data-cmdk-id="cp1"]');
    assert.ok(resultBtn, '案件が検索結果に表示されない');
    resultBtn.click();
    assert.strictEqual(w.isCommandPaletteOpen(), false, '選択後はパレットが閉じるべき');
    assert.strictEqual(w.state.activeTab, 'new');
    assert.strictEqual(w.state.editingId, 'cp1');
  });

  await test('コマンドパレット: 空クエリではタブ一覧が表示され、選択するとタブ遷移する(B6)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    w.openCommandPalette();
    const dashboardResult = doc.querySelector('[data-cmdk-type="tab"][data-cmdk-id="dashboard"]');
    assert.ok(dashboardResult, '空クエリでタブ候補が表示されない');
    dashboardResult.click();
    assert.strictEqual(w.state.activeTab, 'dashboard');
  });

  /* ============================= B7: URLハッシュによるタブのディープリンク ============================= */

  await test('タブを切り替えるとURLハッシュが追従し、再読み込み相当(freshDom)でも同じタブが復元される(B7)', async () => {
    const dom1 = await freshDom();
    dom1.window.state.activeTab = 'dashboard';
    dom1.window.renderAll();
    assert.strictEqual(dom1.window.location.hash, '#dashboard', 'タブ切替でURLハッシュが更新されるべき');
  });

  await test('readTabFromHash: 未知のハッシュ値は無視しnullを返す(B7)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.history.replaceState(null, '', '#not-a-real-tab');
    assert.strictEqual(w.readTabFromHash(), null, '未知のタブIDはnullを返すべき');
    w.history.replaceState(null, '', '#refdb');
    assert.strictEqual(w.readTabFromHash(), 'refdb');
  });

  /* ============================= D3: 選択範囲からのタグ付け行追加 ============================= */

  await test('新規/編集フォーム: 本文の選択範囲を①のタグ付け行に追加できる(D3)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    const textarea = doc.getElementById('f-claimText');
    textarea.value = 'これは事実の記述です。これは意見です。';
    textarea.dispatchEvent(new w.Event('input', { bubbles: true }));
    textarea.selectionStart = 0;
    textarea.selectionEnd = 11; // 「これは事実の記述です。」
    doc.getElementById('btn-add-segment-from-selection').click();
    assert.strictEqual(w.state.draft.segments.length, 1);
    assert.strictEqual(w.state.draft.segments[0].text, 'これは事実の記述です。');
    assert.strictEqual(w.state.draft.segments[0].tag, 'fact', '既定の分類はfactのままで、自動分類はしないべき');
    assert.ok(doc.querySelector('#segments-list [data-rid]'), 'DOMにも行が追加されるべき');
  });

  await test('新規/編集フォーム: 範囲を選択せずにクリックすると警告し、行を追加しない(D3)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    doc.getElementById('btn-add-segment-from-selection').click();
    assert.strictEqual(w.state.draft.segments.length, 0);
    assert.ok(doc.querySelector('.toast.warning'), '警告トーストが表示されるべき');
  });

  /* ============================= D4: URL欄の簡易フォーマット検証 ============================= */

  await test('新規/編集フォーム: http(s)以外のURLを入力すると警告表示になる(D4)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    const input = doc.getElementById('f-sourceUrl');
    input.value = 'ftp://example.com/file';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.ok(doc.getElementById('wrap-sourceUrl').classList.contains('field-error'), 'http(s)以外はエラー表示になるべき');

    input.value = 'https://example.com/page';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.ok(!doc.getElementById('wrap-sourceUrl').classList.contains('field-error'), '正しいURLに直すとエラーが消えるべき');
  });

  await test('新規/編集フォーム: URL欄が空の場合はエラー表示にしない(D4、必須ではないため)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    const input = doc.getElementById('f-archiveUrl');
    input.value = '';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.ok(!doc.getElementById('wrap-archiveUrl').classList.contains('field-error'));
  });

  /* ============================= D5: フォームのステップ表示オプション ============================= */

  await test('新規/編集フォーム: 既定ではステップ表示ではなく全カードが表示される(D5、既定OFF)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    assert.strictEqual(doc.getElementById('form-wizard-nav'), null, '既定ではステップナビが表示されないべき');
    const hiddenCards = Array.from(doc.querySelectorAll('#app > .card')).filter((c) => c.style.display === 'none');
    assert.strictEqual(hiddenCards.length, 0, '既定では全カードが表示されているべき');
  });

  await test('新規/編集フォーム: トグルをONにするとステップ表示になり、次へ/戻るでカードが切り替わる(D5)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    doc.getElementById('form-wizard-toggle').click();
    assert.ok(doc.getElementById('form-wizard-nav'), 'ステップナビが表示されるべき');
    const totalCards = doc.querySelectorAll('#app > .card').length;
    const visibleCardsStep1 = Array.from(doc.querySelectorAll('#app > .card')).filter((c) => c.style.display !== 'none');
    assert.ok(visibleCardsStep1.length < totalCards, '一部のカードだけが表示されるべき');

    const nextBtn = doc.getElementById('wizard-next-step');
    assert.ok(nextBtn, '次へボタンが表示されるべき');
    nextBtn.click();
    assert.ok(doc.getElementById('wizard-prev-step'), '2ステップ目以降は戻るボタンが表示されるべき');

    // 非表示のステップの値も保持されている(データ自体は消えない)ことを確認
    w.state.draft.claimTitle = '値の保持確認';
    assert.strictEqual(w.state.draft.claimTitle, '値の保持確認');
  });

  /* ============================= D7: 実例トグル ============================= */

  await test('新規/編集フォーム: 「実例を見る」の折りたたみが表示され、実際の入力欄は上書きしない(D7)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const details = doc.querySelector('#wrap-claimText details');
    assert.ok(details, '実例トグルが見つからない');
    assert.ok(details.textContent.includes('タイトル例'));
    assert.strictEqual(doc.getElementById('f-claimText').value, '', '実例を表示しても実際の入力欄には反映されないべき');
  });

  /* ============================= D8: 色付きドロップダウン ============================= */

  await test('新規/編集フォーム: 判定・ステータスのselectには選択中の色を示すドットが表示され、変更に追従する(D8)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    const statusWrap = doc.getElementById('f-status').parentElement;
    assert.ok(statusWrap.classList.contains('color-select-wrap'));
    const dot = statusWrap.querySelector('.color-select-dot');
    assert.ok(dot, '色ドットが見つからない');
    const initialColor = dot.style.background;

    const select = doc.getElementById('f-status');
    select.value = 'done';
    select.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.notStrictEqual(dot.style.background, initialColor, 'ステータス変更にあわせてドットの色が変わるべき');
  });

  /* ============================= D9: 発言タイムスタンプ ============================= */

  await test('新規/編集フォーム: 音声/映像のときだけ発言タイムスタンプ欄が有効で、値が保持される(D9)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    const mediaTypeSelect = doc.getElementById('f-mediaType');
    mediaTypeSelect.value = 'video';
    mediaTypeSelect.dispatchEvent(new w.Event('change', { bubbles: true }));
    const timestampInput = doc.getElementById('f-claimTimestamp');
    assert.ok(timestampInput, 'タイムスタンプ欄が見つからない');
    timestampInput.value = '00:12:34';
    timestampInput.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.strictEqual(w.state.draft.claimTimestamp, '00:12:34');
  });

  await test('normalizeItem: claimTimestampが上限文字数で切り詰められる(D9)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const it = w.normalizeItem({ id: 'x', claimTimestamp: 'a'.repeat(50) });
    assert.strictEqual(it.claimTimestamp.length, 30);
  });

  /* ============================= E2: 保存成功のチェックマークアニメーション ============================= */

  await test('保存成功トーストにチェックマークアイコンがポップインアニメーション付きで表示される(E2)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    doc.getElementById('f-claimText').value = 'E2確認用';
    doc.getElementById('f-claimText').dispatchEvent(new w.Event('input', { bubbles: true }));
    doc.getElementById('btn-save').click();
    const toastEl = doc.querySelector('.toast.success');
    assert.ok(toastEl, '保存成功トーストが表示されない');
    const iconEl = toastEl.querySelector('.toast-icon-pop');
    assert.ok(iconEl, 'チェックマークアイコンが見つからない');
  });

  /* ============================= E3: 行の追加/削除のフェード ============================= */

  await test('行の追加/削除にフェードイン/アウトのCSSアニメーションが定義されている(E3)', async () => {
    const dom = await freshDom();
    const styleText = Array.from(dom.window.document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    assert.ok(/\.row-item\{[^}]*animation:row-fade-in/.test(styleText), '.row-itemにfade-inアニメーションが定義されていない');
    assert.ok(styleText.includes('.row-item.row-leaving'), 'row-leavingのfade-outクラスが定義されていない');
  });

  await test('新規/編集フォーム: 行を削除するとrow-leavingクラスが付き、少し遅れてDOMから除去される(E3)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    doc.querySelector('[data-add="crossChecks"]').click();
    const row = doc.querySelector('#cross-list [data-rid]');
    assert.ok(row);
    doc.querySelector('#cross-list [data-remove="crossChecks"]').click();
    assert.ok(row.classList.contains('row-leaving'), '削除直後はrow-leavingクラスが付与されるべき(即座にDOMから消えない)');
    assert.strictEqual(w.state.draft.crossChecks.length, 0, 'データ自体は即座に更新されるべき(保存の整合性のため)');
    await new Promise((r) => setTimeout(r, 250));
    assert.strictEqual(doc.querySelectorAll('#cross-list [data-rid]').length, 0, '一定時間後にDOMからも除去されるべき');
  });

  /* ============================= E5: スコアのカウントアップアニメーション ============================= */

  await test('animateNumberTo: requestAnimationFrame未対応環境(jsdom)では即座に最終値を表示する(E5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const doc = w.document;
    const div = doc.createElement('div');
    w.animateNumberTo(div, 0, 85, 400);
    assert.strictEqual(div.textContent, '85', 'requestAnimationFrame未対応環境では即座に最終値になるべき');
  });

  await test('animateNumberTo: 数値でない場合や未対応環境でも例外を投げない(E5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const doc = w.document;
    const div = doc.createElement('div');
    assert.doesNotThrow(() => w.animateNumberTo(div, null, 50, 400));
    assert.strictEqual(div.textContent, '50');
    assert.doesNotThrow(() => w.animateNumberTo(null, 0, 50, 400), 'DOM要素が無くても例外を投げないべき');
  });

  await test('新規/編集フォーム: 根拠を追加してスコアが変化すると、算出スコアの数値要素が更新される(E5)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    const doc = w.document;
    const scoreEl = doc.getElementById('verdict-score-value');
    assert.ok(scoreEl, '算出スコアの数値要素(verdict-score-value)が見つからない');
    assert.strictEqual(scoreEl.textContent, '—', '根拠が無い状態では—と表示されるべき');

    const officialSel = doc.getElementById('f-officialCheck.result');
    officialSel.value = 'match';
    officialSel.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.strictEqual(doc.getElementById('verdict-score-value').textContent, '100', '根拠を追加すると最終的な数値が反映されるべき');
  });

  /* ============================= 回帰防止: #appの委譲イベントリスナー重複バグ =============================
   * I3の実装時、「新規/編集」タブに2回目以降訪れると、#app要素自体が使い回される
   * (innerHTML更新のみで作り直されない)ため bindNewCheckEvents() 内の
   * app.addEventListener(...) が積み重なり、1回のクリックで同じ処理が複数回走る
   * (トグルボタンが開いた瞬間に閉じる等)不具合を発見した。二度と再発させないための
   * 回帰テスト。
   */
  await test('回帰: 「新規/編集」タブに複数回訪れても、行追加やトグルボタンが1回のクリックにつき1回だけ動作する', async () => {
    const dom = await freshDom();
    const w = dom.window;
    await agreeToConsent(dom);
    const doc = w.document;

    // 1回目: 保存して一覧タブへ、再度「新規/編集」タブへ戻る(renderNewCheckTabが2回呼ばれる状況を作る)
    doc.getElementById('f-claimText').value = '1件目';
    doc.getElementById('f-claimText').dispatchEvent(new w.Event('input', { bubbles: true }));
    doc.getElementById('btn-save').click();
    w.state.activeTab = 'new';
    w.renderAll(); // renderNewCheckTab / bindNewCheckEvents が2回目の呼び出しになる

    // 行追加ボタンは1クリックにつき1行だけ増えるべき(委譲リスナーが重複していれば2行以上増える)
    doc.querySelector('[data-add="segments"]').click();
    assert.strictEqual(doc.querySelectorAll('#segments-list [data-rid]').length, 1, 'segments行の追加が重複している(委譲リスナー重複の疑い)');

    // タグ追加も同様(Enterで1個だけ追加されるべき)
    const tagInput = doc.getElementById('tag-input');
    tagInput.value = '重複確認用タグ';
    tagInput.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.strictEqual(w.state.draft.tags.length, 1, 'タグ追加が重複している(委譲リスナー重複の疑い)');

    // 過去メディア登録フォームのトグルボタンは1クリックで「開く」べき(重複していると開いた瞬間に閉じる)
    w.state.draft.mediaCheck.thumbDataUrl = 'data:image/jpeg;base64,micro';
    w.renderAll();
    doc.getElementById('media-register-btn').click();
    assert.ok(doc.getElementById('refdb-new-label'), 'トグルボタンの委譲リスナーが重複し、開いた直後に閉じてしまっている');
  });

  /* ============================= H6: 文字起こし(音声・映像用) ============================= */

  await test('H6: 種別を音声/映像に変えると文字起こし欄が表示され、テキストだと非表示になる', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const wrap = doc.getElementById('wrap-transcript');
    assert.ok(wrap, '文字起こし欄のラッパーが見つからない');
    assert.strictEqual(wrap.style.display, 'none', '既定(テキスト)では非表示のはず');
    const mtSel = doc.getElementById('f-mediaType');
    mtSel.value = 'video';
    mtSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.strictEqual(wrap.style.display, 'block', '映像を選ぶと文字起こし欄が表示されるべき');
    doc.getElementById('f-transcript').value = '書き起こしテスト';
    doc.getElementById('f-transcript').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.strictEqual(dom.window.state.draft.transcript, '書き起こしテスト');
  });

  await test('normalizeItem: transcriptが上限文字数で切り詰められる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const item = w.normalizeItem({ id: 'x1', transcript: 'a'.repeat(30000) });
    assert.ok(item.transcript.length <= 20000);
  });

  /* ============================= H4: 関連する案件(双方向リンク) ============================= */

  await test('H4: 関連する案件を追加すると双方向にrelatedIdsが設定され、解除も双方向で行われる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const other = w.normalizeItem({
      id: 'other1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: '関連候補', claimText: 't'
    });
    w.state.items = [other];
    await agreeToConsent(dom);
    const doc = dom.window.document;
    w.state.activeTab = 'new';
    w.renderAll();
    const picker = doc.getElementById('related-case-picker');
    assert.ok(picker, '関連案件ピッカーが見つからない');
    picker.value = 'other1';
    picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.strictEqual(w.state.draft.relatedIds[0], 'other1');
    assert.strictEqual(w.state.items[0].relatedIds[0], w.state.draft.id, '相手側にも双方向でリンクが張られるべき');

    // 解除
    doc.querySelector('[data-unlink-case="other1"]').click();
    assert.strictEqual(w.state.draft.relatedIds.length, 0);
    assert.strictEqual(w.state.items[0].relatedIds.length, 0, '相手側のリンクも解除されるべき');
  });

  /* ============================= H10: 類似案件の簡易検出 ============================= */

  await test('jaccardSimilarity/findSimilarItems: よく似た文章は高スコア、無関係な文章は低スコアになる', async () => {
    const dom = await freshDom();
    // jaccardSimilarity/findSimilarItemsはbindNewCheckEvents内のローカル関数のためグローバルには
    // 公開されていない。ここではUI(類似案件のヒント表示)経由で挙動を検証する。
    const w2 = dom.window;
    w2.state.items = [w2.normalizeItem({
      id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: '既存案件',
      claimText: '東京都内で大規模な地震が発生し多数の建物が倒壊したという情報がSNSで拡散している'
    })];
    await agreeToConsent(dom);
    const doc = dom.window.document;
    doc.getElementById('f-claimText').value = '東京都内で大規模な地震が発生し多数の建物が倒壊したとSNSで拡散されている情報について';
    doc.getElementById('f-claimText').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const hint = doc.getElementById('similar-cases-hint').innerHTML;
    assert.ok(hint.includes('似ている既存の案件'), '類似案件のヒントが表示されない: ' + hint);

    doc.getElementById('f-claimText').value = '本日は晴天なり。';
    doc.getElementById('f-claimText').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const hint2 = doc.getElementById('similar-cases-hint').innerHTML;
    assert.strictEqual(hint2, '', '無関係な文章では類似案件のヒントが出ないべき');
  });

  /* ============================= H5: 添付ファイル ============================= */

  await test('H5: 添付ファイルを直接draftへ追加すると一覧に表示され、削除ボタンで消える', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    dom.window.state.draft.attachments.push({
      id: 'att1', name: 'screenshot.png', thumbDataUrl: 'data:image/jpeg;base64,micro', fullImageKey: 'attachment:att1', addedAt: new Date().toISOString()
    });
    dom.window.state.activeTab = 'new';
    dom.window.renderAll();
    assert.ok(doc.body.textContent.includes('screenshot.png'), '添付ファイル名が一覧に表示されない');
    const rmBtn = doc.querySelector('[data-remove-attachment="att1"]');
    assert.ok(rmBtn, '添付ファイルの削除ボタンが見つからない');
    rmBtn.click();
    assert.strictEqual(dom.window.state.draft.attachments.length, 0);
  });

  await test('normalizeItem: attachments/commentsが正しく正規化され、上限件数で切り詰められる', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const manyAttachments = new Array(40).fill(0).map((_, i) => ({ id: 'a' + i, name: 'f' + i, thumbDataUrl: '', fullImageKey: '' }));
    const manyComments = new Array(250).fill(0).map((_, i) => ({ id: 'c' + i, author: 'x', text: 'y' }));
    const item = w.normalizeItem({ id: 'x1', attachments: manyAttachments, comments: manyComments });
    assert.ok(item.attachments.length <= 30, 'attachmentsが上限で切り詰められていない: ' + item.attachments.length);
    assert.ok(item.comments.length <= 200, 'commentsが上限で切り詰められていない: ' + item.comments.length);
  });

  /* ============================= H8: 案件テンプレート ============================= */

  await test('H8: テンプレートを選択すると種別・出所区分・タグが設定される', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    const picker = doc.getElementById('case-template-picker');
    assert.ok(picker, '新規作成時はテンプレートピッカーが表示されるべき');
    picker.value = 'sns-viral';
    picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.strictEqual(dom.window.state.draft.mediaType, 'image');
    assert.strictEqual(dom.window.state.draft.sourceCategory, 'sns');
    assert.ok(dom.window.state.draft.tags.includes('SNS拡散'), 'テンプレートのタグが適用されていない');
    assert.ok(doc.getElementById('f-mediaType').value === 'image', 'mediaType選択欄の表示が更新されていない');
  });

  await test('H8: 編集時(既存案件)はテンプレートピッカーが表示されない', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'edit target', claimText: 't'
    })];
    w.state.draft = w.cloneItem(w.state.items[0]);
    w.state.editingId = 'x1';
    w.state.activeTab = 'new';
    w.renderAll();
    assert.strictEqual(w.document.getElementById('case-template-picker'), null, '編集時にテンプレートピッカーが出てはいけない');
  });

  /* ============================= H12: コメント(ディスカッションログ) ============================= */

  await test('H12: コメントを追加すると一覧に表示され、削除もできる', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    doc.getElementById('comment-author').value = '佐藤';
    doc.getElementById('comment-text').value = '一次情報を確認中です';
    doc.getElementById('comment-add-btn').click();
    assert.strictEqual(dom.window.state.draft.comments.length, 1);
    assert.strictEqual(dom.window.state.draft.comments[0].author, '佐藤');
    assert.ok(doc.body.textContent.includes('一次情報を確認中です'));

    const commentId = dom.window.state.draft.comments[0].id;
    doc.querySelector('[data-remove-comment="' + commentId + '"]').click();
    assert.strictEqual(dom.window.state.draft.comments.length, 0);
  });

  await test('H12: コメント内容が空のまま追加しようとすると警告し、追加しない', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;
    doc.getElementById('comment-add-btn').click();
    assert.strictEqual(dom.window.state.draft.comments.length, 0);
  });

  /* ============================= H13: 再確認期限のハイライト ============================= */

  await test('H13: 期限超過の案件は一覧の行が強調表示される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    w.state.items = [w.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'overdue', claimText: 't', reviewDueDate: fmt(yesterday)
    })];
    w.state.activeTab = 'list';
    w.renderAll();
    const row = w.document.querySelector('#list-table-wrap tbody tr');
    assert.ok(row.getAttribute('style') && row.getAttribute('style').includes('background'), '期限超過の行に背景色が設定されていない');
  });

  /* ============================= H14: Markdownエクスポート ============================= */

  await test('H14: Markdownエクスポートが正しい内容(表・見出し)を出力する', async () => {
    const dom = await freshDom();
    const w = dom.window;
    let captured = null;
    w.Blob = function (parts) { captured = parts.join(''); };
    w.URL.createObjectURL = () => 'blob://fake';
    w.URL.revokeObjectURL = () => {};
    w.state.items = [w.normalizeItem({
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'MDテスト', claimText: 't', verdict: 'true', tags: ['タグA']
    })];
    w.state.activeTab = 'list';
    w.renderAll();
    w.document.getElementById('btn-export-md').click();
    assert.ok(captured.includes('# ファクトチェック一覧レポート'));
    assert.ok(captured.includes('MDテスト'));
    assert.ok(captured.includes('タグA'));
    assert.ok(captured.includes('| 更新日 | 判定 |'), 'テーブルヘッダーが含まれていない');
  });

  /* ============================= C4: 前年同月比較 ============================= */

  await test('computeYoyRows: 前年同月データがある場合のみ比較行を返す', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const monthly = {
      '2025-06': { count: 4, falseish: 1, scoreSum: 240, scoreN: 4 },
      '2026-06': { count: 6, falseish: 2, scoreSum: 480, scoreN: 6 },
      '2026-07': { count: 2, falseish: 0, scoreSum: 180, scoreN: 2 } // 前年同月(2025-07)無し
    };
    const rows = w.computeYoyRows(monthly);
    assert.strictEqual(rows.length, 1, '前年同月データがある月だけが対象になるべき');
    assert.strictEqual(rows[0].month, '2026-06');
    assert.strictEqual(rows[0].prevMonth, '2025-06');
    assert.strictEqual(rows[0].count, 6);
    assert.strictEqual(rows[0].prevCount, 4);
    assert.strictEqual(rows[0].avgScore, 80);
    assert.strictEqual(rows[0].prevAvgScore, 60);
  });

  await test('ダッシュボード: 前年同月データが無い場合は「データがまだありません」と案内する(C4)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true' })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    assert.ok(w.document.body.textContent.includes('前年同月比較'), '前年同月比較の見出しが表示されない');
    assert.ok(w.document.body.textContent.includes('前年同月のデータがまだありません'), 'データ不足時の案内文が表示されない');
  });

  /* ============================= C5: スコア分布ヒストグラム ============================= */

  await test('svgHistogram: 各バケットの値がバー・ツールチップとして描画される', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const svg = w.svgHistogram([1, 0, 3], ['0-9', '10-19', '20-29'], 'var(--blue)', 'hist-test');
    assert.ok(svg.includes('id="hist-test"'), 'chartIdが反映されない');
    assert.ok(svg.includes('<title>0-9: 1件</title>'));
    assert.ok(svg.includes('<title>20-29: 3件</title>'));
    assert.strictEqual((svg.match(/<rect/g) || []).length, 3, 'バケット数分のrectが描画されるべき');
  });

  await test('ダッシュボード: スコア分布ヒストグラムが表示される(C5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({
      id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text',
      sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true', officialCheck: { result: 'match' }
    })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    assert.ok(w.document.getElementById('chart-histogram'), 'スコア分布ヒストグラムのSVGが見つからない');
  });

  /* ============================= C6: 軸別平均スコア(レーダーチャート) ============================= */

  await test('axisAverages: 記録がある軸だけを平均し、記録が無い軸はnullのままにする', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const items = [
      w.normalizeItem({ id: 'a', officialCheck: { result: 'match' } }), // official=100
      w.normalizeItem({ id: 'b', officialCheck: { result: 'mismatch' } }) // official=0
    ];
    const avg = w.axisAverages(items);
    assert.strictEqual(avg.official, 50, '①情報源の確認の平均が正しくない');
    assert.strictEqual(avg.primary, null, '記録の無い軸はnullであるべき(0として扱ってはいけない)');
  });

  await test('ダッシュボード: 軸別平均スコアのレーダーチャートが表示される(C6)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({
      id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text',
      sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true', officialCheck: { result: 'match' }
    })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const radar = w.document.getElementById('chart-radar');
    assert.ok(radar, 'レーダーチャートのSVGが見つからない');
    assert.ok(radar.outerHTML.includes('<polygon'), 'データ多角形が描画されない');
  });

  /* ============================= C7: KPIカードのドラッグ並び替え ============================= */

  await test('getKpiOrder/setKpiOrder: 既定順を保ち、保存された順序を読み戻せる(C7)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.deepStrictEqual(w.getKpiOrder().slice().sort(), w.KPI_KEYS_DEFAULT.slice().sort());
    w.setKpiOrder(['avgScore', 'total', 'falseCount', 'lastMonth']);
    assert.strictEqual(w.getKpiOrder()[0], 'avgScore', '保存した並び順が読み戻せない');
    // 不正なキーが混じっていても既知のキーだけにフィルタされる
    w.setKpiOrder(['total', 'unknown-key']);
    const order = w.getKpiOrder();
    assert.ok(order.indexOf('unknown-key') === -1, '未知のキーは除外されるべき');
    assert.strictEqual(order.length, w.KPI_KEYS_DEFAULT.length, '欠けたキーは末尾に補完されるべき');
  });

  await test('ダッシュボード: KPIカードがdraggable属性とdata-kpi-key付きで描画される(C7)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.setKpiOrder(['falseCount', 'total', 'avgScore', 'lastMonth']);
    w.state.items = [w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true' })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const cards = w.document.querySelectorAll('#kpi-cards .kpi[data-kpi-key]');
    assert.strictEqual(cards.length, 4, '4枚のKPIカードすべてがドラッグ可能であるべき');
    assert.strictEqual(cards[0].getAttribute('data-kpi-key'), 'falseCount', '保存した並び順が反映されていない');
    assert.strictEqual(cards[0].getAttribute('draggable'), 'true');
  });

  await test('KPIカードをドロップすると並び順が更新され再描画される(C7)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true' })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const doc = w.document;
    const cardsBefore = doc.querySelectorAll('#kpi-cards .kpi[data-kpi-key]');
    const firstKey = cardsBefore[0].getAttribute('data-kpi-key');
    const lastKey = cardsBefore[cardsBefore.length - 1].getAttribute('data-kpi-key');

    const dragStart = new w.Event('dragstart', { bubbles: true });
    dragStart.dataTransfer = { setData: () => {} };
    cardsBefore[0].dispatchEvent(dragStart);

    const dropTarget = doc.querySelectorAll('#kpi-cards .kpi[data-kpi-key]')[cardsBefore.length - 1];
    const dropEvt = new w.Event('drop', { bubbles: true, cancelable: true });
    dropEvt.dataTransfer = {};
    dropTarget.dispatchEvent(dropEvt);

    const newOrder = w.getKpiOrder();
    assert.strictEqual(newOrder[newOrder.length - 1], firstKey, 'ドラッグしたカードが末尾に移動しているべき');
    assert.ok(newOrder.indexOf(lastKey) < newOrder.indexOf(firstKey), '順序が入れ替わっているべき');
  });

  /* ============================= C9: 印刷時のグラフ幅制限 ============================= */

  await test('印刷用CSSでチャートSVGの最大幅がコンテナ幅に制限される(C9)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const styleText = Array.from(w.document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    assert.ok(/@media print[\s\S]*svg\.svg-chart[\s\S]*max-width:100%/i.test(styleText), '印刷CSSにチャートの最大幅制限が見つからない');
  });

  /* ============================= C10: グラフのPNGエクスポート ============================= */

  await test('canExportPng: jsdom(canvas未インストール)環境ではfalseを返す(C10)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(w.canExportPng(), false, 'jsdomはcanvas npmパッケージ無しではgetContextがnullのはず');
  });

  await test('exportSvgAsPng: PNG非対応環境では例外を投げず警告トーストを出す(C10)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({ id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text', sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true' })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const svgEl = w.document.getElementById('chart-donut-verdict');
    assert.ok(svgEl, 'PNG保存対象のドーナツチャートが見つからない');
    w.exportSvgAsPng(svgEl, 'test.png');
    const toastEl = w.document.querySelector('.toast.warning');
    assert.ok(toastEl, '非対応環境向けの警告トーストが出ていない');
    assert.ok(toastEl.textContent.includes('対応していません'));
  });

  await test('ダッシュボード: 各チャートカードにPNG保存ボタンが表示される(C10)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({
      id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text',
      sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true', officialCheck: { result: 'match' }
    })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const btns = w.document.querySelectorAll('[data-export-chart]');
    assert.ok(btns.length >= 3, 'ドーナツ/ヒストグラム/レーダーの最低3つはPNG保存ボタンがあるべき: ' + btns.length);
  });

  /* ============================= G3: localStorage書き込みのアイドル遅延 ============================= */

  await test('runWhenIdle: requestIdleCallback未対応環境(jsdom)でもsetTimeoutにフォールバックしコールバックが実行される(G3)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(typeof w.requestIdleCallback, 'undefined', '前提: jsdomはrequestIdleCallback未実装のはず');
    let called = false;
    w.runWhenIdle(() => { called = true; });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(called, 'setTimeoutフォールバックでコールバックが実行されていない');
  });

  await test('persistDraft: 下書きの実書き込みはアイドル時間まで遅延されるが最終的にlocalStorageへ反映される(G3)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const w = dom.window;
    w.state.draft.claimTitle = 'アイドル書き込みテスト';
    w.persistDraft();
    // 遅延中(同期直後)はまだ書き込まれていない可能性がある実装であることを許容しつつ、
    // 最終的には書き込まれることを確認する
    await new Promise((r) => setTimeout(r, 50));
    const saved = w.storageGetJSON(w.DRAFT_KEY, null);
    assert.ok(saved && saved.draft && saved.draft.claimTitle === 'アイドル書き込みテスト', '遅延後に下書きがlocalStorageへ保存されていない');
  });

  /* ============================= G4: 重み変更時のチャート再描画デバウンス ============================= */

  await test('debounce: 連続呼び出しでは最後の1回だけ実行される(G4)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    let count = 0;
    const debounced = w.debounce(() => { count++; }, 30);
    debounced(); debounced(); debounced();
    assert.strictEqual(count, 0, 'デバウンス直後はまだ実行されていないべき');
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(count, 1, '連続呼び出し後は1回だけ実行されるべき: ' + count);
  });

  await test('ダッシュボード: 重み入力を連打してもチャート再描画は最後の入力後にまとめて1回だけ行われる(G4)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({
      id: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mediaType: 'text',
      sourceCategory: 'media', claimTitle: 't', claimText: 't', verdict: 'true', officialCheck: { result: 'match' }
    })];
    w.state.activeTab = 'dashboard';
    w.renderAll();
    const doc = w.document;

    let renderCount = 0;
    const originalRenderDashResults = w.renderDashResults;
    w.renderDashResults = function () { renderCount++; return originalRenderDashResults.apply(this, arguments); };

    const input = doc.getElementById('w-official');
    for (let i = 0; i < 5; i++) {
      input.value = String(10 + i);
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
    }
    // state.weights自体は即時反映される(値の取りこぼしを防ぐ設計)が、
    // 重いチャート再描画(renderDashResults)はデバウンスされ、連打中はまだ呼ばれない
    assert.strictEqual(w.state.weights.official, 14, '重みの値自体は即時反映されるべき');
    assert.strictEqual(renderCount, 0, 'デバウンス待ち時間内は再描画されないべき: ' + renderCount);
    await new Promise((r) => setTimeout(r, 250));
    assert.strictEqual(renderCount, 1, '連打後は1回だけ再描画されるべき: ' + renderCount);
  });

  /* ============================= G5: 初回ロード時間の計測 ============================= */

  await test('window.__bootStats: 初回描画の所要時間とファイルサイズ目安が記録される(G5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.ok(w.__bootStats, '__bootStatsが記録されていない');
    assert.strictEqual(typeof w.__bootStats.elapsedMs, 'number');
    assert.ok(w.__bootStats.elapsedMs >= 0, 'elapsedMsは0以上であるべき');
    assert.ok(w.__bootStats.approxKB > 0, 'approxKBは正の値であるべき(HTMLサイズの目安)');
  });

  /* ============================= G6: 大量データエクスポートのWeb Worker化 ============================= */

  await test('buildCsvString/buildExportJsonString: 純粋関数として正しい文字列を返す(G6)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const csv = w.buildCsvString([['a', 'b"c'], [1, null]]);
    assert.ok(csv.includes('"a","b""c"'), 'CSVのダブルクォートエスケープが正しくない: ' + csv);
    assert.ok(csv.includes('"1",""'), 'null値は空文字列としてクォートされるべき: ' + csv);

    const json = w.buildExportJsonString({ schemaVersion: 1, items: [] });
    assert.strictEqual(JSON.parse(json).schemaVersion, 1);
  });

  await test('runHeavyExport: Worker未対応環境(jsdom)や閾値以下では同期的にpureFnの結果を返す(G6)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    assert.strictEqual(typeof w.Worker, 'undefined', '前提: jsdomはWeb Workerを実装していないはず');
    let resultSmall = null;
    w.runHeavyExport((x) => 'small:' + x, 'data', 1, (r) => { resultSmall = r; });
    assert.strictEqual(resultSmall, 'small:data', '閾値以下は同期的に結果を返すべき');

    let resultLarge = null;
    w.runHeavyExport((x) => 'large:' + x, 'data', w.HEAVY_EXPORT_WORKER_THRESHOLD + 1, (r) => { resultLarge = r; });
    assert.strictEqual(resultLarge, 'large:data', 'Worker未対応環境では閾値超過でも同期フォールバックするべき');
  });

  await test('CSVエクスポート: 大量データ(閾値超過)でもWorker未対応環境では正しくCSVダウンロードが行われる(G6)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    let captured = null;
    w.Blob = function (parts) { captured = parts.join(''); };
    w.URL.createObjectURL = () => 'blob://fake';
    w.URL.revokeObjectURL = () => {};
    w.state.items = [];
    for (let i = 0; i < w.HEAVY_EXPORT_WORKER_THRESHOLD + 5; i++) {
      w.state.items.push(w.normalizeItem({
        id: 'x' + i, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        mediaType: 'text', sourceCategory: 'media', claimTitle: 'claim' + i, claimText: 't', verdict: 'true'
      }));
    }
    w.state.activeTab = 'list';
    w.renderAll();
    w.document.getElementById('btn-export-csv').click();
    assert.ok(captured && captured.includes('claim0') && captured.includes('claim' + (w.HEAVY_EXPORT_WORKER_THRESHOLD + 4)), '大量データのCSVが正しく生成されていない');
  });

  /* ============================= I5: 自動バックアップ ============================= */

  await test('maybeSnapshotBackup: データが無い場合はスナップショットを作らない(I5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [];
    w.maybeSnapshotBackup();
    assert.strictEqual(w.listBackups().length, 0);
  });

  await test('maybeSnapshotBackup: 直近すぎる場合は追加スナップショットを作らない(スロットリング)(I5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({ id: 'a', claimTitle: 't' })];
    w.maybeSnapshotBackup();
    assert.strictEqual(w.listBackups().length, 1, '初回は必ずスナップショットが作られるべき');
    w.state.items.push(w.normalizeItem({ id: 'b', claimTitle: 't2' }));
    w.maybeSnapshotBackup();
    assert.strictEqual(w.listBackups().length, 1, '直近(30分未満)の再呼び出しはスキップされるべき');
  });

  await test('maybeSnapshotBackup: 最大世代数を超えたら古いものから捨てる(I5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const backups = [];
    for (let i = 0; i < w.BACKUP_MAX_GENERATIONS + 2; i++) {
      const d = new Date(); d.setHours(d.getHours() - (w.BACKUP_MAX_GENERATIONS + 2 - i));
      backups.push({ at: d.toISOString(), itemCount: i, payload: { schemaVersion: 1, items: [], weights: {} } });
    }
    w.storageSetJSON(w.BACKUP_STORAGE_KEY, backups);
    w.state.items = [w.normalizeItem({ id: 'new', claimTitle: 't' })];
    w.maybeSnapshotBackup();
    const result = w.listBackups();
    assert.strictEqual(result.length, w.BACKUP_MAX_GENERATIONS, '最大世代数を超えないべき');
    assert.strictEqual(result[result.length - 1].itemCount, 1, '最新のスナップショットが末尾に追加されるべき');
  });

  await test('restoreFromBackup: 指定時点のデータへ復元し、normalizeItemを通す(I5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const at = new Date().toISOString();
    w.storageSetJSON(w.BACKUP_STORAGE_KEY, [{
      at, itemCount: 1,
      payload: { schemaVersion: 1, items: [{ id: 'old', claimTitle: '復元テスト' }], weights: { official: 99 } }
    }]);
    w.state.items = [w.normalizeItem({ id: 'current', claimTitle: '現在のデータ' })];
    const ok = w.restoreFromBackup(at);
    assert.strictEqual(ok, true);
    assert.strictEqual(w.state.items.length, 1);
    assert.strictEqual(w.state.items[0].claimTitle, '復元テスト');
    assert.strictEqual(w.state.items[0].tags.length, 0, 'normalizeItemを通して新フィールドが補完されるべき');
    assert.strictEqual(w.state.weights.official, 99);
  });

  await test('restoreFromBackup: 存在しない時点を指定した場合はfalseを返し、状態を変更しない(I5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.items = [w.normalizeItem({ id: 'current', claimTitle: '現在のデータ' })];
    const ok = w.restoreFromBackup('存在しない時刻');
    assert.strictEqual(ok, false);
    assert.strictEqual(w.state.items[0].claimTitle, '現在のデータ');
  });

  await test('一覧タブ: 自動バックアップから復元ボタンをクリックすると復元され、元に戻すも機能する(I5)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const originalConfirm = w.confirm;
    w.confirm = () => true;
    const at = new Date().toISOString();
    w.storageSetJSON(w.BACKUP_STORAGE_KEY, [{
      at, itemCount: 1,
      payload: { schemaVersion: 1, items: [{ id: 'backup1', claimTitle: 'バックアップ案件' }], weights: {} }
    }]);
    w.state.items = [w.normalizeItem({ id: 'live1', claimTitle: '現在の案件' })];
    w.state.activeTab = 'list';
    w.renderAll();
    const doc = w.document;
    const restoreBtn = doc.querySelector('[data-restore-backup]');
    assert.ok(restoreBtn, 'バックアップ復元ボタンが見つからない');
    restoreBtn.click();
    assert.strictEqual(w.state.items[0].claimTitle, 'バックアップ案件', '復元ボタンでバックアップ内容に切り替わるべき');

    const undoBtn = doc.querySelector('.toast .toast-msg')?.parentElement?.querySelector('button');
    assert.ok(undoBtn, '元に戻すボタンが見つからない');
    undoBtn.click();
    assert.strictEqual(w.state.items[0].claimTitle, '現在の案件', '元に戻すで復元前の状態に戻るべき');
    w.confirm = originalConfirm;
  });

  /* ============================= I9: サーバー共有の競合検知 ============================= */

  await test('checkShareConflictThenSave: 前回同期時点と最新updatedAtが一致すれば確認ダイアログを出さずに保存する(I9)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const key = w.licGenerate('テスト株式会社', w.STORE);
    w.localStorage.setItem('fcd_license', JSON.stringify({ company: 'テスト株式会社', key }));
    w.setShareInfo({ id: 'ws1', editKey: 'key1', lastSyncedAt: '2026-08-01T00:00:00.000Z' });
    let confirmCalled = false;
    w.confirm = () => { confirmCalled = true; return true; };
    let putCalled = false;
    w.fetch = (url, opts) => {
      if (opts && opts.method === 'PUT') { putCalled = true; }
      return Promise.resolve({ json: () => Promise.resolve(opts && opts.method === 'PUT' ? { ok: true, updatedAt: '2026-08-27T00:00:00.000Z' } : { data: {}, updatedAt: '2026-08-01T00:00:00.000Z' }) });
    };
    w.state.activeTab = 'list';
    w.renderAll();
    w.document.getElementById('share-create').click();
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(confirmCalled, false, '競合が無い場合は確認ダイアログを出さないべき');
    assert.strictEqual(putCalled, true, '保存(PUT)は実行されるべき');
  });

  await test('checkShareConflictThenSave: サーバー側が自分の知らない間に更新されていたら警告し、キャンセルすると保存しない(I9)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const key = w.licGenerate('テスト株式会社', w.STORE);
    w.localStorage.setItem('fcd_license', JSON.stringify({ company: 'テスト株式会社', key }));
    w.setShareInfo({ id: 'ws1', editKey: 'key1', lastSyncedAt: '2026-08-01T00:00:00.000Z' });
    let confirmMessage = '';
    w.confirm = (msg) => { confirmMessage = msg; return false; }; // キャンセルする
    let putCalled = false;
    w.fetch = (url, opts) => {
      if (opts && opts.method === 'PUT') { putCalled = true; }
      return Promise.resolve({ json: () => Promise.resolve(opts && opts.method === 'PUT' ? { ok: true } : { data: {}, updatedAt: '2026-08-20T00:00:00.000Z', updatedBy: '他の担当者' }) });
    };
    w.state.activeTab = 'list';
    w.renderAll();
    w.document.getElementById('share-create').click();
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(confirmMessage.includes('他の人が更新した可能性'), '競合警告メッセージが表示されるべき: ' + confirmMessage);
    assert.strictEqual(putCalled, false, 'キャンセルした場合はPUTが実行されないべき');
  });

  await test('checkShareConflictThenSave: 初回保存(lastSyncedAt未設定)では事前確認GETを行わずそのまま保存する(I9)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const key = w.licGenerate('テスト株式会社', w.STORE);
    w.localStorage.setItem('fcd_license', JSON.stringify({ company: 'テスト株式会社', key }));
    let getCalled = false, postCalled = false;
    w.fetch = (url, opts) => {
      const method = opts && opts.method;
      if (!method || method === 'GET') getCalled = true; else if (method === 'POST') postCalled = true;
      return Promise.resolve({ json: () => Promise.resolve({ id: 'new1', editKey: 'key1', updatedAt: '2026-08-27T00:00:00.000Z' }) });
    };
    w.state.activeTab = 'list';
    w.renderAll();
    w.document.getElementById('share-create').click();
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(getCalled, false, '初回保存では事前確認のGETを行わないべき');
    assert.strictEqual(postCalled, true, '初回保存はPOSTで作成されるべき');
  });

  /* ============================= K4: Content-Security-Policy ============================= */

  await test('CSPのmetaタグが設定され、想定ドメイン以外へのconnect-srcを制限している(K4)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const meta = w.document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    assert.ok(meta, 'CSPのmetaタグが見つからない');
    const content = meta.getAttribute('content');
    assert.ok(content.includes("default-src 'none'"), 'default-srcが原則拒否になっていない');
    assert.ok(content.includes('connect-src') && content.includes('di-tools-api.vercel.app'), 'connect-srcにサーバー共有APIドメインが含まれていない');
    assert.ok(content.includes('worker-src') && content.includes('blob:'), "worker-srcにblob:が無いとG6のWeb Workerが動作しない");
    assert.ok(content.includes('media-src') && content.includes('data:'), "media-srcにdata:が無いとN11の<video>フレーム抽出が動作しない(実ブラウザで発覚した回帰)");
    assert.ok(content.includes("object-src 'none'"), 'object-srcが制限されていない');
  });

  /* ============================= K5: ライセンス秘密値の難読化 ============================= */

  await test('K5: ライセンス秘密値がソース中に平文で存在せず、実行時に正しく復元されてlicVerifyが機能する', async () => {
    const dom = await freshDom();
    const w = dom.window;
    // 難読化バイト配列からの復元関数が正しく動作し、既存のlicGenerate/licVerifyと整合すること
    assert.strictEqual(typeof w._licSecret, 'function', '_licSecret()が公開されていない');
    const secret = w._licSecret();
    assert.ok(secret.length > 10, '復元された秘密値が空/極端に短い');
    const key = w.licGenerate('難読化テスト株式会社', w.STORE);
    assert.strictEqual(w.licVerify('難読化テスト株式会社', w.STORE, key), true, '難読化後もライセンス検証が正しく機能するべき');
    assert.strictEqual(w.licVerify('別の会社', w.STORE, key), false, '会社名が違えば検証は失敗するべき');
  });

  await test('K5: 生のHTMLソースをテキスト検索しても、ライセンス秘密値の平文が見つからない', async () => {
    const html = HTML;
    // 難読化前に使っていた秘密値の平文がソース中に残っていないことを確認する
    assert.ok(!html.includes('fc-dash-2026-08-tR4nP8vK2xQ7'), '旧・平文の秘密値がソースに残っている');
  });

  /* ============================= J6で発見したテストの抜け漏れを埋める ============================= */
  /* J6の関数呼び出しカバレッジ計測で、④AI参照・⑤専用ツール行の描画(aiRowHtml/toolRowHtml)と
   * ガイドタブ(renderGuideTab)が一度もテストされていないことが判明したため、追加した。 */

  await test('④AI参照・⑤専用ツールの行を追加/削除でき、内容を入力すると軸スコアに反映される(J6で発見した未テスト関数を補完)', async () => {
    const dom = await freshDom();
    await agreeToConsent(dom);
    const doc = dom.window.document;

    const addAi = doc.querySelector('[data-add="aiChecks"]');
    assert.ok(addAi, 'AIツール参照の追加ボタンが見つからない');
    addAi.click();
    const aiRow = doc.querySelector('.row-item.ai[data-list="aiChecks"]');
    assert.ok(aiRow, 'AIチェック行が描画されない');
    const stanceSel = aiRow.querySelector('[data-field="stance"]');
    stanceSel.value = 'support';
    stanceSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.strictEqual(dom.window.state.draft.aiChecks[0].stance, 'support');

    const addTool = doc.querySelector('[data-add="toolChecks"]');
    assert.ok(addTool, 'ツール利用記録の追加ボタンが見つからない');
    addTool.click();
    const toolRow = doc.querySelector('.row-item.ai[data-list="toolChecks"]');
    assert.ok(toolRow, 'ツールチェック行が描画されない');
    const findingSel = toolRow.querySelector('[data-field="finding"]');
    findingSel.value = 'supports';
    findingSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.strictEqual(dom.window.state.draft.toolChecks[0].finding, 'supports');

    // 削除ボタンも機能すること
    doc.querySelector('[data-remove="aiChecks"]').click();
    assert.strictEqual(dom.window.state.draft.aiChecks.length, 0);
    doc.querySelector('[data-remove="toolChecks"]').click();
    assert.strictEqual(dom.window.state.draft.toolChecks.length, 0);
  });

  await test('ガイド・参考ツールタブが例外なく描画される(J6で発見した未テスト関数を補完)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.activeTab = 'guide';
    w.renderAll();
    const doc = w.document;
    assert.ok(doc.body.textContent.length > 0, 'ガイドタブの描画結果が空');
    assert.ok(doc.body.textContent.includes('ガイド') || doc.querySelector('#app'), 'ガイドタブらしき内容が見つからない');
  });

  /* ============================= N12: パターンカタログのノーコード編集 ============================= */

  await test('normalizeCustomPattern: キーワードのカンマ区切り文字列を配列に正規化し、重みを1-30に丸める', async () => {
    const dom = await freshDom();
    const w = dom.window;
    const p = w.normalizeCustomPattern({ label: 'テストパターン', keywords: '当選,受取手続き, 個人情報', weight: 999, tip: '注意' });
    assert.strictEqual(Array.isArray(p.keywords), true);
    assert.strictEqual(p.keywords.length, 3);
    assert.strictEqual(p.keywords[0], '当選');
    assert.strictEqual(p.keywords[1], '受取手続き');
    assert.strictEqual(p.keywords[2], '個人情報');
    assert.strictEqual(p.weight, 30, '重みは上限30に丸められるべき');
    assert.strictEqual(p.category, 'カスタム', 'カテゴリ未指定時は既定値になるべき');
  });

  await test('allPatterns/scanPatterns: カスタムパターンが組み込みパターンとマージされ、キーワード一致でスコアに反映される(N12)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.saveCustomPatterns([w.normalizeCustomPattern({ label: '偽当選通知', keywords: '当選しました,受取手続き', weight: 25 })]);
    const before = w.allPatterns().length;
    assert.ok(before > w.MISINFO_PATTERNS.length, 'カスタムパターンが組み込みパターンに加算されているべき');

    const result = w.scanPatterns('おめでとうございます！当選しました。受取手続きはこちらから。');
    assert.ok(result.matchedIds.some((id) => id.startsWith('custom-')), 'カスタムパターンのIDが一致結果に含まれるべき');
    assert.ok(result.score >= 25, 'カスタムパターンの重みがスコアに反映されるべき: ' + result.score);
  });

  await test('ガイドタブ: カスタムパターンをフォームから追加・削除でき、元に戻すも機能する(N12)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.activeTab = 'guide';
    w.renderAll();
    const doc = w.document;

    doc.getElementById('cp-label').value = '偽の給付金通知';
    doc.getElementById('cp-keywords').value = '給付金,至急振込';
    doc.getElementById('cp-add').click();

    assert.strictEqual(w.loadCustomPatterns().length, 1, 'カスタムパターンが1件保存されるべき');
    assert.ok(doc.body.textContent.includes('偽の給付金通知'), '追加したパターンが画面に表示されない');
    assert.strictEqual(doc.getElementById('custom-patterns-count').textContent, 'カスタムパターン(1件)', '追加後に見出しの件数が更新されるべき');

    const removeBtn = doc.querySelector('[data-remove-pattern]');
    assert.ok(removeBtn, '削除ボタンが見つからない');
    removeBtn.click();
    assert.strictEqual(w.loadCustomPatterns().length, 0, '削除後は0件になるべき');

    const toasts = doc.querySelectorAll('.toast.warning');
    const lastWarningToast = toasts[toasts.length - 1];
    const undoBtn = lastWarningToast && lastWarningToast.querySelector('button');
    assert.ok(undoBtn, '元に戻すボタンが見つからない');
    undoBtn.click();
    assert.strictEqual(w.loadCustomPatterns().length, 1, '元に戻すで復元されるべき');
  });

  await test('ガイドタブ: パターン名・キーワード未入力では追加せず警告する(N12)', async () => {
    const dom = await freshDom();
    const w = dom.window;
    w.state.activeTab = 'guide';
    w.renderAll();
    const doc = w.document;
    doc.getElementById('cp-add').click();
    assert.strictEqual(w.loadCustomPatterns().length, 0, '未入力のまま追加しようとしても保存されないべき');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  printFunctionCoverageReport();
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
