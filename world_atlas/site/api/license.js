// GET /api/license → この端末が完全版かどうか。
// 期限内のクッキーは署名だけで判断(速い)。期限が切れていたら Stripe で支払い・返金を確かめ直し、クッキーを更新する。
import { cookiePayload, checkPurchase, sessionToken, licenseCookie, clearCookie, send } from "./_lib.js";

export default async function handler(req, res, { env = process.env, fetchImpl = fetch, now = Math.floor(Date.now() / 1000) } = {}) {
  let p = null;
  try { p = cookiePayload(req, env); } catch { p = null; }
  if (!p) return send(res, 200, { paid: false });
  if (p.exp > now) return send(res, 200, { paid: true });
  try {
    const chk = await checkPurchase(p.sid, { env, fetchImpl });
    if (!chk.ok) return send(res, 200, { paid: false, reason: chk.reason }, { "Set-Cookie": clearCookie() });
    return send(res, 200, { paid: true }, { "Set-Cookie": licenseCookie(sessionToken(p, env, now)) });
  } catch (e) {
    // Stripe に一時的につながらないときは、購入者を困らせないよう今回は有効のままにする(次回また確かめる)
    console.error("license refresh", e.message);
    return send(res, 200, { paid: true, stale: true });
  }
}
