// node --test world_atlas/site/js/analytics.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "./analytics.js";

const S = [[2000, 10], [2005, 20], [2010, 30], [2020, 40]];

test("valueAt picks latest point at or before year within gap", () => {
  assert.deepEqual(A.valueAt(S, 2007), [2005, 20]);
  assert.deepEqual(A.valueAt(S, 2020), [2020, 40]);
  assert.equal(A.valueAt(S, 1999), null);
  assert.equal(A.valueAt(S, 2019, 5), null); // 2010 は 9 年前 → gap 超過
  assert.equal(A.valueAt([], 2000), null);
});

test("median / mean", () => {
  assert.equal(A.median([3, 1, 2]), 2);
  assert.equal(A.median([4, 1, 2, 3]), 2.5);
  assert.equal(A.median([]), null);
  assert.equal(A.mean([1, 2, 3, NaN]), 2);
});

test("rankOf respects direction and ties", () => {
  const snap = { A: [2020, 10], B: [2020, 30], C: [2020, 20], D: [2020, 30] };
  assert.deepEqual(A.rankOf("B", snap, "high"), { rank: 1, n: 4, goodness: 1 });
  assert.equal(A.rankOf("D", snap, "high").rank, 1); // 同値は同順位
  assert.equal(A.rankOf("C", snap, "high").rank, 3);
  assert.equal(A.rankOf("A", snap, "low").rank, 1);
  assert.equal(A.rankOf("A", snap, "high").goodness, 0);
  assert.equal(A.rankOf("Z", snap, "high"), null);
});

test("rateLabel thresholds match python", () => {
  assert.equal(A.rateLabel(0.95), "S");
  assert.equal(A.rateLabel(0.75), "A");
  assert.equal(A.rateLabel(0.5), "B");
  assert.equal(A.rateLabel(0.3), "C");
  assert.equal(A.rateLabel(0.05), "D");
  assert.equal(A.rateLabel(null), null);
});

test("trend and meaning", () => {
  const tr = A.trend(S, 10); // 2010→2020
  assert.deepEqual(tr.from, [2010, 30]);
  assert.equal(tr.dir, "up");
  assert.equal(A.trendMeaning(tr, "high"), "改善");
  assert.equal(A.trendMeaning(tr, "low"), "悪化");
  assert.equal(A.trendMeaning(A.trend([[2010, 100], [2020, 100.5]]), "high"), "横ばい");
});

test("groupScore averages goodness only for rated indicators with enough countries", () => {
  const snapHigh = {};
  const snapLow = {};
  for (let i = 0; i < 21; i++) {
    snapHigh["C" + i] = [2020, i];
    snapLow["C" + i] = [2020, i];
  }
  const inds = [
    { id: "h", better: "high" },
    { id: "l", better: "low" },
    { id: "n", better: null },
  ];
  const g = A.groupScore("C20", inds, { h: snapHigh, l: snapLow, n: snapHigh });
  assert.equal(g.n, 2);
  assert.equal(g.score, 50); // high で最良(1)・low で最悪(0)
});

test("quantileBreaks / binOf", () => {
  const br = A.quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8], 4);
  assert.equal(br.length, 3);
  assert.equal(A.binOf(1, br), 0);
  assert.equal(A.binOf(8, br), 3);
});

test("fmtNum / fmtYear", () => {
  assert.equal(A.fmtNum(123456789, 0), "1.2億");
  assert.equal(A.fmtNum(4.2e12, 0), "4.20兆");
  assert.equal(A.fmtNum(52000, 0), "5.2万");
  assert.equal(A.fmtNum(null), "—");
  assert.equal(A.fmtYear(-3000), "紀元前3000年");
  assert.equal(A.fmtYear(1868), "1868年");
});

test("commentary mentions strengths, weaknesses and trends", () => {
  const rows = [
    { ind: { name: "平均寿命", better: "high" }, rank: 2, n: 200, label: "S", meaning: "改善" },
    { ind: { name: "CO2", better: "low" }, rank: 180, n: 200, label: "D", meaning: "悪化" },
    { ind: { name: "人口", better: null }, rank: 5, n: 200, label: null },
  ];
  const text = A.commentary("日本", rows, "健康").join("\n");
  assert.match(text, /【強み】平均寿命/);
  assert.match(text, /【課題】CO2/);
  assert.match(text, /良くなっています/);
  assert.match(text, /悪くなっています/);
  assert.match(text, /人口は200か国中5位/);
  assert.match(A.commentary("X", [], "章")[0], /まだ集まっていません/);
});

test("rankAll matches rankOf for every country", () => {
  const snap = { A: [2020, 10], B: [2020, 30], C: [2020, 20], D: [2020, 30], E: [2020, 5] };
  for (const better of ["high", "low", null]) {
    const all = A.rankAll(snap, better);
    for (const k of Object.keys(snap)) assert.deepEqual(all[k], A.rankOf(k, snap, better));
  }
});

test("vecDistance ignores missing dims and needs 3 common", () => {
  assert.equal(A.vecDistance([0, 0, 0, null], [3, 4, 0, 9]), Math.sqrt(25 / 3));
  assert.equal(A.vecDistance([1, null, null], [1, 2, 3]), null);
});
