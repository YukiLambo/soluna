// Soluna AI proxy — Cloudflare Worker (free plan is enough).
// Keeps the DeepSeek API key on the server. Only signed-in members can generate reports.
// Secrets / vars to set in Cloudflare: DEEPSEEK_API_KEY (secret), FIREBASE_PROJECT_ID, ALLOWED_ORIGIN (e.g. https://yukilambo.github.io)
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const DAILY_LIMIT = 30; // reports per member per day (cost guard)

const b64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const json = (o, status, cors) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...cors } });

async function verifyFirebaseToken(token, projectId) {
  const [h, p, sig] = token.split(".");
  if (!sig) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}` || payload.exp < now || !payload.sub) throw new Error("bad claims");
  const { keys } = await (await fetch(JWKS_URL, { cf: { cacheTtl: 3600 } })).json();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("bad signature");
  return payload.sub;
}

export default {
  async fetch(req, env) {
    const cors = { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ error: "method" }, 405, cors);
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    let uid;
    try { uid = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID); } catch (e) { return json({ error: "signin" }, 401, cors); }

    // Membership is read from Firestore with the user's own token (the rules stop users from setting it themselves).
    const docUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
    const doc = await (await fetch(docUrl, { headers: { authorization: "Bearer " + token } })).json();
    if (doc?.fields?.member?.booleanValue !== true) return json({ error: "locked" }, 402, cors);

    // Simple per-day limit using the Cache API as a counter (good enough for a small app).
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
  },
};
