// せかい3Dデジタル図鑑 — 画面本体
import * as A from "./analytics.js";
import { lineChart, sparkline, radar, scatter, barRows } from "./charts.js";
import { characterSVG, charactersFor } from "./characters.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- 状態
const D = { catalog: null, countries: {}, latest: {}, meta: {}, geo: null, timeline: null, series: {} };
const S = {
  mode: "globe", cat: "people", ind: "population", yearIdx: null, height: true,
  country: null, compare: [], dexTab: "chapter",
  rankRegion: "all", rankOrder: "top",
  groupBy: "region", sx: "gdp_pc", sy: "life_exp",
  tlCats: null, tlEvent: null, sdgGoal: 3, highlight: null,
};
const RATE_COLOR = { S: "#2b8a3e", A: "#5c940d", B: "#e8a200", C: "#e8590c", D: "#c92a2a" };
// 色覚の多様性に配慮した配色(ColorBrewer RdYlBu / YlGnBu)
const PAL_GOOD = ["#d73027", "#f46d43", "#fdae61", "#fee090", "#abd9e9", "#74add1", "#4575b4"]; // 悪い→良い
const PAL_SIZE = ["#ffffcc", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#0c2c84"]; // 小→大
const REGION_COLOR = { EAS: "#e8590c", ECS: "#1c7ed6", LCN: "#2f9e44", MEA: "#f59f00", NAC: "#7048e8", SAS: "#d6336c", SSF: "#0c8599" };
const NO_DATA = "rgba(190,196,210,0.45)";

// ---------------------------------------------------------------- データ
async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function loadSeries(id) {
  if (!id || id.startsWith("sdg:")) return null;
  if (!D.series[id]) D.series[id] = getJSON(`data/series/${id}.json`).catch(() => null);
  return D.series[id];
}
const IND = (id) => (id?.startsWith("sdg:") ? sdgVirtual(+id.slice(4)) : D.catalog.indicators.find((i) => i.id === id));
const CAT = (id) => D.catalog.categories.find((c) => c.id === id);
const indsOf = (cat) => D.catalog.indicators.filter((i) => i.category === cat);
const cname = (iso3) => D.countries[iso3]?.name_ja || iso3;
const flag = (iso3, w = 40) => {
  const c = D.countries[iso3];
  return c?.iso2 && /^[A-Z]{2}$/.test(c.iso2) ? `https://flagcdn.com/w${w <= 40 ? 40 : 160}/${c.iso2.toLowerCase()}.png` : "";
};
const unitOf = (ind) => (ind.unit ? ` ${ind.unit}` : "");
const fmtV = (ind, v) => A.fmtNum(v, ind.decimals ?? 1);

// 最新値スナップショット・順位(キャッシュ)
const _snapLatest = {}, _ranks = {};
function latestSnap(id) {
  if (id.startsWith("sdg:")) return sdgSnap(+id.slice(4));
  if (!_snapLatest[id]) {
    const L = D.latest[id]?.c || {};
    _snapLatest[id] = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, [v[0], v[1]]]));
  }
  return _snapLatest[id];
}
function ranksLatest(id) {
  if (!_ranks[id]) _ranks[id] = A.rankAll(latestSnap(id), IND(id)?.better ?? null);
  return _ranks[id];
}

// ---- 章スコア・SDGs スコア(良し悪しのある指標の順位パーセンタイル平均)
function scoreFor(iso3, inds) {
  const gs = [];
  for (const ind of inds) {
    if (!ind.better || !D.latest[ind.id]) continue;
    const r = ranksLatest(ind.id)[iso3];
    if (r && r.n >= 20) gs.push(r.goodness);
  }
  return gs.length ? (gs.reduce((a, b) => a + b, 0) / gs.length) * 100 : null;
}
const _sdgSnap = {};
function sdgInds(n) { return D.catalog.indicators.filter((i) => i.sdg.includes(n) && i.better); }
function sdgSnap(n) {
  if (!_sdgSnap[n]) {
    const out = {};
    const inds = sdgInds(n);
    for (const iso3 of Object.keys(D.countries)) {
      const s = scoreFor(iso3, inds);
      if (s != null) out[iso3] = [null, s];
    }
    _sdgSnap[n] = out;
  }
  return _sdgSnap[n];
}
function sdgVirtual(n) {
  const g = D.catalog.sdg_goals.find((x) => x.n === n);
  return { id: `sdg:${n}`, name: `SDGs 目標${n}「${g.name}」のスコア`, unit: "点", better: "high", decimals: 0, scale: "linear", category: "sdg",
    explain: `目標${n}に関係する指標(${sdgInds(n).map((i) => i.name).join("・")})で、各国が世界の中でどのあたりにいるかを0〜100点にしたもの(50点が真ん中)。`, sdg: [n], org: "本図鑑で計算", forecast: false };
}

// ---------------------------------------------------------------- 年スライダー
let yearStops = [];
function gapFor(y) { return y < 0 ? 3000 : y < 1500 ? 300 : y < 1800 ? 60 : y < 1950 ? 15 : 6; }
async function setupYears() {
  const ser = await loadSeries(S.ind);
  const slider = $("#year");
  if (!ser) { yearStops = []; $("#globe-ctrl").classList.add("no-year"); slider.disabled = true; $("#year-label").textContent = "最新"; $("#play").disabled = true; return; }
  const ys = new Set();
  for (const c of Object.values(ser.countries)) for (const p of c.s) ys.add(p[0]);
  yearStops = [...ys].sort((a, b) => a - b);
  slider.disabled = false; $("#play").disabled = false;
  slider.min = 0; slider.max = yearStops.length; // 最後の1つ = 「最新」
  if (S.yearIdx == null || S.yearIdx > yearStops.length) S.yearIdx = yearStops.length;
  slider.value = S.yearIdx;
  $("#year-label").textContent = yearLabel();
}
const curYear = () => (S.yearIdx == null || S.yearIdx >= yearStops.length ? null : yearStops[S.yearIdx]);
const yearLabel = () => (curYear() == null ? "最新" : A.fmtYear(curYear()));

async function currentSnap() {
  const y = curYear();
  if (y == null) return latestSnap(S.ind);
  const ser = await loadSeries(S.ind);
  return A.snapshot(ser, y, gapFor(y));
}

// ---------------------------------------------------------------- 色分け
function colorizer(snap, ind) {
  const vals = Object.values(snap).map((p) => p[1]).filter(Number.isFinite);
  const log = ind.scale === "log";
  const tv = (v) => (log ? Math.log10(Math.max(v, 1e-9)) : v);
  const breaks = A.quantileBreaks(vals.filter((v) => !log || v > 0).map(tv), 7);
  const pal = ind.better === "low" ? [...PAL_GOOD].reverse() : ind.better === "high" ? PAL_GOOD : PAL_SIZE;
  const color = (v) => (Number.isFinite(v) ? pal[A.binOf(tv(v), breaks)] : NO_DATA);
  const q = (v) => (Number.isFinite(v) ? A.binOf(tv(v), breaks) / 6 : 0);
  const raw = breaks.map((b) => (log ? Math.pow(10, b) : b));
  return { color, q, pal, breaks: raw };
}

