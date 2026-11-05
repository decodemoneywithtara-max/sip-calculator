// Tara's comment-to-DM bot (our own ManyChat), the shared logic. Used by netlify/functions/ig-webhook.mjs and
// ig-token-refresh.mjs. Meta app "Tara Replies" (Instagram API, Unified login), Standard Access, Tara's own account only.
// A comment holding a keyword from bot/keywords.mjs gets one private-reply DM and a short public reply.
// Netlify env: IG_ACCESS_TOKEN, IG_APP_SECRET (comma-separated if more than one), IG_VERIFY_TOKEN, IG_APP_ID (token
// renewal); optional IG_API_VERSION. Unified login gives a Facebook-style token (EAA...): it is used on graph.facebook.com;
// an Instagram-login token (IG...) on graph.instagram.com.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import KEYWORDS from "./keywords.mjs";

// Netlify Functions can expose variables through Netlify.env (always) and process.env; read both.
export const env = (k) => {
  try { const v = globalThis.Netlify?.env?.get(k); if (v) return v; } catch (e) {}
  return process.env[k] || "";
};
export const apiHost = (token) => (String(token).startsWith("IG") ? "graph.instagram.com" : "graph.facebook.com");
const API = (token) => `https://${apiHost(token)}/${env("IG_API_VERSION") || "v24.0"}`;
const DAY = 24 * 3600 * 1000;

// ---- storage: Netlify Blobs on Netlify, memory when run locally (tests) ----
let memory = null;
export async function store() {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: "ig-bot", consistency: "strong" });
  } catch (e) {
    if (!memory) {
      const m = new Map();
      memory = {
        get: async (k, o) => (m.has(k) ? (o?.type === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
        setJSON: async (k, v) => void m.set(k, JSON.stringify(v)),
        set: async (k, v) => void m.set(k, v),
        delete: async (k) => void m.delete(k),
        list: async (o) => ({ blobs: [...m.keys()].filter((k) => k.startsWith(o?.prefix || "")).map((key) => ({ key })) }),
      };
    }
    return memory;
  }
}

// Comment and commenter records (done/*, user/*) are kept 30 days, then deleted (the privacy page promises this).
export const KEEP_DAYS = 30;
export async function cleanup(now = Date.now()) {
  const db = await store();
  let removed = 0;
  for (const prefix of ["done/", "user/"]) {
    const { blobs } = await db.list({ prefix });
    for (const { key } of blobs) {
      const rec = await db.get(key, { type: "json" }).catch(() => null);
      if (!rec?.at || now - rec.at > KEEP_DAYS * DAY) { await db.delete(key); removed++; }
    }
  }
  return removed;
}

const sha = (s) => createHash("sha256").update(s || "").digest("hex").slice(0, 16);

// The token: the env value, unless the weekly refresh stored a newer one for that same env value.
export async function accessToken() {
  const fromEnv = env("IG_ACCESS_TOKEN");
  try {
    const saved = await (await store()).get("token", { type: "json" });
    if (saved?.token && saved.from_env === sha(fromEnv)) return saved.token;
  } catch (e) {}
  return fromEnv;
}

export function signatureOk(raw, header) {
  const secrets = (env("IG_APP_SECRET") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!secrets.length || !header?.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice(7), "hex");
  return secrets.some((s) => {
    const want = createHmac("sha256", s).update(raw).digest();
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

export function findKeyword(text) {
  const t = ` ${String(text || "").toLowerCase()} `;
  for (const [name, k] of Object.entries(KEYWORDS)) {
    if (name.startsWith("_")) continue;
    for (const w of k.words) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u");
      if (re.test(t)) return name;
    }
  }
  return null;
}

async function call(path, body, token) {
  const r = await fetch(`${API(token)}${path}?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status} ${j?.error?.message || ""}`.trim());
  return j;
}

// One comments change -> what we did. Comment ids starting "test_" are dry runs: nothing is sent.
export async function handleComment(ownId, v, now = Date.now()) {
  const id = v?.id, from = v?.from?.id, text = v?.text;
  if (!id || !from) return { id, skip: "no id" };
  if (from === ownId) return { id, skip: "own comment" };
  const kw = findKeyword(text);
  if (!kw) return { id, skip: "no keyword" };
  const db = await store();
  if (await db.get(`done/${id}`)) return { id, kw, skip: "already answered" };
  const last = await db.get(`user/${from}/${kw}`, { type: "json" });
  if (last && now - last.at < DAY) return { id, kw, skip: "same person, same keyword, under 24 h" };

  const k = KEYWORDS[kw];
  const reply = k.public[Math.floor(Math.random() * k.public.length)];
  const result = { id, kw, dm: false, public: false };
  if (String(id).startsWith("test_")) return { ...result, dry: true, would_dm: k.dm, would_reply: reply };

  const token = await accessToken();
  try {
    await call(`/${ownId || "me"}/messages`, { recipient: { comment_id: id }, message: { text: k.dm } }, token);
    result.dm = true;
  } catch (e) { result.dm_error = e.message; }
  if (result.dm) {
    try { await call(`/${id}/replies`, { message: reply }, token); result.public = true; }
    catch (e) { result.public_error = e.message; }
    await db.setJSON(`done/${id}`, { at: now, kw });
    await db.setJSON(`user/${from}/${kw}`, { at: now });
  }
  return result;
}

export { KEYWORDS };
