// 歴史人物のデフォルメ・キャラクターを SVG で描く(外部画像なし・著作権フリーのオリジナル)。
// look: { skin, hair, hairColor, beard, beardColor, hat, cloth, trim, item, glasses, female, robe }
// person.symbol があるときは顔を描かずシンボルで表す(宗教の開祖への配慮)。

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function darker(hex, k = 0.75) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#333";
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

// 頭の中心 (50, 50) 半径 25。体は y=78 から下。
function hairBack(h, c) {
  switch (h) {
    case "long": return `<path d="M22 50 Q20 88 30 98 L70 98 Q80 88 78 50 Z" fill="${c}"/>`;
    case "bob": return `<path d="M23 48 Q20 74 30 78 L70 78 Q80 74 77 48 Z" fill="${c}"/>`;
    case "wig": return `<g fill="${c}"><circle cx="24" cy="58" r="9"/><circle cx="76" cy="58" r="9"/><circle cx="24" cy="72" r="8"/><circle cx="76" cy="72" r="8"/><circle cx="26" cy="84" r="7"/><circle cx="74" cy="84" r="7"/></g>`;
    case "curly": return `<g fill="${c}"><circle cx="26" cy="54" r="9"/><circle cx="74" cy="54" r="9"/><circle cx="27" cy="68" r="8"/><circle cx="73" cy="68" r="8"/></g>`;
    case "braids": return `<g fill="${c}"><rect x="21" y="52" width="9" height="40" rx="4.5"/><rect x="70" y="52" width="9" height="40" rx="4.5"/></g>`;
    case "bun": return `<circle cx="50" cy="22" r="10" fill="${c}"/>`;
    case "wild": return `<g fill="${c}"><circle cx="23" cy="40" r="10"/><circle cx="77" cy="40" r="10"/><circle cx="20" cy="54" r="9"/><circle cx="80" cy="54" r="9"/><circle cx="32" cy="27" r="10"/><circle cx="68" cy="27" r="10"/><circle cx="50" cy="22" r="11"/></g>`;
    case "topknot": return `<rect x="45" y="17" width="10" height="12" rx="3" fill="${c}"/>`;
    default: return "";
  }
}

function hairFront(h, c) {
  switch (h) {
    case "bald": return `<path d="M26 52 Q25 42 29 38 L31 54 Z M74 52 Q75 42 71 38 L69 54 Z" fill="${c}"/>`;
    case "topknot": return `<path d="M25 48 Q26 30 36 28 L36 40 Q30 42 28 50 Z M75 48 Q74 30 64 28 L64 40 Q70 42 72 50 Z" fill="${c}"/><path d="M36 30 Q50 34 64 30 L64 34 Q50 38 36 34 Z" fill="${c}" opacity=".35"/>`;
    case "messy": return `<path d="M24 50 Q22 26 50 24 Q78 26 76 50 L70 38 L64 44 L58 34 L50 42 L42 34 L36 44 L30 38 Z" fill="${c}"/>`;
    case "parted": return `<path d="M24 50 Q24 25 50 25 Q76 25 76 50 Q70 36 56 33 Q44 36 36 38 Q28 42 24 50 Z" fill="${c}"/>`;
    case "wild": return `<path d="M26 46 Q30 30 50 29 Q70 30 74 46 Q62 38 50 38 Q38 38 26 46 Z" fill="${c}"/>`;
    case "wig": return `<path d="M25 50 Q24 24 50 24 Q76 24 75 50 Q70 36 50 35 Q30 36 25 50 Z" fill="${c}"/>`;
    case "bob": case "long": case "curly": case "braids": case "bun":
      return `<path d="M25 52 Q24 24 50 24 Q76 24 75 52 Q68 34 50 34 Q32 34 25 52 Z" fill="${c}"/>`;
    case "short": default:
      return `<path d="M25 48 Q25 24 50 24 Q75 24 75 48 Q68 33 50 33 Q32 33 25 48 Z" fill="${c}"/>`;
  }
}

