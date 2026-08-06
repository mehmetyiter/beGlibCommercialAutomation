import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildHostProspectCanonicalRequest,
  canonicalizeHostProspectPath,
  HOST_PROSPECT_CTA_URL_PATTERN,
  signHostProspectCanonicalRequest,
  validateHostProspectCreateRequest,
  validateHostProspectCreateResponse,
  validateHostProspectEventPage,
  validateHostProspectRevokeRequest,
  validateHostProspectRevokeResponse,
  verifyHostProspectSignature
} from "./host-prospect-contract.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractRoot = path.join(repositoryRoot, "contracts", "host-prospect", "v1");

function fixture(name) {
  return JSON.parse(readFileSync(path.join(contractRoot, "fixtures", name), "utf8"));
}

function relativeFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? relativeFiles(root, absolutePath)
      : [path.relative(root, absolutePath)];
  }).sort();
}

test("consumer snapshot publishes the expected strict versioned API surface", () => {
  const document = JSON.parse(readFileSync(path.join(contractRoot, "openapi.json"), "utf8"));
  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.info.version, "1.0");
  assert.deepEqual(Object.keys(document.paths).sort(), [
    "/internal/v1/host-prospect-events",
    "/internal/v1/host-prospects",
    "/internal/v1/host-prospects/{prospectId}/revoke"
  ]);
  assert.ok(document.components.schemas.HostProspectStatus.enum.includes("rejected"));
  assert.equal(
    HOST_PROSPECT_CTA_URL_PATTERN,
    document.components.schemas.HostProspectCreateResponse.properties.ctaUrl.pattern
  );
});

test("consumer accepts the candidate-owned pilot request", () => {
  const result = validateHostProspectCreateRequest(fixture("create-direct-prospect.request.json"), {
    now: new Date("2026-07-13T15:00:00.000Z")
  });
  assert.equal(result.ok, true, result.errors?.join("\n"));
});

test("consumer rejects representative data during the candidate-owned pilot", () => {
  const result = validateHostProspectCreateRequest(fixture("create-representative-prospect.rejected.json"), {
    now: new Date("2026-07-13T15:00:00.000Z")
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("associationType")));
  assert.ok(result.errors.some((error) => error.includes("recipientKind")));
});

test("consumer derives expiry instead of trusting a caller eligibility flag", () => {
  const request = fixture("create-direct-prospect.request.json");
  request.contact.otpEligibility = "eligible";
  let result = validateHostProspectCreateRequest(request, { now: new Date("2026-07-13T15:00:00.000Z") });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("otpEligibility is not allowed")));

  delete request.contact.otpEligibility;
  result = validateHostProspectCreateRequest(request, { now: new Date("2027-01-12T14:00:00.000Z") });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("verification is expired")));

  result = validateHostProspectCreateRequest(request, { now: new Date("invalid") });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("evaluation time is invalid")));

  const outlivesEvidence = fixture("create-direct-prospect.request.json");
  outlivesEvidence.expiresAt = "2027-02-12T14:00:00.000Z";
  result = validateHostProspectCreateRequest(outlivesEvidence, { now: new Date("2026-07-13T15:00:00.000Z") });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("must not exceed")));

  const futureEvidence = fixture("create-direct-prospect.request.json");
  futureEvidence.contact.association.verifiedAt = "2026-07-13T15:00:01.000Z";
  result = validateHostProspectCreateRequest(futureEvidence, { now: new Date("2026-07-13T15:00:00.000Z") });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("must not be later")));
});

test("consumer validates the closed revoke request and response", () => {
  assert.equal(
    validateHostProspectRevokeRequest({ contractVersion: "1.0", reasonCode: "contact_withdrawn" }).ok,
    true
  );
  assert.equal(
    validateHostProspectRevokeRequest({ contractVersion: "1.0", reasonCode: "free_text" }).ok,
    false
  );
  assert.equal(
    validateHostProspectRevokeResponse({
      contractVersion: "1.0",
      prospectId: "8d7636a6-c4f3-4aa9-85eb-ff59a8cf12f4",
      status: "revoked",
      revokedAt: "2026-07-15T10:00:00.000Z"
    }).ok,
    true
  );
  assert.equal(
    validateHostProspectRevokeResponse({
      contractVersion: "1.0",
      prospectId: "prospect_not_route_compatible",
      status: "revoked",
      revokedAt: "2026-07-15T10:00:00.000Z"
    }).ok,
    false
  );
});

