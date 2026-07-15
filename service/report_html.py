"""観測性 HTMLレポート(標準ライブラリのみ)."""
from __future__ import annotations

import html
from typing import Dict


def build_html_report(summary: Dict, provider_modes: Dict[str, str] = None) -> str:
    prov_rows = ""
    for name, s in summary.get("by_provider", {}).items():
        mode = (provider_modes or {}).get(name, "-")
        prov_rows += (f'<tr><td>{html.escape(name)}</td><td>{mode}</td>'
                      f'<td>{s["count"]}</td><td>${s["cost_usd"]:.6f}</td></tr>')
    return f"""<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>AI基盤 観測性レポート</title>
<style>body{{font-family:system-ui,sans-serif;margin:24px;color:#1a1a2e}}
h1{{color:#4361ee}} table{{border-collapse:collapse;width:100%}}
th,td{{border:1px solid #dde;padding:6px 10px}} th{{background:#eaeefb}}
.metrics{{display:flex;gap:16px;margin:12px 0}} .metric{{flex:1;background:#eaeefb;border-radius:8px;padding:12px;text-align:center}}
.val{{font-size:24px;font-weight:bold;color:#4361ee}}</style></head><body>
<h1>AI基盤 観測性レポート</h1>
<div class="metrics">
  <div class="metric"><div>総リクエスト</div><div class="val">{summary.get("count", 0)}</div></div>
  <div class="metric"><div>総コスト(USD)</div><div class="val">${summary.get("total_cost_usd", 0):.4f}</div></div>
  <div class="metric"><div>p95レイテンシ</div><div class="val">{summary.get("p95_latency_ms", 0):.0f}ms</div></div>
  <div class="metric"><div>フォールバック率</div><div class="val">{summary.get("fallback_rate", 0) * 100:.1f}%</div></div>
</div>
<h2>プロバイダ別</h2>
<table><tr><th>プロバイダ</th><th>mode</th><th>件数</th><th>コスト</th></tr>{prov_rows}</table>
</body></html>"""
