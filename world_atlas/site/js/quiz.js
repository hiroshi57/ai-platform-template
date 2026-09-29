// 授業用クイズの自動生成(DOM に依存しない純粋関数)。node --test でテストする。
// 同じ seed なら同じ問題になるので、「問題番号」を共有すればクラス全員が同じワークシートを使える。
import { fmtNum, fmtYear, rankAll } from "./analytics.js";

/** 再現できる乱数(mulberry32) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function shuffle(r, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** 正解を含む選択肢をシャッフルし、正解の位置を返す */
function withAnswer(r, correct, wrongs) {
  const choices = shuffle(r, [correct, ...wrongs]);
  return { choices, answer: choices.indexOf(correct) };
}

const unit = (ind) => (ind.unit ? ` ${ind.unit}` : "");

/**
 * data: { catalog, countries, latest(=latest.json), timeline }
 * 戻り値: [{ type, q, choices, answer, explain, link, person? }]
 */
export function makeQuiz(data, seed, n = 10) {
  const r = rng(seed);
  const { catalog, countries, latest, timeline } = data;
  const name = (k) => countries[k]?.name_ja || k;
  const snap = (id) => Object.fromEntries(Object.entries(latest[id]?.c || {}).map(([k, v]) => [k, [v[0], v[1]]]));
  const pop = snap("population");
  // 身近に感じやすいよう、人口500万人以上の国から出題する
  const bigCountries = Object.keys(countries).filter((k) => (pop[k]?.[1] || 0) >= 5e6);
  const inds = catalog.indicators.filter((i) => latest[i.id] && Object.keys(latest[i.id].c).length >= 100 && i.category !== "history" && !i.levels);
  const events = (timeline?.events || []).filter((e) => !e.auto);
  const people = events.flatMap((e) => (e.p || []).filter((p) => !p.symbol).map((p) => ({ p, e })));
  const regions = [...new Set(Object.values(countries).map((c) => c.region_ja))];

  const makers = {
    compare() {
      const ind = pick(r, inds);
      const s = snap(ind.id);
      const pool = bigCountries.filter((k) => s[k]);
      for (let t = 0; t < 30; t++) {
        const a = pick(r, pool), b = pick(r, pool);
        if (a === b) continue;
        const va = s[a][1], vb = s[b][1];
        if (Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb), 1e-9) < 0.15) continue;
        const wantLow = ind.better === "low";
        const correct = (wantLow ? va < vb : va > vb) ? a : b;
        const { choices, answer } = withAnswer(r, name(correct), [name(correct === a ? b : a)]);
        return {
          type: "compare",
          q: `「${ind.name}」が${wantLow ? "少ない" : "大きい"}のは、どちらの国?`,
          choices, answer,
          explain: `${name(a)}: ${fmtNum(va, ind.decimals ?? 1)}${unit(ind)}(${s[a][0]}年) / ${name(b)}: ${fmtNum(vb, ind.decimals ?? 1)}${unit(ind)}(${s[b][0]}年)。${ind.explain}`,
          link: { mode: "compare", ind: ind.id, countries: [a, b] },
        };
      }
      return null;
    },
    top() {
      const ind = pick(r, inds.filter((i) => i.better || i.scale === "log"));
      const s = Object.fromEntries(Object.entries(snap(ind.id)).filter(([k]) => bigCountries.includes(k)));
      const ranks = rankAll(s, ind.better === "low" ? "low" : "high");
      const order = Object.keys(ranks).sort((x, y) => ranks[x].rank - ranks[y].rank);
      if (order.length < 20) return null;
      const correct = order[0];
      const wrongs = shuffle(r, order.slice(Math.floor(order.length * 0.2), Math.floor(order.length * 0.8))).slice(0, 3);
      const { choices, answer } = withAnswer(r, name(correct), wrongs.map(name));
      return {
        type: "top",
        q: `人口500万人以上の国のうち、「${ind.name}」がいちばん${ind.better === "low" ? "少ない" : "大きい"}国は?`,
        choices, answer,
        explain: `正解は${name(correct)}(${fmtNum(s[correct][1], ind.decimals ?? 1)}${unit(ind)}、${s[correct][0]}年)。${ind.explain}`,
        link: { mode: "rank", ind: ind.id, country: correct },
      };
    },
    year() {
      if (events.length < 8) return null;
      const e = pick(r, events);
      const label = (x) => `${fmtYear(x.y)}${x.approx ? "頃" : ""}`;
      const others = shuffle(r, events.filter((x) => Math.abs(x.y - e.y) > 60 && label(x) !== label(e)));
      const wrongs = [...new Set(others.map(label))].slice(0, 3);
      const { choices, answer } = withAnswer(r, label(e), wrongs);
      return {
        type: "year", q: `「${e.t}」が起きたのは、いつ?`, choices, answer,
        explain: e.d, link: { mode: "timeline", event: timeline.events.indexOf(e) },
      };
    },
    person() {
      if (people.length < 4) return null;
      const it = pick(r, people);
      const wrongs = shuffle(r, [...new Set(people.map((x) => x.p.name).filter((nm) => nm !== it.p.name))]).slice(0, 3);
      const { choices, answer } = withAnswer(r, it.p.name, wrongs);
      return {
        type: "person", q: `この人物はだれ?(ヒント: ${it.p.role}・${fmtYear(it.e.y)}${it.e.approx ? "頃" : ""})`,
        choices, answer, person: it.p,
        explain: `${it.p.name}(${it.p.role})。${it.e.t}: ${it.e.d}`,
        link: { mode: "timeline", event: timeline.events.indexOf(it.e) },
      };
    },
    region() {
      const k = pick(r, bigCountries);
      const correct = countries[k].region_ja;
      const wrongs = shuffle(r, regions.filter((x) => x !== correct)).slice(0, 3);
      const { choices, answer } = withAnswer(r, correct, wrongs);
      return {
        type: "region", q: `「${name(k)}」があるのは、どの地域?`, choices, answer,
        explain: `${name(k)}(首都 ${countries[k].capital || "—"})は${correct}の国です。`,
        link: { mode: "globe", country: k },
      };
    },
    sdg() {
      const g = pick(r, catalog.sdg_goals);
      const wrongs = shuffle(r, catalog.sdg_goals.filter((x) => x.n !== g.n)).slice(0, 3).map((x) => x.name);
      const { choices, answer } = withAnswer(r, g.name, wrongs);
      return {
        type: "sdg", q: `SDGs の目標${g.n}は、どれ?`, choices, answer,
        explain: `目標${g.n}は「${g.name}」。関係する指標は、図鑑の SDGs ページで見られます。`,
        link: { mode: "sdg", goal: g.n },
      };
    },
  };
  const cycle = ["compare", "top", "year", "person", "compare", "region", "top", "year", "sdg", "person"];
  const out = [];
  for (let i = 0; out.length < n && i < n * 5; i++) {
    const q = makers[cycle[i % cycle.length]]();
    if (q && !out.some((x) => x.q === q.q)) out.push(q);
  }
  return out;
}
