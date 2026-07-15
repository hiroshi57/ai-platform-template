import React from "react";

// 観測性ダッシュボード: 総コスト/p95/フォールバック率/プロバイダ別。
export default function Observability({ summary, onOpenReport }) {
  if (!summary) return <div className="card">メトリクスがありません。</div>;
  return (
    <div className="card">
      <h2>観測性ダッシュボード</h2>
      <div className="metrics">
        <div className="metric"><div>総リクエスト</div><div className="val">{summary.count}</div></div>
        <div className="metric"><div>総コスト</div><div className="val">${summary.total_cost_usd?.toFixed(4)}</div></div>
        <div className="metric"><div>p95レイテンシ</div><div className="val">{summary.p95_latency_ms}ms</div></div>
        <div className="metric"><div>フォールバック率</div><div className="val">{Math.round(summary.fallback_rate * 100)}%</div></div>
      </div>
      <h3>プロバイダ別</h3>
      <table><thead><tr><th>プロバイダ</th><th>件数</th><th>コスト</th></tr></thead>
        <tbody>{Object.entries(summary.by_provider || {}).map(([k, v]) => (
          <tr key={k}><td>{k}</td><td>{v.count}</td><td>${v.cost_usd}</td></tr>))}</tbody></table>
      {onOpenReport && <button className="primary" onClick={onOpenReport}>HTMLレポート</button>}
    </div>
  );
}
