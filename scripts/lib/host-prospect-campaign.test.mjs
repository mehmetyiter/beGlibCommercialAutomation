import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyHostProspectEventPage,
  buildHostProspectCreateRequest,
  createPrivateHostProspectRecord,
  redactExpiredHostProspectCtas,
  summarizeHostProspectState
} from "./host-prospect-campaign.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contractRoot = path.join(repositoryRoot, "contracts", "host-prospect", "v1");

function fixture(name) {
  return JSON.parse(readFileSync(path.join(contractRoot, "fixtures", name), "utf8"));
}

function campaignMember(overrides = {}) {
  return {
    approvalStatus: "approved",
    campaignId: "campaign_host_pilot_en_001",
    campaignMemberId: "member_host_pilot_0001",
    preferredLocale: "en",
    countryCode: "GB",
    requestedAt: "2026-07-13T15:00:00.000Z",
    expiresAt: "2026-08-12T15:00:00.000Z",
    candidate: {
      id: "candidate_pilot_0001",
      name: "Ada Lovelace",
      status: "approved",
      consentStatus: "public-business-contact",
      riskLevel: "low",
      primaryCategory: "science",
      subcategories: ["computing", "mathematics", "computing"],
      sourceUrls: ["https://example.org/ada/contact"]
    },
    contactRoute: {
      type: "public-business-email",
      value: "Ada.Lovelace@Example.org",
      sourceUrl: "https://example.org/ada/contact",
      verifiedAt: "2026-07-12"
    },
    association: {
      id: "association_pilot_0001",
      associationType: "candidate_owned",
      recipientKind: "candidate",
      evidenceStatus: "human_verified",
      sourceEvidenceRef: "evidence:first_party_profile:0001",
      reviewerRef: "reviewer:operator_001",
      verificationMethod: "public_first_party_page",
      verifiedAt: "2026-07-12T14:00:00.000Z",
      verificationFreshUntil: "2027-01-12T14:00:00.000Z",
      suppressionStatus: "clear",
      complianceDecision: "approved",
      contactPurpose: "host_invitation"
    },
    ...overrides
  };
}

test("builds a strict v1 create request only from an approved candidate-owned email association", () => {
  const result = buildHostProspectCreateRequest(campaignMember(), {
    now: new Date("2026-07-13T15:00:00.000Z")
  });
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.request.contact.endpoint.value, "ada.lovelace@example.org");
  assert.deepEqual(result.request.candidate.topics, ["computing", "mathematics"]);
  assert.equal(result.request.candidate.displayName, "Ada Lovelace");
  assert.equal(result.request.candidate.countryCode, "GB");
});

test("fails closed without explicit campaign approval or a pilot-supported route", () => {
  const unapproved = buildHostProspectCreateRequest(campaignMember({ approvalStatus: "pending" }), {
    now: new Date("2026-07-13T15:00:00.000Z")
  });
  assert.equal(unapproved.ok, false);
  assert.ok(unapproved.errors.some((error) => error.includes("approvalStatus")));

  const representative = buildHostProspectCreateRequest(campaignMember({
    contactRoute: {
      type: "representative-email",
      value: "booking@example.org",
      sourceUrl: "https://example.org/ada/contact",
      verifiedAt: "2026-07-12"
    }
  }), {
    now: new Date("2026-07-13T15:00:00.000Z")
  });
  assert.equal(representative.ok, false);
  assert.ok(representative.errors.some((error) => error.includes("candidate-owned public business email")));
});

test("requires sensitive-category and high-risk approvals before request staging", () => {
  const sensitive = buildHostProspectCreateRequest(campaignMember({
    candidate: {
      ...campaignMember().candidate,
      primaryCategory: "medicine",
      riskLevel: "high"
    }
  }), {
    now: new Date("2026-07-13T15:00:00.000Z")
  });
  assert.equal(sensitive.ok, false);
  assert.ok(sensitive.errors.some((error) => error.includes("sensitiveCategoryReviewStatus")));
  assert.ok(sensitive.errors.some((error) => error.includes("seniorApprovalRef")));

  const approvedSensitive = buildHostProspectCreateRequest(campaignMember({
    sensitiveCategoryReviewStatus: "approved",
    seniorApprovalRef: "senior:operator_002",
    candidate: {
      ...campaignMember().candidate,
      primaryCategory: "medicine",
      riskLevel: "high"
    }
  }), {
    now: new Date("2026-07-13T15:00:00.000Z")
  });
  assert.equal(approvedSensitive.ok, true, approvedSensitive.errors?.join("\n"));
});

test("creates a private CTA record without copying email or dossier fields", () => {
  const request = buildHostProspectCreateRequest(campaignMember(), {
    now: new Date("2026-07-13T15:00:00.000Z")
  }).request;
  const result = createPrivateHostProspectRecord({
    request,
    response: fixture("create-prospect.response.json"),
    allowedCtaOrigins: ["https://beglib.com"],
    recordedAt: "2026-07-13T15:00:02.000Z"
  });
  assert.equal(result.ok, true, result.errors?.join("\n"));
  assert.equal(result.record.prospectId, "8d7636a6-c4f3-4aa9-85eb-ff59a8cf12f4");
  assert.equal(result.record.externalCandidateId, "candidate_pilot_0001");
  assert.equal(result.record.ctaUrl.includes("#t="), true);
  assert.equal(JSON.stringify(result.record).includes("ada.lovelace@example.org"), false);
  assert.equal(JSON.stringify(result.record).includes("Ada Lovelace"), false);
});

