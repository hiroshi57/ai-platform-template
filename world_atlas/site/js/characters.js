// 歴史人物キャラクター(第2版): 輪郭線のある漫画タッチの胸像を SVG で描く。
// 外部画像は使わないオリジナル。肖像画などに見られる特徴(髪型・ひげ・帽子・服・持ち物)をもとにしたデフォルメで、
// 実際の顔とは異なる。宗教の開祖は信仰への配慮から顔を描かず、シンボルで表す(person.symbol)。
//
// look: { skin, hair, hairColor, beard, beardColor, hat, cloth, trim, item, glasses, female, robe, old }
//   hair : short | parted | messy | long | bob | bun | braids | curly | wild | wig | bald | topknot(月代+ちょんまげ) | none
//   beard: none | mustache | goatee | chin | full | long
//   robe : kimono | hakama | junihitoe | suit | (省略時は襟つきの上着)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const INK = "#2b2118"; // 輪郭線の色

function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex || "#888";
  const n = parseInt(m[1], 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) > 480;
}

// ---------------------------------------------------------------- 顔(頭の中心 60,55)
// 名前から決まる「ゆらぎ」(同じ人物は毎回同じ顔になる)
function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}
function facePath(w, jaw) {
  // w: 顔の横幅のゆらぎ(-3〜3)、jaw: あごの長さ(-3〜4)
  const l = 34 - w, r = 86 + w, bot = 94 + jaw;
  return `M${l} 52 Q${l - 1} 22 60 21 Q${r + 1} 22 ${r} 52 Q${r} 76 ${74 + w * 0.3} ${87 + jaw * 0.6} Q66 ${bot} 60 ${bot} Q54 ${bot} ${46 - w * 0.3} ${87 + jaw * 0.6} Q${l} 76 ${l} 52 Z`;
}

