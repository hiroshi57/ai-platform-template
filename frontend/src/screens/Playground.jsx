import React, { useState } from "react";

// LLMプレイグラウンド: プロンプト + 戦略選択 -> 選択プロバイダ/コスト/レイテンシ。
export default function Playground({ onSend, result, busy }) {
  const [prompt, setPrompt] = useState("社内規程の経費精算の締め日は?");
  const [strategy, setStrategy] = useState("balanced");
  return (
    <div className="card">
      <h2>LLMプレイグラウンド</h2>
      <textarea rows="3" style={{ width: "100%" }} value={prompt}
        onChange={(e) => setPrompt(e.target.value)} />
      <label>ルーティング戦略
        <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
          <option value="balanced">balanced</option><option value="cost">cost</option>
          <option value="latency">latency</option><option value="quality">quality</option></select>
      </label>
      <button className="primary" disabled={busy} onClick={() => onSend(prompt, strategy)}>
        {busy ? "実行中..." : "送信"}
      </button>
      {result && (
        <div className="result">
          <p>{result.text}</p>
          <small>provider={result.provider} / model={result.model} /
            cost=${result.cost_usd?.toFixed(6)} / latency={result.latency_ms?.toFixed(0)}ms</small>
        </div>
      )}
    </div>
  );
}
