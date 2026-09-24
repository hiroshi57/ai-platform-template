// SVG グラフ部品(外部ライブラリなし)。すべて SVG 文字列を返す。
import { fmtNum, fmtYear } from "./analytics.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function niceTicks(min, max, n = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const step0 = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/**
 * 折れ線グラフ。lines: [{ name, color, points: [[y,v]...], dashed?, width? }]
 * forecast: [{ color, from:[y,v], to:[y,v] }] … 予測は点線
 * opts: { width, height, log, unit, decimals, yearMarks: [{year,label}] }
 */
export function lineChart(lines, opts = {}) {
  const W = opts.width || 520, H = opts.height || 220;
  const m = { l: 54, r: 14, t: 14, b: 26 };
  const all = lines.flatMap((l) => l.points).concat((opts.forecast || []).flatMap((f) => [f.from, f.to]));
  const pts = all.filter((p) => p && Number.isFinite(p[1]) && (!opts.log || p[1] > 0));
  if (!pts.length) return `<div class="empty">データがありません</div>`;
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const tr = (v) => (opts.log ? Math.log10(Math.max(v, 1e-9)) : v);
  let y0 = Math.min(...pts.map((p) => tr(p[1]))), y1 = Math.max(...pts.map((p) => tr(p[1])));
  if (!opts.log && y0 > 0 && y0 < (y1 - y0) * 1.5) y0 = 0;
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.06; y1 += pad; if (y0 !== 0 || opts.log) y0 -= pad;
  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((tr(v) - y0) / (y1 - y0)) * (H - m.t - m.b);
  const yt = opts.log
    ? niceTicks(y0, y1, 4).filter((t) => Number.isInteger(t)).map((t) => Math.pow(10, t))
    : niceTicks(y0, y1, 4);
  const xt = niceTicks(x0, x1, 5).filter((t) => Number.isInteger(t));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  for (const t of yt) {
    const y = Y(t);
    if (y < m.t - 1 || y > H - m.b + 1) continue;
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="grid"/><text x="${m.l - 6}" y="${y + 4}" class="axis" text-anchor="end">${fmtNum(t, opts.decimals ?? 1)}</text>`;
  }
  for (const t of xt) s += `<text x="${X(t)}" y="${H - 8}" class="axis" text-anchor="middle">${t < 0 ? "前" + -t : t}</text>`;
  for (const mk of opts.yearMarks || []) {
    if (mk.year < x0 || mk.year > x1) continue;
    s += `<line x1="${X(mk.year)}" x2="${X(mk.year)}" y1="${m.t}" y2="${H - m.b}" class="mark"/><text x="${X(mk.year) + 3}" y="${m.t + 10}" class="axis mark-l">${esc(mk.label)}</text>`;
  }
  for (const f of opts.forecast || []) {
    if (!f.from || !f.to) continue;
    s += `<line x1="${X(f.from[0])}" y1="${Y(f.from[1])}" x2="${X(f.to[0])}" y2="${Y(f.to[1])}" stroke="${f.color}" stroke-width="2" stroke-dasharray="5 4"/><circle cx="${X(f.to[0])}" cy="${Y(f.to[1])}" r="3.5" fill="#fff" stroke="${f.color}" stroke-width="2"><title>${f.to[0]}年の予測: ${fmtNum(f.to[1], opts.decimals ?? 1)}</title></circle>`;
  }
  for (const l of lines) {
    const p = l.points.filter((q) => Number.isFinite(q[1]) && (!opts.log || q[1] > 0));
    if (!p.length) continue;
    const d = p.map((q, i) => `${i ? "L" : "M"}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join("");
    s += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.width || 2.2}" ${l.dashed ? 'stroke-dasharray="3 3"' : ""} stroke-linejoin="round"/>`;
    const last = p[p.length - 1];
    s += `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="3" fill="${l.color}"><title>${esc(l.name)} ${fmtYear(last[0])}: ${fmtNum(last[1], opts.decimals ?? 1)}</title></circle>`;
  }
  s += `</svg>`;
  const legend = lines.length > 1 || (opts.forecast || []).length
    ? `<div class="legend-row">${lines.map((l) => `<span><i style="background:${l.color}${l.dashed ? ";opacity:.6" : ""}"></i>${esc(l.name)}</span>`).join("")}${(opts.forecast || []).length ? `<span><i class="dash"></i>予測(点線)</span>` : ""}</div>`
    : "";
  return s + legend;
}