function face(L, key = "") {
  const hv = hash(key);
  const w = L.faceW ?? Math.round((hv * 6 - 3) * 10) / 10;
  const jaw = L.jaw ?? Math.round(((hash(key + "j") * 7) - 3) * 10) / 10;
  const FACE = facePath(w, jaw);
  // 表情: stern(きりっと) / gentle(おだやか)。指定がなければ名前から
  const mood = L.mood || (hash(key + "m") > 0.6 ? "stern" : "gentle");
  const tilt = mood === "stern" ? 9 : -2;
  const eyeOpen = L.old ? 0.8 : mood === "stern" ? 0.85 : 1;
  const skin = L.skin || "#f1c9a5", dark = shade(skin, 0.82);
  const old = L.old ?? isLight(L.hairColor) ;
  const female = !!L.female;
  const brow = female ? shade(L.hairColor || "#3b2a1a", 0.9) : shade(L.hairColor || "#3b2a1a", old ? 0.8 : 0.75);
  const bw = female ? 1.6 : 2.8;
  let s = "";
  // 耳
  s += `<path d="M35 50 Q27 49 27 58 Q28 67 36 66" fill="${skin}" stroke="${INK}" stroke-width="1.4"/><path d="M33 54 Q30 58 34 62" fill="none" stroke="${dark}" stroke-width="1.1"/>`;
  s += `<path d="M85 50 Q93 49 93 58 Q92 67 84 66" fill="${skin}" stroke="${INK}" stroke-width="1.4"/><path d="M87 54 Q90 58 86 62" fill="none" stroke="${dark}" stroke-width="1.1"/>`;
  // 顔の形と影
  s += `<path d="${FACE}" fill="${skin}" stroke="${INK}" stroke-width="1.6"/>`;
  s += `<path d="M86 52 Q86 76 74 87 Q66 94 60 94 Q72 86 78 70 Q82 58 80 40 Q85 44 86 52Z" fill="${dark}" opacity=".45"/>`;
  // 眉
  if (female) {
    s += `<path d="M41 47 Q47 44 54 46.5" fill="none" stroke="${brow}" stroke-width="${bw}" stroke-linecap="round"/><path d="M79 47 Q73 44 66 46.5" fill="none" stroke="${brow}" stroke-width="${bw}" stroke-linecap="round"/>`;
  } else {
    s += `<path transform="rotate(${tilt} 55 47)" d="M40 49 Q46 44 55 47 Q47 46.5 41 50.5Z" fill="${brow}" stroke="${brow}" stroke-width="${bw * 0.6}" stroke-linejoin="round"/>`;
    s += `<path transform="rotate(${-tilt} 65 47)" d="M80 49 Q74 44 65 47 Q73 46.5 79 50.5Z" fill="${brow}" stroke="${brow}" stroke-width="${bw * 0.6}" stroke-linejoin="round"/>`;
  }
  // 目(白目・黒目・ハイライト・まぶた)
  const eye = (cx, flip) => {
    const a = cx - 6.5, b = cx + 6.5;
    const top = 56 - (female ? 6 : 4.5) * eyeOpen, bottom = 56 + 4 * eyeOpen;
    return `<path d="M${a} 56 Q${cx} ${top} ${b} 56 Q${cx} ${bottom} ${a} 56Z" fill="#fff" stroke="${INK}" stroke-width="1.2"/>
      <circle cx="${cx + (flip ? -0.6 : 0.6)}" cy="56.2" r="${female ? 3.2 : 2.7}" fill="#4a3526"/><circle cx="${cx + (flip ? -0.6 : 0.6)}" cy="56.2" r="1.3" fill="#111"/>
      <circle cx="${cx + (flip ? -1.4 : 1.6)}" cy="55" r=".9" fill="#fff"/>
      <path d="M${a - 0.5} 55.5 Q${cx} ${top - 0.5} ${b + 0.5} 55.5" fill="none" stroke="${INK}" stroke-width="${female ? 2 : 1.8}" stroke-linecap="round"/>
      ${female ? `<path d="M${flip ? a - 0.5 : b + 0.5} 55.5 l${flip ? -2 : 2} -1.6" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>` : ""}`;
  };
  s += eye(47.5, true) + eye(72.5, false);
  // 鼻
  s += `<path d="M61 58 Q59.5 65 57 69 Q60 71.5 64 69.5" fill="none" stroke="${shade(skin, 0.6)}" stroke-width="1.3" stroke-linecap="round"/>`;
  // しわ(年配)
  if (old) {
    s += `<path d="M46 36 Q60 33 74 36 M48 40 Q60 38 72 40" fill="none" stroke="${shade(skin, 0.68)}" stroke-width="1" stroke-linecap="round"/>`;
    s += `<path d="M52 70 Q50 76 52 80 M68 70 Q70 76 68 80" fill="none" stroke="${shade(skin, 0.7)}" stroke-width="1" stroke-linecap="round"/>`;
    s += `<path d="M40 59 Q42 61 44 60.5 M80 59 Q78 61 76 60.5" fill="none" stroke="${shade(skin, 0.7)}" stroke-width=".9"/>`;
  }
  // ほお
  s += `<ellipse cx="42" cy="66" rx="4.5" ry="2.6" fill="#ff8a8a" opacity="${female ? 0.35 : 0.18}"/><ellipse cx="78" cy="66" rx="4.5" ry="2.6" fill="#ff8a8a" opacity="${female ? 0.35 : 0.18}"/>`;
  // 口
  if (!["full", "long"].includes(L.beard)) {
    s += female
      ? `<path d="M54.5 78 Q60 81.5 65.5 78 Q60 79.5 54.5 78Z" fill="#d9485f" stroke="#a8323f" stroke-width=".8"/>`
      : `<path d="M54 78.5 Q60 80.5 66 78.5" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/><path d="M57 82 Q60 83 63 82" fill="none" stroke="${shade(skin, 0.7)}" stroke-width=".9"/>`;
  }
  // めがね
  if (L.glasses) {
    s += `<g fill="none" stroke="#222" stroke-width="1.6"><circle cx="47.5" cy="56" r="8"/><circle cx="72.5" cy="56" r="8"/><path d="M55.5 55.5 Q60 53.5 64.5 55.5 M39.5 55 L34 53 M80.5 55 L86 53"/></g>`;
  }
  return s;
}

