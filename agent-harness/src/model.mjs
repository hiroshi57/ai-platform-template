// model.mjs — モデルの代役（決定的スタブ）
//
// 本物のモデルは確率的だが、ここでは検証可能なように決定的にふるまう。
// 重要な設計: モデルは「日付をどの形式で出すか」を *コンテキストに見えている証拠* で決める。
//   - last_evidence に date_format 失敗が見えていない → slash 形式(2026/09/11, NG)のまま
//   - date_format 失敗が見えている        → ISO 形式(2026-09-11, OK)へ修復
// これにより「証拠が戻らなければ修復できない」という記事の主張が実際に観測できる。

const SOURCE = [
  { date: "2026-09-11", region: "tokyo", revenue: 120 },
  { date: "2026-09-11", region: "osaka", revenue: 80 },
  { date: "2026-09-12", region: "tokyo", revenue: 95 },
];

function renderDate(iso, mode) {
  return mode === "iso" ? iso : iso.replaceAll("-", "/");
}

export function buildCsv(mode) {
  const header = "date,region,revenue";
  const rows = SOURCE.map((r) => `${renderDate(r.date, mode)},${r.region},${r.revenue}`);
  return [header, ...rows].join("\n") + "\n";
}

// コンテキスト文字列に「date_format の失敗証拠」が含まれているか。
// これが見えて初めてモデルは ISO へ切り替える。
function sawDateFailure(context) {
  return /"name":"date_format","passed":false/.test(context);
}

export function propose(context, state) {
  if (!state.completed.includes("verification")) {
    const mode = sawDateFailure(context) ? "iso" : "slash";
    return {
      name: "write_workspace",
      args: { path: "artifacts/export.csv", content: buildCsv(mode) },
    };
  }
  // 検証を通過したら、成果を送る（送信は承認が要る＝層3で止まる）
  return {
    name: "send_message",
    args: { final_content_preview: "CSV エクスポートを追加しました（artifacts/export.csv）" },
  };
}
