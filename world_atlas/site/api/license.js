// GET /api/license → この端末が完全版かどうか(クッキーの署名だけを確かめる。Stripe は呼ばない)
import { licenseFromRequest, send } from "./_lib.js";

export default function handler(req, res, { env = process.env } = {}) {
  let paid = false;
  try { paid = !!licenseFromRequest(req, env); } catch { paid = false; }
  return send(res, 200, { paid });
}
