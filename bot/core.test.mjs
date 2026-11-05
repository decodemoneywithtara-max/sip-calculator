// npm test   (no network: Instagram calls are replaced by a fake fetch)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.IG_ACCESS_TOKEN = "tok";
process.env.IG_APP_SECRET = "wrong-secret, sekret";
process.env.IG_VERIFY_TOKEN = "vt";

const { findKeyword, handleComment, signatureOk } = await import("./core.mjs");
const handler = (await import("../netlify/functions/ig-webhook.mjs")).default;

const calls = [];
globalThis.fetch = async (url, opt) => {
  calls.push({ url: String(url), body: opt?.body ? JSON.parse(opt.body) : null, auth: opt?.headers?.Authorization });
  return new Response("{}", { status: 200 });
};

test("keyword matching: whole word, any case, Hindi", () => {
  assert.equal(findKeyword("SIP"), "SIP");
  assert.equal(findKeyword("sip please!"), "SIP");
  assert.equal(findKeyword("Sip🙏"), "SIP");
  assert.equal(findKeyword("mujhe एसआईपी chahiye"), "SIP");
  assert.equal(findKeyword("gossip"), null);
  assert.equal(findKeyword("sipping chai"), null);
  assert.equal(findKeyword(""), null);
});

test("a keyword comment gets one DM and one public reply; repeats are skipped", async () => {
  calls.length = 0;
  const v = { id: "c1", from: { id: "u1", username: "a" }, text: "SIP", media: { id: "m1" } };
  const r = await handleComment("me1", v, 1_000);
  assert.equal(r.dm, true);
  assert.equal(r.public, true);
  assert.match(calls[0].url, /\/me1\/messages$/);
  assert.deepEqual(calls[0].body.recipient, { comment_id: "c1" });
  assert.match(calls[0].body.message.text, /tara-sip-calculator\.netlify\.app/);
  assert.match(calls[0].body.message.text, /Education only, not investment advice\./);
  assert.equal(calls[0].auth, "Bearer tok");
  assert.match(calls[1].url, /\/c1\/replies$/);

  assert.equal((await handleComment("me1", v, 2_000)).skip, "already answered");
  const again = await handleComment("me1", { ...v, id: "c2" }, 5_000);
  assert.match(again.skip, /under 24 h/);
  const nextDay = await handleComment("me1", { ...v, id: "c3" }, 1_000 + 25 * 3600 * 1000);
  assert.equal(nextDay.dm, true);
});

test("own comments, no keyword and dry runs send nothing", async () => {
  calls.length = 0;
  assert.equal((await handleComment("me1", { id: "c9", from: { id: "me1" }, text: "SIP" })).skip, "own comment");
  assert.equal((await handleComment("me1", { id: "c8", from: { id: "u2" }, text: "nice video" })).skip, "no keyword");
  const dry = await handleComment("me1", { id: "test_1", from: { id: "u3" }, text: "sip" });
  assert.equal(dry.dry, true);
  assert.equal(calls.length, 0);
});

test("a failed DM is not marked done (so a retry can try again)", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 });
  const r = await handleComment("me1", { id: "c20", from: { id: "u20" }, text: "SIP" });
  assert.equal(r.dm, false);
  assert.match(r.dm_error, /400 nope/);
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  assert.equal((await handleComment("me1", { id: "c20", from: { id: "u20" }, text: "SIP" })).dm, true);
});

test("signature check: second secret in the list works, tampering fails", () => {
  const raw = '{"a":1}';
  const sig = "sha256=" + createHmac("sha256", "sekret").update(raw).digest("hex");
  assert.equal(signatureOk(raw, sig), true);
  assert.equal(signatureOk(raw + " ", sig), false);
  assert.equal(signatureOk(raw, null), false);
});

test("webhook: verification handshake, health, signed POST", async () => {
  const ok = await handler(new Request("https://x/ig/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42"));
  assert.equal(await ok.text(), "42");
  const bad = await handler(new Request("https://x/ig/webhook?hub.mode=subscribe&hub.verify_token=no&hub.challenge=42"));
  assert.equal(bad.status, 403);
  const health = await (await handler(new Request("https://x/ig/webhook"))).json();
  assert.deepEqual(health, { ok: true, token_set: true, secret_set: true, verify_set: true, keywords: ["SIP"] });

  const body = JSON.stringify({ object: "instagram", entry: [{ id: "me1", changes: [{ field: "comments",
    value: { id: "test_9", from: { id: "u9" }, text: "SIP", media: { id: "m" } } }] }] });
  const sig = "sha256=" + createHmac("sha256", "sekret").update(body).digest("hex");
  const res = await handler(new Request("https://x/ig/webhook", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
  const j = await res.json();
  assert.equal(j.done[0].dry, true);
  const unsigned = await handler(new Request("https://x/ig/webhook", { method: "POST", body }));
  assert.equal(unsigned.status, 401);
});

test("cleanup deletes records older than 30 days and keeps newer ones", async () => {
  const { store, cleanup } = await import("./core.mjs");
  const db = await store();
  const now = 100 * 24 * 3600 * 1000;
  await db.setJSON("done/old", { at: now - 31 * 24 * 3600 * 1000 });
  await db.setJSON("user/new/SIP", { at: now - 2 * 24 * 3600 * 1000 });
  await db.setJSON("token", { token: "x" });
  await cleanup(now);
  assert.equal(await db.get("done/old"), null);
  assert.notEqual(await db.get("user/new/SIP"), null);
  assert.notEqual(await db.get("token"), null);
});
