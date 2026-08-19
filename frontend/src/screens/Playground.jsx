import React, { useState } from "react";

const STRATEGIES = [
  ["balanced", "合成スコア(既定)"],
  ["cost", "最安を優先"],
  ["latency", "最速を優先"],
  ["quality", "最高品質を優先"],
];

const usd = (v) => {
  const n = Number(v || 0);
  if (n > 0 && n < 0.000001) return "< $0.000001";
  return `$${n.toFixed(6)}`;
};

// LLMプレイグラウンド: プロンプト + 戦略選択 -> 選択プロバイダ/コスト/レイテンシ。
export default function Playground({ onSend, result, busy }) {
  const [prompt, setPrompt] = useState("社内規程の経費精算の締め日は?");
  const [strategy, setStrategy] = useState("balanced");

  const trimmed = prompt.trim();
  // 旧実装は空プロンプトでも送信でき、サーバ側で 422 になっていた
  const canSend = !busy && trimmed.length > 0;

  const submit = () => { if (canSend) onSend(trimmed, strategy); };

  return (
    <div className="card">
      <h2>LLMプレイグラウンド</h2>
      <label htmlFor="prompt" className="hint">プロンプト(Ctrl+Enter で送信)</label>
      <textarea
        id="prompt"
        rows="3"
        style={{ width: "100%" }}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }}
      />
      <label htmlFor="strategy">ルーティング戦略
        <select id="strategy" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
          {STRATEGIES.map(([v, label]) => (
            <option key={v} value={v}>{v} — {label}</option>
          ))}
        </select>
      </label>
      <button className="primary" disabled={!canSend} onClick={submit}>
        {busy ? "実行中..." : "送信"}
      </button>

      {result && (
        <div className="result">
          <p>{result.text}</p>
          <small>
            provider={result.provider} / model={result.model} / strategy={result.strategy}
            {" / "}cost={usd(result.cost_usd)} / latency={Number(result.latency_ms || 0).toFixed(0)}ms
            {" / "}tokens={result.input_tokens}in+{result.output_tokens}out
            {result.estimated_tokens && " (推定値)"}
            {result.fell_back && " / フォールバック発生"}
          </small>
          {result.estimated_tokens && (
            <p className="note">
              ⚠ トークン数は概算です(mock 実行時、または usage を返さないプロバイダ)。
              表示コストは実際の請求額と一致しません。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