// ---------------------------------------------------------------- 髪
function hairBack(h, c) {
  const st = `stroke="${INK}" stroke-width="1.4"`;
  switch (h) {
    case "long": return `<path d="M31 50 Q26 96 36 118 L84 118 Q94 96 89 50 Q86 24 60 20 Q34 24 31 50Z" fill="${c}" ${st}/>`;
    case "bob": return `<path d="M31 50 Q28 80 38 88 L82 88 Q92 80 89 50 Q86 24 60 20 Q34 24 31 50Z" fill="${c}" ${st}/>`;
    case "braids": return `<g fill="${c}" ${st}><path d="M32 58 Q26 90 32 116 Q38 118 40 112 Q36 88 40 64Z"/><path d="M88 58 Q94 90 88 116 Q82 118 80 112 Q84 88 80 64Z"/></g>`;
    case "bun": return `<circle cx="60" cy="16" r="10" fill="${c}" ${st}/><path d="M53 14 Q60 10 67 14" fill="none" stroke="${shade(c, 1.4)}" stroke-width="1"/>`;
    case "wig": return `<g fill="${c}" ${st}>${[[29, 60], [91, 60], [28, 74], [92, 74], [31, 88], [89, 88]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8.5"/>`).join("")}</g>`;
    case "curly": return `<g fill="${c}" ${st}>${[[32, 52], [88, 52], [30, 66], [90, 66], [34, 78], [86, 78]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7.5"/>`).join("")}</g>`;
    case "wild": return `<path d="M26 58 L18 46 L28 42 L20 28 L34 30 L34 14 L46 22 L52 8 L60 20 L68 8 L74 22 L86 14 L86 30 L100 28 L92 42 L102 46 L94 58 Q86 30 60 28 Q34 30 26 58Z" fill="${c}" ${st} stroke-linejoin="round"/>`;
    default: return "";
  }
}
function hairFront(h, c, skin) {
  const st = `stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"`;
  const hi = `stroke="${shade(c, 1.5)}" stroke-width="1" fill="none" opacity=".7"`;
  switch (h) {
    case "bald":
      return `<path d="M34 60 Q31 46 38 40 L40 62Z M86 60 Q89 46 82 40 L80 62Z" fill="${c}" ${st}/>
        <ellipse cx="52" cy="30" rx="9" ry="4" fill="#fff" opacity=".55" transform="rotate(-18 52 30)"/>`;
    case "topknot": {
      // 月代(剃った頭頂部)+ ちょんまげ
      const shaved = shade(skin || "#f1c9a5", 0.93);
      return `<path d="M36 44 Q38 24 60 22 Q82 24 84 44 Q72 38 60 38 Q48 38 36 44Z" fill="${shaved}" stroke="none"/>
        <ellipse cx="54" cy="30" rx="10" ry="4.5" fill="#fff" opacity=".6" transform="rotate(-14 54 30)"/>
        <path d="M34 62 Q30 46 37 38 Q40 44 41 52 L41 62Z M86 62 Q90 46 83 38 Q80 44 79 52 L79 62Z" fill="${c}" ${st}/>
        <path d="M57 24 Q56 14 62 10 Q70 8 74 13 Q70 14 67 16 Q63 19 63 25Z" fill="${c}" ${st}/>
        <path d="M58 25 L64 25" stroke="#fff" stroke-width="1.6"/>`;
    }
    case "messy":
      return `<path d="M33 52 Q30 24 60 20 Q90 24 87 52 L82 38 L76 46 L70 32 L62 42 L56 30 L48 42 L42 34 L38 46Z" fill="${c}" ${st}/>`;
    case "parted":
      return `<path d="M33 52 Q31 22 60 20 Q89 22 87 52 Q84 36 70 32 Q58 36 46 38 Q37 42 33 52Z" fill="${c}" ${st}/><path d="M68 23 Q66 28 70 32" ${hi}/>`;
    case "wild":
      return `<path d="M34 50 Q38 32 60 31 Q82 32 86 50 Q74 40 60 40 Q46 40 34 50Z" fill="${c}" ${st}/>`;
    case "wig":
      return `<path d="M33 54 Q30 20 60 20 Q90 20 87 54 Q82 36 60 35 Q38 36 33 54Z" fill="${c}" ${st}/><path d="M44 26 Q60 22 76 26" ${hi}/>`;
    case "none": return "";
    case "bob": case "long": case "braids": case "bun": case "curly":
      return `<path d="M33 56 Q30 21 60 20 Q90 21 87 56 Q82 34 66 32 Q62 38 50 38 Q38 42 33 56Z" fill="${c}" ${st}/><path d="M44 27 Q52 23 60 23" ${hi}/>`;
    case "short": default:
      return `<path d="M33 52 Q31 21 60 20 Q89 21 87 52 Q82 34 60 32 Q38 34 33 52Z" fill="${c}" ${st}/><path d="M44 27 Q52 23 60 23" ${hi}/>`;
  }
}

