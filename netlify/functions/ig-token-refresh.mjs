// Weekly job: (1) delete comment and commenter records older than 30 days; (2) renew the access token and keep the new
// one in Netlify Blobs, so the bot never runs on an expired token (a new IG_ACCESS_TOKEN pasted into Netlify wins).
//   Facebook-style token (EAA..., Unified login): fb_exchange_token, needs IG_APP_ID + IG_APP_SECRET.
//   Instagram-login token (IG...): ig_refresh_token.
import { createHash } from "node:crypto";
import { store, accessToken, cleanup, env } from "../../bot/core.mjs";

const sha = (s) => createHash("sha256").update(s || "").digest("hex").slice(0, 16);
const V = () => env("IG_API_VERSION") || "v24.0";

export function renewUrl(token, vars = null) {
  const get = (k) => (vars ? vars[k] || "" : env(k));
  if (String(token).startsWith("IG"))
    return `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const id = get("IG_APP_ID"), secret = (get("IG_APP_SECRET") || "").split(",")[0].trim();
  if (!id || !secret) return null;
  return `https://graph.facebook.com/${V()}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(id)}` +
    `&client_secret=${encodeURIComponent(secret)}&fb_exchange_token=${encodeURIComponent(token)}`;
}

export default async () => {
  try { console.log("ig-weekly: deleted", await cleanup(), "old records"); }
  catch (e) { console.log("ig-weekly: cleanup failed", e.message); }

  const token = await accessToken();
  if (!token) return console.log("ig-weekly: no token set");
  const url = renewUrl(token);
  if (!url) return console.log("ig-weekly: IG_APP_ID or IG_APP_SECRET missing, token not renewed");
  // A token that never expires (Unified login gives a system-user token) is left alone: renewing could swap it for a
  // 60-day one.
  if (!String(token).startsWith("IG")) {
    const app = `${env("IG_APP_ID")}|${(env("IG_APP_SECRET") || "").split(",")[0].trim()}`;
    const d = await fetch(`https://graph.facebook.com/${V()}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(app)}`)
      .then((r) => r.json()).catch(() => ({}));
    if (d?.data?.is_valid && !d.data.expires_at) return console.log("ig-weekly: token never expires, nothing to renew");
    if (d?.data && !d.data.is_valid) return console.log("ig-weekly: TOKEN INVALID, generate a new one (GUIDE step F)");
  }
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return console.log("ig-weekly: token renewal failed", r.status, j?.error?.message || "");
  const days = j.expires_in ? Math.round(j.expires_in / 86400) : null;
  await (await store()).setJSON("token", {
    token: j.access_token,
    from_env: sha(env("IG_ACCESS_TOKEN")),
    refreshed_at: new Date().toISOString(),
    expires_in_days: days,
  });
  console.log("ig-weekly: token renewed, expires in", days ?? "?", "days");
};

export const config = { schedule: "@weekly" };
