// Tara's comment-to-DM bot: the webhook. The logic is in bot/core.mjs, the keywords in bot/keywords.mjs.
// GET  /ig/webhook  Meta's verification handshake (hub.challenge), or a health check without secrets.
// POST /ig/webhook  "comments" events -> bot/core.mjs handleComment.
import { accessToken, signatureOk, handleComment, KEYWORDS, env } from "../../bot/core.mjs";

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe") {
      const ok = env("IG_VERIFY_TOKEN") && url.searchParams.get("hub.verify_token") === env("IG_VERIFY_TOKEN");
      return ok ? new Response(url.searchParams.get("hub.challenge") || "") : new Response("bad verify token", { status: 403 });
    }
    return Response.json({
      ok: true,
      token_set: Boolean(await accessToken()),
      secret_set: Boolean(env("IG_APP_SECRET")),
      verify_set: Boolean(env("IG_VERIFY_TOKEN")),
      keywords: Object.keys(KEYWORDS).filter((k) => !k.startsWith("_")),
    });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get("x-hub-signature-256"))) {
    console.log("ig-webhook: bad signature");
    return new Response("bad signature", { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch (e) { return new Response("bad json", { status: 400 }); }

  const done = [];
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field !== "comments") continue;
      const r = await handleComment(String(entry.id || ""), ch.value);
      console.log("ig-webhook:", JSON.stringify(r));
      done.push(r);
    }
  }
  // Always 200 after a valid signature, so Meta doesn't retry and double-send.
  return Response.json({ ok: true, done });
};

export const config = { path: "/ig/webhook" };