// ---------------------------------------------------------------- 地球儀
let globe = null, geoFeatures = [], pointCountries = [], colorFn = null, snapNow = {};
function initGlobe() {
  const el = $("#globe");
  globe = Globe()(el)
    .globeImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg")
    .bumpImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png")
    .backgroundImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png")
    .atmosphereColor("#9ecbff").atmosphereAltitude(0.18)
    .polygonsData(geoFeatures)
    .polygonSideColor(() => "rgba(20,30,60,0.35)")
    .polygonStrokeColor(() => "rgba(20,20,30,0.6)")
    .polygonsTransitionDuration(450)
    .polygonLabel((f) => tipHTML(f.properties.iso3))
    .onPolygonClick((f) => f.properties.iso3 && selectCountry(f.properties.iso3, { fly: false }))
    .onPolygonHover((f) => { el.style.cursor = f?.properties.iso3 ? "pointer" : "grab"; })
    .pointsData(pointCountries)
    .pointLat((c) => c.lat).pointLng((c) => c.lng).pointRadius(0.45)
    .pointLabel((c) => tipHTML(c.iso3))
    .onPointClick((c) => selectCountry(c.iso3, { fly: false }));
  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.35;
  globe.pointOfView({ lat: 25, lng: 135, altitude: 2.3 });
  el.addEventListener("pointerdown", () => { globe.controls().autoRotate = false; $("#rotate").checked = false; });
  new ResizeObserver(() => sizeGlobe()).observe($("#globe-wrap"));
  sizeGlobe();
}
function sizeGlobe() {
  if (!globe) return;
  const w = $("#globe-wrap");
  globe.width(w.clientWidth).height(w.clientHeight);
}
function tipHTML(iso3) {
  if (!iso3 || !D.countries[iso3]) return "";
  const ind = IND(S.ind);
  const p = snapNow[iso3];
  const r = p ? A.rankAll(snapNow, ind.better)[iso3] : null;
  const f = flag(iso3);
  const hl = S.mode === "timeline" && S.highlight?.has(iso3) ? `<div>📜 この出来事に関係する国</div>` : "";
  return `<div class="tip"><b>${f ? `<img src="${f}">` : ""}${esc(cname(iso3))}</b>${hl}<div>${esc(ind.name)}</div>
    <div class="v">${p ? `${fmtV(ind, p[1])}${esc(unitOf(ind))}` : "データなし"}</div>
    ${p && p[0] != null ? `<small>${A.fmtYear(p[0])}のデータ</small>` : ""}${r ? `<div>${r.n}か国中 <b>${r.rank}位</b></div>` : ""}</div>`;
}
async function paintGlobe() {
  if (!globe) return;
  const ind = IND(S.ind);
  snapNow = await currentSnap();
  const cz = colorizer(snapNow, ind);
  colorFn = cz.color;
  const tl = S.mode === "timeline" && S.highlight;
  const tlColor = "#ffd43b";
  globe
    .polygonCapColor((f) => {
      const iso = f.properties.iso3;
      if (tl) return S.highlight.has(iso) ? tlColor : "rgba(210,215,228,0.5)";
      return iso && snapNow[iso] ? cz.color(snapNow[iso][1]) : NO_DATA;
    })
    .polygonAltitude((f) => {
      const iso = f.properties.iso3;
      if (tl) return S.highlight.has(iso) ? 0.09 : 0.006;
      const base = S.height && iso && snapNow[iso] ? 0.008 + cz.q(snapNow[iso][1]) * 0.16 : 0.008;
      return iso === S.country ? base + 0.06 : base;
    })
    .pointColor((c) => (tl ? (S.highlight.has(c.iso3) ? tlColor : "rgba(230,232,238,.6)") : snapNow[c.iso3] ? cz.color(snapNow[c.iso3][1]) : NO_DATA))
    .pointAltitude((c) => (tl ? (S.highlight.has(c.iso3) ? 0.09 : 0.01) : S.height && snapNow[c.iso3] ? 0.01 + cz.q(snapNow[c.iso3][1]) * 0.16 : 0.01));
  // 年表モード: 関係国に波紋(rings)と、地球儀の上に立つキャラクター(3D の HTML 要素)
  const tlc = tl ? [...S.highlight].map((k) => D.countries[k]).filter((c) => c?.lat != null)
    : S.country && D.countries[S.country]?.lat != null ? [D.countries[S.country]] : [];
  globe
    .ringsData(tlc).ringLat((c) => c.lat).ringLng((c) => c.lng)
    .ringColor(() => (t) => `rgba(250,176,5,${Math.max(0, 1 - t)})`).ringMaxRadius(7).ringPropagationSpeed(2.5).ringRepeatPeriod(1100)
    .htmlElementsData(tlc.map((c, i) => ({ c, i })))
    .htmlLat((d) => d.c.lat).htmlLng((d) => d.c.lng).htmlAltitude(tl ? 0.1 : 0.2)
    .htmlElement((d) => {
      const el = document.createElement("div");
      el.className = "globe-chara";
      const people = tl && d.i === 0 && S.tlEvent?.p?.length ? S.tlEvent.p.slice(0, 2).map((p) => characterSVG(p, 46)).join("") : "";
      const v = !tl && snapNow[d.c.iso3] ? `<b>${fmtV(ind, snapNow[d.c.iso3][1])}${esc(unitOf(ind))}</b>` : "";
      el.innerHTML = `${people}<span>${tl ? "" : "📍"}${esc(cname(d.c.iso3))}${v ? " " + v : ""}</span>`;
      el.style.pointerEvents = "auto";
      el.onclick = () => selectCountry(d.c.iso3);
      return el;
    });
  // タイトル・凡例
  const cat = CAT(ind.category);
  $("#globe-title").innerHTML = tl && S.tlEvent
    ? `<div class="t">📜 ${esc(A.fmtYear(S.tlEvent.y))} ${esc(S.tlEvent.t)}</div><div class="s">光っている国がこの出来事に関係する国です</div>`
    : `<div class="t">${cat ? cat.icon : "🎯"} ${esc(ind.name)}</div><div class="s">${esc(yearLabel())}${curYear() == null ? "(各国の最新データ)" : ""}・${Object.keys(snapNow).length}か国のデータ${ind.unit ? `・単位 ${esc(ind.unit)}` : ""}</div>`;
  const lbl = ind.better === "high" ? ["課題が大きい", "良い"] : ind.better === "low" ? ["課題が大きい", "良い"] : ["小さい", "大きい"];
  const br = cz.breaks;
  $("#legend").innerHTML = tl ? "" : `<div>${esc(ind.name)}${ind.better ? "(青いほど望ましい)" : ""}</div>
    <div class="legend-bar">${cz.pal.map((c) => `<i style="background:${c}"></i>`).join("")}</div>
    <div class="legend-lbl"><span>${lbl[0]}</span><span>${br.length ? `${fmtV(ind, br[0])} … ${fmtV(ind, br[br.length - 1])}` : ""}</span><span>${lbl[1]}</span></div>
    <div class="legend-lbl"><span><i style="display:inline-block;width:10px;height:10px;background:${NO_DATA}"></i> データなし</span>${S.height ? "<span>高さ = 値の大きさの順位</span>" : ""}</div>`;
}

// ---------------------------------------------------------------- 章ナビ
function renderChapters() {
  const list = D.catalog.categories.map((c) => {
    const inds = indsOf(c.id);
    const open = c.id === S.cat;
    return `<button class="chap${open ? " on" : ""}" style="--c:${c.color}" data-cat="${c.id}"><span class="ic">${c.icon}</span>${esc(c.name)}<span class="n">${inds.length}</span></button>
      ${open ? `<div class="inds" style="--c:${c.color}">${inds.map((i) => `<button class="ind${i.id === S.ind ? " on" : ""}" data-ind="${i.id}">${esc(i.name)}<span class="sdg-dots">${i.sdg.slice(0, 2).map((n) => `<span class="sdg-dot" style="background:${D.catalog.sdg_goals[n - 1].color}" title="SDGs 目標${n}">${n}</span>`).join("")}</span></button>`).join("")}</div>` : ""}`;
  }).join("");
  $("#chapter-list").innerHTML = `<div class="muted" style="margin:0 0 6px 4px">📖 章をえらぶ</div>${list}`;
  renderIndBox();
}
function renderIndBox() {
  const ind = IND(S.ind);
  const w = D.latest[ind.id]?.w;
  $("#ind-box").innerHTML = `<h4>${esc(ind.name)}</h4><div>${esc(ind.explain)}</div>
    ${w ? `<div style="margin-top:6px">🌍 世界全体: <b>${fmtV(ind, w[1])}${esc(unitOf(ind))}</b> <small>(${w[0]}年)</small></div>` : ""}
    ${ind.sdg.length ? `<div style="margin-top:6px">${ind.sdg.map((n) => `<span class="sdg-dot" style="background:${D.catalog.sdg_goals[n - 1].color};width:auto;padding:0 5px">SDGs ${n}</span>`).join(" ")}</div>` : ""}
    <div class="src">出典: ${esc(ind.org || sourceName(ind.source))}</div>`;
}
function sourceName(s) {
  return { wb: "世界銀行 World Development Indicators(国連機関等のデータを集約)", unhcr: "UNHCR", undp: "UNDP 人間開発報告書", owid: "Our World in Data" }[s] || s;
}

// ---------------------------------------------------------------- 図鑑ページ(右)
async function renderDex() {
  const el = $("#dex");
  if (S.mode === "timeline") return renderEventDex();
  if (!S.country) return renderWorldDex();
  const c = D.countries[S.country];
  const f = flag(S.country, 160);
  el.innerHTML = `<div class="dex-head">${f ? `<img class="flag" src="${f}" alt="">` : ""}
      <div><h2>${esc(c.name_ja)}</h2><div class="en">${esc(c.name_en)}${c.capital ? `・首都 ${esc(c.capital)}` : ""}</div></div></div>
    <div class="chips"><span class="chip">🗺️ ${esc(c.region_ja)}</span><span class="chip">💴 ${esc(c.income_ja)}</span>
      <button class="chip" data-act="cmp-add">⚖️ くらべるに追加</button><button class="chip" data-act="world">🌍 世界全体を見る</button></div>
    <div class="tabs">${[["chapter", "この章"], ["overview", "全体像"], ["profile", "プロフィール"], ["history", "歴史"]].map(([k, l]) => `<button data-tab="${k}" class="${S.dexTab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="dex-body"><div class="empty">読み込み中…</div></div>`;
  const body = $("#dex-body");
  if (S.dexTab === "chapter") body.innerHTML = await dexChapter(S.country);
  else if (S.dexTab === "overview") body.innerHTML = dexOverview(S.country);
  else if (S.dexTab === "profile") body.innerHTML = dexProfile(S.country);
  else body.innerHTML = await dexHistory(S.country);
}

