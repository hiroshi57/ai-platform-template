// POST /api/redeem {code} → 別の端末でライセンスコードを入力したとき。署名と、Stripe 上の支払いを確かめてクッキーに保存
import { verifyLicense, stripe, isPaidSession, licenseCookie, send } from "./_lib.js";

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

export default async function handler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (req.method !== "POST") return send(res, 405, { error: "POST のみ" });
  const { code } = await readJson(req);
  const lic = verifyLicense(code, env);
  if (!lic) return send(res, 400, { error: "ライセンスコードが正しくありません" });
  try {
    // 返金された購入などは使えないようにする
    const s = await stripe(`checkout/sessions/${lic.sid}`, { env, fetchImpl });
    if (!isPaidSession(s)) return send(res, 402, { error: "この購入は有効ではありません" });
    const pi = s.payment_intent ? await stripe(`payment_intents/${s.payment_intent}`, { env, fetchImpl }) : null;
    if (pi?.latest_charge) {
      const ch = await stripe(`charges/${pi.latest_charge}`, { env, fetchImpl });
      if (ch.refunded) return send(res, 402, { error: "この購入は返金済みです" });
    }
    return send(res, 200, { ok: true }, { "Set-Cookie": licenseCookie(code.trim()) });
  } catch (e) {
    console.error("redeem", e.message);
    return send(res, 500, { error: "確認中にエラーが起きました。時間をおいてもう一度お試しください。" });
  }
}
