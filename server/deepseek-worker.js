// Soluna server — one Cloudflare Worker (free plan is enough).
//   POST /                AI reading (DeepSeek), members only
//   POST /checkout        start a Stripe Checkout page for the web app
//   POST /stripe-webhook  Stripe tells us a payment finished -> update Firestore
//   POST /rc-webhook      RevenueCat tells us an App Store purchase happened -> update Firestore
//
// Secrets (wrangler secret put …):
//   DEEPSEEK_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RC_WEBHOOK_AUTH,
//   GOOGLE_SA_JSON  (the whole service-account JSON from Firebase > Project settings > Service accounts)
// Vars: FIREBASE_PROJECT_ID=soluna-71703, ALLOWED_ORIGIN=https://yukilambo.github.io, APP_URL=https://yukilambo.github.io/soluna/

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const DAILY_LIMIT = 30; // AI reports per member per day (cost guard)

// Prices live on the server so nobody can change them in the browser. HKD cents.
const CATALOG = {
  "luna-month": { name: "Luna Plus 月費", amount: 2800, sub: "month", member: "luna" },
  "luna-year":  { name: "Luna Plus 年費", amount: 19800, sub: "year", member: "luna", trial: 7 },
  "sol-month":  { name: "Sol Pro 月費", amount: 5800, sub: "month", member: "sol" },
  "sol-year":   { name: "Sol Pro 年費", amount: 39800, sub: "year", member: "sol", trial: 7 },
  love:   { name: "愛情中的你", amount: 3800, own: "love" },
  career: { name: "天賦與事業", amount: 3800, own: "career" },
  money:  { name: "財運密碼", amount: 3800, own: "money" },
  soul:   { name: "你的靈魂課題", amount: 3800, own: "soul" },
  year:   { name: "年度運勢報告", amount: 9800, own: "year" },
  decade: { name: "十年人生報告", amount: 12800, own: "decade" },
  compat: { name: "合盤報告", amount: 4800, own: "compat:" },
  p5:  { name: "占卜 5 次", amount: 1800, credits: 5 },
  p15: { name: "占卜 15 次", amount: 4500, credits: 15 },
  p40: { name: "占卜 40 次", amount: 9800, credits: 40 },
};
const SOL_DISCOUNT = 0.8; // Sol Pro members pay 80% for one-off reports
// App Store product ids are "soluna_" + key with "-" -> "_" (e.g. soluna_sol_year, soluna_p15, soluna_compat).
const fromStoreId = id => String(id || "").replace(/^soluna_/, "").replace(/_/g, "-");

const enc = new TextEncoder(), dec = new TextDecoder();
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const toB64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (o, status, cors = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...cors } });

async function verifyFirebaseToken(token, projectId) {
  const [h, p, sig] = token.split(".");
  if (!sig) throw new Error("bad token");
  const header = JSON.parse(dec.decode(b64url(h)));
  const payload = JSON.parse(dec.decode(b64url(p)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}` || payload.exp < now || !payload.sub) throw new Error("bad claims");
  const { keys } = await (await fetch(JWKS_URL, { cf: { cacheTtl: 3600 } })).json();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error("bad signature");
  return { uid: payload.sub, email: payload.email || "" };
}

/* ---------- Firestore as the server (service account, bypasses client rules) ---------- */
let saToken = null;
async function googleToken(env) {
  if (saToken && saToken.exp > Date.now() + 60000) return saToken.value;
  const sa = JSON.parse(env.GOOGLE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const head = toB64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = toB64url(enc.encode(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })));
  const pem = sa.private_key.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = toB64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${body}`)));
  const r = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${body}.${sig}` })).json();
  if (!r.access_token) throw new Error("google token");
  saToken = { value: r.access_token, exp: Date.now() + r.expires_in * 1000 };
  return saToken.value;
}
const docName = (env, path) => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
async function fsGet(env, path) {
  const r = await fetch(`https://firestore.googleapis.com/v1/${docName(env, path)}`, { headers: { authorization: "Bearer " + await googleToken(env) } });
  return r.ok ? r.json() : null;
}
// grant: { member?: "luna"|"sol"|false, own?: string, credits?: number, extra?: {field: string} }
// eventId makes every webhook safe to receive twice: the commit fails if payments/{eventId} already exists.
async function applyGrant(env, uid, grant, eventId, source) {
  const user = docName(env, `users/${uid}`);
  const fields = {}, mask = [], transforms = [];
  if (grant.member !== undefined) { fields.member = grant.member ? { stringValue: grant.member } : { booleanValue: false }; mask.push("member"); fields.memberSource = { stringValue: source }; mask.push("memberSource"); }
  for (const [k, v] of Object.entries(grant.extra || {})) { fields[k] = { stringValue: String(v) }; mask.push(k); }
  if (grant.own) transforms.push({ fieldPath: "owned", appendMissingElements: { values: [{ stringValue: grant.own }] } });
  if (grant.credits) transforms.push({ fieldPath: "credits", increment: { integerValue: String(grant.credits) } });
  const writes = [
    { update: { name: docName(env, `payments/${eventId}`), fields: { uid: { stringValue: uid }, source: { stringValue: source }, grant: { stringValue: JSON.stringify(grant) }, at: { timestampValue: new Date().toISOString() } } }, currentDocument: { exists: false } },
    { update: { name: user, fields }, updateMask: { fieldPaths: mask }, updateTransforms: transforms },
  ];
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + await googleToken(env) }, body: JSON.stringify({ writes }),
  });
  if (r.ok) return "ok";
  const t = await r.text();
  if (/ALREADY_EXISTS|already exists/i.test(t)) return "duplicate";
  throw new Error("firestore " + r.status + " " + t.slice(0, 300));
}
function grantFor(key, partnerId) {
  const item = CATALOG[key];
  if (!item) return null;
  if (item.member) return { member: item.member };
  if (item.credits) return { credits: item.credits };
  if (item.own === "compat:") return { own: partnerId ? "compat:" + partnerId : "compat" };
  return { own: item.own };
}

