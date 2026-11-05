// Weekly job: (1) refresh the Instagram long-lived token (60 days; refreshable once it is a day old) and keep the new
// one in Netlify Blobs, so the bot never runs on an expired token (a new IG_ACCESS_TOKEN pasted into Netlify wins over
// it); (2) delete comment and commenter records older than 30 days.
import { createHash } from "node:crypto";
import { store, accessToken, cleanup } from "../../bot/core.mjs";

const sha = (s) => createHash("sha256").update(s || "").digest("hex").slice(0, 16);

export default async () => {
  try { console.log("ig-weekly: deleted", await cleanup(), "old records"); }
  catch (e) { console.log("ig-weekly: cleanup failed", e.message); }

  const token = await accessToken();
  if (!token) return console.log("ig-weekly: no token set");
  const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return console.log("ig-weekly: token refresh failed", r.status, j?.error?.message || "");
  await (await store()).setJSON("token", {
    token: j.access_token,
    from_env: sha(process.env.IG_ACCESS_TOKEN),
    refreshed_at: new Date().toISOString(),
    expires_in_days: Math.round((j.expires_in || 0) / 86400),
  });
  console.log("ig-weekly: token refreshed, expires in", Math.round((j.expires_in || 0) / 86400), "days");
};

export const config = { schedule: "@weekly" };