// ---------------------------------------------------------------- ひげ
function beard(b, c) {
  const st = `stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"`;
  switch (b) {
    case "mustache": return `<path d="M50 75 Q55 71 60 73.5 Q65 71 70 75 Q66 74.5 63 76.5 Q60 75.5 57 76.5 Q54 74.5 50 75Z" fill="${c}" ${st}/>`;
    case "goatee": return `<path d="M52 75 Q56 72 60 74 Q64 72 68 75 Q64 76 60 75.5 Q56 76 52 75Z" fill="${c}" ${st}/><path d="M56 84 Q58 96 60 100 Q62 96 64 84 Q60 86 56 84Z" fill="${c}" ${st}/>`;
    case "chin": return `<path d="M35 62 Q37 88 60 96 Q83 88 85 62 Q80 84 60 88 Q40 84 35 62Z" fill="${c}" ${st}/>`;
    case "full": return `<path d="M35 60 Q36 96 60 102 Q84 96 85 60 Q80 80 70 77 Q64 73 60 75 Q56 73 50 77 Q40 80 35 60Z" fill="${c}" ${st}/><path d="M54 79 Q60 81 66 79" stroke="${INK}" stroke-width="1.3" fill="none"/>`;
    case "long": return `<path d="M35 60 Q36 104 60 122 Q84 104 85 60 Q80 80 70 77 Q64 73 60 75 Q56 73 50 77 Q40 80 35 60Z" fill="${c}" ${st}/><path d="M54 79 Q60 81 66 79 M52 92 Q56 104 60 112 M68 92 Q64 104 60 112" stroke="${shade(c, 0.75)}" stroke-width="1" fill="none"/>`;
    default: return "";
  }
}