/* ---------- Stripe ---------- */
const form = (obj, prefix = "", out = []) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out); else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
  }
  return out.join("&");
};
const stripe = async (env, path, body) => {
  const r = await fetch("https://api.stripe.com/v1/" + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" }, body: body ? form(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "stripe");
  return j;
};
async function verifyStripe(raw, header, secret) {
  const parts = Object.fromEntries(String(header || "").split(",").map(s => s.split("=")));
  const t = parts.t, v1 = String(header || "").split(",").filter(s => s.startsWith("v1=")).map(s => s.slice(3));
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - +t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)))].map(b => b.toString(16).padStart(2, "0")).join("");
  return v1.includes(mac);
}

async function checkout(req, env, cors) {
  let who;
  try { who = await verifyFirebaseToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env.FIREBASE_PROJECT_ID); } catch (e) { return json({ error: "signin" }, 401, cors); }
  const { key, partner, back } = await req.json().catch(() => ({}));
  const item = CATALOG[key];
  if (!item) return json({ error: "product" }, 400, cors);
  const partnerId = key === "compat" && typeof partner === "string" ? partner.replace(/[^\w-]/g, "").slice(0, 40) : "";
  const doc = await fsGet(env, `users/${who.uid}`);
  const m = doc?.fields?.member, isSol = m?.booleanValue === true || m?.stringValue === "sol";
  if (item.member && (m?.stringValue === item.member || (isSol && item.member === "luna"))) return json({ error: "already" }, 409, cors);
  const amount = !item.sub && isSol ? Math.round(item.amount * SOL_DISCOUNT) : item.amount;
  const app = env.APP_URL || "https://yukilambo.github.io/soluna/";
  const backHash = typeof back === "string" && /^#[\w\/-]{0,40}$/.test(back) ? back : "#shop";
  const meta = { uid: who.uid, key, partner: partnerId };
  const s = await stripe(env, "checkout/sessions", {
    mode: item.sub ? "subscription" : "payment",
    client_reference_id: who.uid,
    customer_email: who.email || undefined,
    locale: "zh-HK",
    allow_promotion_codes: "true",
    line_items: { 0: { quantity: 1, price_data: { currency: "hkd", unit_amount: amount, product_data: { name: item.name }, recurring: item.sub ? { interval: item.sub } : undefined } } },
    metadata: meta,
    subscription_data: item.sub ? { metadata: meta, trial_period_days: item.trial || undefined } : undefined,
    payment_intent_data: item.sub ? undefined : { metadata: meta },
    success_url: `${app}?paid=1${backHash}`,
    cancel_url: `${app}${backHash}`,
  });
  return json({ url: s.url }, 200, cors);
}

async function stripeWebhook(req, env) {
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) return json({ error: "signature" }, 400);
  const ev = JSON.parse(raw), o = ev.data?.object || {};
  try {
    if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
      if (o.payment_status === "unpaid" && o.mode === "payment") return json({ ok: "waiting" }, 200); // e.g. bank transfer not cleared yet
      const { uid, key, partner } = o.metadata || {};
      const g = uid && grantFor(key, partner);
      if (!g) return json({ ok: "ignored" }, 200);
      if (o.subscription) g.extra = { stripeSub: o.subscription, stripeCustomer: o.customer || "" };
      return json({ ok: await applyGrant(env, uid, g, "stripe_" + ev.id, "stripe") }, 200);
    }
    if (ev.type === "customer.subscription.deleted" || (ev.type === "customer.subscription.updated" && ["unpaid", "canceled", "incomplete_expired"].includes(o.status))) {
      const uid = o.metadata?.uid;
      if (!uid) return json({ ok: "ignored" }, 200);
      const doc = await fsGet(env, `users/${uid}`);
      if (doc?.fields?.stripeSub?.stringValue !== o.id) return json({ ok: "not-current" }, 200); // they moved to another plan or to the App Store
      return json({ ok: await applyGrant(env, uid, { member: false }, "stripe_" + ev.id, "stripe") }, 200);
    }
    return json({ ok: "ignored" }, 200);
  } catch (e) { return json({ error: String(e.message || e) }, 500); } // Stripe retries on 5xx
}

