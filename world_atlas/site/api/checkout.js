// POST /api/checkout → Stripe の決済画面の URL を返す(買い切り 990円)
import { stripe, checkoutParams, send } from "./_lib.js";

export default async function handler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (req.method !== "POST") return send(res, 405, { error: "POST のみ" });
  try {
    const s = await stripe("checkout/sessions", { method: "POST", params: checkoutParams(env), env, fetchImpl });
    return send(res, 200, { url: s.url });
  } catch (e) {
    console.error("checkout", e.message);
    return send(res, 500, { error: "決済画面を開けませんでした。時間をおいてもう一度お試しください。" });
  }
}
