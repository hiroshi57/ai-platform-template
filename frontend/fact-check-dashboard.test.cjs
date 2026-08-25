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
    dom.window.state.items = [{
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'サンプル,主張"引用"', claimText: '本文',
      sourceUrl: 'https://example.com', archiveUrl: '', collectedAt: '', segments: [],
      officialCheck: { result: 'match', agency: '', note: '', link: '' },
      primaryCheck: { result: '', sourceType: '', note: '', link: '' },
      crossChecks: [], aiChecks: [], toolChecks: [], verdict: 'true', summary: '', reviewer: '', history: []
    }];
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
    dom.window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ id: 'abc123', editKey: 'edit999' }) });
    dom.window.state.activeTab = 'list';
    dom.window.renderAll();
    const doc = dom.window.document;
    assert.ok(doc.getElementById('share-create'));
    doc.getElementById('share-create').click();
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(
      dom.window.localStorage.getItem(dom.window.STORE + ':__share'),
      JSON.stringify({ id: 'abc123', editKey: 'edit999' })
    );
  });

  await test('印刷レポート: 試用版では免責文言と透かしが入り、正規版ではライセンス名が表示される', async () => {
    const dom = await freshDom();
    dom.window.state.items = [{
      id: 'x1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      mediaType: 'text', sourceCategory: 'media', claimTitle: 'テスト主張', claimText: '本文',
      sourceUrl: 'https://example.com', archiveUrl: '', collectedAt: '', segments: [],
      officialCheck: { result: '', agency: '', note: '', link: '' },
      primaryCheck: { result: '', sourceType: '', note: '', link: '' },
      crossChecks: [], aiChecks: [], toolChecks: [], verdict: 'false', summary: '', reviewer: '', history: []
    }];
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
      return {
        id: 'id' + monthsAgo + verdict + Math.random(), createdAt: d.toISOString(), updatedAt: d.toISOString(),
        mediaType, sourceCategory, claimTitle: 'claim ' + monthsAgo, claimText: 'text', sourceUrl: '', archiveUrl: '',
        collectedAt: '', segments: [], officialCheck: { result: 'match', agency: '', note: '', link: '' },
        primaryCheck: { result: 'match', sourceType: '', note: '', link: '' },
        crossChecks: [], aiChecks: [], toolChecks: [], verdict, summary: '', reviewer: '', history: []
      };
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

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
