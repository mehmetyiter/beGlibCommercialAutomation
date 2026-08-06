import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const HOST_PROSPECT_CONTRACT_VERSION = "1.0";
export const HOST_PROSPECT_MAX_CLOCK_SKEW_SECONDS = 300;
export const HOST_PROSPECT_NONCE_TTL_SECONDS = 600;

const CONTRACT_DOCUMENT = JSON.parse(
  readFileSync(
    new URL("../../contracts/host-prospect/v1/openapi.json", import.meta.url),
    "utf8"
  )
);
export const HOST_PROSPECT_CTA_URL_PATTERN =
  CONTRACT_DOCUMENT.components?.schemas?.HostProspectCreateResponse?.properties?.ctaUrl?.pattern;
if (typeof HOST_PROSPECT_CTA_URL_PATTERN !== "string") {
  throw new Error("Host prospect v1 contract is missing its CTA URL pattern.");
}
const HOST_PROSPECT_CTA_URL_REGEX = new RegExp(HOST_PROSPECT_CTA_URL_PATTERN);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EVENT_TYPES = new Set([
  "host_prospect.landing_observed",
  "host_prospect.interest_confirmed",
  "host_prospect.revoked",
  "host_prospect.expired",
  "host_enrollment.email_challenge_sent",
  "host_enrollment.email_verified",
  "host_enrollment.sso_verified",
  "host_enrollment.manual_review_required",
  "host_enrollment.accepted",
  "host_enrollment.rejected",
  "host_onboarding.started",
  "host_onboarding.completed",
  "host_enrollment.active",
  "host_enrollment.already_active",
  "host_enrollment.revoked"
]);
const PROSPECT_STATUSES = new Set([
  "issued",
  "interest_confirmed",
  "enrollment_started",
  "converted",
  "rejected",
  "expired",
  "revoked"
]);
const ENROLLMENT_STATUSES = new Set([
  "claim_started",
  "email_verification_pending",
  "email_verified",
  "sso_pending",
  "sso_verified",
  "manual_review",
  "onboarding",
  "accepted",
  "active",
  "already_active",
  "rejected",
  "expired",
  "revoked"
]);
const EVENT_STATE_REQUIREMENTS = {
  "host_prospect.landing_observed": { enrollmentStatus: { mode: "forbidden" } },
  "host_prospect.interest_confirmed": {
    prospectStatus: "interest_confirmed",
    enrollmentStatus: { mode: "required", value: "claim_started" }
  },
  "host_prospect.revoked": {
    prospectStatus: "revoked",
    enrollmentStatus: { mode: "optional", value: "revoked" }
  },
  "host_prospect.expired": {
    prospectStatus: "expired",
    enrollmentStatus: { mode: "optional", value: "expired" }
  },
  "host_enrollment.email_challenge_sent": {
    prospectStatus: "enrollment_started",
    enrollmentStatus: { mode: "required", value: "email_verification_pending" }
  },
  "host_enrollment.email_verified": {
    prospectStatus: "enrollment_started",
    enrollmentStatus: { mode: "required", value: "email_verified" }
  },
  "host_enrollment.sso_verified": {
    prospectStatus: "enrollment_started",
    enrollmentStatus: { mode: "required", value: "sso_verified" }
  },
  "host_enrollment.manual_review_required": {
    prospectStatus: "enrollment_started",
    enrollmentStatus: { mode: "required", value: "manual_review" }
  },
  "host_enrollment.accepted": {
    prospectStatus: "enrollment_started",
    enrollmentStatus: { mode: "required", value: "accepted" }
  },
  "host_enrollment.rejected": {
    prospectStatus: "rejected",
    enrollmentStatus: { mode: "required", value: "rejected" }
  },
  "host_onboarding.started": {
    prospectStatus: "enrollment_started",
    enrollmentStatus: { mode: "required", value: "onboarding" }
  },
  "host_onboarding.completed": {
    prospectStatus: "enrollment_started",
    enrollmentStatus: { mode: "required", value: "accepted" }
  },
  "host_enrollment.active": {
    prospectStatus: "converted",
    enrollmentStatus: { mode: "required", value: "active" }
  },
  "host_enrollment.already_active": {
    prospectStatus: "converted",
    enrollmentStatus: { mode: "required", value: "already_active" }
  },
  "host_enrollment.revoked": {
    prospectStatus: "revoked",
    enrollmentStatus: { mode: "required", value: "revoked" }
  }
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkObject(value, path, allowedKeys, requiredKeys, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`${path}.${key} is not allowed`);
    }
  }
  for (const key of requiredKeys) {
    if (!(key in value)) {
      errors.push(`${path}.${key} is required`);
    }
  }
  return true;
}

