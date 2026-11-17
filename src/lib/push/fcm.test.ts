import { describe, expect, it } from "vitest";

import {
  classify,
  fcmWebMessage,
  parseServiceAccount,
  pemToDer,
  runPush,
  secretMatches,
  serviceAccountSchema,
  signedAssertion,
  type PushDeps,
} from "./fcm";

const payload = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  type: "SURGERY_REMINDER",
  title: "Surgery tomorrow",
  body: "KL0001 · Rhinoplasty · RH-0001 · Koramangala · 18/11/2026",
  case_id: "c1",
  visit_id: null,
  visit_type: null,
  read: false,
  tokens: ["tok-a", "tok-b"],
  ...over,
});

function fakeDeps(opts: { data?: unknown; answer?: (token: string) => { status: number; body: unknown } } = {}) {
  const sent: Record<string, unknown>[] = [];
  const dropped: string[][] = [];
  const logs: { ok: boolean; detail: Record<string, unknown> }[] = [];
  const deps: PushDeps = {
    payload: async () => (opts.data === undefined ? payload() : opts.data),
    dropTokens: async (tokens) => {
      dropped.push(tokens);
    },
    log: async (ok, detail) => {
      logs.push({ ok, detail });
    },
    send: async (message) => {
      sent.push(message);
      const token = (message.message as { token: string }).token;
      return opts.answer ? opts.answer(token) : { status: 200, body: { name: "projects/x/messages/1" } };
    },
    linkFor: (p) => `/cases/${p.case_id}?tab=overview`,
  };
  return { deps, sent, dropped, logs };
}

describe("web push (FCM HTTP v1)", () => {
  it("sends to every browser and logs the run", async () => {
    const { deps, sent, logs } = fakeDeps();
    expect(await runPush("n1", true, deps)).toEqual({ state: "done", sent: 2, dropped: 0, failed: 0 });
    expect(sent.map((m) => (m.message as { token: string }).token)).toEqual(["tok-a", "tok-b"]);
    expect(logs.at(-1)?.ok).toBe(true);
  });

  it("builds a data-only webpush message with a same-origin link and no android block", () => {
    const m = fcmWebMessage("tok", payload() as never, "/cases/c1?tab=overview").message as Record<
      string,
      Record<string, unknown>
    >;
    expect(m.data).toEqual({
      id: "n1",
      type: "SURGERY_REMINDER",
      title: "Surgery tomorrow",
      body: "KL0001 · Rhinoplasty · RH-0001 · Koramangala · 18/11/2026",
      link: "/cases/c1?tab=overview",
    });
    expect(m.webpush).toEqual({
      headers: { Urgency: "high", TTL: "86400" },
      fcm_options: { link: "/cases/c1?tab=overview" },
    });
    expect("android" in m).toBe(false);
    expect("notification" in m).toBe(false);
  });

  it("removes tokens Firebase no longer knows", async () => {
    const { deps, dropped } = fakeDeps({
      answer: (t) =>
        t === "tok-a"
          ? { status: 404, body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } }
          : { status: 200, body: {} },
    });
    expect(await runPush("n1", true, deps)).toEqual({ state: "done", sent: 1, dropped: 1, failed: 0 });
    expect(dropped).toEqual([["tok-a"]]);
  });

  it("stops after the first browser on a key problem", async () => {
    const { deps, sent, logs } = fakeDeps({
      answer: () => ({ status: 403, body: { error: { status: "PERMISSION_DENIED" } } }),
    });
    expect((await runPush("n1", true, deps)).state).toBe("auth_error");
    expect(sent).toHaveLength(1);
    expect(logs.at(-1)?.ok).toBe(false);
  });

  it("does nothing when off, read, missing or without browsers", async () => {
    expect((await runPush("n1", false, fakeDeps().deps)).state).toBe("off");
    expect((await runPush("n1", true, fakeDeps({ data: payload({ read: true }) }).deps)).state).toBe("skipped");
    expect((await runPush("n1", true, fakeDeps({ data: payload({ tokens: [] }) }).deps)).state).toBe("skipped");
    const missing = fakeDeps({ data: null });
    expect((await runPush("n1", true, missing.deps)).state).toBe("skipped");
    expect(missing.sent).toHaveLength(0);
  });

  it("counts a network error as failed and still sends the rest", async () => {
    const { deps } = fakeDeps();
    let n = 0;
    const flaky: PushDeps = {
      ...deps,
      send: async (m) => (n++ === 0 ? Promise.reject(new Error("timeout")) : deps.send(m)),
    };
    expect(await runPush("n1", true, flaky)).toEqual({ state: "done", sent: 1, dropped: 0, failed: 1 });
  });

  it("sorts Firebase answers", () => {
    expect(classify(200, {})).toBe("sent");
    expect(
      classify(400, {
        error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" },
      }),
    ).toBe("gone");
    expect(classify(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } })).toBe("failed");
    expect(classify(401, null)).toBe("auth");
    expect(classify(403, { error: { details: [{ errorCode: "SENDER_ID_MISMATCH" }] } })).toBe("auth");
    expect(classify(429, { error: { status: "RESOURCE_EXHAUSTED" } })).toBe("failed");
    expect(classify(503, null)).toBe("failed");
  });

  it("signs a valid RS256 Google assertion from a one-line .env key", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    let bin = "";
    for (const b of der) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    const pem = `-----BEGIN PRIVATE KEY-----\\n${b64.match(/.{1,64}/g)!.join("\\n")}\\n-----END PRIVATE KEY-----\\n`;
    expect(pemToDer(pem)).toEqual(der);

    const sa = serviceAccountSchema.parse({
      client_email: "push@test.iam.gserviceaccount.com",
      private_key: pem,
      project_id: "test",
    });
    const jwt = await signedAssertion(sa, 1_800_000_000);
    const [h, c, s] = jwt.split(".");
    const decode = (part: string) =>
      Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(decode(h)))).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(new TextDecoder().decode(decode(c)));
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.exp - claims.iat).toBe(3600);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      decode(s) as BufferSource,
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it("parses the service account only when well-formed", () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("not json")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ client_email: "a@b.c" }))).toBeNull();
    expect(
      parseServiceAccount(JSON.stringify({ client_email: "a@b.c", private_key: "-----BEGIN PRIVATE KEY-----x" })),
    ).not.toBeNull();
  });

  it("compares the dispatch secret safely", async () => {
    const secret = "a".repeat(64);
    expect(await secretMatches(secret, secret)).toBe(true);
    expect(await secretMatches("b".repeat(64), secret)).toBe(false);
    expect(await secretMatches(null, secret)).toBe(false);
    expect(await secretMatches(secret, undefined)).toBe(false);
  });
});
