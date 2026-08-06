import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignedHostProspectRequest,
  executeSignedHostProspectRequest,
  normalizeApiBaseUrl,
  summarizeSignedRequest
} from "./host-prospect-api-client.mjs";

test("builds contract-compatible HMAC headers without exposing the secret", () => {
  const signed = buildSignedHostProspectRequest({
    baseUrl: "https://api.beglib.com",
    keyId: "key_1",
    secret: "super-secret",
    method: "POST",
    pathWithQuery: "/internal/v1/host-prospects",
    body: { contractVersion: "1.0" },
    timestamp: 1783954800,
    nonce: "nonce_0123456789abcdef",
    idempotencyKey: "idem_0123456789abcdef"
  });
  assert.equal(signed.url, "https://api.beglib.com/internal/v1/host-prospects");
  assert.equal(signed.headers["X-BeGlib-Key-Id"], "key_1");
  assert.equal(signed.headers["X-BeGlib-Timestamp"], "1783954800");
  assert.equal(signed.headers["X-BeGlib-Nonce"], "nonce_0123456789abcdef");
  assert.match(signed.headers["X-BeGlib-Signature"], /^[a-f0-9]{64}$/);
  assert.equal(signed.headers["Idempotency-Key"], "idem_0123456789abcdef");
  assert.equal(JSON.stringify(summarizeSignedRequest(signed)).includes("super-secret"), false);
});

test("signs sorted query paths and redacts query values in summaries", () => {
  const signed = buildSignedHostProspectRequest({
    baseUrl: "https://api.beglib.com/",
    keyId: "key_1",
    secret: "super-secret",
    method: "GET",
    pathWithQuery: "/internal/v1/host-prospect-events?z=last&a=first",
    timestamp: 1783954800,
    nonce: "nonce_0123456789abcdef"
  });
  assert.equal(signed.headers["Idempotency-Key"], undefined);
  assert.equal(signed.rawBody, "");
  assert.equal(signed.canonicalRequest.split("\n")[4], "/internal/v1/host-prospect-events?a=first&z=last");
  assert.equal(
    summarizeSignedRequest(signed).url,
    "https://api.beglib.com/internal/v1/host-prospect-events?z=%5Bredacted%5D&a=%5Bredacted%5D"
  );
});

test("rejects insecure non-local API origins", () => {
  assert.equal(normalizeApiBaseUrl("http://127.0.0.1:3000", { allowInsecureLocal: true }).origin, "http://127.0.0.1:3000");
  assert.throws(() => normalizeApiBaseUrl("http://api.beglib.com"));
});

test("executes a signed request through an injected fetch implementation", async () => {
  const signed = buildSignedHostProspectRequest({
    baseUrl: "https://api.beglib.com",
    keyId: "key_1",
    secret: "super-secret",
    method: "GET",
    pathWithQuery: "/internal/v1/host-prospect-events",
    timestamp: 1783954800,
    nonce: "nonce_0123456789abcdef"
  });
  const response = await executeSignedHostProspectRequest(signed, {
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.beglib.com/internal/v1/host-prospect-events");
      assert.equal(init.method, "GET");
      assert.equal(init.headers["X-BeGlib-Key-Id"], "key_1");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { ok: true });
});
