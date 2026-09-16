// context.mjs — 層2 コンテキスト・コンパイラ
//
// 会話全文やDBを丸ごと渡さない。高信号な情報だけを、必要な順で組み立てる:
//   AGENTS.md(地図) -> 製品ルール -> 契約の目標/制約 -> 圧縮した履歴 -> 直近の証拠
//
// ★実験: 末尾の last_evidence 行を消すと、モデルは date_format の失敗を「見られなく」なり、
//   修復が起きない。コンテキストの設計が修復可能性を決めていることが分かる。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8").trim();

export function buildContext(task, state) {
  return [
    `# map (AGENTS.md)\n${read("AGENTS.md").split("\n").slice(0, 4).join("\n")}`,
    `# product-rules\n${read("context/product-rules.md")}`,
    `goal: ${task.goal}`,
    `constraints: ${task.constraints.join(" / ")}`,
    `completed: ${state.completed.join(", ") || "(none)"}`,
    `open_risks: ${state.open_risks.join(", ") || "(none)"}`,
    `last_evidence: ${JSON.stringify(state.last_evidence ?? null)}`,
  ].join("\n---\n");
}
