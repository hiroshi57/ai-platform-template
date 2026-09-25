// GET /api/claim?session_id=cs_... → 支払い済みなら、ライセンスコードを発行してクッキーに保存する
import { stripe, isPaidSession, signLicense, licenseCookie, send } from "./_lib.js";

export default async function handler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  const sid = new URL(req.url, "http://x").searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return send(res, 400, { error: "購入の情報が正しくありません" });
  try {
    const s = await stripe(`checkout/sessions/${sid}`, { env, fetchImpl });
    if (!isPaidSession(s)) return send(res, 402, { error: "お支払いが確認できませんでした" });
    // 同じ購入からは毎回同じコードになる(iat は Stripe の作成時刻)
    const code = signLicense({ v: 1, sid: s.id, iat: s.created, live: s.livemode === true }, env);
    return send(res, 200, { ok: true, code }, { "Set-Cookie": licenseCookie(code) });
  } catch (e) {
    console.error("claim", e.message);
    return send(res, 500, { error: "購入の確認中にエラーが起きました。時間をおいてもう一度お試しください。" });
  }
}