function beard(b, c) {
  switch (b) {
    case "mustache": return `<path d="M40 62 Q45 58 50 61 Q55 58 60 62 Q55 65 50 63 Q45 65 40 62 Z" fill="${c}"/>`;
    case "goatee": return `<path d="M41 62 Q50 58 59 62 Q55 64 50 63 Q45 64 41 62 Z M46 68 Q50 78 54 68 Z" fill="${c}"/>`;
    case "chin": return `<path d="M27 56 Q30 78 50 82 Q70 78 73 56 Q66 72 50 74 Q34 72 27 56 Z" fill="${c}"/>`;
    case "full": return `<path d="M27 54 Q28 82 50 84 Q72 82 73 54 Q68 66 60 64 Q50 60 40 64 Q32 66 27 54 Z" fill="${c}"/>`;
    case "long": return `<path d="M28 56 Q30 96 50 100 Q70 96 72 56 Q66 68 58 64 Q50 60 42 64 Q34 68 28 56 Z" fill="${c}"/>`;
    default: return "";
  }
}

function hat(h, trim, cloth) {
  const gold = "#f2b705";
  switch (h) {
    case "crown": return `<path d="M30 30 L32 14 L41 24 L50 10 L59 24 L68 14 L70 30 Z" fill="${gold}" stroke="#b8860b" stroke-width="1"/><circle cx="50" cy="24" r="2.5" fill="#e03131"/>`;
    case "laurel": return `<g fill="#2f9e44">${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${30 + i * 4}" cy="${36 - i * 2.5}" rx="4" ry="2" transform="rotate(-30 ${30 + i * 4} ${36 - i * 2.5})"/><ellipse cx="${70 - i * 4}" cy="${36 - i * 2.5}" rx="4" ry="2" transform="rotate(30 ${70 - i * 4} ${36 - i * 2.5})"/>`).join("")}</g>`;
    case "mian": return `<rect x="26" y="20" width="48" height="6" rx="1" fill="#212529"/><rect x="36" y="24" width="28" height="10" fill="#212529"/>${[30, 38, 62, 70].map((x) => `<line x1="${x}" y1="26" x2="${x}" y2="40" stroke="#f2b705" stroke-width="1.5"/><circle cx="${x}" cy="41" r="1.6" fill="#e03131"/>`).join("")}`;
    case "chinese": return `<path d="M34 30 Q34 16 50 16 Q66 16 66 30 Z" fill="#212529"/><rect x="47" y="10" width="6" height="8" rx="2" fill="#212529"/>`;
    case "qing": return `<path d="M26 32 Q50 12 74 32 Z" fill="#212529"/><path d="M28 32 Q50 20 72 32" stroke="#c92a2a" stroke-width="3" fill="none"/><circle cx="50" cy="16" r="3.5" fill="#e03131"/>`;
    case "mongol": return `<path d="M28 34 Q30 12 50 10 Q70 12 72 34 Z" fill="${trim}"/><rect x="26" y="30" width="48" height="7" rx="3" fill="#8a5a3a"/><circle cx="50" cy="9" r="3" fill="#e03131"/>`;
    case "turban": return `<ellipse cx="50" cy="26" rx="27" ry="14" fill="#f8f9fa" stroke="#dee2e6"/><path d="M26 28 Q50 16 74 28" stroke="#dee2e6" stroke-width="2" fill="none"/><circle cx="50" cy="21" r="3" fill="#e03131"/>`;
    case "helmet": return `<path d="M26 36 Q26 14 50 14 Q74 14 74 36 Z" fill="#adb5bd" stroke="#868e96"/><path d="M50 14 L50 6" stroke="#e03131" stroke-width="3"/>`;
    case "beret": return `<ellipse cx="46" cy="27" rx="25" ry="9" fill="#212529"/><circle cx="46" cy="18" r="2" fill="#212529"/>`;
    case "cap": return `<path d="M30 32 Q30 17 50 17 Q70 17 70 32 Z" fill="#6741d9"/><rect x="28" y="29" width="44" height="5" rx="2" fill="#3b2a1a"/>`;
    case "flatcap": return `<path d="M26 32 Q28 18 50 18 Q72 18 74 30 Z" fill="#495057"/><path d="M60 30 Q76 30 80 34 L60 34 Z" fill="#343a40"/>`;
    case "tophat": return `<rect x="34" y="2" width="32" height="28" rx="2" fill="#212529"/><rect x="26" y="28" width="48" height="5" rx="2" fill="#212529"/><rect x="34" y="22" width="32" height="4" fill="#495057"/>`;
    case "bowler": return `<path d="M32 30 Q32 12 50 12 Q68 12 68 30 Z" fill="#212529"/><rect x="26" y="28" width="48" height="5" rx="2.5" fill="#212529"/>`;
    case "bicorne": return `<path d="M16 32 Q50 2 84 32 Q50 22 16 32 Z" fill="#212529"/><circle cx="62" cy="22" r="3.5" fill="#1c7ed6" stroke="#f8f9fa" stroke-width="1.5"/>`;
    case "tricorn": return `<path d="M22 32 L50 14 L78 32 Q50 26 22 32 Z" fill="#212529"/>`;
    case "phrygian": return `<path d="M28 34 Q26 12 52 12 Q72 12 70 22 Q66 18 60 20 Q70 26 72 34 Z" fill="#e03131"/><circle cx="44" cy="30" r="3" fill="#f8f9fa"/><circle cx="44" cy="30" r="1.5" fill="#1c7ed6"/>`;
    case "eboshi": return `<path d="M36 30 Q34 6 52 2 Q58 14 64 30 Z" fill="#212529"/><path d="M36 30 L64 30" stroke="#495057" stroke-width="2"/>`;
    case "kanmuri": return `<rect x="36" y="18" width="28" height="12" rx="3" fill="#212529"/><rect x="45" y="10" width="10" height="10" rx="2" fill="#212529"/><path d="M60 22 Q78 10 84 2" stroke="#212529" stroke-width="3" fill="none"/>`;
    case "egypt": return `<rect x="26" y="28" width="48" height="5" rx="2" fill="${gold}"/><path d="M50 28 Q46 20 50 16 Q54 20 50 28 Z" fill="${gold}"/><circle cx="50" cy="30.5" r="2" fill="#1c7ed6"/>`;
    case "scarf": return `<path d="M22 56 Q18 22 50 20 Q82 22 78 56 Q78 70 72 80 L66 80 Q72 64 70 50 Q66 32 50 32 Q34 32 30 50 Q28 64 34 80 L28 80 Q22 70 22 56 Z" fill="${cloth}"/>`;
    case "feather": return `<rect x="27" y="28" width="46" height="6" rx="3" fill="${trim}"/>${[-18, -9, 0, 9, 18].map((dx, i) => `<ellipse cx="${50 + dx}" cy="${16 - (2 - Math.abs(i - 2)) * 3}" rx="3.2" ry="11" fill="${["#2f9e44", "#1c7ed6", "#e03131", "#1c7ed6", "#2f9e44"][i]}" transform="rotate(${dx * 1.2} ${50 + dx} 28)"/>`).join("")}`;
    case "fur": return `<path d="M24 38 Q22 14 50 12 Q78 14 76 38 Q64 30 50 30 Q36 30 24 38 Z" fill="#8a6a4a"/><path d="M24 38 Q36 28 50 28 Q64 28 76 38" stroke="#f1e3c8" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    case "peci": return `<path d="M32 30 L34 16 Q50 12 66 16 L68 30 Q50 26 32 30 Z" fill="#212529"/>`;
    case "space": return `<circle cx="50" cy="50" r="33" fill="rgba(165,216,255,.25)" stroke="#dee2e6" stroke-width="4"/><path d="M26 30 Q34 22 44 20" stroke="#fff" stroke-width="3" fill="none" opacity=".8"/>`;
    default: return "";
  }
}

