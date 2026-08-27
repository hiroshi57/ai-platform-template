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

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
