// harness.mjs — ループ本体（6層を結線する）
//
//   model.propose  (層2 context を入力に次の行動を提案)
//     -> gateway   (層3 提案・許可・実行を分離)
//     -> verify    (層5 証拠で accept/retry/escalate)
//     -> state     (層4 永続状態) / trace (層6)
//
// 実行: node agent-harness/src/harness.mjs

import { buildContext } from "./context.mjs";
import { propose } from "./model.mjs";
import { gateway } from "./gateway.mjs";
import { verify } from "./verify.mjs";
import {
  initState,
  saveState,
  appendTrace,
  loadContract,
  loadPermissions,
} from "./state.mjs";

const DECISION = "既存のエクスポートエンドポイントを再利用";
const ARTIFACT = "artifacts/export.csv";
const MAX_STEPS = 10;

const task = loadContract();
const permissions = loadPermissions();
let state = initState(task);

let step = 0;
let toolCalls = 0;
let stateChanges = 0;
let retries = 0;
let stopReason = "loop_exhausted";

while (step < MAX_STEPS) {
  step++;
  const context = buildContext(task, state);
  const request = propose(context, state);
  const obs = gateway({ request, permissions });
  toolCalls++;

  console.log(`[step ${step}] ${request.name} -> ${obs.status}`);

  if (obs.status === "permission_denied") {
    stopReason = "permission_denied";
    console.log(`  ⛔ 権限なし: ${request.name}`);
    break;
  }

  if (obs.status === "paused_for_human_approval") {
    stopReason = "human_approval_required";
    console.log(`  ⏸ 承認待ち: ${request.name}`);
    console.log(`     条件: ${obs.requires.join(", ")}`);
    console.log(`     preview: ${JSON.stringify(obs.preview)}`);
    break;
  }

  // obs.status === "ok": ツールが実行された
  if (request.name === "write_workspace") {
    if (!state.artifacts.includes(ARTIFACT)) state.artifacts.push(ARTIFACT);
    if (!state.decisions.includes(DECISION)) state.decisions.push(DECISION);

    const result = verify(ARTIFACT);
    state.last_evidence = result.evidence;
    stateChanges++;

    if (result.status === "accept") {
      console.log(`  ✅ 全チェック通過: ${result.evidence.map((c) => c.name).join(", ")}`);
      if (!state.completed.includes("implementation")) state.completed.push("implementation");
      if (!state.completed.includes("verification")) state.completed.push("verification");
      state.status = "verified";
    } else {
      console.log(`  ❌ 失敗: ${JSON.stringify(result.failed)}`);
      if (result.status === "retry" && state.repairs < task.max_repairs) {
        state.repairs++;
        retries++;
        console.log(`  🔧 限定修復 ${state.repairs}/${task.max_repairs} 回目へ`);
      } else {
        stopReason = "escalate";
        const names = result.failed.map((c) => c.name).join(", ");
        console.log(`  ⤴ エスカレーション: 修復上限 or 修復不能 (${names})`);
        state.status = "escalated";
        state.open_risks.push(`unresolved: ${names}`);
        saveState(state);
        break;
      }
    }
  }

  saveState(state);
}

saveState(state);

const passed = (state.last_evidence ?? []).filter((c) => c.passed).length;
const failed = (state.last_evidence ?? []).filter((c) => !c.passed).length;

appendTrace({
  run_id: `run_${new Date().toISOString().slice(0, 10)}_${Math.floor(Math.random() * 9000 + 1000)}`,
  contract_version: "1",
  model_route: "deterministic-stub",
  context_sources: ["AGENTS.md", "context/product-rules.md"],
  tool_calls: toolCalls,
  state_changes: stateChanges,
  verification: { passed, failed },
  retries,
  stop_reason: stopReason,
  rollback_point: "git:initial",
});

console.log("");
console.log(`=== stop_reason: ${stopReason} / retries: ${retries} ===`);