function rowFor(iso3, ind) {
  const L = D.latest[ind.id]?.c?.[iso3];
  if (!L) return null;
  const r = ranksLatest(ind.id)[iso3];
  const tr = L[2] !== L[0] ? A.trend([[L[2], L[3]], [L[0], L[1]]], 99) : null;
  return {
    ind, year: L[0], value: L[1], base: [L[2], L[3]], forecast: L[4], world: D.latest[ind.id]?.w,
    rank: r?.rank, n: r?.n, goodness: r?.goodness, label: ind.better && r && r.n >= 20 ? A.rateLabel(r.goodness) : null,
    tr, meaning: A.trendMeaning(tr, ind.better),
  };
}
function trendHTML(row) {
  if (!row.tr) return "";
  const arrow = row.tr.dir === "up" ? "↗" : row.tr.dir === "down" ? "↘" : "→";
  const cls = row.meaning === "改善" ? "up" : row.meaning === "悪化" ? "down" : "flat";
  return `<span class="${cls}">${arrow} ${row.tr.from[0]}年から${row.tr.pct != null ? `${row.tr.pct > 0 ? "+" : ""}${row.tr.pct.toFixed(0)}%` : ""}${row.meaning ? `(${row.meaning})` : ""}</span>`;
}
function diffHTML(row) {
  if (!row.world) return "";
  const d = A.diffPct(row.value, row.world[1]);
  if (d == null) return "";
  const good = row.ind.better ? (d > 0) === (row.ind.better === "high") : null;
  return `<span class="${good == null ? "" : good ? "pos" : "neg"}">世界全体比 ${d > 0 ? "+" : ""}${Math.abs(d) >= 1000 ? (d / 100).toFixed(0) + "倍" : d.toFixed(0) + "%"}</span>`;
}

