#!/usr/bin/env node
// Claude Code PostToolUse hook: Write/Edit で Markdown を保存したら textlint を実行する。
// jq に依存せず node の標準機能だけで動く（Windows / macOS / Linux 共通）。
// 指摘があれば stderr に出して exit 2 で返し、エージェントに自己修正させる。
import { execSync } from "node:child_process";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let filePath = "";
  try {
    filePath = JSON.parse(input)?.tool_input?.file_path || "";
  } catch {
    process.exit(0); // ペイロードを解析できないときは何もしない
  }
  if (!/\.md$/i.test(filePath)) process.exit(0); // Markdown 以外は対象外

  try {
    execSync(`npx textlint "${filePath}"`, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out =
      (err.stdout ? err.stdout.toString() : "") +
      (err.stderr ? err.stderr.toString() : "");
    process.stderr.write(out || "textlint failed\n");
    process.exit(2); // exit 2 で指摘内容をエージェントに返す
  }
});
