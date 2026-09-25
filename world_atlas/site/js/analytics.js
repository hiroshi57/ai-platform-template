// 図鑑の計算ロジック(DOM に依存しない純粋関数)。node --test でテストする。

/** series: [[year, value], ...](年昇順)から year 以前で最も新しい点を返す(maxGap 年以内) */
export function valueAt(series, year, maxGap = 10) {
  if (!series || !series.length) return null;
  let best = null;
  for (const p of series) {
    if (p[0] <= year) best = p;
    else break;
  }
  if (!best || year - best[0] > maxGap) return null;
  return best;
}

export function latestPoint(series) {
  return series && series.length ? series[series.length - 1] : null;
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function mean(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/**
 * 指定年のスナップショット { iso3: [year, value] } を作る。
 * year を省略すると各国の最新値。
 */
export function snapshot(seriesData, year = null, maxGap = 10) {
  const out = {};
  if (!seriesData) return out;
  for (const [iso3, c] of Object.entries(seriesData.countries)) {
    const p = year == null ? latestPoint(c.s) : valueAt(c.s, year, maxGap);
    if (p) out[iso3] = p;
  }
  return out;
}

/**
 * 順位とパーセンタイル。
 * better="high" … 大きいほど1位 / "low" … 小さいほど1位 / null … 大きい順(良し悪しなし)
 * 戻り値: { rank, n, goodness } goodness は 0〜1(1が最も望ましい。better=null のときは「大きさ」)
 */
export function rankOf(iso3, snap, better) {
  const entries = Object.entries(snap).filter(([, p]) => Number.isFinite(p[1]));
  const me = snap[iso3];
  if (!me) return null;
  const desc = better !== "low";
  entries.sort((a, b) => (desc ? b[1][1] - a[1][1] : a[1][1] - b[1][1]));
  const n = entries.length;
  // 同値は同順位
  let rank = 1;
  for (const [, p] of entries) {
    if (desc ? p[1] > me[1] : p[1] < me[1]) rank++;
  }
  const goodness = n > 1 ? (n - rank) / (n - 1) : 1;
  return { rank, n, goodness };
}

/** goodness(0〜1)→ S〜D。Python 側 analytics.rate_label と同じ閾値 */
export function rateLabel(p) {
  if (p == null) return null;
  if (p >= 0.9) return "S";
  if (p >= 0.7) return "A";
  if (p >= 0.4) return "B";
  if (p >= 0.15) return "C";
  return "D";
}

export const RATE_TEXT = { S: "とても良い", A: "良い", B: "ふつう", C: "課題あり", D: "大きな課題" };

/** 直近 window 年の変化。{ from, to, change, pct, dir } dir: up / flat / down */
export function trend(series, window = 10) {
  if (!series || series.length < 2) return null;
  const last = series[series.length - 1];
  let first = series[0];
  for (const p of series) {
    if (p[0] >= last[0] - window) { first = p; break; }
  }
  if (first === last) return null;
  const change = last[1] - first[1];
  const base = Math.abs(first[1]) > 1e-9 ? Math.abs(first[1]) : null;
  const pct = base ? (change / base) * 100 : null;
  const rel = pct == null ? change : pct;
  const dir = Math.abs(rel) < 2 ? "flat" : rel > 0 ? "up" : "down";
  return { from: first, to: last, change, pct, dir };
}

/** 望ましさ方向を考慮した「改善/悪化」 */
export function trendMeaning(tr, better) {
  if (!tr || !better || tr.dir === "flat") return tr && tr.dir === "flat" ? "横ばい" : null;
  const improving = (tr.dir === "up") === (better === "high");
  return improving ? "改善" : "悪化";
}

/** 差分(%)。世界の値との比較 */
export function diffPct(value, ref) {
  if (!Number.isFinite(value) || !Number.isFinite(ref) || Math.abs(ref) < 1e-12) return null;
  return ((value - ref) / Math.abs(ref)) * 100;
}

/**
 * 章スコア: 章内の「良し悪しがある指標」の goodness 平均(0〜100)。
 * latest: { indId: { iso3: [year, value] } }, indicators: カタログの指標配列
 */
export function groupScore(iso3, indicators, latest) {
  const gs = [];
  for (const ind of indicators) {
    if (!ind.better || !latest[ind.id]) continue;
    const r = rankOf(iso3, latest[ind.id], ind.better);
    if (r && r.n >= 20) gs.push(r.goodness);
  }
  if (!gs.length) return null;
  return { score: (gs.reduce((a, b) => a + b, 0) / gs.length) * 100, n: gs.length };
}

/** 数値の日本語表記(億・万) */
export function fmtNum(v, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + "兆";
  if (a >= 1e8) return (v / 1e8).toFixed(a >= 1e10 ? 0 : 1) + "億";
  if (a >= 1e4 && decimals === 0) return (v / 1e4).toFixed(a >= 1e6 ? 0 : 1) + "万";
  return v.toLocaleString("ja-JP", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

/** 年の表記(紀元前対応) */
export function fmtYear(y) {
  if (y == null) return "—";
  return y < 0 ? `紀元前${-y}年` : `${y}年`;
}

/**
 * 分位点で色分けするための境界(bins 個の区間)を返す。
 * log=true なら対数空間で分割(人口や GDP のような桁が違う量向け)。
 */
export function quantileBreaks(values, bins = 7) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const out = [];
  for (let i = 1; i < bins; i++) {
    const q = (v.length - 1) * (i / bins);
    const lo = Math.floor(q), hi = Math.ceil(q);
    out.push(v[lo] + (v[hi] - v[lo]) * (q - lo));
  }
  return out;
}

export function binOf(value, breaks) {
  let i = 0;
  while (i < breaks.length && value > breaks[i]) i++;
  return i;
}

/**
 * 国の総評(中高生向けの文章)を作る。
 * rows: [{ ind, value, year, world, rank, n, label, meaning, forecast }]
 */
export function commentary(countryName, rows, chapterName) {
  const rated = rows.filter((r) => r.label && r.ind.better);
  if (!rows.length) return [`${countryName}の「${chapterName}」のデータはまだ集まっていません。`];
  const lines = [];
  const strong = rated.filter((r) => r.label === "S" || r.label === "A");
  const weak = rated.filter((r) => r.label === "C" || r.label === "D");
  if (strong.length) {
    lines.push(`【強み】${strong.slice(0, 3).map((r) => `${r.ind.name}(${r.n}か国中${r.rank}位)`).join("、")}は世界の中でも上位です。`);
  }
  if (weak.length) {
    lines.push(`【課題】${weak.slice(0, 3).map((r) => `${r.ind.name}(${r.n}か国中${r.rank}位)`).join("、")}は世界の中で下位にあり、改善の余地があります。`);
  }
  if (!strong.length && !weak.length && rated.length) {
    lines.push(`【全体】この章の指標は、世界の中でほぼ真ん中あたりです。`);
  }
  const better = rated.filter((r) => r.meaning === "改善").map((r) => r.ind.name);
  const worse = rated.filter((r) => r.meaning === "悪化").map((r) => r.ind.name);
  if (better.length) lines.push(`【この10年】${better.slice(0, 3).join("、")}は良くなっています。`);
  if (worse.length) lines.push(`【注意】${worse.slice(0, 3).join("、")}はこの10年で悪くなっています。原因を調べてみましょう。`);
  const neutral = rows.filter((r) => !r.ind.better && r.rank != null && r.n);
  for (const r of neutral.slice(0, 2)) {
    const pos = r.rank <= r.n * 0.1 ? "世界でもかなり大きい" : r.rank >= r.n * 0.9 ? "世界でもかなり小さい" : null;
    if (pos) lines.push(`【特徴】${r.ind.name}は${r.n}か国中${r.rank}位で、${pos}ほうです。`);
  }
  lines.push("【考えてみよう】日本やとなりの国とくらべると、どこが同じで、どこがちがうでしょうか。");
  return lines;
}

/** 全国の順位を一度に計算する。戻り値 { iso3: { rank, n, goodness } }(rankOf と同じ定義) */
export function rankAll(snap, better) {
  const entries = Object.entries(snap).filter(([, p]) => Number.isFinite(p[1]));
  const desc = better !== "low";
  entries.sort((a, b) => (desc ? b[1][1] - a[1][1] : a[1][1] - b[1][1]));
  const n = entries.length;
  const out = {};
  let rank = 1;
  entries.forEach(([iso3, p], i) => {
    if (i > 0 && p[1] !== entries[i - 1][1][1]) rank = i + 1;
    out[iso3] = { rank, n, goodness: n > 1 ? (n - rank) / (n - 1) : 1 };
  });
  return out;
}

/** ベクトル(null を含む)同士の距離。共通に値がある次元だけで平均二乗距離の平方根 */
export function vecDistance(a, b) {
  let s = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || b[i] == null) continue;
    s += (a[i] - b[i]) ** 2;
    k++;
  }
  return k >= 3 ? Math.sqrt(s / k) : null;
}
