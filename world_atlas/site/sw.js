// せかい3Dデジタル図鑑: オフライン対応(サービスワーカー)
// 一度開いた画面・データ・3D地球儀のライブラリを保存し、通信が弱い教室でも使えるようにする。
// データは「保存した分をすぐ表示し、裏で最新版に更新する」(stale-while-revalidate)。
const VERSION = "atlas-v4";
const SHELL = [
  "./", "index.html", "style.css",
  "js/app.js", "js/analytics.js", "js/charts.js", "js/characters.js", "js/quiz.js",
  "data/catalog.json", "data/countries.json", "data/latest.json", "data/meta.json",
  "data/geo/countries.json", "data/timeline.json", "data/glossary.json",
  "data/flows/refugees.json", "data/exports.json", "data/update_report.json",
];
const CDN = [
  "https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js",
  "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg",
  "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png",
  "https://cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 1つ失敗しても残りは保存する(addAll は1つでも失敗すると全体が失敗するため)
    await Promise.all([...SHELL, ...CDN].map((u) => cache.add(new Request(u, { mode: u.startsWith("http") ? "no-cors" : "same-origin" })).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 保存した分をすぐ返し、裏で取り直して保存を更新する
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then((res) => {
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await fresh) || new Response("offline", { status: 503, statusText: "offline" });
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin
    || url.hostname === "cdn.jsdelivr.net"
    || url.hostname === "flagcdn.com";
  if (!cacheable) return; // Wikipedia などは保存しない
  ev.respondWith(staleWhileRevalidate(req));
});

// 画面からの依頼で、全指標のデータ(series)をまとめて保存する
self.addEventListener("message", (ev) => {
  if (ev.data?.type !== "prefetch") return;
  const urls = ev.data.urls || [];
  ev.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    let done = 0;
    for (const u of urls) {
      try {
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res);
      } catch { /* 取れなかった分は次回 */ }
      done++;
      if (done % 5 === 0 || done === urls.length) ev.source?.postMessage({ type: "prefetch-progress", done, total: urls.length });
    }
  })());
});
