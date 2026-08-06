import { randomBytes } from "node:crypto";

import {
  buildHostProspectCanonicalRequest,
  signHostProspectCanonicalRequest,
  validateHostProspectCreateResponse,
  validateHostProspectEventPage,
  validateHostProspectRevokeResponse
} from "./host-prospect-contract.mjs";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function randomOpaqueToken(bytes = 18) {
  return randomBytes(bytes).toString("base64url");
}

export function normalizeApiBaseUrl(value, { allowInsecureLocal = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("HOST_PROSPECT_API_BASE_URL must be an absolute URL");
  }
  const hostname = url.hostname.toLowerCase();
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (url.protocol !== "https:" && !(allowInsecureLocal && local)) {
    throw new Error("Host prospect API base URL must use HTTPS unless --allow-insecure-local is set for localhost");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

export function buildSignedHostProspectRequest({
  baseUrl,
  keyId,
  secret,
  method,
  pathWithQuery,
  body,
  idempotencyKey,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = randomOpaqueToken()
}) {
  if (!keyId) throw new Error("HOST_PROSPECT_HMAC_KEY_ID is required");
  if (!secret) throw new Error("HOST_PROSPECT_HMAC_SECRET is required");
  const normalizedMethod = String(method).toUpperCase();
  const rawBody = body === undefined || body === null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const canonicalRequest = buildHostProspectCanonicalRequest({
    timestamp,
    nonce,
    method: normalizedMethod,
    pathWithQuery,
    rawBody
  });
  const signature = signHostProspectCanonicalRequest(secret, canonicalRequest);
  const headers = {
    "X-BeGlib-Key-Id": keyId,
    "X-BeGlib-Timestamp": String(timestamp),
    "X-BeGlib-Nonce": nonce,
    "X-BeGlib-Signature": signature
  };
  if (rawBody) headers["Content-Type"] = "application/json";
  if (MUTATION_METHODS.has(normalizedMethod)) {
    headers["Idempotency-Key"] = idempotencyKey || randomOpaqueToken();
  }
  const url = new URL(pathWithQuery, normalizeApiBaseUrl(baseUrl));
  return {
    url: url.toString(),
    method: normalizedMethod,
    headers,
    rawBody,
    canonicalRequest,
    bodySha256: canonicalRequest.split("\n").at(-1)
  };
}

export async function executeSignedHostProspectRequest(signedRequest, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this runtime");
  }
  const response = await fetchImpl(signedRequest.url, {
    method: signedRequest.method,
    headers: signedRequest.headers,
    body: signedRequest.rawBody || undefined
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: response.status,
        errors: ["response body is not valid JSON"],
        text
      };
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
    text
  };
}

export function validateHostProspectApiResponse(operation, value, options = {}) {
  if (operation === "create") return validateHostProspectCreateResponse(value, options);
  if (operation === "revoke") return validateHostProspectRevokeResponse(value);
  if (operation === "events") return validateHostProspectEventPage(value);
  return { ok: false, errors: [`unsupported operation ${operation}`] };
}

export function summarizeSignedRequest(signedRequest) {
  return {
    method: signedRequest.method,
    url: redactQueryValues(signedRequest.url),
    keyId: signedRequest.headers["X-BeGlib-Key-Id"],
    timestamp: signedRequest.headers["X-BeGlib-Timestamp"],
    nonceLength: signedRequest.headers["X-BeGlib-Nonce"]?.length ?? 0,
    hasSignature: Boolean(signedRequest.headers["X-BeGlib-Signature"]),
    hasIdempotencyKey: Boolean(signedRequest.headers["Idempotency-Key"]),
    bodySha256: signedRequest.bodySha256
  };
}

function redactQueryValues(rawUrl) {
  const url = new URL(rawUrl);
  for (const key of [...url.searchParams.keys()]) {
    url.searchParams.set(key, "[redacted]");
  }
  return url.toString();
}