/* ---------- RevenueCat (App Store) ---------- */
async function rcWebhook(req, env) {
  if ((req.headers.get("authorization") || "") !== "Bearer " + env.RC_WEBHOOK_AUTH) return json({ error: "auth" }, 401);
  const { event: e } = await req.json().catch(() => ({}));
  if (!e) return json({ error: "body" }, 400);
  const uid = e.app_user_id;
  if (!uid || uid.startsWith("$RCAnonymousID")) return json({ ok: "anonymous" }, 200); // app always calls Purchases.logIn(uid) first
  if (e.environment === "SANDBOX" && env.RC_ALLOW_SANDBOX !== "1") return json({ ok: "sandbox" }, 200);
  const key = fromStoreId(e.product_id), partner = e.subscriber_attributes?.compat_partner?.value || "";
  try {
    if (["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE"].includes(e.type)) {
      const nk = e.type === "PRODUCT_CHANGE" && e.new_product_id ? fromStoreId(e.new_product_id) : key;
      const g = grantFor(nk, partner);
      if (!g) return json({ ok: "unknown-product" }, 200);
      if (g.member) g.extra = { rcProduct: nk };
      return json({ ok: await applyGrant(env, uid, g, "rc_" + e.id, "appstore") }, 200);
    }
    if (e.type === "EXPIRATION") {
      const doc = await fsGet(env, `users/${uid}`);
      if (doc?.fields?.memberSource?.stringValue !== "appstore") return json({ ok: "not-current" }, 200);
      return json({ ok: await applyGrant(env, uid, { member: false }, "rc_" + e.id, "appstore") }, 200);
    }
    return json({ ok: "ignored" }, 200); // CANCELLATION only turns off auto-renew; access ends at EXPIRATION
  } catch (err) { return json({ error: String(err.message || err) }, 500); }
}

/* ---------- AI ---------- */
async function ai(req, env, cors) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let uid;
  try { uid = (await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID)).uid; } catch (e) { return json({ error: "signin" }, 401, cors); }
  const docUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const doc = await (await fetch(docUrl, { headers: { authorization: "Bearer " + token } })).json();
  const m = doc?.fields?.member, owned = (doc?.fields?.owned?.arrayValue?.values || []).length;
  if (!(m?.booleanValue === true || ["sol", "luna"].includes(m?.stringValue) || owned)) return json({ error: "locked" }, 402, cors);

  const day = new Date().toISOString().slice(0, 10), ck = new Request(`https://quota.local/${uid}/${day}`), cache = caches.default;
  const used = parseInt((await (await cache.match(ck))?.text()) || "0", 10);
  if (used >= DAILY_LIMIT) return json({ error: "rate_limited" }, 429, cors);
  await cache.put(ck, new Response(String(used + 1), { headers: { "cache-control": "max-age=90000" } }));

  const { prompt } = await req.json().catch(() => ({}));
  if (!prompt || typeof prompt !== "string" || prompt.length > 16000) return json({ error: "prompt" }, 400, cors);
  const ds = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + env.DEEPSEEK_API_KEY },
    body: JSON.stringify({ model: "deepseek-chat", stream: true, max_tokens: 2000, temperature: 0.8, messages: [{ role: "user", content: prompt }] }),
  });
  if (!ds.ok) return json({ error: "upstream", status: ds.status }, 502, cors);
  return new Response(ds.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...cors } });
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    // Webhooks are server-to-server: no CORS.
    if (req.method === "POST" && path === "/stripe-webhook") return stripeWebhook(req, env);
    if (req.method === "POST" && path === "/rc-webhook") return rcWebhook(req, env);
    const origin = req.headers.get("origin") || "";
    const allowed = [env.ALLOWED_ORIGIN, "capacitor://localhost", "https://localhost"].filter(Boolean);
    const cors = { "access-control-allow-origin": allowed.includes(origin) ? origin : (env.ALLOWED_ORIGIN || "*"), "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ error: "method" }, 405, cors);
    try {
      if (path === "/checkout") return await checkout(req, env, cors);
      return await ai(req, env, cors);
    } catch (e) { return json({ error: String(e.message || e) }, 500, cors); }
  },
};
