import React from "react";

// 極小コストが $0.0000 と表示されて「無料」に見えるのを避ける
const usd = (v) => {
  const n = Number(v || 0);
  if (n > 0 && n < 0.0001) return "< $0.0001";
  return `$${n.toFixed(4)}`;
};
const pct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;

// 観測性ダッシュボード: 総コスト/レイテンシ分位/フォールバック率/エラー率/プロバイダ別。
export default function Observability({ summary, isDemo, onOpenReport }) {
  if (!summary) return <div className="card">メトリクスがありません。</div>;

  const total = Number(summary.total_cost_usd || 0);
  const rows = Object.entries(summary.by_provider || {})
    .sort((a, b) => (b[1].cost_usd || 0) - (a[1].cost_usd || 0));

  return (
    <div className="card">
      <h2>観測性ダッシュボード{isDemo && <span className="tag demo">サンプル</span>}</h2>
      <div className="metrics">
        <div className="metric"><div>総リクエスト</div><div className="val">{summary.count ?? 0}</div></div>
        <div className="metric"><div>総コスト</div><div className="val">{usd(total)}</div></div>
        <div className="metric"><div>p50</div><div className="val">{Math.round(summary.p50_latency_ms || 0)}ms</div></div>
        <div className="metric"><div>p95</div><div className="val">{Math.round(summary.p95_latency_ms || 0)}ms</div></div>
        <div className="metric"><div>p99</div><div className="val">{Math.round(summary.p99_latency_ms || 0)}ms</div></div>
        <div className="metric"><div>フォールバック率</div><div className="val">{pct(summary.fallback_rate)}</div></div>
        <div className="metric"><div>エラー率</div><div className="val">{pct(summary.error_rate)}</div></div>
      </div>

      <h3>プロバイダ別</h3>
      <table>
        <thead>
          <tr><th>プロバイダ</th><th>件数</th><th>入力tok</th><th>出力tok</th><th>コスト</th><th>コスト比</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} className="empty">まだ記録がありません</td></tr>
          )}
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="num">{v.count}</td>
              <td className="num">{v.input_tokens ?? "-"}</td>
              <td className="num">{v.output_tokens ?? "-"}</td>
              <td className="num">{usd(v.cost_usd)}</td>
              <td className="num">{total > 0 ? pct((v.cost_usd || 0) / total) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        レイテンシ統計は成功リクエストのみで算出しています(失敗は latency=0 のため分布を歪めます)。
      </p>
      {onOpenReport && <button className="primary" onClick={onOpenReport}>HTMLレポート</button>}
    </div>
  );
}