test("applies event pages idempotently and advances only known prospect records", () => {
  const request = buildHostProspectCreateRequest(campaignMember(), {
    now: new Date("2026-07-13T15:00:00.000Z")
  }).request;
  const initial = createPrivateHostProspectRecord({
    request,
    response: fixture("create-prospect.response.json"),
    allowedCtaOrigins: ["https://beglib.com"],
    recordedAt: "2026-07-13T15:00:02.000Z"
  }).record;

  const firstApply = applyHostProspectEventPage({ records: [initial], processedEventIds: [] }, fixture("events-page.response.json"), {
    now: new Date("2026-07-14T10:00:00.000Z")
  });
  assert.equal(firstApply.ok, true, firstApply.errors?.join("\n"));
  assert.equal(firstApply.summary.applied, 3);
  assert.equal(firstApply.state.records[0].prospectStatus, "enrollment_started");
  assert.equal(firstApply.state.records[0].enrollmentStatus, "email_verified");
  assert.equal(firstApply.state.records[0].lastLandingObservedAt, "2026-07-14T09:00:00.000Z");

  const secondApply = applyHostProspectEventPage(firstApply.state, fixture("events-page.response.json"), {
    now: new Date("2026-07-14T10:01:00.000Z")
  });
  assert.equal(secondApply.ok, true);
  assert.equal(secondApply.summary.applied, 0);
  assert.equal(secondApply.summary.skippedDuplicate, 3);
});

test("redacts CTA URLs after terminal or expiry retention windows", () => {
  const state = {
    records: [
      {
        prospectId: "8d7636a6-c4f3-4aa9-85eb-ff59a8cf12f4",
        ctaUrl: "https://beglib.com/host/invite#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        expiresAt: "2026-08-12T15:00:00.000Z",
        terminalAt: null
      },
      {
        prospectId: "8d7636a6-c4f3-4aa9-85eb-ff59a8cf12f5",
        ctaUrl: "https://beglib.com/host/invite#t=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        expiresAt: "2026-08-12T15:00:00.000Z",
        terminalAt: "2026-07-20T10:00:00.000Z"
      },
      {
        prospectId: "8d7636a6-c4f3-4aa9-85eb-ff59a8cf12f6",
        ctaUrl: "https://beglib.com/host/invite#t=CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        expiresAt: "2026-12-12T15:00:00.000Z",
        terminalAt: null
      }
    ],
    processedEventIds: [],
    cursor: null
  };

  const result = redactExpiredHostProspectCtas(state, {
    now: new Date("2026-09-20T15:00:00.000Z"),
    terminalRetentionDays: 30,
    expiredRetentionDays: 30
  });
  assert.equal(result.ok, true);
  assert.equal(result.summary.redacted, 2);
  assert.equal(result.state.records[0].ctaUrl, null);
  assert.equal(result.state.records[0].ctaRedactionReason, "expired_retention_elapsed");
  assert.equal(result.state.records[1].ctaUrl, null);
  assert.equal(result.state.records[1].ctaRedactionReason, "terminal_retention_elapsed");
  assert.equal(result.state.records[2].ctaUrl?.includes("#t="), true);
});

test("summarizes private state counters and redaction due counts without mutation", () => {
  const state = {
    records: [
      {
        prospectId: "8d7636a6-c4f3-4aa9-85eb-ff59a8cf12f4",
        prospectStatus: "converted",
        enrollmentStatus: "active",
        ctaUrl: "https://beglib.com/host/invite#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        expiresAt: "2026-08-12T15:00:00.000Z",
        terminalAt: "2026-08-01T10:00:00.000Z"
      },
      {
        prospectId: "8d7636a6-c4f3-4aa9-85eb-ff59a8cf12f5",
        prospectStatus: "expired",
        enrollmentStatus: "expired",
        ctaUrl: null,
        ctaRedactedAt: "2026-09-20T15:00:00.000Z",
        expiresAt: "2026-08-12T15:00:00.000Z",
        terminalAt: null
      }
    ],
    processedEventIds: ["event_1", "event_2"],
    cursor: "cursor_2"
  };
  const summary = summarizeHostProspectState(state, {
    now: new Date("2026-09-20T15:00:00.000Z"),
    terminalRetentionDays: 30,
    expiredRetentionDays: 30
  });

  assert.equal(summary.records, 2);
  assert.equal(summary.byProspectStatus.converted, 1);
  assert.equal(summary.byProspectStatus.expired, 1);
  assert.equal(summary.byEnrollmentStatus.active, 1);
  assert.equal(summary.ctaActive, 1);
  assert.equal(summary.ctaRedacted, 1);
  assert.equal(summary.ctaRedactionDue, 1);
  assert.equal(summary.terminal, 1);
  assert.equal(summary.converted, 1);
  assert.equal(summary.expired, 1);
  assert.equal(summary.processedEvents, 2);
  assert.equal(state.records[0].ctaUrl?.includes("#t="), true);
});