async function dexChapter(iso3) {
  const cat = CAT(S.cat);
  const inds = indsOf(S.cat);
  const sers = await Promise.all(inds.map((i) => loadSeries(i.id)));
  const rows = inds.map((ind) => rowFor(iso3, ind)).filter(Boolean);
  const stats = inds.map((ind, k) => {
    const row = rowFor(iso3, ind);
    if (!row) return `<div class="stat"><div class="nm">${esc(ind.name)}</div><div class="val"><small>データなし</small></div></div>`;
    const s = sers[k]?.countries?.[iso3]?.s || [];
    return `<div class="stat${ind.id === S.ind ? " on" : ""}" data-ind="${ind.id}">
      <div class="nm">${row.label ? `<span class="rate ${row.label}" title="${A.RATE_TEXT[row.label]}">${row.label}</span> ` : ""}${esc(ind.name)}</div>
      <div class="val">${fmtV(ind, row.value)}<small>${esc(unitOf(ind))}</small></div>
      <div class="meta"><span>${A.fmtYear(row.year)}</span>${row.rank ? `<span>${row.n}か国中 <b>${row.rank}位</b></span>` : ""}${diffHTML(row)}${trendHTML(row)}
        ${row.forecast != null ? `<span>🔮 2030年予測 ${fmtV(ind, row.forecast)}</span>` : ""}<span style="margin-left:auto">${sparkline(s.slice(-30), cat.color)}</span></div></div>`;
  }).join("");
  // 選択中の指標の推移グラフ(国・地域の中央値・世界)
  const ind = IND(S.ind).category === S.cat ? IND(S.ind) : inds[0];
  const ser = sers[inds.indexOf(ind)];
  let chart = "";
  if (ser?.countries?.[iso3]) {
    const me = ser.countries[iso3];
    const region = D.countries[iso3].region;
    const regionSeries = regionMedianSeries(ser, region);
    const lines = [
      { name: cname(iso3), color: cat.color, points: me.s, width: 3 },
      { name: `${D.countries[iso3].region_ja}の中央値`, color: "#adb5bd", points: regionSeries, dashed: true },
    ];
    if (ser.world?.length) lines.push({ name: "世界全体", color: "#495057", points: ser.world });
    const fc = me.f && ind.forecast !== false ? [{ color: cat.color, from: me.s[me.s.length - 1], to: [me.f.year, me.f.value] }] : [];
    chart = `<h3>📈 ${esc(ind.name)}の移り変わり</h3>${lineChart(lines, { log: ind.scale === "log", decimals: ind.decimals, forecast: fc, height: 200 })}
      ${me.f ? `<div class="note">点線は過去${me.f.n}年の傾向をそのまま伸ばした場合の${me.f.year}年の見込み(決定係数 R²=${me.f.r2.toFixed(2)}。1に近いほど直線的な変化)。政策や出来事で大きく変わることがあります。</div>` : ""}`;
  }
  const score = scoreFor(iso3, inds);
  const lines = A.commentary(cname(iso3), rows, cat.name);
  return `<div class="kpis"><div class="kpi"><div class="l">${esc(cat.name)}の章スコア</div><div class="v">${score == null ? "—" : `${score.toFixed(0)}点`}</div>${score == null ? "<small>良し悪しで測らない章</small>" : ""}</div>
      <div class="kpi"><div class="l">評価</div><div class="v">${score == null ? "—" : `<span class="rate ${A.rateLabel(score / 100)}">${A.rateLabel(score / 100)}</span> ${A.RATE_TEXT[A.rateLabel(score / 100)]}`}</div></div>
      <div class="kpi"><div class="l">データのある指標</div><div class="v">${rows.length}/${inds.length}</div></div></div>
    <div class="comment">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
    ${stats}${chart}
    <div class="note">評価(S〜D)は、データのある国の中での順位(パーセンタイル)から決めています。S=上位10%、A=上位30%、B=真ん中、C=下位40〜15%、D=下位15%。良し悪しで測らない指標(面積・人口など)には付けていません。章スコアは「良し悪しのある指標」の順位の平均です(50点が世界の真ん中)。</div>`;
}
function regionMedianSeries(ser, region) {
  const byYear = {};
  for (const [iso3, c] of Object.entries(ser.countries)) {
    if (D.countries[iso3]?.region !== region) continue;
    for (const [y, v] of c.s) (byYear[y] ||= []).push(v);
  }
  return Object.entries(byYear).filter(([, v]) => v.length >= 3).map(([y, v]) => [+y, A.median(v)]).sort((a, b) => a[0] - b[0]);
}
function chapterScores(iso3) {
  return D.catalog.categories.map((c) => ({ cat: c, score: scoreFor(iso3, indsOf(c.id)) }));
}
function dexOverview(iso3) {
  const sc = chapterScores(iso3).filter((x) => indsOf(x.cat.id).some((i) => i.better));
  const ref = iso3 === "JPN" ? null : "JPN";
  const series = [{ name: cname(iso3), color: "#1c64d6", values: sc.map((x) => x.score) }];
  if (ref) series.push({ name: cname(ref), color: "#e8590c", values: sc.map((x) => scoreFor(ref, indsOf(x.cat.id))) });
  const sdg = D.catalog.sdg_goals.map((g) => ({ g, s: sdgSnap(g.n)[iso3]?.[1] }));
  const valid = sc.filter((x) => x.score != null).sort((a, b) => b.score - a.score);
  const best = valid.slice(0, 2).map((x) => x.cat.name), worst = valid.slice(-2).reverse().map((x) => x.cat.name);
  const sim = similarCountries(iso3, 6);
  return `<h3>🕸️ 章ごとのバランス(50点=世界の真ん中)</h3>
    ${radar(sc.map((x) => ({ label: x.cat.icon + x.cat.name.replace(/\(.*\)/, "") })), series, 300)}
    <div class="legend-row">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}<span><i class="dash"></i>世界の真ん中(50点)</span></div>
    <div class="comment"><p>【得意な分野】${esc(best.join("・") || "—")}</p><p>【課題のある分野】${esc(worst.join("・") || "—")}</p>
      <p>【考えてみよう】得意な分野と課題のある分野は、地理や歴史とどんな関係があるでしょうか。</p></div>
    ${sc.map((x) => `<div class="stat" data-cat="${x.cat.id}"><div class="nm">${x.cat.icon} ${esc(x.cat.name)}</div><div class="val">${x.score == null ? "<small>—</small>" : `${x.score.toFixed(0)}<small>点</small> <span class="rate ${A.rateLabel(x.score / 100)}">${A.rateLabel(x.score / 100)}</span>`}</div></div>`).join("")}
    <h3>🎯 SDGs 17目標のスコア</h3>
    <div class="sdg-mini">${sdg.map(({ g, s }) => `<div style="background:${g.color}" title="目標${g.n} ${esc(g.name)}">${g.n}<small>${s == null ? "—" : s.toFixed(0)}</small></div>`).join("")}</div>
    <h3>🧩 データが似ている国</h3>
    <div class="sim">${sim.map((s) => `<button class="chip" data-country="${s.iso3}">${esc(cname(s.iso3))}</button>`).join("") || "<small>計算できるデータが足りません</small>"}</div>
    <div class="note">「似ている国」は、章スコア(地理・人口…歴史)の組み合わせが近い国です。地図上で近いとは限りません。</div>`;
}
function scoreVector(iso3) { return D.catalog.categories.filter((c) => indsOf(c.id).some((i) => i.better)).map((c) => scoreFor(iso3, indsOf(c.id))); }
function similarCountries(iso3, k) {
  const me = scoreVector(iso3);
  return Object.keys(D.countries).filter((x) => x !== iso3).map((x) => ({ iso3: x, d: A.vecDistance(me, scoreVector(x)) }))
    .filter((x) => x.d != null).sort((a, b) => a.d - b.d).slice(0, k);
}
function dexProfile(iso3) {
  const c = D.countries[iso3];
  const fb = c.factbook || {};
  const w = c.wiki;
  const items = [
    ["📍 位置", fb.location], ["📐 広さのたとえ", fb.area_comparative], ["🌡️ 気候", fb.climate], ["⛰️ 地形", fb.terrain],
    ["🏔️ いちばん高い所", fb.highest_point], ["🌊 いちばん低い所", fb.lowest_point], ["⚠️ 自然災害", fb.natural_hazards],
    ["💎 天然資源", fb.natural_resources], ["🗣️ 言語", fb.languages], ["🙏 宗教", fb.religions], ["👪 民族", fb.ethnic_groups],
    ["🏛️ 政治のしくみ", fb.government_type], ["🎌 独立・建国", fb.independence], ["🎉 祝日", fb.national_holiday],
    ["🌾 農産物", fb.agricultural_products], ["🚢 主な輸出品", fb.exports_commodities], ["♻️ 環境問題", fb.environmental_issues],
  ].filter(([, v]) => v);
  return `${w ? `<h3>📖 どんな国?(Wikipedia 日本語版より)</h3><div class="wiki">${esc(w.extract)}</div><div class="note">出典: <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia「${esc(w.title)}」</a>(CC BY-SA 4.0)</div>` : ""}
    <h3>🗂️ 基本データ(CIA World Factbook)</h3>
    ${items.length ? `<dl class="fact">${items.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "<p class='muted'>この国・地域の Factbook データはありません。</p>"}
    <div class="note">Factbook の項目はアメリカ中央情報局(CIA)が公開している原文(英語)です。英語の授業の教材としても使えます。</div>`;
}
async function dexHistory(iso3) {
  const c = D.countries[iso3];
  const evs = D.timeline.events.filter((e) => e.c.includes(iso3));
  const longIds = ["pop_hist", "gdp_long", "life_long", "democracy"];
  const sers = await Promise.all(longIds.map(loadSeries));
  const charts = longIds.map((id, k) => {
    const ind = IND(id), me = sers[k]?.countries?.[iso3];
    if (!me) return "";
    return `<div class="card" style="margin-bottom:8px"><b>${esc(ind.name)}</b> <small>${esc(ind.org)}</small>
      ${lineChart([{ name: cname(iso3), color: "#862e9c", points: me.s, width: 2.5 }, ...(sers[k].world?.length ? [{ name: "世界全体", color: "#adb5bd", points: sers[k].world }] : [])],
        { log: ind.scale === "log", decimals: ind.decimals, height: 150, yearMarks: evs.filter((e) => e.y >= me.s[0][0]).slice(-3).map((e) => ({ year: e.y, label: e.t.slice(0, 8) })) })}</div>`;
  }).join("");
  return `<h3>📜 年表に登場する出来事(${evs.length}件)</h3>
    ${evs.length ? evs.map((e) => `<div class="tl-mini" data-event="${D.timeline.events.indexOf(e)}">${e.p?.length ? characterSVG(e.p[0], 34) : `<span style="font-size:22px">📌</span>`}<div><b>${A.fmtYear(e.y)}</b> ${esc(e.t)}</div></div>`).join("") : "<p class='muted'>この国が登場する出来事はまだ年表にありません。</p>"}
    <h3>⏳ 数百年のデータで見る歴史</h3>${charts || "<p class='muted'>長期データがありません。</p>"}
    ${c.factbook?.background ? `<h3>🗒️ 歴史の背景(CIA World Factbook・英語原文)</h3><div class="fact" style="white-space:pre-line">${esc(c.factbook.background)}</div>` : ""}`;
}

function worldCommentary(ind, snap) {
  const w = D.latest[ind.id]?.w;
  const ranks = A.rankAll(snap, ind.better);
  const order = Object.entries(ranks).sort((a, b) => a[1].rank - b[1].rank).map(([k]) => k);
  const lines = [];
  if (order.length) {
    lines.push(`【${ind.better === "low" ? "少ない(良い)" : "大きい"}国】${order.slice(0, 3).map(cname).join("、")}`);
    lines.push(`【${ind.better === "low" ? "多い(課題が大きい)" : "小さい"}国】${order.slice(-3).reverse().map(cname).join("、")}`);
  }
  const vals = Object.values(snap).map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b);
  if (vals.length > 10) {
    const ratio = vals[Math.floor(vals.length * 0.9)] / Math.max(vals[Math.floor(vals.length * 0.1)], 1e-9);
    if (Number.isFinite(ratio) && ratio > 3) lines.push(`【格差】上位10%の国と下位10%の国では、およそ${ratio >= 100 ? Math.round(ratio / 10) * 10 : ratio.toFixed(0)}倍の差があります。`);
  }
  if (ind.sdg.length) lines.push(`【SDGs】この指標は目標${ind.sdg.join("・")}に関係しています。`);
  lines.push("【考えてみよう】色の濃い国はどの地域に集まっていますか? 気候・歴史・経済と関係がありそうですか?");
  return { lines, order, w };
}
async function renderWorldDex() {
  const ind = IND(S.ind);
  const snap = latestSnap(S.ind);
  const { lines, order, w } = worldCommentary(ind, snap);
  const ser = await loadSeries(S.ind);
  const regionMed = Object.entries(D.countries).reduce((acc, [k, c]) => { if (snap[k]) (acc[c.region] ||= []).push(snap[k][1]); return acc; }, {});
  const regRows = Object.entries(regionMed).map(([r, v]) => ({ id: r, label: Object.values(D.countries).find((c) => c.region === r).region_ja, value: A.median(v), color: REGION_COLOR[r] })).sort((a, b) => b.value - a.value);
  const top = order.slice(0, 5), bottom = order.slice(-5).reverse();
  const med = A.median(Object.values(snap).map((p) => p[1]));
  $("#dex").innerHTML = `<h2>🌍 世界全体で見る</h2><p class="muted">国を地球儀でクリックすると、その国の図鑑ページが開きます。</p>
    <div class="kpis"><div class="kpi"><div class="l">世界全体</div><div class="v">${w ? fmtV(ind, w[1]) : "—"}</div><small>${w ? `${w[0]}年` : ""}</small></div>
      <div class="kpi"><div class="l">各国の中央値</div><div class="v">${fmtV(ind, med)}</div></div><div class="kpi"><div class="l">データのある国</div><div class="v">${Object.keys(snap).length}</div></div></div>
    <div class="comment">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
    ${ser?.world?.length ? `<h3>📈 世界全体の移り変わり</h3>${lineChart([{ name: "世界全体", color: "#1c64d6", points: ser.world, width: 3 }], { log: ind.scale === "log", decimals: ind.decimals, height: 170 })}` : ""}
    <h3>🗺️ 地域ごとの中央値</h3>${barRows(regRows, { decimals: ind.decimals, log: ind.scale === "log" })}
    <div class="grid2" style="margin-top:10px"><div><h3>🔝 上位5か国</h3>${top.map((k, i) => `<div class="tl-mini" data-country="${k}">${i + 1}. ${esc(cname(k))} <b style="margin-left:auto">${fmtV(ind, snap[k][1])}</b></div>`).join("")}</div>
      <div><h3>🔚 下位5か国</h3>${bottom.map((k) => `<div class="tl-mini" data-country="${k}">${esc(cname(k))} <b style="margin-left:auto">${fmtV(ind, snap[k][1])}</b></div>`).join("")}</div></div>
    <div class="note">「上位」は値が${ind.better === "low" ? "小さい(望ましい)" : "大きい"}順です。${esc(ind.org || sourceName(ind.source))}のデータ。</div>`;
}

// ---------------------------------------------------------------- ランキング
async function renderRank() {
  const ind = IND(S.ind);
  const snap = await currentSnap();
  const ranks = A.rankAll(snap, ind.better);
  let rows = Object.entries(ranks).map(([k, r]) => ({ id: k, rank: r.rank, label: cname(k), value: snap[k][1], highlight: k === S.country, sub: A.fmtYear(snap[k][0]) }))
    .filter((r) => S.rankRegion === "all" || D.countries[r.id]?.region === S.rankRegion)
    .sort((a, b) => a.rank - b.rank);
  if (S.rankOrder === "bottom") rows.reverse();
  const cz = colorizer(snap, ind);
  rows.forEach((r) => (r.color = cz.color(r.value)));
  const w = D.latest[ind.id]?.w;
  const regions = [...new Set(Object.values(D.countries).map((c) => c.region))];
  $("#view-rank").innerHTML = `<h2>🏆 ${esc(ind.name)} ランキング <small>${esc(yearLabel())}</small></h2><p class="muted">${esc(ind.explain)}</p>
    <div class="toolbar"><select id="rank-region"><option value="all">すべての地域</option>${regions.map((r) => `<option value="${r}" ${S.rankRegion === r ? "selected" : ""}>${esc(Object.values(D.countries).find((c) => c.region === r).region_ja)}</option>`).join("")}</select>
      <button class="tb ${S.rankOrder === "top" ? "on" : ""}" data-order="top">${ind.better === "low" ? "少ない順" : "大きい順"}</button><button class="tb ${S.rankOrder === "bottom" ? "on" : ""}" data-order="bottom">逆順</button>
      <span class="muted">黒い線 = 世界全体${w && curYear() == null ? `(${fmtV(ind, w[1])})` : ""}・${rows.length}か国</span></div>
    ${barRows(rows, { ref: curYear() == null ? w?.[1] : null, decimals: ind.decimals, log: ind.scale === "log" })}`;
}

// ---------------------------------------------------------------- くらべる
const CMP_COLORS = ["#1c64d6", "#e8590c", "#2f9e44", "#ae3ec9"];
async function renderCompare() {
  if (!S.compare.length) S.compare = [...new Set([S.country || "JPN", "USA", "CHN", "IND"])].slice(0, 4);
  const ind = IND(S.ind);
  const ser = await loadSeries(S.ind);
  const inds = indsOf(S.cat);
  const lines = S.compare.map((k, i) => ({ name: cname(k), color: CMP_COLORS[i], points: ser?.countries?.[k]?.s || [], width: 2.6 }));
  if (ser?.world?.length) lines.push({ name: "世界全体", color: "#868e96", points: ser.world, dashed: true });
  const fc = S.compare.map((k, i) => { const c = ser?.countries?.[k]; return c?.f ? { color: CMP_COLORS[i], from: c.s[c.s.length - 1], to: [c.f.year, c.f.value] } : null; }).filter(Boolean);
  const cats = D.catalog.categories.filter((c) => indsOf(c.id).some((i) => i.better));
  const table = inds.map((ii) => {
    const vals = S.compare.map((k) => rowFor(k, ii));
    const nums = vals.map((v) => v?.value).filter(Number.isFinite);
    const best = ii.better === "high" ? Math.max(...nums) : ii.better === "low" ? Math.min(...nums) : null;
    return `<tr><td>${esc(ii.name)}<br><small>${esc(ii.unit)}</small></td>${vals.map((v) => `<td class="${v && best != null && v.value === best && nums.length > 1 ? "best" : ""}">${v ? `${fmtV(ii, v.value)} ${v.label ? `<span class="rate ${v.label}">${v.label}</span>` : ""}<br><small>${v.n ? `${v.rank}/${v.n}位` : ""} ${v.year}</small>` : "—"}</td>`).join("")}<td><small>${D.latest[ii.id]?.w ? fmtV(ii, D.latest[ii.id].w[1]) : "—"}</small></td></tr>`;
  }).join("");
  const options = Object.entries(D.countries).sort((a, b) => a[1].name_ja.localeCompare(b[1].name_ja, "ja")).map(([k, c]) => `<option value="${k}">${esc(c.name_ja)}</option>`).join("");
  $("#view-compare").innerHTML = `<h2>⚖️ くらべる(最大4か国)</h2>
    <div class="toolbar">${S.compare.map((k, i) => `<button class="chip x" data-rm="${k}" style="background:${CMP_COLORS[i]};color:#fff">${esc(cname(k))}</button>`).join("")}
      ${S.compare.length < 4 ? `<select id="cmp-add"><option value="">+ 国を追加</option>${options}</select>` : ""}<span class="muted">左の章・指標を変えると、グラフと表が切りかわります</span></div>
    <div class="grid2"><div class="card"><b>📈 ${esc(ind.name)}の移り変わり</b>${lineChart(lines, { log: ind.scale === "log", decimals: ind.decimals, forecast: fc, height: 240 })}</div>
      <div class="card"><b>🕸️ 章ごとのバランス</b>${radar(cats.map((c) => ({ label: c.icon + c.name.replace(/\(.*\)/, "") })), S.compare.map((k, i) => ({ name: cname(k), color: CMP_COLORS[i], values: cats.map((c) => scoreFor(k, indsOf(c.id))) })), 300)}</div></div>
    <h3>📋 「${esc(CAT(S.cat).name)}」の指標をくらべる</h3>
    <table class="cmp"><thead><tr><th>指標</th>${S.compare.map((k, i) => `<th style="color:${CMP_COLORS[i]}">${esc(cname(k))}</th>`).join("")}<th>世界全体</th></tr></thead><tbody>${table}</tbody></table>
    <div class="comment">${compareComment(inds)}</div>`;
}
function compareComment(inds) {
  const out = [];
  for (const ii of inds.filter((x) => x.better)) {
    const vals = S.compare.map((k) => ({ k, r: rowFor(k, ii) })).filter((x) => x.r);
    if (vals.length < 2) continue;
    vals.sort((a, b) => b.r.goodness - a.r.goodness);
    out.push(`${ii.name}は${cname(vals[0].k)}がいちばん${ii.better === "low" ? "少なく(良く)" : "高く"}、${cname(vals[vals.length - 1].k)}がいちばん課題が大きい。`);
    if (out.length >= 3) break;
  }
  out.push("【考えてみよう】ちがいが生まれる理由を、地理(気候・資源)や歴史(植民地・戦争)から考えてみましょう。");
  return out.map((l) => `<p>${esc(l)}</p>`).join("");
}

// ---------------------------------------------------------------- 分類
async function renderClassify() {
  const ind = IND(S.ind);
  const snap = latestSnap(S.ind);
  const groups = {};
  for (const [k, p] of Object.entries(snap)) {
    const c = D.countries[k]; if (!c) continue;
    const g = S.groupBy === "region" ? c.region_ja : c.income_ja;
    (groups[g] ||= []).push({ k, v: p[1] });
  }
  const log = ind.scale === "log";
  const all = Object.values(snap).map((p) => p[1]).filter((v) => Number.isFinite(v) && (!log || v > 0));
  const tv = (v) => (log ? Math.log10(Math.max(v, 1e-9)) : v);
  const lo = Math.min(...all.map(tv)), hi = Math.max(...all.map(tv));
  const X = (v) => 4 + ((tv(v) - lo) / (hi - lo || 1)) * 92;
  const cz = colorizer(snap, ind);
  const strips = Object.entries(groups).map(([g, arr]) => ({ g, arr, med: A.median(arr.map((a) => a.v)) }))
    .sort((a, b) => (ind.better === "low" ? a.med - b.med : b.med - a.med))
    .map(({ g, arr, med }) => `<div class="strip"><b>${esc(g)} <small>(${arr.length})</small></b>
      <div class="strip-track">${arr.map((a) => `<i class="sdot${a.k === S.country ? " me" : ""}" data-id="${a.k}" style="left:${X(a.v)}%;background:${cz.color(a.v)}" title="${esc(cname(a.k))}: ${esc(fmtV(ind, a.v))}"></i>`).join("")}
        <i class="smed" style="left:${X(med)}%"></i></div>
      <span>中央値 <b>${fmtV(ind, med)}</b></span></div>`).join("");
  const opts = (sel) => D.catalog.categories.map((c) => `<optgroup label="${c.icon} ${esc(c.name)}">${indsOf(c.id).map((i) => `<option value="${i.id}" ${i.id === sel ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</optgroup>`).join("");
  const sx = IND(S.sx), sy = IND(S.sy), pop = latestSnap("population");
  const sxs = latestSnap(S.sx), sys = latestSnap(S.sy);
  const dots = Object.keys(D.countries).filter((k) => sxs[k] && sys[k]).map((k) => ({
    id: k, x: sxs[k][1], y: sys[k][1], r: Math.max(2.5, Math.sqrt((pop[k]?.[1] || 1e6) / 1e6) * 1.05), color: REGION_COLOR[D.countries[k].region] || "#868e96",
    label: `${cname(k)}  ${sx.name}: ${fmtV(sx, sxs[k][1])} / ${sy.name}: ${fmtV(sy, sys[k][1])}`, short: cname(k), highlight: k === S.country || S.compare.includes(k),
  }));
  const regionLegend = Object.entries(REGION_COLOR).map(([r, c]) => `<span><i style="background:${c};height:10px;width:10px;border-radius:50%"></i>${esc(Object.values(D.countries).find((x) => x.region === r)?.region_ja || r)}</span>`).join("");
  $("#view-classify").innerHTML = `<h2>🧩 分類する — グループで分けて、2つの指標で並べる</h2>
    <h3>① ${esc(ind.name)}を${S.groupBy === "region" ? "地域" : "所得"}で分ける</h3>
    <div class="toolbar"><button class="tb ${S.groupBy === "region" ? "on" : ""}" data-group="region">地域で分ける</button><button class="tb ${S.groupBy === "income" ? "on" : ""}" data-group="income">所得で分ける</button><span class="muted">点=国、黒い線=グループの中央値。点を押すと国の図鑑が開きます</span></div>
    <div class="card">${strips}</div>
    <h3>② 2つの指標の関係(散布図・円の大きさ=人口)</h3>
    <div class="toolbar">横軸 <select id="sx">${opts(S.sx)}</select> 縦軸 <select id="sy">${opts(S.sy)}</select>
      <button class="tb" data-preset="gdp_pc,life_exp">豊かさと寿命</button><button class="tb" data-preset="gdp_pc,co2_pc">豊かさとCO₂</button><button class="tb" data-preset="tertiary,fertility">進学率と出生率</button><button class="tb" data-preset="forest,thr_mammal">森林と絶滅危惧種</button></div>
    <div class="card">${scatter(dots, { xlog: sx.scale === "log", ylog: sy.scale === "log", xname: `${sx.name}(${sx.unit})`, yname: `${sy.name}(${sy.unit})`, height: 430 })}<div class="legend-row">${regionLegend}</div></div>
    <div class="comment">${scatterComment(sx, sy, sxs, sys)}</div>`;
}
function scatterComment(sx, sy, xs, ys) {
  const ks = Object.keys(xs).filter((k) => ys[k] && (sx.scale !== "log" || xs[k][1] > 0) && (sy.scale !== "log" || ys[k][1] > 0));
  if (ks.length < 10) return "<p>データが少ないため、関係を読み取れません。</p>";
  const t = (v, ind) => (ind.scale === "log" ? Math.log10(v) : v);
  const X = ks.map((k) => t(xs[k][1], sx)), Y = ks.map((k) => t(ys[k][1], sy));
  const mx = A.mean(X), my = A.mean(Y);
  let sxy = 0, sxx = 0, syy = 0;
  X.forEach((x, i) => { sxy += (x - mx) * (Y[i] - my); sxx += (x - mx) ** 2; syy += (Y[i] - my) ** 2; });
  const r = sxy / Math.sqrt(sxx * syy);
  const strength = Math.abs(r) >= 0.7 ? "強い" : Math.abs(r) >= 0.4 ? "ある程度の" : Math.abs(r) >= 0.2 ? "弱い" : "ほとんどない";
  const dir = r > 0 ? "「一方が大きい国ほど、もう一方も大きい」" : "「一方が大きい国ほど、もう一方は小さい」";
  return `<p>【関係の強さ】${ks.length}か国で相関係数は <b>${r.toFixed(2)}</b>。${Math.abs(r) >= 0.2 ? `${dir}という${strength}関係があります。` : "関係はほとんど見られません。"}</p>
    <p>【注意】相関があっても、どちらかが原因とは限りません(第3の理由がかくれていることがあります)。</p><p>【考えてみよう】グラフから大きく外れている国はどこですか? なぜでしょう?</p>`;
}

// ---------------------------------------------------------------- ビジュアル年表
const TL_SEG = [[-10000, -3000, 260], [-3000, 0, 760], [0, 1000, 720], [1000, 1500, 620], [1500, 1800, 900], [1800, 1900, 1000], [1900, 1950, 900], [1950, 2030, 1350]];
const TL_W = TL_SEG.reduce((a, s) => a + s[2], 0) + 60;
function tlX(y) {
  let x = 30;
  for (const [a, b, w] of TL_SEG) {
    if (y <= b) return x + ((Math.max(y, a) - a) / (b - a)) * w;
    x += w;
  }
  return x;
}
const TL_CAT_COLOR = { politics: "#1c64d6", war: "#c92a2a", science: "#7048e8", biology: "#0ca678", environment: "#2f9e44", economy: "#f59f00", culture: "#d6336c" };
const catColor = (c) => TL_CAT_COLOR[c] || "#495057";
const ERA_COLOR = { ancient: "#8d6e63", medieval: "#5c7cfa", early_modern: "#20c997", modern: "#fd7e14", contemporary: "#e64980" };

async function renderTimeline() {
  const T = D.timeline;
  if (!S.tlCats) S.tlCats = new Set(Object.keys(T.categories));
  $("#tl-filters").innerHTML = Object.entries(T.categories).map(([k, v]) => `<button data-tlcat="${k}" class="${S.tlCats.has(k) ? "on" : ""}" style="--c:${catColor(k)}">${esc(v)}</button>`).join("");
  $("#tl-eras").innerHTML = T.eras.map((e) => `<button data-jump="${e.from}" style="background:${ERA_COLOR[e.id]}">${esc(e.name)} ${e.from < 0 ? `前${-e.from}` : e.from}〜</button>`).join("");
  const H = 470, cardW = 150, cardH = 74, top0 = 36, rowGap = 6;
  const evs = T.events.map((e, i) => ({ e, i })).filter(({ e }) => S.tlCats.has(e.cat));
  const rowsEnd = [];
  let html = "";
  // 時代の帯
  for (const era of T.eras) {
    const x0 = tlX(era.from), x1 = tlX(Math.min(era.to, 2030));
    html += `<div class="tl-band" style="left:${x0}px;width:${x1 - x0}px;background:${ERA_COLOR[era.id]}">${esc(era.name)}</div>`;
  }
  // 世界人口の山(pop_hist 世界)
  const pop = (await loadSeries("pop_hist"))?.world || [];
  if (pop.length) {
    const ph = 170, lmin = Math.log10(pop[0][1]), lmax = Math.log10(pop[pop.length - 1][1]);
    const Y = (v) => ph - ((Math.log10(v) - lmin) / (lmax - lmin)) * (ph - 10);
    const d = pop.map((p, i) => `${i ? "L" : "M"}${tlX(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    const last = pop[pop.length - 1];
    html += `<svg class="tl-pop" width="${TL_W}" height="${ph}"><path d="${d} L${tlX(last[0])},${ph} L${tlX(pop[0][0])},${ph} Z" fill="#e9d8a6" opacity=".55"/><path d="${d}" fill="none" stroke="#c9a227" stroke-width="2"/>
      <text x="${tlX(last[0]) - 6}" y="${Y(last[1]) - 6}" text-anchor="end" font-size="11" fill="#8a6d1a" font-weight="700">世界の人口 ${A.fmtNum(last[1], 0)}人</text>
      <text x="${tlX(pop[0][0]) + 6}" y="${Y(pop[0][1]) - 6}" font-size="11" fill="#8a6d1a">紀元前1万年 約${A.fmtNum(pop[0][1], 0)}人</text></svg>`;
  }
  // 目盛り
  const ticks = [-10000, -5000, -3000, -2000, -1000, -500, 1, 500, 1000, 1200, 1400, 1500, 1600, 1700, 1800, 1850, 1900, 1925, 1950, 1975, 2000, 2025];
  html += `<div class="tl-axis"></div>` + ticks.map((y) => `<div class="tl-tick" style="left:${tlX(y)}px">${y < 0 ? `前${-y}` : y}</div>`).join("");
  // カード(重ならない行に詰める)
  for (const { e, i } of evs) {
    const cx = tlX(e.y);
    const left = Math.max(4, cx - 20);
    let row = rowsEnd.findIndex((end) => left > end + 6);
    if (row === -1) { row = rowsEnd.length; rowsEnd.push(-1e9); }
    rowsEnd[row] = left + cardW;
    const top = top0 + row * (cardH + rowGap);
    if (top + cardH > H - 40) continue; // 表示しきれない分は省略(フィルタで絞れる)
    const col = catColor(e.cat);
    html += `<div class="tl-stem" style="left:${cx}px;top:${top + cardH}px;background:${col}"></div>
      <div class="tl-card${S.tlEvent === e ? " on" : ""}" data-event="${i}" style="left:${left}px;top:${top}px;--c:${col}" title="${esc(e.t)}">
        <div class="ch">${e.p?.length ? charactersFor({ p: e.p.slice(0, 2) }, 40) : `<span class="ico">${{ politics: "🏛️", war: "⚔️", science: "🔬", biology: "🧬", environment: "🌱", economy: "⚙️", culture: "🎨" }[e.cat] || "📌"}</span>`}</div>
        <div class="tx"><div class="yr">${A.fmtYear(e.y)}${e.approx ? "頃" : ""}${e.y2 ? `〜${e.y2}` : ""}</div><div class="tt">${esc(e.t)}</div></div></div>`;
  }
  const cv = $("#tl-canvas");
  cv.style.width = `${TL_W}px`;
  cv.style.height = `${H}px`;
  cv.innerHTML = html;
}
async function renderEventDex() {
  const e = S.tlEvent;
  const T = D.timeline;
  if (!e) {
    const people = T.events.filter((x) => x.p?.length).flatMap((x) => x.p.map((p) => ({ p, e: x })));
    $("#dex").innerHTML = `<h2>📜 ビジュアル年表</h2><p class="muted">年表のカードを押すと、ここに出来事の説明と登場人物が表示されます。</p>
      <div class="kpis"><div class="kpi"><div class="l">出来事</div><div class="v">${T.events.length}</div></div><div class="kpi"><div class="l">登場人物</div><div class="v">${people.length}</div></div><div class="kpi"><div class="l">時代</div><div class="v">${T.eras.length}</div></div></div>
      <h3>🧑‍🤝‍🧑 登場人物</h3><div style="display:flex;flex-wrap:wrap;gap:2px">${people.map(({ p, e: ev }) => `<button class="chip" style="padding:2px;background:none" data-event="${T.events.indexOf(ev)}" title="${esc(p.name)}">${characterSVG(p, 40)}</button>`).join("")}</div>
      <div class="note">${esc(T.character_note)}<br>${esc(T.note)}</div>`;
    return;
  }
  // そのころの世界(長期データの世界値)
  const [pop, life, gdp] = await Promise.all(["pop_hist", "life_long", "gdp_long"].map(loadSeries));
  const near = (ser) => (ser?.world?.length ? A.valueAt(ser.world, e.y, gapFor(e.y) * 3) : null);
  const wp = near(pop), wl = near(life), wg = near(gdp);
  $("#dex").innerHTML = `<div class="ev-hero">${e.p?.length ? e.p.map((p) => characterSVG(p, 118)).join("") : `<span style="font-size:80px">📌</span>`}</div>
    <div class="ev-year" style="color:${catColor(e.cat)}">${esc(T.categories[e.cat])}・${A.fmtYear(e.y)}${e.approx ? "頃" : ""}${e.y2 ? `〜${e.y2}年` : ""}</div>
    <h2>${esc(e.t)}</h2>
    ${e.p?.length ? `<div class="ev-people">${e.p.map((p) => `<div class="ev-person"><b>${esc(p.name)}</b> — ${esc(p.role)}</div>`).join("")}</div>` : ""}
    <p class="ev-desc">${esc(e.d)}</p>
    ${e.c.length ? `<h3>🌐 関係する国(地球儀で光っています)</h3><div class="chips">${e.c.filter((k) => D.countries[k]).map((k) => `<button class="chip" data-country="${k}">${esc(cname(k))}</button>`).join("")}</div>` : ""}
    <h3>⏳ そのころの世界(大学の長期推計)</h3>
    <div class="kpis"><div class="kpi"><div class="l">世界の人口</div><div class="v">${wp ? A.fmtNum(wp[1], 0) + "人" : "—"}</div><small>${wp ? A.fmtYear(wp[0]) : ""}</small></div>
      <div class="kpi"><div class="l">世界の平均寿命</div><div class="v">${wl ? wl[1].toFixed(0) + "歳" : "—"}</div><small>${wl ? A.fmtYear(wl[0]) : "推計なし"}</small></div>
      <div class="kpi"><div class="l">1人あたりGDP(世界)</div><div class="v">${wg ? A.fmtNum(wg[1], 0) : "—"}</div><small>${wg ? A.fmtYear(wg[0]) + "・国際ドル" : "推計なし"}</small></div></div>
    <div class="toolbar"><button class="tb" data-tlnav="-1">◀ 前の出来事</button><button class="tb" data-tlnav="1">次の出来事 ▶</button></div>
    <div class="note">${e.p?.some((p) => p.symbol) ? esc(e.p.find((p) => p.symbol).note) + "<br>" : ""}${esc(T.character_note)}</div>`;
}
async function selectEvent(idx) {
  const e = D.timeline.events[idx];
  if (!e) return;
  S.tlEvent = e;
  S.highlight = new Set(e.c);
  if (S.mode !== "timeline") setMode("timeline");
  await renderTimeline(); renderEventDex(); paintGlobe(); syncHash();
  const cc = e.c.map((k) => D.countries[k]).filter((c) => c?.lat != null);
  if (cc.length && globe) globe.pointOfView({ lat: A.mean(cc.map((c) => c.lat)), lng: A.mean(cc.map((c) => c.lng)), altitude: cc.length > 4 ? 2.2 : 1.7 }, 900);
  const sc = $("#tl-scroll");
  sc.scrollLeft = Math.max(0, tlX(e.y) - sc.clientWidth / 2);
}

// ---------------------------------------------------------------- SDGs
function renderSDG() {
  const G = D.catalog.sdg_goals;
  const iso3 = S.country;
  const g = G[S.sdgGoal - 1];
  const inds = D.catalog.indicators.filter((i) => i.sdg.includes(g.n));
  const snap = sdgSnap(g.n);
  const ranks = A.rankAll(snap, "high");
  const order = Object.keys(ranks).sort((a, b) => ranks[a].rank - ranks[b].rank);
  const rows = inds.map((ii) => {
    const w = D.latest[ii.id]?.w, r = iso3 ? rowFor(iso3, ii) : null;
    return `<tr><td><button class="chip" data-ind="${ii.id}">${esc(ii.name)}</button><br><small>${esc(ii.explain)}</small></td><td>${w ? `${fmtV(ii, w[1])}<br><small>${w[0]}年</small>` : "—"}</td>
      ${iso3 ? `<td>${r ? `${fmtV(ii, r.value)} ${r.label ? `<span class="rate ${r.label}">${r.label}</span>` : ""}<br><small>${r.n ? `${r.n}か国中${r.rank}位` : ""} ${trendHTML(r)}</small>` : "—"}</td>` : ""}</tr>`;
  }).join("");
  $("#view-sdg").innerHTML = `<h2>🎯 SDGs(持続可能な開発目標)17の目標</h2>
    <p class="muted">2015年に国連で決まった、2030年までに世界で達成をめざす17の目標です。${iso3 ? `タイルの数字は<b>${esc(cname(iso3))}</b>のスコア(0〜100点、50点=世界の真ん中)。` : "右上で国をえらぶと、国ごとのスコアが表示されます。"}</p>
    <div class="sdg-grid">${G.map((x) => { const s = iso3 ? sdgSnap(x.n)[iso3]?.[1] : null; return `<button class="sdg-tile${x.n === g.n ? " on" : ""}" data-goal="${x.n}" style="background:${x.color}"><div class="no">${x.n}</div><div class="nm">${esc(x.name)}</div>${s != null ? `<span class="sc">${s.toFixed(0)}</span>` : ""}</button>`; }).join("")}</div>
    <h3 style="color:${g.color}">目標${g.n}「${esc(g.name)}」</h3>
    <div class="toolbar"><button class="tb" data-globe-sdg="${g.n}">🌐 この目標のスコアを地球儀で見る</button><span class="muted">関係する指標 ${inds.length}個</span></div>
    <div class="grid2"><div class="card"><table class="cmp"><thead><tr><th>指標</th><th>世界全体</th>${iso3 ? `<th>${esc(cname(iso3))}</th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card"><b>🔝 スコア上位10か国</b>${barRows(order.slice(0, 10).map((k) => ({ id: k, label: cname(k), value: snap[k][1], color: g.color, rank: ranks[k].rank, highlight: k === iso3 })), { decimals: 0 })}
        <b style="display:block;margin-top:10px">🔚 スコア下位10か国</b>${barRows(order.slice(-10).reverse().map((k) => ({ id: k, label: cname(k), value: snap[k][1], color: "#adb5bd", rank: ranks[k].rank, highlight: k === iso3 })), { decimals: 0 })}</div></div>
    <div class="note">スコアは本図鑑独自の計算です(関係する指標で、データのある国の中での順位の平均)。国連の公式な達成度評価ではありません。公式の SDGs データは <a href="https://data.un.org/undatacommons/goals" target="_blank" rel="noopener">UN Data Commons</a> や <a href="https://unstats.un.org/sdgs/dataportal" target="_blank" rel="noopener">UN SDG Global Database</a> で確認できます。</div>`;
}

// ---------------------------------------------------------------- 出典
function renderSources() {
  const m = D.meta;
  const rows = D.catalog.indicators.map((i) => {
    const st = m.sources?.[`${i.source}:${i.code}`];
    return `<tr><td>${CAT(i.category).icon} ${esc(i.name)}</td><td>${esc(i.org || sourceName(i.source))}</td><td><code>${esc(i.code)}</code></td><td>${st?.years ? `${A.fmtYear(st.years[0])}〜${st.years[1]}` : ""}</td><td>${st?.count ?? ""}</td><td class="${st?.ok ? "ok" : "ng"}">${st?.ok ? "OK" : "失敗(前回データ)"}</td></tr>`;
  }).join("");
  const aux = ["factbook", "wiki", "geo"].map((k) => `<tr><td>${{ factbook: "CIA World Factbook(国の基本情報)", wiki: "Wikipedia 日本語版(国の概要)", geo: "Natural Earth(国境)" }[k]}</td><td class="${m.sources?.[k]?.ok ? "ok" : "ng"}">${m.sources?.[k]?.ok ? "OK" : "失敗"}</td><td>${m.sources?.[k]?.count ?? ""}</td></tr>`).join("");
  $("#view-sources").innerHTML = `<h2>📚 出典・データの更新・注意</h2>
    <p class="muted">最終更新: <b>${esc((m.generated_at || "").replace("T", " ").slice(0, 16))} (UTC)</b>・${m.ok}/${m.total} ソース取得成功。GitHub Actions で毎週自動更新します。取得に失敗したソースは前回のデータを使い続けます。</p>
    <h3>データを提供している機関</h3>
    <div class="grid3">
      <div class="card"><b>🇺🇳 国連・国際機関</b><p class="fact">UNDP(人間開発報告書)/ UNHCR(難民)/ 世界銀行(WHO・FAO・ILO・IEA・IUCN・SIPRI などのデータを集約)/ UN Data Commons・UN SDG Global Database(参照)</p></div>
      <div class="card"><b>🎓 世界の大学・研究機関</b><p class="fact">オックスフォード大学 Our World in Data / フローニンゲン大学 Maddison Project / ヨーテボリ大学 V-Dem 研究所 / ウプサラ大学 紛争データ計画(UCDP)</p></div>
      <div class="card"><b>🗂️ そのほか</b><p class="fact">CIA World Factbook(国の基本情報)/ Wikipedia 日本語版(CC BY-SA 4.0)/ Natural Earth(国境・パブリックドメイン)/ 国旗画像 flagcdn.com</p></div></div>
    <h3>付帯データ</h3><table class="src"><thead><tr><th>データ</th><th>状態</th><th>件数</th></tr></thead><tbody>${aux}</tbody></table>
    <h3>指標一覧(${D.catalog.indicators.length})</h3>
    <table class="src"><thead><tr><th>指標</th><th>出典</th><th>コード</th><th>期間</th><th>国数</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>⚠️ 使うときの注意</h3>
    <ul class="fact"><li>数値は各機関の公表値や推計です。国によって調べ方や年がちがうため、くらべるときは「何年のデータか」を確認しましょう。</li>
      <li>2030年の予測は、過去10年の傾向をそのまま伸ばした<b>参考値</b>です。実際には政策・災害・戦争などで大きく変わります。</li>
      <li>S〜Dの評価・章スコア・SDGsスコアは、本図鑑が順位から計算した<b>目安</b>で、国連などの公式評価ではありません。</li>
      <li>国境や国・地域の名前は、特定の立場を示すものではありません(データ提供元の区分に従っています)。</li>
      <li>年表の人物はオリジナルのデフォルメ・キャラクターで、実際の顔とは異なります。</li></ul>`;
}

// ---------------------------------------------------------------- 画面切りかえ
function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${mode}`));
  // 地球儀は「地球儀」「年表」で共有(DOM を移動)
  const wrap = $("#globe-wrap");
  if (mode === "timeline") $("#globe-slot-tl").appendChild(wrap);
  else $("#globe-slot-main").appendChild(wrap);
  $("#globe-ctrl").hidden = mode === "timeline";
  if (mode !== "timeline") S.highlight = null;
  requestAnimationFrame(sizeGlobe);
  renderAll();
}
async function renderAll() {
  renderChapters();
  const m = S.mode;
  if (m === "globe" || m === "timeline") await paintGlobe();
  if (m === "rank") await renderRank();
  if (m === "compare") await renderCompare();
  if (m === "classify") await renderClassify();
  if (m === "timeline") await renderTimeline();
  if (m === "sdg") renderSDG();
  if (m === "sources") renderSources();
  await renderDex();
  syncHash();
}
async function setIndicator(id) {
  S.ind = id;
  const ind = IND(id);
  if (ind.category && ind.category !== "sdg") S.cat = ind.category;
  S.yearIdx = null;
  stopPlay();
  await setupYears();
  if (S.mode === "sources" || S.mode === "sdg") S.mode = S.mode === "sdg" && id.startsWith("sdg:") ? "globe" : S.mode;
  if (id.startsWith("sdg:")) setMode("globe"); else renderAll();
}
function selectCountry(iso3, { fly = true } = {}) {
  if (!D.countries[iso3]) return;
  S.country = iso3;
  const c = D.countries[iso3];
  if (fly && globe && c.lat != null) globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 1.6 }, 900);
  if (S.mode === "timeline") { setMode("globe"); return; }
  renderAll();
}
function syncHash() {
  const h = new URLSearchParams({ m: S.mode, i: S.ind, ...(S.country ? { c: S.country } : {}),
    ...(S.mode === "timeline" && S.tlEvent ? { e: D.timeline.events.indexOf(S.tlEvent) } : {}) });
  history.replaceState(null, "", `#${h}`);
}

// ---------------------------------------------------------------- 再生
let playTimer = null;
function stopPlay() { clearInterval(playTimer); playTimer = null; $("#play").textContent = "▶"; }
function togglePlay() {
  if (playTimer) return stopPlay();
  if (!yearStops.length) return;
  if (S.yearIdx >= yearStops.length) S.yearIdx = 0;
  $("#play").textContent = "⏸";
  playTimer = setInterval(async () => {
    S.yearIdx++;
    if (S.yearIdx >= yearStops.length) { S.yearIdx = yearStops.length; stopPlay(); }
    $("#year").value = S.yearIdx;
    $("#year-label").textContent = yearLabel();
    await paintGlobe();
  }, IND(S.ind).category === "history" ? 180 : 420);
}

// ---------------------------------------------------------------- イベント
function bind() {
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("button, [data-event], [data-country], .stat, .bar-row, circle[data-id], .dot, .sdot");
    if (!t) return;
    const d = t.dataset;
    if (d.mode) return setMode(d.mode);
    if (d.cat && t.classList.contains("chap")) { S.cat = d.cat; return setIndicator(indsOf(d.cat)[0].id); }
    if (d.ind) return setIndicator(d.ind);
    if (d.cat && t.classList.contains("stat")) { S.cat = d.cat; S.dexTab = "chapter"; return setIndicator(indsOf(d.cat)[0].id); }
    if (d.tab) { S.dexTab = d.tab; return renderDex(); }
    if (d.act === "world") { S.country = null; return renderAll(); }
    if (d.act === "cmp-add") { if (!S.compare.includes(S.country)) S.compare = [...S.compare, S.country].slice(-4); return setMode("compare"); }
    if (d.rm) { S.compare = S.compare.filter((k) => k !== d.rm); return renderCompare(); }
    if (d.order) { S.rankOrder = d.order; return renderRank(); }
    if (d.group) { S.groupBy = d.group; return renderClassify(); }
    if (d.preset) { [S.sx, S.sy] = d.preset.split(","); return renderClassify(); }
    if (d.goal) { S.sdgGoal = +d.goal; return renderSDG(); }
    if (d.globeSdg) return setIndicator(`sdg:${d.globeSdg}`);
    if (d.tlcat) { S.tlCats.has(d.tlcat) ? S.tlCats.delete(d.tlcat) : S.tlCats.add(d.tlcat); return renderTimeline(); }
    if (d.jump != null) { $("#tl-scroll").scrollLeft = tlX(+d.jump) - 20; return; }
    if (d.tlnav) { const i = D.timeline.events.indexOf(S.tlEvent) + +d.tlnav; if (i >= 0 && i < D.timeline.events.length) selectEvent(i); return; }
    if (d.event != null) return selectEvent(+d.event);
    if (d.country) return selectCountry(d.country);
    if (d.id && D.countries[d.id]) return selectCountry(d.id);
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "rank-region") { S.rankRegion = t.value; renderRank(); }
    if (t.id === "cmp-add" && t.value) { S.compare = [...new Set([...S.compare, t.value])].slice(0, 4); renderCompare(); }
    if (t.id === "sx") { S.sx = t.value; renderClassify(); }
    if (t.id === "sy") { S.sy = t.value; renderClassify(); }
  });
  $("#year").addEventListener("input", async (ev) => {
    S.yearIdx = +ev.target.value;
    $("#year-label").textContent = yearLabel();
    await paintGlobe();
    if (S.mode === "rank") renderRank();
  });
  $("#play").addEventListener("click", togglePlay);
  $("#height").addEventListener("change", (ev) => { S.height = ev.target.checked; paintGlobe(); });
  $("#rotate").addEventListener("change", (ev) => { if (globe) globe.controls().autoRotate = ev.target.checked; });
  $("#search").addEventListener("change", (ev) => {
    const q = ev.target.value.trim();
    const hit = Object.entries(D.countries).find(([, c]) => c.name_ja === q || c.name_en.toLowerCase() === q.toLowerCase())
      || Object.entries(D.countries).find(([, c]) => c.name_ja.includes(q) || c.name_en.toLowerCase().includes(q.toLowerCase()));
    if (hit) {
      if (!["globe", "rank", "compare", "classify", "sdg"].includes(S.mode)) setMode("globe");
      selectCountry(hit[0]);
      ev.target.value = "";
    }
  });
}

