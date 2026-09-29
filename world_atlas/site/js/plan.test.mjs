// node --test world_atlas/site/js/plan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAN, canUseIndicator, canUseMode, canUseFeature, isPaidFromStorage } from "./plan.js";

const catalog = JSON.parse(readFileSync(new URL("../data/catalog.json", import.meta.url), "utf8"));

test("free indicators all exist in the catalog", () => {
  const ids = new Set(catalog.indicators.map((i) => i.id));
  for (const id of PLAN.freeIndicators) assert.ok(ids.has(id), id);
});

test("every chapter except history has at least 2 free indicators", () => {
  for (const c of catalog.categories) {
    const n = catalog.indicators.filter((i) => i.category === c.id && PLAN.freeIndicators.includes(i.id)).length;
    if (c.id === "history") assert.equal(n, 0);
    else if (c.id === "human") assert.ok(n >= 1, c.id);
    else assert.ok(n >= 2, `${c.id}: ${n}`);
  }
});

test("free users are limited, paid users are not", () => {
  assert.equal(canUseIndicator("life_exp", false), true);
  assert.equal(canUseIndicator("pop_hist", false), false);
  assert.equal(canUseIndicator("sdg:3", false), true);
  assert.equal(canUseIndicator("pop_hist", true), true);
  assert.equal(canUseMode("globe", false), true);
  assert.equal(canUseMode("compare", false), false);
  assert.equal(canUseMode("compare", true), true);
  assert.equal(canUseFeature("print", false), false);
  assert.equal(canUseFeature("print", true), true);
  assert.equal(canUseFeature("something-free", false), true);
});

test("paid preview works only on localhost", () => {
  const store = { getItem: () => null };
  assert.equal(isPaidFromStorage(store, { hostname: "127.0.0.1", hash: "#m=globe&plan=paid" }), true);
  assert.equal(isPaidFromStorage(store, { hostname: "sekai-3d-zukan.vercel.app", hash: "#plan=paid" }), false);
  assert.equal(isPaidFromStorage(store, { hostname: "localhost", hash: "#m=globe" }), false);
});
