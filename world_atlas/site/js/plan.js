// 無料版と有料版(買い切り)の範囲。ここを変えれば画面の🔒と案内がすべて変わる。
// 注意: 画面側の制限だけでは、公開ファイルのデータ自体は守れない。
//       有料データの保護は、購入者だけにサーバーから配信する仕組み(Task-lists T9-B3)で行う。

export const PLAN = {
  name: "せかい3Dデジタル図鑑 完全版",
  price: null, // 価格は未定(決まったら円で入れる。例 2980)
  // 無料版で使える指標(各章の代表。歴史のデータの章は有料)
  freeIndicators: [
    "land_area", "forest", "density", "precip",
    "population", "pop_growth", "urban", "fertility", "age65",
    "co2_pc", "renewable", "pm25",
    "thr_mammal", "protected_land",
    "gdp_pc", "gdp", "poverty", "internet", "electricity",
    "life_exp", "u5_mort", "water",
    "literacy", "secondary",
    "conflict_deaths", "refugees_out",
    "hdi",
  ],
  // 無料版で使える画面
  freeModes: ["globe", "rank", "timeline", "sdg", "quiz", "guide", "sources", "plans"],
  // 有料版の機能(キー → 画面に出す説明)
  paidFeatures: {
    allIndicators: "全10章・98指標(無料版は27指標)",
    history: "📜 歴史のデータ(人口は紀元前1万年から・民主主義・寿命・GDP の数百年)",
    years: "⏳ 年スライダーと再生(過去から現在までの変化)",
    forecast: "🔮 2030年の予測",
    compare: "⚖️ くらべる(最大4か国・日本とくらべる)",
    classify: "🧩 分類(散布図・データが似ている国)",
    viz: "📊 3D棒グラフ・難民の流れの弧",
    exports: "🚢 国ごとの主な輸出品",
    factbookJa: "🗒️ CIA の歴史の背景(日本語要約)",
    print: "🖨️ 国別の印刷用ページ(PDF 保存)",
    quizFull: "🧠 クイズ10問・ワークシート印刷(無料版は5問)",
    offline: "📥 オフライン保存",
  },
  freeQuizQuestions: 5,
};

/** 有料版かどうか。購入の仕組み(T9-B)ができるまでは、ローカル確認用の切りかえだけ */
export function isPaidFromStorage(storage, location) {
  // 開発中の確認用: 手元(localhost/127.0.0.1)でだけ #plan=paid を有効にする
  const local = /^(localhost|127\.0\.0\.1)$/.test(location?.hostname || "");
  if (local && /(^|[#&])plan=paid(&|$)/.test(location?.hash || "")) return true;
  return storage?.getItem?.("atlas-license") === "valid"; // T9-B で本物のライセンス確認に置きかえる
}

export function canUseIndicator(id, paid) {
  if (paid) return true;
  if (id?.startsWith("sdg:")) return true; // SDGs スコアの地球儀は無料
  return PLAN.freeIndicators.includes(id);
}

export function canUseMode(mode, paid) {
  return paid || PLAN.freeModes.includes(mode);
}

export function canUseFeature(key, paid) {
  return paid || !(key in PLAN.paidFeatures);
}
