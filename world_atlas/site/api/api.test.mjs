// node --test world_atlas/site/api/api.test.mjs(Stripe は偽物に差しかえる。ネットワーク不要)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signLicense, verifyLicense, checkoutParams, isPaidSession, readCookie, PRODUCT } from "./_lib.js";
import checkout from "./checkout.js";
import claim from "./claim.js";
import redeem from "./redeem.js";
import license from "./license.js";
import data from "./data.js";

const env = { LICENSE_SECRET: "x".repeat(40), STRIPE_SECRET_KEY: "sk_test_dummy", SITE_URL: "https://example.test" };
const PAID = { id: "cs_test_abc123", object: "checkout.session", payment_status: "paid", mode: "payment", currency: "jpy",
  amount_total: 990, created: 1790000000, livemode: false, payment_intent: "pi_1", url: "https://checkout.stripe.com/c/pay/cs_test_abc123" };

function mockRes() {
  const r = { statusCode: 0, headers: {}, body: "" };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (b) => { r.body = b ? b.toString() : ""; };
  r.json = () => JSON.parse(r.body);
  return r;
}
function mockFetch(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    const [status, body] = hit ? hit[1] : [404, { error: { message: "not found" } }];
    return { ok: status < 400, status, json: async () => body };
  };
  f.calls = calls;
  return f;
}
const req = (method, url, extra = {}) => ({ method, url, headers: {}, ...extra });

test("license code: sign/verify, tamper detection", () => {
  const code = signLicense({ v: 1, sid: "cs_test_1", iat: 1 }, env);
  assert.deepEqual(verifyLicense(code, env), { v: 1, sid: "cs_test_1", iat: 1 });
  assert.equal(verifyLicense(code.slice(0, -2) + "AA", env), null);
  assert.equal(verifyLicense(code, { LICENSE_SECRET: "y".repeat(40) }), null);
  assert.equal(verifyLicense("garbage", env), null);
  assert.throws(() => signLicense({ v: 1, sid: "x" }, { LICENSE_SECRET: "short" }));
});

test("checkout params: one-time 990 JPY and safe URLs", () => {
  const p = checkoutParams(env);
  assert.equal(p.mode, "payment");
  assert.equal(p["line_items[0][price_data][unit_amount]"], "990");
  assert.equal(p["line_items[0][price_data][currency]"], "jpy");
  assert.match(p.success_url, /^https:\/\/example\.test\/\?purchase=success&session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.throws(() => checkoutParams({ SITE_URL: "javascript:alert(1)" }));
  assert.equal(PRODUCT.amount, 990);
});

test("isPaidSession checks status, amount and currency", () => {
  assert.equal(isPaidSession(PAID), true);
  assert.equal(isPaidSession({ ...PAID, payment_status: "unpaid" }), false);
  assert.equal(isPaidSession({ ...PAID, amount_total: 1 }), false);
  assert.equal(isPaidSession({ ...PAID, currency: "usd" }), false);
});

test("POST /api/checkout returns the Stripe URL", async () => {
  const f = mockFetch({ "checkout/sessions": [200, PAID] });
  const res = mockRes();
  await checkout(req("POST", "/api/checkout"), res, { env, fetchImpl: f });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().url, PAID.url);
  assert.equal(f.calls[0].opts.headers.Authorization, "Bearer sk_test_dummy");
  assert.match(f.calls[0].opts.body, /unit_amount%5D=990/);
  const bad = mockRes();
  await checkout(req("GET", "/api/checkout"), bad, { env, fetchImpl: f });
  assert.equal(bad.statusCode, 405);
});

test("GET /api/claim issues an HttpOnly cookie only for paid sessions", async () => {
  const res = mockRes();
  await claim(req("GET", "/api/claim?session_id=cs_test_abc123"), res, { env, fetchImpl: mockFetch({ "checkout/sessions/cs_test_abc123": [200, PAID] }) });
  assert.equal(res.statusCode, 200);
  const { code } = res.json();
  assert.ok(verifyLicense(code, env));
  assert.match(res.headers["set-cookie"], /^atlas_lic=.+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);

  const unpaid = mockRes();
  await claim(req("GET", "/api/claim?session_id=cs_test_abc123"), unpaid, { env, fetchImpl: mockFetch({ "checkout/sessions/": [200, { ...PAID, payment_status: "unpaid" }] }) });
  assert.equal(unpaid.statusCode, 402);
  assert.equal(unpaid.headers["set-cookie"], undefined);

  const injected = mockRes();
  await claim(req("GET", "/api/claim?session_id=../../v1/charges"), injected, { env, fetchImpl: mockFetch({}) });
  assert.equal(injected.statusCode, 400);
});

test("POST /api/redeem rejects forged and refunded codes", async () => {
  const code = signLicense({ v: 1, sid: "cs_test_abc123", iat: 1 }, env);
  const ok = mockRes();
  await redeem(req("POST", "/api/redeem", { body: { code } }), ok, { env, fetchImpl: mockFetch({
    "checkout/sessions/": [200, PAID], "payment_intents/pi_1": [200, { latest_charge: "ch_1" }], "charges/ch_1": [200, { refunded: false }] }) });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.headers["set-cookie"]);

  const refunded = mockRes();
  await redeem(req("POST", "/api/redeem", { body: { code } }), refunded, { env, fetchImpl: mockFetch({
    "checkout/sessions/": [200, PAID], "payment_intents/pi_1": [200, { latest_charge: "ch_1" }], "charges/ch_1": [200, { refunded: true }] }) });
  assert.equal(refunded.statusCode, 402);

  const forged = mockRes();
  await redeem(req("POST", "/api/redeem", { body: { code: "SK1.abc.def" } }), forged, { env, fetchImpl: mockFetch({}) });
  assert.equal(forged.statusCode, 400);
});

test("GET /api/license and /api/data require a valid cookie", async () => {
  const code = signLicense({ v: 1, sid: "cs_test_abc123", iat: 1 }, env);
  const cookie = `foo=1; atlas_lic=${encodeURIComponent(code)}`;
  assert.equal(readCookie({ headers: { cookie } }), code);

  const l1 = mockRes(); license(req("GET", "/api/license"), l1, { env });
  assert.equal(l1.json().paid, false);
  const l2 = mockRes(); license(req("GET", "/api/license", { headers: { cookie } }), l2, { env });
  assert.equal(l2.json().paid, true);

  const root = mkdtempSync(path.join(tmpdir(), "paid-"));
  mkdirSync(path.join(root, "series"));
  writeFileSync(path.join(root, "series", "pop_hist.json"), '{"id":"pop_hist"}');
  const noLic = mockRes();
  await data(req("GET", "/api/data?f=series/pop_hist.json"), noLic, { env, root });
  assert.equal(noLic.statusCode, 401);
  const withLic = mockRes();
  await data(req("GET", "/api/data?f=series/pop_hist.json", { headers: { cookie } }), withLic, { env, root });
  assert.equal(withLic.statusCode, 200);
  assert.equal(withLic.body, '{"id":"pop_hist"}');
  for (const f of ["../_lib.js", "series/../../x.json", "series/POP.json", "/etc/passwd"]) {
    const r = mockRes();
    await data(req("GET", `/api/data?f=${encodeURIComponent(f)}`, { headers: { cookie } }), r, { env, root });
    assert.equal(r.statusCode, 400, f);
  }
});