// ---------------------------------------------------------------- 帽子(旧版の形を新しい頭の大きさに合わせて描く)
function hatShapes(h, trim, cloth) {
  const gold = "#f2b705";
  switch (h) {
    case "crown": return `<path d="M30 30 L32 14 L41 24 L50 10 L59 24 L68 14 L70 30 Z" fill="${gold}"/><circle cx="50" cy="24" r="2.5" fill="#e03131"/>`;
    case "laurel": return `<g fill="#2f9e44">${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${30 + i * 4}" cy="${36 - i * 2.5}" rx="4" ry="2" transform="rotate(-30 ${30 + i * 4} ${36 - i * 2.5})"/><ellipse cx="${70 - i * 4}" cy="${36 - i * 2.5}" rx="4" ry="2" transform="rotate(30 ${70 - i * 4} ${36 - i * 2.5})"/>`).join("")}</g>`;
    case "mian": return `<rect x="26" y="20" width="48" height="6" rx="1" fill="#212529"/><rect x="36" y="24" width="28" height="10" fill="#212529"/>${[30, 38, 62, 70].map((x) => `<line x1="${x}" y1="26" x2="${x}" y2="40" stroke="#f2b705" stroke-width="1.5"/><circle cx="${x}" cy="41" r="1.6" fill="#e03131"/>`).join("")}`;
    case "chinese": return `<path d="M34 30 Q34 16 50 16 Q66 16 66 30 Z" fill="#212529"/><rect x="47" y="10" width="6" height="8" rx="2" fill="#212529"/>`;
    case "qing": return `<path d="M26 32 Q50 12 74 32 Z" fill="#212529"/><path d="M28 32 Q50 20 72 32" stroke="#c92a2a" stroke-width="3" fill="none"/><circle cx="50" cy="16" r="3.5" fill="#e03131"/>`;
    case "mongol": return `<path d="M28 34 Q30 12 50 10 Q70 12 72 34 Z" fill="${trim}"/><rect x="26" y="30" width="48" height="7" rx="3" fill="#8a5a3a"/><circle cx="50" cy="9" r="3" fill="#e03131"/>`;
    case "turban": return `<ellipse cx="50" cy="26" rx="27" ry="14" fill="#f8f9fa"/><path d="M26 28 Q50 16 74 28 M28 22 Q50 32 72 20" stroke="#ced4da" stroke-width="2" fill="none"/><circle cx="50" cy="21" r="3" fill="#e03131"/>`;
    case "helmet": return `<path d="M26 36 Q26 14 50 14 Q74 14 74 36 Z" fill="#adb5bd"/><path d="M50 14 L50 6" stroke="#e03131" stroke-width="3"/>`;
    case "beret": return `<ellipse cx="46" cy="27" rx="25" ry="9" fill="#212529"/><circle cx="46" cy="18" r="2" fill="#212529"/>`;
    case "cap": return `<path d="M30 32 Q30 17 50 17 Q70 17 70 32 Z" fill="#6741d9"/><rect x="28" y="29" width="44" height="5" rx="2" fill="#3b2a1a"/>`;
    case "flatcap": return `<path d="M26 32 Q28 18 50 18 Q72 18 74 30 Z" fill="#495057"/><path d="M60 30 Q76 30 80 34 L60 34 Z" fill="#343a40"/>`;
    case "tophat": return `<rect x="34" y="2" width="32" height="28" rx="2" fill="#212529"/><rect x="26" y="28" width="48" height="5" rx="2" fill="#212529"/><rect x="34" y="22" width="32" height="4" fill="#495057"/>`;
    case "bowler": return `<path d="M32 30 Q32 12 50 12 Q68 12 68 30 Z" fill="#212529"/><rect x="26" y="28" width="48" height="5" rx="2.5" fill="#212529"/>`;
    case "bicorne": return `<path d="M16 32 Q50 2 84 32 Q50 22 16 32 Z" fill="#212529"/><circle cx="62" cy="22" r="3.5" fill="#1c7ed6" stroke="#f8f9fa" stroke-width="1.5"/>`;
    case "tricorn": return `<path d="M22 32 L50 14 L78 32 Q50 26 22 32 Z" fill="#212529"/>`;
    case "phrygian": return `<path d="M28 34 Q26 12 52 12 Q72 12 70 22 Q66 18 60 20 Q70 26 72 34 Z" fill="#e03131"/><circle cx="44" cy="30" r="3" fill="#f8f9fa"/><circle cx="44" cy="30" r="1.5" fill="#1c7ed6"/>`;
    case "eboshi": return `<path d="M37 31 Q34 6 52 2 Q60 14 63 31 Z" fill="#212529"/><path d="M40 20 Q50 14 58 18" stroke="#495057" stroke-width="1.2" fill="none"/><path d="M36 31 L64 31" stroke="#495057" stroke-width="2"/>`;
    case "kanmuri": return `<rect x="36" y="18" width="28" height="12" rx="3" fill="#212529"/><rect x="45" y="10" width="10" height="10" rx="2" fill="#212529"/><path d="M60 22 Q78 10 84 2" stroke="#212529" stroke-width="3" fill="none"/>`;
    case "egypt": return `<rect x="26" y="28" width="48" height="5" rx="2" fill="${gold}"/><path d="M50 28 Q46 20 50 16 Q54 20 50 28 Z" fill="${gold}"/><circle cx="50" cy="30.5" r="2" fill="#1c7ed6"/>`;
    case "feather": return `<rect x="27" y="28" width="46" height="6" rx="3" fill="${trim}"/>${[-18, -9, 0, 9, 18].map((dx, i) => `<ellipse cx="${50 + dx}" cy="${16 - (2 - Math.abs(i - 2)) * 3}" rx="3.2" ry="11" fill="${["#2f9e44", "#1c7ed6", "#e03131", "#1c7ed6", "#2f9e44"][i]}" transform="rotate(${dx * 1.2} ${50 + dx} 28)"/>`).join("")}`;
    case "fur": return `<path d="M24 38 Q22 14 50 12 Q78 14 76 38 Q64 30 50 30 Q36 30 24 38 Z" fill="#8a6a4a"/><path d="M24 38 Q36 28 50 28 Q64 28 76 38" stroke="#f1e3c8" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    case "peci": return `<path d="M32 30 L34 16 Q50 12 66 16 L68 30 Q50 26 32 30 Z" fill="#212529"/>`;
    default: return "";
  }
}
function hat(h, trim, cloth) {
  if (h === "scarf") {
    return `<path d="M28 60 Q22 20 60 18 Q98 20 92 60 Q92 80 84 96 L76 96 Q84 74 82 56 Q78 32 60 32 Q42 32 38 56 Q36 74 44 96 L36 96 Q28 80 28 60 Z" fill="${cloth}" stroke="${INK}" stroke-width="1.4"/>`;
  }
  if (h === "space") {
    return `<circle cx="60" cy="56" r="40" fill="rgba(165,216,255,.22)" stroke="#dee2e6" stroke-width="5"/><circle cx="60" cy="56" r="40" fill="none" stroke="${INK}" stroke-width="1.2"/><path d="M32 34 Q42 24 54 22" stroke="#fff" stroke-width="3" fill="none" opacity=".8"/>`;
  }
  const inner = hatShapes(h, trim, cloth);
  return inner ? `<g transform="translate(6 -3) scale(1.08)" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round">${inner}</g>` : "";
}

