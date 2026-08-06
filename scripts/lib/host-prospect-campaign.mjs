import {
  HOST_PROSPECT_CONTRACT_VERSION,
  validateHostProspectCreateRequest,
  validateHostProspectCreateResponse,
  validateHostProspectEventPage
} from "./host-prospect-contract.mjs";

const PILOT_ROUTE_TYPE = "public-business-email";
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SENSITIVE_CATEGORIES = new Set(["religion", "psychology", "therapy", "medicine"]);
const TERMINAL_EVENT_TYPES = new Set([
  "host_prospect.revoked",
  "host_prospect.expired",
  "host_enrollment.active",
  "host_enrollment.already_active",
  "host_enrollment.rejected",
  "host_enrollment.revoked"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stableIdentifier(value) {
  return stringValue(value).replace(/[^A-Za-z0-9._:-]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseDate(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function isoDate(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return date ? date.toISOString() : "";
}

function addError(errors, condition, message) {
  if (condition) errors.push(message);
}

function normalizeTopic(topic) {
  return stringValue(topic).replace(/\s+/g, " ").slice(0, 80);
}

function candidateTopics(candidate, explicitTopics) {
  const rawTopics = Array.isArray(explicitTopics) && explicitTopics.length > 0
    ? explicitTopics
    : Array.isArray(candidate?.subcategories)
      ? candidate.subcategories
      : [];
  const seen = new Set();
  const topics = [];
  for (const rawTopic of rawTopics) {
    const topic = normalizeTopic(rawTopic);
    const key = topic.toLowerCase();
    if (!topic || seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
    if (topics.length >= 20) break;
  }
  return topics;
}

function validateCampaignMemberInput(input, now) {
  const errors = [];
  const warnings = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["campaign member input must be an object"], warnings };
  }

  const candidate = input.candidate;
  const contactRoute = input.contactRoute;
  const association = input.association;
  const requestedAt = isoDate(input.requestedAt ?? now);
  const expiresAt = isoDate(input.expiresAt);

  addError(errors, !isRecord(candidate), "candidate is required");
  addError(errors, !isRecord(contactRoute), "contactRoute is required");
  addError(errors, !isRecord(association), "association is required");
  addError(errors, !stableIdentifier(input.campaignId), "campaignId is required");
  addError(errors, !stableIdentifier(input.campaignMemberId), "campaignMemberId is required");
  addError(errors, input.approvalStatus !== "approved", "campaign member approvalStatus must be approved");
  addError(errors, !requestedAt, "requestedAt must be a valid date-time");
  addError(errors, !expiresAt, "expiresAt must be a valid date-time");
  if (!isRecord(candidate) || !isRecord(contactRoute) || !isRecord(association)) {
    return { ok: false, errors, warnings };
  }

  const candidateId = stableIdentifier(candidate.id);
  addError(errors, !candidateId, "candidate.id is required");
  addError(errors, !stringValue(candidate.name), "candidate.name is required");
  addError(errors, contactRoute.type !== PILOT_ROUTE_TYPE, "pilot Host prospect requests require a candidate-owned public business email route");
  addError(errors, !EMAIL_PATTERN.test(stringValue(contactRoute.value)), "contactRoute.value must be a valid email address");
  addError(
    errors,
    stringValue(contactRoute.value).includes("{") || stringValue(contactRoute.value).includes("first.last"),
    "contactRoute.value looks like a guessed email pattern"
  );
  addError(errors, candidate.status === "do-not-contact", "candidate is marked do-not-contact");
  addError(
    errors,
    ["opted-out", "not-allowed", "unknown"].includes(candidate.consentStatus),
    "candidate consent/lawful outreach basis is not approved for public business contact"
  );
  addError(
    errors,
    candidate.consentStatus !== "public-business-contact",
    "pilot Host prospect requests require candidate consentStatus public-business-contact"
  );
  if (SENSITIVE_CATEGORIES.has(candidate.primaryCategory) && input.sensitiveCategoryReviewStatus !== "approved") {
    errors.push("sensitive-category campaign member requires sensitiveCategoryReviewStatus approved");
  }
  if (candidate.riskLevel === "high" && !stableIdentifier(input.seniorApprovalRef)) {
    errors.push("high-risk campaign member requires seniorApprovalRef");
  }

  const requiredAssociation = {
    associationType: "candidate_owned",
    recipientKind: "candidate",
    evidenceStatus: "human_verified",
    suppressionStatus: "clear",
    complianceDecision: "approved",
    contactPurpose: "host_invitation"
  };
  for (const [field, expected] of Object.entries(requiredAssociation)) {
    addError(errors, association[field] !== expected, `association.${field} must be ${expected}`);
  }
  for (const field of ["id", "sourceEvidenceRef", "reviewerRef", "verificationMethod", "verifiedAt", "verificationFreshUntil"]) {
    addError(errors, !stringValue(association[field]), `association.${field} is required`);
  }

  const topics = candidateTopics(candidate, input.topics);
  addError(errors, topics.length === 0, "candidate topics are required");

  if (candidate.status !== "approved") {
    warnings.push("candidate.status is not approved; keep this request in staging until campaign approval is recorded");
  }
  if (contactRoute.sourceUrl && !candidate.sourceUrls?.includes(contactRoute.sourceUrl)) {
    warnings.push("contactRoute.sourceUrl is not present in candidate.sourceUrls; keep reviewer evidence with the campaign member");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function buildHostProspectCreateRequest(input, { now = new Date() } = {}) {
  const preflight = validateCampaignMemberInput(input, now);
  if (!preflight.ok) return preflight;

  const requestedAt = isoDate(input.requestedAt ?? now);
  const request = {
    contractVersion: HOST_PROSPECT_CONTRACT_VERSION,
    externalCandidateId: stableIdentifier(input.candidate.id),
    campaignId: stableIdentifier(input.campaignId),
    campaignMemberId: stableIdentifier(input.campaignMemberId),
    contact: {
      endpoint: {
        type: "email",
        value: stringValue(input.contactRoute.value).toLowerCase()
      },
      association: {
        id: stableIdentifier(input.association.id),
        associationType: "candidate_owned",
        recipientKind: "candidate",
        evidenceStatus: "human_verified",
        sourceEvidenceRef: stableIdentifier(input.association.sourceEvidenceRef),
        reviewerRef: stableIdentifier(input.association.reviewerRef),
        verificationMethod: input.association.verificationMethod,
        verifiedAt: isoDate(input.association.verifiedAt),
        verificationFreshUntil: isoDate(input.association.verificationFreshUntil),
        suppressionStatus: "clear",
        complianceDecision: "approved",
        contactPurpose: "host_invitation"
      }
    },
    candidate: {
      displayName: stringValue(input.candidate.name).slice(0, 200),
      preferredLocale: stringValue(input.preferredLocale) || "en",
      topics: candidateTopics(input.candidate, input.topics)
    },
    requestedAt,
    expiresAt: isoDate(input.expiresAt)
  };

  const countryCode = stringValue(input.countryCode).toUpperCase();
  if (/^[A-Z]{2}$/.test(countryCode)) {
    request.candidate.countryCode = countryCode;
  }

  const contractResult = validateHostProspectCreateRequest(request, { now });
  return contractResult.ok
    ? { ok: true, request, warnings: preflight.warnings }
    : { ok: false, errors: contractResult.errors, warnings: preflight.warnings };
}

export function createPrivateHostProspectRecord({ request, response, allowedCtaOrigins, recordedAt = new Date() }) {
  const responseResult = validateHostProspectCreateResponse(response, { allowedCtaOrigins });
  if (!responseResult.ok) {
    return { ok: false, errors: responseResult.errors };
  }
  const requestResult = validateHostProspectCreateRequest(request, { now: new Date(request.requestedAt) });
  if (!requestResult.ok) {
    return { ok: false, errors: requestResult.errors };
  }

  return {
    ok: true,
    record: {
      contractVersion: response.contractVersion,
      prospectId: response.prospectId,
      externalCandidateId: request.externalCandidateId,
      campaignId: request.campaignId,
      campaignMemberId: request.campaignMemberId,
      status: response.status,
      prospectStatus: "issued",
      ctaUrl: response.ctaUrl,
      expiresAt: response.expiresAt,
      recordedAt: isoDate(recordedAt),
      lastAuthoritativeEventType: null,
      lastAuthoritativeEventAt: null,
      terminalAt: null
    }
  };
}

export function upsertPrivateHostProspectRecord(state, record, { now = new Date() } = {}) {
  const records = new Map((state?.records ?? []).map((existing) => [existing.prospectId, existing]));
  records.set(record.prospectId, {
    ...records.get(record.prospectId),
    ...record
  });
  return {
    records: [...records.values()],
    processedEventIds: state?.processedEventIds ?? [],
    cursor: state?.cursor ?? null,
    updatedAt: isoDate(now)
  };
}

export function applyHostProspectEventPage(state, page, { now = new Date() } = {}) {
  const result = validateHostProspectEventPage(page);
  if (!result.ok) return { ok: false, errors: result.errors };

  const records = new Map((state?.records ?? []).map((record) => [record.prospectId, { ...record }]));
  const processedEventIds = new Set(state?.processedEventIds ?? []);
  const warnings = [];
  let applied = 0;
  let skippedDuplicate = 0;
  let unknownProspectEvents = 0;

  for (const event of page.events) {
    if (processedEventIds.has(event.eventId)) {
      skippedDuplicate += 1;
      continue;
    }
    const record = records.get(event.prospectId);
    if (!record) {
      unknownProspectEvents += 1;
      warnings.push(`Skipped event ${event.eventId} for unknown prospect ${event.prospectId}`);
      processedEventIds.add(event.eventId);
      continue;
    }

    const nextRecord = {
      ...record,
      lastEventType: event.type,
      lastEventAt: event.occurredAt,
      updatedAt: isoDate(now)
    };
    if (event.type === "host_prospect.landing_observed") {
      nextRecord.lastLandingObservedAt = event.occurredAt;
    }
    if (event.authoritative) {
      nextRecord.prospectStatus = event.prospectStatus;
      if (event.enrollmentStatus) nextRecord.enrollmentStatus = event.enrollmentStatus;
      nextRecord.lastAuthoritativeEventType = event.type;
      nextRecord.lastAuthoritativeEventAt = event.occurredAt;
      if (TERMINAL_EVENT_TYPES.has(event.type)) {
        nextRecord.terminalAt = event.occurredAt;
      }
    }
    records.set(event.prospectId, nextRecord);
    processedEventIds.add(event.eventId);
    applied += 1;
  }

  return {
    ok: true,
    state: {
      records: [...records.values()],
      processedEventIds: [...processedEventIds],
      cursor: page.nextCursor ?? state?.cursor ?? null,
      updatedAt: isoDate(now)
    },
    summary: {
      eventsRead: page.events.length,
      applied,
      skippedDuplicate,
      unknownProspectEvents,
      nextCursor: page.nextCursor ?? null,
      hasMore: page.hasMore
    },
    warnings
  };
}

export function redactExpiredHostProspectCtas(
  state,
  { now = new Date(), terminalRetentionDays = 30, expiredRetentionDays = 30 } = {}
) {
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now();
  const terminalRetentionMs = Math.max(0, terminalRetentionDays) * 24 * 60 * 60 * 1000;
  const expiredRetentionMs = Math.max(0, expiredRetentionDays) * 24 * 60 * 60 * 1000;
  let redacted = 0;
  const records = (state?.records ?? []).map((record) => {
    if (!record?.ctaUrl) return record;

    const terminalAtMs = record.terminalAt ? Date.parse(record.terminalAt) : Number.NaN;
    const expiresAtMs = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
    const terminalEligible = Number.isFinite(terminalAtMs) && terminalAtMs + terminalRetentionMs <= nowMs;
    const expiredEligible = Number.isFinite(expiresAtMs) && expiresAtMs + expiredRetentionMs <= nowMs;
    if (!terminalEligible && !expiredEligible) return record;

    redacted += 1;
    return {
      ...record,
      ctaUrl: null,
      ctaRedactedAt: isoDate(now),
      ctaRedactionReason: terminalEligible ? "terminal_retention_elapsed" : "expired_retention_elapsed"
    };
  });

  return {
    ok: true,
    state: {
      ...state,
      records,
      updatedAt: isoDate(now)
    },
    summary: {
      records: records.length,
      redacted
    }
  };
}

export function summarizeHostProspectState(
  state,
  { now = new Date(), terminalRetentionDays = 30, expiredRetentionDays = 30 } = {}
) {
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now();
  const terminalRetentionMs = Math.max(0, terminalRetentionDays) * 24 * 60 * 60 * 1000;
  const expiredRetentionMs = Math.max(0, expiredRetentionDays) * 24 * 60 * 60 * 1000;
  const summary = {
    records: 0,
    byProspectStatus: {},
    byEnrollmentStatus: {},
    ctaActive: 0,
    ctaRedacted: 0,
    ctaRedactionDue: 0,
    terminal: 0,
    converted: 0,
    expired: 0,
    revoked: 0,
    cursor: state?.cursor ?? null,
    processedEvents: Array.isArray(state?.processedEventIds) ? state.processedEventIds.length : 0
  };

  for (const record of state?.records ?? []) {
    summary.records += 1;
    const prospectStatus = record.prospectStatus ?? "unknown";
    const enrollmentStatus = record.enrollmentStatus ?? "none";
    summary.byProspectStatus[prospectStatus] = (summary.byProspectStatus[prospectStatus] ?? 0) + 1;
    summary.byEnrollmentStatus[enrollmentStatus] = (summary.byEnrollmentStatus[enrollmentStatus] ?? 0) + 1;
    if (record.ctaUrl) summary.ctaActive += 1;
    else if (record.ctaRedactedAt) summary.ctaRedacted += 1;
    if (record.terminalAt) summary.terminal += 1;
    if (prospectStatus === "converted") summary.converted += 1;
    if (prospectStatus === "expired") summary.expired += 1;
    if (prospectStatus === "revoked") summary.revoked += 1;

    const terminalAtMs = record.terminalAt ? Date.parse(record.terminalAt) : Number.NaN;
    const expiresAtMs = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
    const terminalEligible = Number.isFinite(terminalAtMs) && terminalAtMs + terminalRetentionMs <= nowMs;
    const expiredEligible = Number.isFinite(expiresAtMs) && expiresAtMs + expiredRetentionMs <= nowMs;
    if (record.ctaUrl && (terminalEligible || expiredEligible)) {
      summary.ctaRedactionDue += 1;
    }
  }

  return summary;
}
