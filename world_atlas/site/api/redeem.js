// POST /api/redeem {code} → 別の端末でライセンスコードを入力したとき。署名と、Stripe 上の支払いを確かめてクッキーに保存
import { verifyLicense, checkPurchase, sessionToken, licenseCookie, send } from "./_lib.js";

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

export default async function handler(req, res, { env = process.env, fetchImpl = fetch, now } = {}) {
  if (req.method !== "POST") return send(res, 405, { error: "POST のみ" });
  const { code } = await readJson(req);
  const lic = verifyLicense(code, env);
  // 入力できるのは期限のない「ライセンスコード」だけ(クッキーの中身は受け付けない)
  if (!lic || lic.exp) return send(res, 400, { error: "ライセンスコードが正しくありません" });
  try {
    // 返金された購入などは使えないようにする
    const chk = await checkPurchase(lic.sid, { env, fetchImpl });
    if (!chk.ok) return send(res, 402, { error: chk.reason });
    return send(res, 200, { ok: true }, { "Set-Cookie": licenseCookie(sessionToken(lic, env, now)) });
  } catch (e) {
    console.error("redeem", e.message);
    return send(res, 500, { error: "確認中にエラーが起きました。時間をおいてもう一度お試しください。" });
  }
}
