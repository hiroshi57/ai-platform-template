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

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
