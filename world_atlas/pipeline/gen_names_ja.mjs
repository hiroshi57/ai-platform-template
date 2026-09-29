// World Bank の国一覧(ISO2)から日本語国名表を生成する。
// 使い方: node world_atlas/pipeline/gen_names_ja.mjs > world_atlas/pipeline/names_ja.json
// Node の ICU(Intl.DisplayNames)を使うため追加ライブラリ不要。
const res = await fetch("https://api.worldbank.org/v2/country?format=json&per_page=400");
const [, rows] = await res.json();
const dn = new Intl.DisplayNames(["ja"], { type: "region" });
const out = {};
for (const r of rows) {
  if (r.region.id === "NA") continue; // 地域集計は除外
  let ja = null;
  try { ja = dn.of(r.iso2Code); } catch { ja = null; }
  if (!ja || ja === r.iso2Code) ja = null;
  out[r.id] = { iso2: r.iso2Code, ja };
}
// ICU に無い World Bank 独自コードの補完
if (out.CHI && !out.CHI.ja) out.CHI.ja = "チャネル諸島";
console.log(JSON.stringify(out, null, 1));
