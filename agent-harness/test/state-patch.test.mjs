// state-patch.test.mjs — 状態パッチの検証とマージ（提案C）と仮説記録（提案B）のテスト
// 実行: node --test agent-harness/test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch, parseStepOutput, WORKER_STATE_SCHEMA } from "../src/state-patch.mjs";
import { initState } from "../src/state.mjs";
import { buildContext } from "../src/context.mjs";

const baseState = () =>
  initState({ task_id: "feature_042", max_repairs: 1 });

test("パッチに書かれていないキーは残る（上書き事故の防止）", () => {
  const s0 = applyPatch(baseState(), { decisions: ["A"], artifacts: ["x.csv"] }).state;
  const r = applyPatch(s0, { status: "verified" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.decisions, ["A"]);
  assert.deepEqual(r.state.artifacts, ["x.csv"]);
  assert.equal(r.state.status, "verified");
});

test("merge:append の配列は追加分だけを足し、既存要素を消さない", () => {
  const s0 = applyPatch(baseState(), { completed: ["implementation"] }).state;
  const r = applyPatch(s0, { completed: ["verification", "implementation"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.completed, ["implementation", "verification"]);
});

test("null は nullable なキーだけ削除できる", () => {
  const s0 = applyPatch(baseState(), { last_evidence: [{ name: "x", passed: true }] }).state;
  const ok = applyPatch(s0, { last_evidence: null });
  assert.equal(ok.ok, true);
  assert.equal("last_evidence" in ok.state, false);

  const ng = applyPatch(s0, { completed: null });
  assert.equal(ng.ok, false);
  assert.match(ng.errors[0], /削除できないキー: completed/);
});

test("型違反・未知キー・変更不可キーは状態を一切変えずに差し戻す（rollback）", () => {
  const s0 = baseState();
  const snapshot = structuredClone(s0);
  const r = applyPatch(s0, { repairs: "1", status: "verified", foo: 1, max_repairs: 9 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 3);
  assert.ok(r.errors.some((e) => e.includes("型が不正: repairs")));
  assert.ok(r.errors.some((e) => e.includes("未知のキー: foo")));
  assert.ok(r.errors.some((e) => e.includes("変更不可のキー: max_repairs")));
  // 正しい部分（status）も適用されない = 部分適用しない
  assert.deepEqual(r.state, snapshot);
  assert.deepEqual(s0, snapshot);
});

test("成功時も元の state オブジェクトは変更しない", () => {
  const s0 = baseState();
  const snapshot = structuredClone(s0);
  applyPatch(s0, { completed: ["implementation"], repairs: 1 });
  assert.deepEqual(s0, snapshot);
});

test("object 型はネストしたキーを null で削除できる", () => {
  const schema = { inventory: { type: "object" } };
  const s0 = { inventory: { shelf_42: "item_12", shelf_43: "item_13" } };
  const r = applyPatch(s0, { inventory: { shelf_42: null } }, schema);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.inventory, { shelf_43: "item_13" });
});

test("parseStepOutput: 推論を捨て、state_patch と action だけを返す", () => {
  const text = [
    "Reasoning: item_12 は shelf_42 にある。出荷する。",
    "```json",
    '{ "state_patch": { "inventory": { "shelf_42": null } }, "action": "Ship item_12 shelf_42" }',
    "```",
  ].join("\n");
  const r = parseStepOutput(text);
  assert.equal(r.ok, true);
  assert.equal(r.action, "Ship item_12 shelf_42");
  assert.deepEqual(r.state_patch, { inventory: { shelf_42: null } });
  assert.equal("reasoning" in r, false);
});

test("parseStepOutput: JSON 構文エラーと余計なキーは retry 可能なエラーになる", () => {
  const bad = parseStepOutput('```json\n{ "state_patch": {}, "action": "x", }\n```');
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /JSON 構文エラー/);

  const extra = parseStepOutput('```json\n{ "state_patch": {}, "action": "x", "note": 1 }\n```');
  assert.equal(extra.ok, false);

  const none = parseStepOutput("Action: Ship item_12");
  assert.equal(none.ok, false);
});

test("提案B: initState は tested_hypotheses を持ち、スキーマに定義がある", () => {
  const s = baseState();
  assert.deepEqual(s.tested_hypotheses, []);
  for (const key of Object.keys(s)) {
    assert.ok(WORKER_STATE_SCHEMA[key], `schema に ${key} がない`);
  }
});

test("提案B: 試した仮説がコンテキストに入り、次の試行で見える", () => {
  const s = applyPatch(baseState(), {
    tested_hypotheses: [{ attempt: 1, hypothesis: "slash 形式の日付", result: "failed: date_format" }],
  }).state;
  const context = buildContext(
    { goal: "g", constraints: ["c"] },
    s,
  );
  assert.match(context, /tested_hypotheses: .*slash 形式の日付.*failed: date_format/);
});