// ---------------------------------------------------------------- 服(胸から上)
function body(L) {
  const c = L.cloth || "#495057", t = L.trim || "#f8f9fa", skin = L.skin || "#f1c9a5";
  const st = `stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"`;
  const fold = `stroke="${shade(c, 0.7)}" stroke-width="1.1" fill="none" stroke-linecap="round"`;
  let s = `<path d="M52 86 L52 100 L68 100 L68 86Z" fill="${skin}" ${st}/><path d="M52 92 Q60 96 68 92" fill="none" stroke="${shade(skin, 0.8)}" stroke-width="1"/>`;
  const robe = L.robe || (L.hair === "topknot" ? "kimono" : "");
  if (robe === "junihitoe") {
    s += `<path d="M10 150 Q12 106 44 97 L76 97 Q108 106 110 150Z" fill="${c}" ${st}/>`;
    s += `<path d="M20 150 Q24 110 48 100 M100 150 Q96 110 72 100" fill="none" stroke="${t}" stroke-width="5"/><path d="M28 150 Q32 114 52 102 M92 150 Q88 114 68 102" fill="none" stroke="#2f9e44" stroke-width="5"/>`;
    s += `<path d="M48 98 L60 124 L72 98" fill="#f8f9fa" ${st}/>`;
  } else if (robe === "kimono" || robe === "hakama") {
    // 着物: 右前(着る人の左の身ごろが上)の襟の重なり、白い半襟、ひだ
    s += `<path d="M12 150 Q14 108 42 97 L78 97 Q106 108 108 150Z" fill="${c}" ${st}/>`;
    s += `<path d="M47 97 L62 132 L70 97" fill="#f8f9fa" ${st}/>`;
    s += `<path d="M73 97 L58 136 L64 150 L108 150 Q106 108 78 97Z" fill="${shade(c, 0.92)}" ${st}/>`;
    s += `<path d="M30 118 Q34 132 32 148 M90 116 Q86 132 88 148 M20 128 Q26 136 24 148" ${fold}/>`;
    if (robe === "hakama") {
      const hk = L.hakama || "#c9a227";
      s += `<path d="M22 132 Q60 126 98 132 L104 150 L16 150Z" fill="${hk}" ${st}/>`;
      s += `<path d="M22 132 Q60 126 98 132" fill="none" stroke="${shade(hk, 0.7)}" stroke-width="3"/>`;
      s += `<path d="M40 131 L36 150 M52 129.5 L50 150 M60 129 L60 150 M68 129.5 L70 150 M80 131 L84 150" stroke="${shade(hk, 0.62)}" stroke-width="1.2"/>`;
    }
  } else if (robe === "suit") {
    s += `<path d="M12 150 Q14 108 42 97 L78 97 Q106 108 108 150Z" fill="${c}" ${st}/>`;
    s += `<path d="M48 97 L60 118 L72 97Z" fill="#f8f9fa" ${st}/><path d="M57 100 L60 104 L63 100 L61.5 120 L60 124 L58.5 120Z" fill="${t}" ${st}/>`;
    s += `<path d="M48 97 L54 130 L42 114 L46 104Z M72 97 L66 130 L78 114 L74 104Z" fill="${shade(c, 0.85)}" ${st}/>`;
  } else {
    s += `<path d="M12 150 Q14 108 42 97 L78 97 Q106 108 108 150Z" fill="${c}" ${st}/>`;
    s += `<path d="M46 97 L60 116 L74 97" fill="${t}" ${st}/>`;
    s += `<path d="M30 118 Q34 132 32 148 M90 118 Q86 132 88 148" ${fold}/>`;
  }
  return s;
}