function body(look) {
  const c = look.cloth || "#495057";
  const t = look.trim || "#f8f9fa";
  if (look.robe === "junihitoe") {
    return `<path d="M14 120 Q16 84 50 78 Q84 84 86 120 Z" fill="${c}"/><path d="M20 120 Q24 90 50 84 Q76 90 80 120" fill="none" stroke="${t}" stroke-width="4"/><path d="M26 120 Q30 96 50 90 Q70 96 74 120" fill="none" stroke="#2f9e44" stroke-width="4"/><path d="M42 80 L50 96 L58 80" fill="#f8f9fa"/>`;
  }
  if (look.robe === "hakama") {
    return `<path d="M18 120 Q20 86 50 80 Q80 86 82 120 Z" fill="${c}"/><path d="M40 80 L50 100 L60 80 Z" fill="#f8f9fa"/><path d="M40 80 L50 100" stroke="#212529" stroke-width="2"/><path d="M60 80 L50 100" stroke="#212529" stroke-width="2"/><rect x="18" y="108" width="64" height="12" fill="#343a40"/>`;
  }
  return `<path d="M18 120 Q20 86 50 80 Q80 86 82 120 Z" fill="${c}"/><path d="M40 81 L50 94 L60 81" fill="${t}"/>`;
}

function face(look) {
  const skin = look.skin || "#f1c9a5";
  const eyes = look.glasses
    ? `<circle cx="41" cy="52" r="6" fill="none" stroke="#343a40" stroke-width="2"/><circle cx="59" cy="52" r="6" fill="none" stroke="#343a40" stroke-width="2"/><line x1="47" y1="52" x2="53" y2="52" stroke="#343a40" stroke-width="2"/><circle cx="41" cy="52" r="2.2" fill="#212529"/><circle cx="59" cy="52" r="2.2" fill="#212529"/>`
    : `<circle cx="41" cy="52" r="2.8" fill="#212529"/><circle cx="59" cy="52" r="2.8" fill="#212529"/><circle cx="42" cy="51" r=".9" fill="#fff"/><circle cx="60" cy="51" r=".9" fill="#fff"/>`;
  const lashes = look.female && !look.glasses ? `<path d="M37 49 L35 47 M63 49 L65 47" stroke="#212529" stroke-width="1.4"/>` : "";
  const mouth = look.beard === "full" || look.beard === "long" ? "" : `<path d="M45 64 Q50 68 55 64" stroke="#8a4a3a" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  return `<circle cx="50" cy="50" r="25" fill="${skin}"/><ellipse cx="25" cy="54" rx="3.5" ry="5" fill="${skin}"/><ellipse cx="75" cy="54" rx="3.5" ry="5" fill="${skin}"/>
    <circle cx="36" cy="60" r="4" fill="#ff8787" opacity=".35"/><circle cx="64" cy="60" r="4" fill="#ff8787" opacity=".35"/>${eyes}${lashes}${mouth}`;
}

/** 人物1人分の SVG 文字列 */
export function characterSVG(person, size = 64) {
  const title = `<title>${esc(person.name)}(${esc(person.role)})</title>`;
  if (person.symbol) {
    return `<svg class="chara" viewBox="0 0 100 120" width="${size}" height="${size * 1.2}" role="img" aria-label="${esc(person.name)}">${title}
      <circle cx="50" cy="56" r="40" fill="${person.color || "#495057"}" opacity=".15"/>
      <circle cx="50" cy="56" r="32" fill="#fff" stroke="${person.color || "#495057"}" stroke-width="3"/>
      <text x="50" y="68" text-anchor="middle" font-size="34">${person.symbol}</text></svg>`;
  }
  const L = person.look || {};
  const hc = L.hairColor || "#3b2a1a";
  const bc = L.beardColor || hc;
  const item = L.item ? `<circle cx="80" cy="100" r="14" fill="#fff" stroke="${darker(L.cloth || "#495057")}" stroke-width="2"/><text x="80" y="106" text-anchor="middle" font-size="16">${L.item}</text>` : "";
  const hatSvg = hat(L.hat, L.trim, L.cloth);
  return `<svg class="chara" viewBox="0 0 100 120" width="${size}" height="${size * 1.2}" role="img" aria-label="${esc(person.name)}">${title}
    ${L.hat === "scarf" ? "" : hairBack(L.hair, hc)}
    ${body(L)}
    ${face(L)}
    ${beard(L.beard, bc)}
    ${L.hat === "scarf" ? "" : hairFront(L.hair, hc)}
    ${hatSvg}
    ${item}
  </svg>`;
}

/** 出来事の登場人物(複数可)をまとめて描く */
export function charactersFor(event, size = 48) {
  return (event.p || []).map((p) => characterSVG(p, size)).join("");
}