function checkString(value, path, errors, { min = 1, max = Infinity, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    errors.push(`${path} is invalid`);
    return false;
  }
  return true;
}

function checkIdentifier(value, path, errors) {
  return checkString(value, path, errors, { min: 1, max: 128, pattern: IDENTIFIER_PATTERN });
}

function checkProspectId(value, path, errors) {
  return checkString(value, path, errors, { min: 36, max: 36, pattern: UUID_PATTERN });
}

function checkDateTime(value, path, errors) {
  if (typeof value !== "string" || !RFC3339_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an RFC 3339 date-time`);
    return false;
  }
  return true;
}

function expectConstant(value, expected, path, errors) {
  if (value !== expected) {
    errors.push(`${path} must equal ${expected}`);
  }
}

function validateCandidateOwnedContact(contact, errors, now) {
  if (!checkObject(contact, "contact", ["endpoint", "association"], ["endpoint", "association"], errors)) {
    return;
  }

  const endpoint = contact.endpoint;
  if (checkObject(endpoint, "contact.endpoint", ["type", "value"], ["type", "value"], errors)) {
    expectConstant(endpoint.type, "email", "contact.endpoint.type", errors);
    checkString(endpoint.value, "contact.endpoint.value", errors, { min: 3, max: 320, pattern: EMAIL_PATTERN });
  }

  const association = contact.association;
  const associationKeys = [
    "id",
    "associationType",
    "recipientKind",
    "evidenceStatus",
    "sourceEvidenceRef",
    "reviewerRef",
    "verificationMethod",
    "verifiedAt",
    "verificationFreshUntil",
    "suppressionStatus",
    "complianceDecision",
    "contactPurpose"
  ];
  if (!checkObject(association, "contact.association", associationKeys, associationKeys, errors)) {
    return;
  }

  checkIdentifier(association.id, "contact.association.id", errors);
  expectConstant(association.associationType, "candidate_owned", "contact.association.associationType", errors);
  expectConstant(association.recipientKind, "candidate", "contact.association.recipientKind", errors);
  expectConstant(association.evidenceStatus, "human_verified", "contact.association.evidenceStatus", errors);
  checkString(association.sourceEvidenceRef, "contact.association.sourceEvidenceRef", errors, {
    max: 256,
    pattern: IDENTIFIER_PATTERN
  });
  checkIdentifier(association.reviewerRef, "contact.association.reviewerRef", errors);

  if (!["public_first_party_page", "direct_confirmation", "manual_review"].includes(association.verificationMethod)) {
    errors.push("contact.association.verificationMethod is invalid");
  }

  const verifiedAtValid = checkDateTime(association.verifiedAt, "contact.association.verifiedAt", errors);
  const freshUntilValid = checkDateTime(
    association.verificationFreshUntil,
    "contact.association.verificationFreshUntil",
    errors
  );
  if (verifiedAtValid && freshUntilValid) {
    const verifiedAt = Date.parse(association.verifiedAt);
    const freshUntil = Date.parse(association.verificationFreshUntil);
    if (freshUntil <= verifiedAt) {
      errors.push("contact.association.verificationFreshUntil must be later than verifiedAt");
    }
    if (freshUntil <= now.getTime()) {
      errors.push("contact association verification is expired");
    }
  }

  expectConstant(association.suppressionStatus, "clear", "contact.association.suppressionStatus", errors);
  expectConstant(association.complianceDecision, "approved", "contact.association.complianceDecision", errors);
  expectConstant(association.contactPurpose, "host_invitation", "contact.association.contactPurpose", errors);
}

function validateCandidate(candidate, errors) {
  if (!checkObject(
    candidate,
    "candidate",
    ["displayName", "preferredLocale", "countryCode", "topics"],
    ["displayName", "preferredLocale", "topics"],
    errors
  )) {
    return;
  }

  checkString(candidate.displayName, "candidate.displayName", errors, { max: 200 });
  checkString(candidate.preferredLocale, "candidate.preferredLocale", errors, { min: 2, max: 35 });
  if (candidate.countryCode !== undefined) {
    checkString(candidate.countryCode, "candidate.countryCode", errors, { min: 2, max: 2, pattern: /^[A-Z]{2}$/ });
  }
  if (!Array.isArray(candidate.topics) || candidate.topics.length > 20) {
    errors.push("candidate.topics must be an array with at most 20 items");
    return;
  }
  for (const [index, topic] of candidate.topics.entries()) {
    checkString(topic, `candidate.topics[${index}]`, errors, { max: 80 });
  }
  if (new Set(candidate.topics).size !== candidate.topics.length) {
    errors.push("candidate.topics must be unique");
  }
}

export function validateHostProspectCreateRequest(value, { now = new Date() } = {}) {
  const errors = [];
  const evaluationNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date(0);
  if (evaluationNow !== now) {
    errors.push("eligibility evaluation time is invalid");
  }
  const keys = [
    "contractVersion",
    "externalCandidateId",
    "campaignId",
    "campaignMemberId",
    "contact",
    "candidate",
    "requestedAt",
    "expiresAt"
  ];
  if (!checkObject(value, "request", keys, keys, errors)) {
    return { ok: false, errors };
  }

  expectConstant(value.contractVersion, HOST_PROSPECT_CONTRACT_VERSION, "request.contractVersion", errors);
  checkIdentifier(value.externalCandidateId, "request.externalCandidateId", errors);
  checkIdentifier(value.campaignId, "request.campaignId", errors);
  checkIdentifier(value.campaignMemberId, "request.campaignMemberId", errors);
  validateCandidateOwnedContact(value.contact, errors, evaluationNow);
  validateCandidate(value.candidate, errors);

  const requestedAtValid = checkDateTime(value.requestedAt, "request.requestedAt", errors);
  const expiresAtValid = checkDateTime(value.expiresAt, "request.expiresAt", errors);
  if (requestedAtValid && expiresAtValid && Date.parse(value.expiresAt) <= Date.parse(value.requestedAt)) {
    errors.push("request.expiresAt must be later than requestedAt");
  }
  if (
    requestedAtValid &&
    isRecord(value.contact) &&
    isRecord(value.contact.association) &&
    checkDateTime(value.contact.association.verifiedAt, "contact.association.verifiedAt", []) &&
    Date.parse(value.contact.association.verifiedAt) > Date.parse(value.requestedAt)
  ) {
    errors.push("contact.association.verifiedAt must not be later than requestedAt");
  }
  if (
    expiresAtValid &&
    isRecord(value.contact) &&
    isRecord(value.contact.association) &&
    checkDateTime(value.contact.association.verificationFreshUntil, "contact.association.verificationFreshUntil", []) &&
    Date.parse(value.expiresAt) > Date.parse(value.contact.association.verificationFreshUntil)
  ) {
    errors.push("request.expiresAt must not exceed contact verificationFreshUntil");
  }

  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

export function assertHostProspectCreateRequest(value, options) {
  const result = validateHostProspectCreateRequest(value, options);
  if (!result.ok) {
    throw new Error(`Invalid Host prospect v1 request:\n- ${result.errors.join("\n- ")}`);
  }
  return result.value;
}

export function validateHostProspectRevokeRequest(value) {
  const errors = [];
  const keys = ["contractVersion", "reasonCode"];
  if (!checkObject(value, "request", keys, keys, errors)) {
    return { ok: false, errors };
  }
  expectConstant(value.contractVersion, HOST_PROSPECT_CONTRACT_VERSION, "request.contractVersion", errors);
  if (!["campaign_cancelled", "contact_withdrawn", "compliance_hold", "operator_revoked"].includes(value.reasonCode)) {
    errors.push("request.reasonCode is invalid");
  }
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

export function validateHostProspectRevokeResponse(value) {
  const errors = [];
  const keys = ["contractVersion", "prospectId", "status", "revokedAt"];
  if (!checkObject(value, "response", keys, keys, errors)) {
    return { ok: false, errors };
  }
  expectConstant(value.contractVersion, HOST_PROSPECT_CONTRACT_VERSION, "response.contractVersion", errors);
  checkProspectId(value.prospectId, "response.prospectId", errors);
  expectConstant(value.status, "revoked", "response.status", errors);
  checkDateTime(value.revokedAt, "response.revokedAt", errors);
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

export function validateHostProspectCreateResponse(value, { allowedCtaOrigins } = {}) {
  const errors = [];
  const keys = ["contractVersion", "prospectId", "status", "ctaUrl", "contactPolicy", "expiresAt"];
  if (!checkObject(value, "response", keys, keys, errors)) {
    return { ok: false, errors };
  }
  expectConstant(value.contractVersion, HOST_PROSPECT_CONTRACT_VERSION, "response.contractVersion", errors);
  checkProspectId(value.prospectId, "response.prospectId", errors);
  expectConstant(value.status, "issued", "response.status", errors);
  checkString(value.ctaUrl, "response.ctaUrl", errors, {
    max: 2048,
    pattern: HOST_PROSPECT_CTA_URL_REGEX
  });
  try {
    const ctaUrl = new URL(value.ctaUrl);
    if (ctaUrl.protocol !== "https:") errors.push("response.ctaUrl must use HTTPS");
    if (!Array.isArray(allowedCtaOrigins) || allowedCtaOrigins.length === 0) {
      errors.push("allowedCtaOrigins must contain at least one configured beGlib origin");
    } else if (!allowedCtaOrigins.includes(ctaUrl.origin)) {
      errors.push("response.ctaUrl origin is not allowlisted");
    }
  } catch {
    errors.push("response.ctaUrl must be an absolute URL");
  }
  if (checkObject(
    value.contactPolicy,
    "response.contactPolicy",
    ["otpEligibility", "evaluatedAt"],
    ["otpEligibility", "evaluatedAt"],
    errors
  )) {
    expectConstant(value.contactPolicy.otpEligibility, "eligible", "response.contactPolicy.otpEligibility", errors);
    checkDateTime(value.contactPolicy.evaluatedAt, "response.contactPolicy.evaluatedAt", errors);
  }
  checkDateTime(value.expiresAt, "response.expiresAt", errors);
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

function validateEvent(event, index, errors) {
  const path = `events[${index}]`;
  const required = [
    "eventId",
    "schemaVersion",
    "type",
    "authoritative",
    "prospectId",
    "externalCandidateId",
    "campaignId",
    "campaignMemberId",
    "prospectStatus",
    "occurredAt"
  ];
  if (!checkObject(event, path, [...required, "enrollmentStatus"], required, errors)) {
    return;
  }
  checkIdentifier(event.eventId, `${path}.eventId`, errors);
  expectConstant(event.schemaVersion, HOST_PROSPECT_CONTRACT_VERSION, `${path}.schemaVersion`, errors);
  if (!EVENT_TYPES.has(event.type)) errors.push(`${path}.type is invalid`);
  if (typeof event.authoritative !== "boolean") errors.push(`${path}.authoritative must be boolean`);
  const mustBeAuthoritative = event.type !== "host_prospect.landing_observed";
  if (event.authoritative !== mustBeAuthoritative) errors.push(`${path}.authoritative conflicts with event type`);
  checkProspectId(event.prospectId, `${path}.prospectId`, errors);
  checkIdentifier(event.externalCandidateId, `${path}.externalCandidateId`, errors);
  checkIdentifier(event.campaignId, `${path}.campaignId`, errors);
  checkIdentifier(event.campaignMemberId, `${path}.campaignMemberId`, errors);
  if (!PROSPECT_STATUSES.has(event.prospectStatus)) errors.push(`${path}.prospectStatus is invalid`);
  if (event.enrollmentStatus !== undefined && !ENROLLMENT_STATUSES.has(event.enrollmentStatus)) {
    errors.push(`${path}.enrollmentStatus is invalid`);
  }
  checkDateTime(event.occurredAt, `${path}.occurredAt`, errors);

  const requirement = EVENT_STATE_REQUIREMENTS[event.type];
  if (!requirement) return;
  if (requirement.prospectStatus && event.prospectStatus !== requirement.prospectStatus) {
    errors.push(`${path}.prospectStatus conflicts with event type`);
  }
  if (requirement.enrollmentStatus.mode === "forbidden" && event.enrollmentStatus !== undefined) {
    errors.push(`${path}.enrollmentStatus is forbidden for this event type`);
  }
  if (
    requirement.enrollmentStatus.mode === "required" &&
    event.enrollmentStatus !== requirement.enrollmentStatus.value
  ) {
    errors.push(`${path}.enrollmentStatus conflicts with event type`);
  }
  if (
    requirement.enrollmentStatus.mode === "optional" &&
    event.enrollmentStatus !== undefined &&
    event.enrollmentStatus !== requirement.enrollmentStatus.value
  ) {
    errors.push(`${path}.enrollmentStatus conflicts with event type`);
  }
}

export function validateHostProspectEventPage(value) {
  const errors = [];
  if (!checkObject(
    value,
    "page",
    ["contractVersion", "events", "nextCursor", "hasMore"],
    ["contractVersion", "events", "hasMore"],
    errors
  )) {
    return { ok: false, errors };
  }
  expectConstant(value.contractVersion, HOST_PROSPECT_CONTRACT_VERSION, "page.contractVersion", errors);
  if (!Array.isArray(value.events) || value.events.length > 200) {
    errors.push("page.events must be an array with at most 200 items");
  } else {
    value.events.forEach((event, index) => validateEvent(event, index, errors));
  }
  if (typeof value.hasMore !== "boolean") errors.push("page.hasMore must be boolean");
  if (value.nextCursor !== undefined) checkString(value.nextCursor, "page.nextCursor", errors, { max: 512 });
  if (value.hasMore === true && value.nextCursor === undefined) errors.push("page.nextCursor is required when hasMore is true");

  if (Array.isArray(value.events)) {
    const seenEventIds = new Set();
    for (const [index, event] of value.events.entries()) {
      if (!isRecord(event)) continue;
      if (seenEventIds.has(event.eventId)) errors.push(`events[${index}].eventId must be unique within a page`);
      seenEventIds.add(event.eventId);
    }
  }
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function canonicalizeHostProspectPath(pathWithQuery) {
  if (typeof pathWithQuery !== "string" || !pathWithQuery.startsWith("/") || pathWithQuery.startsWith("//")) {
    throw new Error("pathWithQuery must be an origin-relative path");
  }
  const url = new URL(pathWithQuery, "https://host-prospect.invalid");
  const entries = [...url.searchParams.entries()]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)])
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      if (leftName !== rightName) return leftName < rightName ? -1 : 1;
      if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
      return 0;
    });
  const query = entries.map(([name, value]) => `${name}=${value}`).join("&");
  return query ? `${url.pathname}?${query}` : url.pathname;
}

export function buildHostProspectCanonicalRequest({ timestamp, nonce, method, pathWithQuery, rawBody }) {
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  return [
    "v1",
    String(timestamp),
    nonce,
    method.toUpperCase(),
    canonicalizeHostProspectPath(pathWithQuery),
    bodyHash
  ].join("\n");
}

export function signHostProspectCanonicalRequest(secret, canonicalRequest) {
  return createHmac("sha256", secret).update(canonicalRequest, "utf8").digest("hex");
}

export function verifyHostProspectSignature(secret, canonicalRequest, providedSignature) {
  if (typeof providedSignature !== "string" || !/^[a-f0-9]{64}$/.test(providedSignature)) {
    return false;
  }
  const expected = Buffer.from(signHostProspectCanonicalRequest(secret, canonicalRequest), "hex");
  const provided = Buffer.from(providedSignature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
