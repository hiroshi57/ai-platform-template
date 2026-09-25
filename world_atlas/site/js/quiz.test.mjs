// node --test world_atlas/site/js/quiz.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { makeQuiz, rng } from "./quiz.js";

// 小さな架空データ(人口500万人以上の国を24か国つくる)
function fixture() {
  const countries = {};
  const pop = {}, lifeExp = {}, co2 = {};
  const regions = ["東アジア・太平洋", "ヨーロッパ・中央アジア", "サハラ以南アフリカ", "南アジア", "中南米・カリブ"];
  for (let i = 0; i < 120; i++) {
    const k = `C${String(i).padStart(2, "0")}`;
    countries[k] = { name_ja: `国${i}`, region_ja: regions[i % regions.length], capital: `首都${i}` };
    pop[k] = [2024, i < 24 ? 1e7 + i * 1e6 : 1e6, 2014, 1, null];
    lifeExp[k] = [2024, 50 + i * 0.3, 2014, 50, null];
    co2[k] = [2024, 0.5 + i * 0.1, 2014, 1, null];
  }
  const catalog = {
    indicators: [
      { id: "population", name: "人口", unit: "人", better: null, scale: "log", category: "people", explain: "人の数", decimals: 0 },
      { id: "life_exp", name: "平均寿命", unit: "歳", better: "high", scale: "linear", category: "health", explain: "寿命", decimals: 1 },
      { id: "co2_pc", name: "CO2", unit: "t", better: "low", scale: "linear", category: "climate", explain: "排出", decimals: 2 },
    ],
    sdg_goals: Array.from({ length: 17 }, (_, i) => ({ n: i + 1, name: `目標名${i + 1}` })),
  };
  const events = Array.from({ length: 12 }, (_, i) => ({
    y: -500 + i * 200, approx: false, t: `出来事${i}`, d: `説明${i}`, cat: "politics", c: ["C01"],
    p: [{ name: `人物${i}`, role: `役割${i}`, look: {} }],
  }));
  events.push({ y: 610, t: "宗教の成立", d: "…", cat: "culture", c: [], p: [{ name: "開祖", role: "預言者", symbol: "🕌" }] });
  return { catalog, countries, latest: { population: { c: pop }, life_exp: { c: lifeExp }, co2_pc: { c: co2 } }, timeline: { events } };
}

test("rng is deterministic", () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  assert.notEqual(rng(1)(), rng(2)());
});

test("makeQuiz returns n valid questions and is reproducible by seed", () => {
  const data = fixture();
  const q1 = makeQuiz(data, 123, 10);
  const q2 = makeQuiz(data, 123, 10);
  assert.equal(q1.length, 10);
  assert.deepEqual(q1, q2);
  for (const q of q1) {
    assert.ok(q.q && q.explain, "question and explanation");
    assert.ok(q.choices.length >= 2 && q.choices.length <= 4);
    assert.equal(new Set(q.choices).size, q.choices.length, "no duplicate choices");
    assert.ok(q.answer >= 0 && q.answer < q.choices.length);
  }
  assert.ok(new Set(q1.map((q) => q.type)).size >= 4, "mixes question types");
});

test("compare questions pick the correct direction", () => {
  const data = fixture();
  for (let seed = 1; seed < 40; seed++) {
    for (const q of makeQuiz(data, seed, 10).filter((x) => x.type === "compare")) {
      const byName = Object.fromEntries(Object.entries(data.countries).map(([k, c]) => [c.name_ja, k]));
      const ind = data.catalog.indicators.find((i) => q.q.includes(i.name));
      const vals = q.choices.map((c) => data.latest[ind.id].c[byName[c]][1]);
      const best = ind.better === "low" ? Math.min(...vals) : Math.max(...vals);
      assert.equal(vals[q.answer], best);
    }
  }
});

test("person questions never use symbol-only (religious founder) figures", () => {
  const data = fixture();
  for (let seed = 1; seed < 30; seed++) {
    for (const q of makeQuiz(data, seed, 10).filter((x) => x.type === "person")) {
      assert.ok(!q.person.symbol);
      assert.ok(!q.choices.includes("開祖"));
    }
  }
});