/** 人物1人分の SVG 文字列 */
export function characterSVG(person, size = 64) {
  const title = `<title>${esc(person.name)}(${esc(person.role)})</title>`;
  const W = size, H = size * 1.25;
  if (person.symbol) {
    return `<svg class="chara" viewBox="0 0 120 150" width="${W}" height="${H}" role="img" aria-label="${esc(person.name)}">${title}
      <circle cx="60" cy="70" r="48" fill="${person.color || "#495057"}" opacity=".15"/>
      <circle cx="60" cy="70" r="38" fill="#fff" stroke="${person.color || "#495057"}" stroke-width="3"/>
      <text x="60" y="84" text-anchor="middle" font-size="40">${person.symbol}</text></svg>`;
  }
  const L = person.look || {};
  const hc = L.hairColor || "#3b2a1a";
  const bc = L.beardColor || hc;
  const covered = L.hat === "scarf";
  const item = L.item
    ? `<circle cx="100" cy="130" r="15" fill="#fff" stroke="${INK}" stroke-width="1.5"/><text x="100" y="136.5" text-anchor="middle" font-size="17">${L.item}</text>`
    : "";
  return `<svg class="chara" viewBox="0 0 120 150" width="${W}" height="${H}" role="img" aria-label="${esc(person.name)}">${title}
    ${covered ? "" : hairBack(L.hair, hc)}
    ${body(L)}
    ${face(L, person.name)}
    ${beard(L.beard, bc)}
    ${covered ? "" : hairFront(L.hair, hc, L.skin)}
    ${hat(L.hat, L.trim, L.cloth)}
    ${item}
  </svg>`;
}

/** 出来事の登場人物(複数可)をまとめて描く */
export function charactersFor(event, size = 48) {
  return (event.p || []).map((p) => characterSVG(p, size)).join("");
}
