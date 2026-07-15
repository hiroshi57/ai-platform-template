import React, { useState } from "react";
import Playground from "./screens/Playground.jsx";
import Observability from "./screens/Observability.jsx";
import { chat, metrics, reportUrl } from "./api.js";

const TENANT = "demo-tenant";
const DEMO_RESULT = {
  text: "[claude:claude-3-5-sonnet] response to: 社内規程の経費精算の締め日は?",
  provider: "claude", model: "claude-3-5-sonnet", cost_usd: 0.000096, latency_ms: 900,
};
const DEMO_SUMMARY = {
  count: 4, total_cost_usd: 0.000257, p95_latency_ms: 1300, fallback_rate: 0.0,
  by_provider: { claude: { count: 2, cost_usd: 0.000192 }, gemini: { count: 2, cost_usd: 0.000066 } },
};

export default function App() {
  const [tab, setTab] = useState("play");
  const [result, setResult] = useState(DEMO_RESULT);
  const [summary, setSummary] = useState(DEMO_SUMMARY);
  const [busy, setBusy] = useState(false);

  const send = async (prompt, strategy) => {
    setBusy(true);
    try {
      setResult(await chat(TENANT, prompt, strategy));
      setSummary(await metrics(TENANT));
    } catch (e) {
      alert("バックエンド未起動の可能性: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <h1>AI基盤テンプレート</h1>
      <nav>
        <button onClick={() => setTab("play")} disabled={tab === "play"}>プレイグラウンド</button>
        <button onClick={() => setTab("obs")} disabled={tab === "obs"}>観測性</button>
      </nav>
      {tab === "play"
        ? <Playground onSend={send} result={result} busy={busy} />
        : <Observability summary={summary} onOpenReport={() => window.open(reportUrl(), "_blank")} />}
    </div>
  );
}
