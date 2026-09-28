// 購入・ライセンスの共通処理(Vercel Functions / Node)。外部ライブラリは使わない。
// 必要な環境変数(Vercel の Environment Variables に登録する。リポジトリには入れない):
//   STRIPE_SECRET_KEY … Stripe の秘密鍵(テストは sk_test_...)
//   LICENSE_SECRET    … ライセンスに署名するための長いランダムな文字列(32文字以上)
//   SITE_URL          … 例 https://sekai-3d-zukan.vercel.app(決済後に戻るページ)
import { createHmac, timingSafeEqual } from "node:crypto";

export const PRODUCT = { name: "せかい3Dデジタル図鑑 完全版(買い切り)", amount: 990, currency: "jpy" };
export const COOKIE = "atlas_lic";
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function secret(env) {
  const s = env.LICENSE_SECRET || "";
  if (s.length < 32) throw new Error("LICENSE_SECRET が未設定か短すぎます(32文字以上)");
  return s;
}

/** ライセンスコード = 本文(購入の ID と日時)+ 署名。署名は LICENSE_SECRET でしか作れない */
export function signLicense(payload, env) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret(env)).update(body).digest());
  return `SK1.${body}.${sig}`;
}

export function verifyLicense(code, env) {
  if (typeof code !== "string") return null;
  const m = /^SK1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) return null;
  const expected = createHmac("sha256", secret(env)).update(m[1]).digest();
  const got = fromB64url(m[2]);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(fromB64url(m[1]).toString("utf8"));
    return p && p.v === 1 && p.sid ? p : null;
  } catch {
    return null;
  }
}

export function readCookie(req, name = COOKIE) {
  const raw = req.headers?.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// 端末のクッキーは「期限つきのセッション」。7日ごとに Stripe で支払い(返金されていないか)を確かめ直す。
// ユーザーに見せる「ライセンスコード」は期限なし(別の端末で入力するため)。
export const REFRESH_SECONDS = 60 * 60 * 24 * 7;
const nowSec = () => Math.floor(Date.now() / 1000);

/** クッキー用の期限つきトークン */
export function sessionToken(lic, env, now = nowSec()) {
  return signLicense({ v: 1, sid: lic.sid, iat: lic.iat, live: lic.live === true, exp: now + REFRESH_SECONDS }, env);
}

export function licenseCookie(token) {
  // クッキー自体は長く残し、中の exp で確かめ直しの時期を決める
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${TEN_YEARS}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** 署名が正しいクッキーの中身(期限切れも含む)。確かめ直しに使う */
export function cookiePayload(req, env) {
  const p = verifyLicense(readCookie(req), env);
  return p && typeof p.exp === "number" ? p : null;
}

/** 有効なライセンス(署名が正しく、期限内)。データの配信はこれで判断する */
export function licenseFromRequest(req, env, now = nowSec()) {
  const p = cookiePayload(req, env);
  return p && p.exp > now ? p : null;
}

/** Stripe で、支払い済みで返金されていない購入か確かめる */
export async function checkPurchase(sid, { env, fetchImpl = fetch }) {
  const s = await stripe(`checkout/sessions/${sid}`, { env, fetchImpl });
  if (!isPaidSession(s)) return { ok: false, reason: "この購入は有効ではありません", session: s };
  const pi = s.payment_intent ? await stripe(`payment_intents/${s.payment_intent}`, { env, fetchImpl }) : null;
  if (pi?.latest_charge) {
    const ch = await stripe(`charges/${pi.latest_charge}`, { env, fetchImpl });
    if (ch.refunded) return { ok: false, reason: "この購入は返金済みです", session: s };
  }
  return { ok: true, session: s };
}

/** Stripe API を呼ぶ(form 形式)。fetchImpl はテストで差しかえる */
export async function stripe(path, { method = "GET", params = null, env, fetchImpl = fetch } = {}) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY が未設定です");
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message || "error"}`);
  return data;
}

/** 買い切りの Checkout セッションを作るときのパラメータ */
export function checkoutParams(env) {
  const site = (env.SITE_URL || "").replace(/\/$/, "");
  if (!/^https:\/\//.test(site) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(site)) throw new Error("SITE_URL が不正です");
  return {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": PRODUCT.currency,
    "line_items[0][price_data][unit_amount]": String(PRODUCT.amount),
    "line_items[0][price_data][product_data][name]": PRODUCT.name,
    locale: "ja",
    customer_creation: "always",
    "invoice_creation[enabled]": "true",
    success_url: `${site}/?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/?purchase=cancel#m=plans`,
  };
}

/** 支払い済みの Checkout セッションか(金額・通貨も確認する) */
export function isPaidSession(s) {
  return !!s && s.payment_status === "paid" && s.mode === "payment"
    && s.currency === PRODUCT.currency && Number(s.amount_total) === PRODUCT.amount;
}

export function send(res, status, obj, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}
