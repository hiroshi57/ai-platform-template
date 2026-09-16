// state.mjs — 層4 永続状態 ＋ 層6 トレース
//
// 記憶は「チャット全部の保存」ではなく、正しく継続するための最低限。
// 4種類に分けて扱う: FACTS(契約) / DECISIONS(選択) / STATE(現在地) / LESSONS(教訓)。
// 一時的なツール出力は捨ててよい。

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function initState(task) {
  return {
    task_id: task.task_id,
    status: "in_progress",
    completed: [],
    decisions: [],
    artifacts: [],
    open_risks: [],
    repairs: 0,
    max_repairs: task.max_repairs,
    last_evidence: null,
  };
}

export function saveState(state) {
  const target = path.join(ROOT, "state/current.json");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function appendTrace(trace) {
  const target = path.join(ROOT, "runs/traces.jsonl");
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, JSON.stringify(trace) + "\n", "utf8");
}

export function loadContract() {
  return JSON.parse(readFileSync(path.join(ROOT, "contracts/feature_042.json"), "utf8"));
}

export function loadPermissions() {
  return JSON.parse(readFileSync(path.join(ROOT, "tools/permissions.json"), "utf8"));
}