// ---------------------------------------------------------------- 起動
async function main() {
  try {
    const [catalog, countries, latest, meta, geo, timeline] = await Promise.all([
      getJSON("data/catalog.json"), getJSON("data/countries.json"), getJSON("data/latest.json"),
      getJSON("data/meta.json"), getJSON("data/geo/countries.json"), getJSON("data/timeline.json"),
    ]);
    Object.assign(D, { catalog, countries: countries.countries, latest, meta, geo, timeline });
  } catch (e) {
    $("#loading").textContent = `データを読み込めませんでした(${e.message})。README の手順でローカルサーバーから開いてください。`;
    return;
  }
  $("#updated").textContent = `更新 ${(D.meta.generated_at || "").slice(0, 10)}`;
  $("#country-list").innerHTML = Object.values(D.countries).map((c) => `<option value="${esc(c.name_ja)}">${esc(c.name_en)}</option>`).join("");
  geoFeatures = D.geo.features;
  const inGeo = new Set(geoFeatures.map((f) => f.properties.iso3).filter(Boolean));
  pointCountries = Object.values(D.countries).filter((c) => !inGeo.has(c.iso3) && c.lat != null);
  // URL の状態を復元
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("i") && (IND(h.get("i")))) { S.ind = h.get("i"); S.cat = IND(S.ind).category === "sdg" ? S.cat : IND(S.ind).category; }
  if (h.get("c") && D.countries[h.get("c")]) S.country = h.get("c");
  bind();
  if (typeof Globe === "function") initGlobe();
  else $("#globe").innerHTML = `<div class="empty" style="color:#fff">3D地球儀ライブラリを読み込めませんでした(インターネット接続を確認してください)。ほかの画面は使えます。</div>`;
  await setupYears();
  $("#loading").hidden = true;
  setMode(h.get("m") || "globe");
  if (h.get("e") != null && D.timeline.events[+h.get("e")]) selectEvent(+h.get("e"));
  if (h.get("t")) { S.dexTab = h.get("t"); renderDex(); }
  if (S.country && globe) { const c = D.countries[S.country]; if (c.lat != null) globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 1.8 }); }
}
main();