test("consumer validates response and PII-minimized events", () => {
  const responseOptions = { allowedCtaOrigins: ["https://beglib.com"] };
  assert.equal(validateHostProspectCreateResponse(fixture("create-prospect.response.json"), responseOptions).ok, true);
  assert.equal(validateHostProspectEventPage(fixture("events-page.response.json")).ok, true);

  const page = fixture("events-page.response.json");
  page.events[0].email = "must-not-cross@example.org";
  assert.equal(validateHostProspectEventPage(page).ok, false);

  const insecureResponse = fixture("create-prospect.response.json");
  insecureResponse.ctaUrl = "http://beglib.com/host/invite/example";
  assert.equal(validateHostProspectCreateResponse(insecureResponse, responseOptions).ok, false);

  const foreignResponse = fixture("create-prospect.response.json");
  foreignResponse.ctaUrl = `https://example.net/host/invite#t=${"A".repeat(43)}`;
  assert.equal(validateHostProspectCreateResponse(foreignResponse, responseOptions).ok, false);

  for (const ctaUrl of [
    `https://beglib.com/host/invite?t=${"A".repeat(43)}`,
    `https://BEGLIB.com/host/invite#t=${"A".repeat(43)}`,
    `https://beglib.com:443/host/invite#t=${"A".repeat(43)}`,
    `https://127.0.0.1/host/invite#t=${"A".repeat(43)}`,
    `https://beglib.com/host/invite#t=short`
  ]) {
    const invalidResponse = fixture("create-prospect.response.json");
    invalidResponse.ctaUrl = ctaUrl;
    assert.equal(
      validateHostProspectCreateResponse(invalidResponse, responseOptions).ok,
      false,
      ctaUrl
    );
  }
  assert.equal(validateHostProspectCreateResponse(fixture("create-prospect.response.json")).ok, false);
});

test("consumer rejects contradictory or duplicate events", () => {
  const wrongState = fixture("events-page.response.json");
  wrongState.events[2].enrollmentStatus = "sso_verified";
  assert.equal(validateHostProspectEventPage(wrongState).ok, false);

  const duplicate = fixture("events-page.response.json");
  duplicate.events[2].eventId = duplicate.events[1].eventId;
  duplicate.events[2].occurredAt = "2026-07-14T08:00:00.000Z";
  const result = validateHostProspectEventPage(duplicate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("unique")));

  const appendOrdered = fixture("events-page.response.json");
  appendOrdered.events[2].occurredAt = "2026-07-14T08:00:00.000Z";
  assert.equal(validateHostProspectEventPage(appendOrdered).ok, true);
});

test("consumer canonical HMAC implementation matches the v1 contract", () => {
  assert.equal(
    canonicalizeHostProspectPath("/internal/v1/host-prospect-events?z=last&a=second&space=hello+world&a=first"),
    "/internal/v1/host-prospect-events?a=first&a=second&space=hello%20world&z=last"
  );
  assert.equal(
    canonicalizeHostProspectPath("/internal/v1/host-prospect-events?q=~&q=Z&q=%C3%A4"),
    "/internal/v1/host-prospect-events?q=%C3%A4&q=Z&q=~"
  );
  const canonical = buildHostProspectCanonicalRequest({
    timestamp: "1783954800",
    nonce: "nonce_0123456789abcdef",
    method: "POST",
    pathWithQuery: "/internal/v1/host-prospects",
    rawBody: "{}"
  });
  assert.equal(
    canonical,
    [
      "v1",
      "1783954800",
      "nonce_0123456789abcdef",
      "POST",
      "/internal/v1/host-prospects",
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    ].join("\n")
  );
  const signature = signHostProspectCanonicalRequest("test-secret", canonical);
  assert.equal(verifyHostProspectSignature("test-secret", canonical, signature), true);
  assert.equal(verifyHostProspectSignature("wrong-secret", canonical, signature), false);
});

test("consumer snapshot matches the sibling Conversio canonical contract when available", (context) => {
  const canonicalRoot = path.resolve(repositoryRoot, "../Conversio/contracts/host-prospect/v1");
  if (!existsSync(canonicalRoot)) {
    context.skip("Conversio sibling repository is not available in this checkout");
    return;
  }

  const consumerFiles = relativeFiles(contractRoot);
  const canonicalFiles = relativeFiles(canonicalRoot);
  assert.deepEqual(consumerFiles, canonicalFiles, "v1 contract file lists drifted");
  for (const relativeFile of consumerFiles) {
    assert.deepEqual(
      readFileSync(path.join(contractRoot, relativeFile)),
      readFileSync(path.join(canonicalRoot, relativeFile)),
      `${relativeFile} drifted from the Conversio canonical copy`
    );
  }
});