/** 小さな推移線(カード用) */
export function sparkline(points, color = "#1c7ed6", w = 90, h = 26) {
  const p = (points || []).filter((q) => Number.isFinite(q[1]));
  if (p.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const x0 = p[0][0], x1 = p[p.length - 1][0];
  const v0 = Math.min(...p.map((q) => q[1])), v1 = Math.max(...p.map((q) => q[1]));
  const X = (x) => 2 + ((x - x0) / (x1 - x0 || 1)) * (w - 4);
  const Y = (v) => h - 3 - ((v - v0) / (v1 - v0 || 1)) * (h - 6);
  const d = p.map((q, i) => `${i ? "L" : "M"}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join("");
  return `<svg width="${w}" height="${h}" class="spark"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8"/><circle cx="${X(p[p.length - 1][0])}" cy="${Y(p[p.length - 1][1])}" r="2.4" fill="${color}"/></svg>`;
}

/** レーダー。axes: [{label, color}], series: [{name, color, values:[0..100|null]}] */
export function radar(axes, series, size = 280) {
  const c = size / 2, R = size / 2 - 46, n = axes.length;
  const ang = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const P = (i, r) => [c + Math.cos(ang(i)) * r, c + Math.sin(ang(i)) * r];
  let s = `<svg class="chart radar" viewBox="0 0 ${size} ${size}">`;
  for (const k of [0.25, 0.5, 0.75, 1]) {
    s += `<polygon points="${axes.map((_, i) => P(i, R * k).join(",")).join(" ")}" class="grid" fill="none"/>`;
  }
  axes.forEach((a, i) => {
    const [x, y] = P(i, R);
    const [lx, ly] = P(i, R + 20);
    s += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" class="grid"/><text x="${lx}" y="${ly + 4}" text-anchor="middle" class="axis" style="font-size:10.5px">${esc(a.label)}</text>`;
  });
  // 世界の真ん中(50)ライン
  s += `<polygon points="${axes.map((_, i) => P(i, R * 0.5).join(",")).join(" ")}" fill="none" stroke="#adb5bd" stroke-dasharray="4 3"/>`;
  for (const se of series) {
    const pts = se.values.map((v, i) => P(i, R * ((v ?? 0) / 100)).join(","));
    s += `<polygon points="${pts.join(" ")}" fill="${se.color}" fill-opacity=".18" stroke="${se.color}" stroke-width="2"/>`;
    se.values.forEach((v, i) => {
      if (v == null) return;
      const [x, y] = P(i, R * (v / 100));
      s += `<circle cx="${x}" cy="${y}" r="3" fill="${se.color}"><title>${esc(se.name)} ${esc(axes[i].label)}: ${v.toFixed(0)}</title></circle>`;
    });
  }
  return s + `</svg>`;
}

/**
 * 散布図(バブル)。dots: [{ id, x, y, r, color, label, highlight }]
 * opts: { xlog, ylog, xname, yname, width, height }
 */
export function scatter(dots, opts = {}) {
  const W = opts.width || 640, H = opts.height || 400;
  const m = { l: 56, r: 16, t: 14, b: 40 };
  const d = dots.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (!opts.xlog || p.x > 0) && (!opts.ylog || p.y > 0));
  if (!d.length) return `<div class="empty">データがありません</div>`;
  const tx = (v) => (opts.xlog ? Math.log10(v) : v), ty = (v) => (opts.ylog ? Math.log10(v) : v);
  let x0 = Math.min(...d.map((p) => tx(p.x))), x1 = Math.max(...d.map((p) => tx(p.x)));
  let y0 = Math.min(...d.map((p) => ty(p.y))), y1 = Math.max(...d.map((p) => ty(p.y)));
  const px = (x1 - x0) * 0.05 || 1, py = (y1 - y0) * 0.06 || 1;
  x0 -= px; x1 += px; y0 -= py; y1 += py;
  const X = (v) => m.l + ((tx(v) - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((ty(v) - y0) / (y1 - y0)) * (H - m.t - m.b);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;
  const ticks = (lo, hi, log) => (log ? niceTicks(lo, hi, 5).filter(Number.isInteger).map((t) => Math.pow(10, t)) : niceTicks(lo, hi, 5));
  for (const t of ticks(y0, y1, opts.ylog)) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" class="axis">${fmtNum(t, 1)}</text>`;
  for (const t of ticks(x0, x1, opts.xlog)) s += `<line y1="${m.t}" y2="${H - m.b}" x1="${X(t)}" x2="${X(t)}" class="grid"/><text x="${X(t)}" y="${H - m.b + 16}" text-anchor="middle" class="axis">${fmtNum(t, 1)}</text>`;
  s += `<text x="${(W + m.l) / 2}" y="${H - 4}" text-anchor="middle" class="axis-title">${esc(opts.xname)} →</text>`;
  s += `<text x="12" y="${(H - m.b) / 2}" text-anchor="middle" class="axis-title" transform="rotate(-90 12 ${(H - m.b) / 2})">${esc(opts.yname)} →</text>`;
  const sorted = [...d].sort((a, b) => (b.r || 4) - (a.r || 4) || (a.highlight ? 1 : -1));
  for (const p of sorted) {
    s += `<circle class="dot${p.highlight ? " hl" : ""}" data-id="${esc(p.id)}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${(p.r || 4).toFixed(1)}" fill="${p.color}"><title>${esc(p.label)}</title></circle>`;
    if (p.highlight || (p.r || 0) > 18) s += `<text x="${X(p.x)}" y="${Y(p.y) - (p.r || 4) - 3}" text-anchor="middle" class="dot-l">${esc(p.short || p.label)}</text>`;
  }
  return s + `</svg>`;
}

/** 横棒ランキング行。rows: [{ id, label, value, color, highlight, sub }], ref: 世界の値 */
export function barRows(rows, opts = {}) {
  const vals = rows.map((r) => r.value).filter(Number.isFinite);
  if (!vals.length) return `<div class="empty">データがありません</div>`;
  const tr = (v) => (opts.log ? Math.log10(Math.max(v, 1e-9)) : v);
  const lo = opts.log ? Math.min(...vals.filter((v) => v > 0).map(tr)) - 0.3 : Math.min(0, ...vals);
  const hi = Math.max(...vals.map(tr), opts.ref != null ? tr(opts.ref) : -Infinity);
  const pct = (v) => Math.max(0, Math.min(100, ((tr(v) - lo) / (hi - lo || 1)) * 100));
  const refPos = opts.ref != null && Number.isFinite(opts.ref) ? pct(opts.ref) : null;
  return rows.map((r, i) => `<div class="bar-row${r.highlight ? " hl" : ""}" data-id="${esc(r.id)}">
      <span class="bar-rank">${r.rank ?? i + 1}</span>
      <span class="bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="bar-track">${refPos != null ? `<i class="bar-ref" style="left:${refPos}%" title="世界全体"></i>` : ""}<i class="bar-fill" style="width:${pct(r.value)}%;background:${r.color}"></i></span>
      <span class="bar-val">${fmtNum(r.value, opts.decimals ?? 1)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span>
    </div>`).join("");
}
