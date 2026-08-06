import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSignedHostProspectRequest,
  executeSignedHostProspectRequest,
  normalizeApiBaseUrl,
  randomOpaqueToken,
  validateHostProspectApiResponse
} from "./lib/host-prospect-api-client.mjs";
import {
  applyHostProspectEventPage,
  createPrivateHostProspectRecord,
  upsertPrivateHostProspectRecord
} from "./lib/host-prospect-campaign.mjs";
import {
  validateHostProspectCreateRequest,
  validateHostProspectRevokeRequest
} from "./lib/host-prospect-contract.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

await loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
} else {
  await main();
}

async function main() {
  const phase = args.phase;
  if (!phase) throw new Error("--phase is required");
  const baseUrl = requireNonProdBaseUrl();
  const statePath = path.resolve(args.state ?? "exports/host-prospect-smoke-state.local.json");
  const recordPath = path.resolve(args.record ?? "exports/host-prospect-smoke-record.local.json");

  if (!args.live) {
    console.log(JSON.stringify({
      dryRun: true,
      phase,
      apiOrigin: baseUrl.origin,
      statePath,
      recordPath,
      candidateActionRequired: phase === "verify-onboarding"
    }, null, 2));
    console.log("No API call was made. Pass --live only in a non-production environment.");
    return;
  }

  if (phase === "create") {
    await runCreatePhase({ baseUrl, statePath, recordPath });
    return;
  }
  if (phase === "verify-onboarding") {
    await runVerifyOnboardingPhase({ baseUrl, statePath, recordPath });
    return;
  }
  if (phase === "revoke") {
    await runRevokePhase({ baseUrl, statePath, recordPath });
    return;
  }
  throw new Error(`Unsupported --phase ${phase}`);
}

async function runCreatePhase({ baseUrl, statePath, recordPath }) {
  if (!args.request) throw new Error("--request is required for the create phase");
  const requestPath = path.resolve(args.request);
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  const requestValidation = validateHostProspectCreateRequest(request, {
    now: new Date(request.requestedAt)
  });
  assertValid("Host prospect create request", requestValidation);

  const idempotencyKey = randomOpaqueToken();
  const signed = buildSignedHostProspectRequest({
    baseUrl,
    keyId: requiredEnv("HOST_PROSPECT_HMAC_KEY_ID"),
    secret: requiredEnv("HOST_PROSPECT_HMAC_SECRET"),
    method: "POST",
    pathWithQuery: "/internal/v1/host-prospects",
    body: request,
    idempotencyKey
  });
  const response = await executeSignedHostProspectRequest(signed);
  assertApiSuccess("create", response);

  const allowedCtaOrigins = csvValues(requiredEnv("HOST_PROSPECT_ALLOWED_CTA_ORIGINS"));
  assertValid(
    "Host prospect create response",
    validateHostProspectApiResponse("create", response.json, { allowedCtaOrigins })
  );
  const replaySigned = buildSignedHostProspectRequest({
    baseUrl,
    keyId: requiredEnv("HOST_PROSPECT_HMAC_KEY_ID"),
    secret: requiredEnv("HOST_PROSPECT_HMAC_SECRET"),
    method: "POST",
    pathWithQuery: "/internal/v1/host-prospects",
    body: request,
    idempotencyKey
  });
  const replayResponse = await executeSignedHostProspectRequest(replaySigned);
  assertApiSuccess("exact idempotent create replay", replayResponse);
  assertValid(
    "Host prospect exact replay response",
    validateHostProspectApiResponse("create", replayResponse.json, { allowedCtaOrigins })
  );
  for (const field of ["prospectId", "status", "ctaUrl", "expiresAt"]) {
    if (response.json[field] !== replayResponse.json[field]) {
      throw new Error(`Exact idempotent create replay changed ${field}`);
    }
  }
  const reduced = createPrivateHostProspectRecord({
    request,
    response: response.json,
    allowedCtaOrigins
  });
  assertValid("Private Host prospect record", reduced);

  const state = await readJson(statePath, emptyState());
  const nextState = upsertPrivateHostProspectRecord(state, reduced.record);
  await writeJson(statePath, nextState);

  const now = new Date().toISOString();
  const ctaOrigin = new URL(response.json.ctaUrl).origin;
  await writeJson(recordPath, {
    schemaVersion: 1,
    environment: requiredEnv("HOST_PROSPECT_SMOKE_ENV"),
    apiOrigin: baseUrl.origin,
    startedAt: now,
    completedAt: null,
    status: "waiting_for_candidate_onboarding",
    prospectId: response.json.prospectId,
    externalCandidateId: request.externalCandidateId,
    campaignId: request.campaignId,
    campaignMemberId: request.campaignMemberId,
    observedEventTypes: [],
    checks: {
      signedCreate: { status: "passed", checkedAt: now },
      exactIdempotentReplay: { status: "passed", checkedAt: now },
      ctaOrigin: { status: "passed", checkedAt: now, value: ctaOrigin }
    }
  });

  console.log(`Non-production smoke record written to ${recordPath}`);
  console.log(`Private campaign state written to ${statePath}`);
  console.log("Next: open the CTA from the private state file, complete email OTP and Google/Apple SSO, then stop on the onboarding screen.");
}

async function runVerifyOnboardingPhase({ baseUrl, statePath, recordPath }) {
  const record = await requiredRecord(recordPath);
  assertRecordOrigin(record, baseUrl);
  const state = await readJson(statePath, null);
  if (!state) throw new Error(`Smoke state does not exist: ${statePath}`);

  const pulled = await pullAllEvents({ baseUrl, state, prospectId: record.prospectId });
  await writeJson(statePath, pulled.state);
  const observed = unique([...(record.observedEventTypes ?? []), ...pulled.eventTypes]);
  const requiredEvents = [
    "host_prospect.interest_confirmed",
    "host_enrollment.email_challenge_sent",
    "host_enrollment.email_verified",
    "host_enrollment.sso_verified",
    "host_onboarding.started"
  ];
  const missing = requiredEvents.filter((eventType) => !observed.includes(eventType));
  if (missing.length > 0) {
    throw new Error(`Smoke onboarding event chain is incomplete: ${missing.join(", ")}`);
  }

  const prospect = findRecord(pulled.state, record.prospectId);
  if (prospect.prospectStatus !== "enrollment_started") {
    throw new Error(`Expected enrollment_started prospect before revoke, received ${prospect.prospectStatus}`);
  }
  if (!["onboarding", "accepted"].includes(prospect.enrollmentStatus)) {
    throw new Error(`Expected onboarding or accepted enrollment before revoke, received ${prospect.enrollmentStatus ?? "none"}`);
  }

  const now = new Date().toISOString();
  await writeJson(recordPath, {
    ...record,
    status: "onboarding_verified_waiting_for_revoke",
    observedEventTypes: observed,
    checks: {
      ...record.checks,
      claimOtpSsoOnboarding: {
        status: "passed",
        checkedAt: now,
        requiredEventTypes: requiredEvents
      },
      eventFeed: {
        status: "passed",
        checkedAt: now,
        pagesRead: pulled.pagesRead
      }
    }
  });

  console.log("Claim, OTP, SSO, onboarding, and event-feed checks passed.");
  console.log("Next: run the revoke phase before activating the test Host.");
}

async function runRevokePhase({ baseUrl, statePath, recordPath }) {
  const record = await requiredRecord(recordPath);
  assertRecordOrigin(record, baseUrl);
  if (record.status !== "onboarding_verified_waiting_for_revoke") {
    throw new Error("The onboarding verification phase must pass before revoke.");
  }

  const request = { contractVersion: "1.0", reasonCode: "operator_revoked" };
  assertValid("Host prospect revoke request", validateHostProspectRevokeRequest(request));
  const signed = buildSignedHostProspectRequest({
    baseUrl,
    keyId: requiredEnv("HOST_PROSPECT_HMAC_KEY_ID"),
    secret: requiredEnv("HOST_PROSPECT_HMAC_SECRET"),
    method: "POST",
    pathWithQuery: `/internal/v1/host-prospects/${encodeURIComponent(record.prospectId)}/revoke`,
    body: request
  });
  const response = await executeSignedHostProspectRequest(signed);
  assertApiSuccess("revoke", response);
  assertValid("Host prospect revoke response", validateHostProspectApiResponse("revoke", response.json));

  const state = await readJson(statePath, null);
  if (!state) throw new Error(`Smoke state does not exist: ${statePath}`);
  const pulled = await pullAllEvents({ baseUrl, state, prospectId: record.prospectId });
  await writeJson(statePath, pulled.state);
  const observed = unique([...(record.observedEventTypes ?? []), ...pulled.eventTypes]);
  if (!observed.some((eventType) => eventType === "host_prospect.revoked" || eventType === "host_enrollment.revoked")) {
    throw new Error("The authoritative revoke event was not observed.");
  }
  const prospect = findRecord(pulled.state, record.prospectId);
  if (prospect.prospectStatus !== "revoked") {
    throw new Error(`Expected revoked prospect state, received ${prospect.prospectStatus}`);
  }

  const now = new Date().toISOString();
  await writeJson(recordPath, {
    ...record,
    status: "passed",
    completedAt: now,
    observedEventTypes: observed,
    checks: {
      ...record.checks,
      signedRevoke: { status: "passed", checkedAt: now },
      authoritativeRevokeEvent: { status: "passed", checkedAt: now }
    }
  });
  console.log(`Non-production Host prospect smoke passed. Evidence: ${recordPath}`);
}

async function pullAllEvents({ baseUrl, state, prospectId }) {
  let nextState = state;
  let pagesRead = 0;
  const eventTypes = [];

  while (pagesRead < 100) {
    const query = new URLSearchParams({ limit: "100" });
    if (nextState.cursor) query.set("after", nextState.cursor);
    const pathWithQuery = `/internal/v1/host-prospect-events?${query.toString()}`;
    const signed = buildSignedHostProspectRequest({
      baseUrl,
      keyId: requiredEnv("HOST_PROSPECT_HMAC_KEY_ID"),
      secret: requiredEnv("HOST_PROSPECT_HMAC_SECRET"),
      method: "GET",
      pathWithQuery
    });
    const response = await executeSignedHostProspectRequest(signed);
    assertApiSuccess("events", response);
    assertValid("Host prospect event page", validateHostProspectApiResponse("events", response.json));
    eventTypes.push(
      ...response.json.events
        .filter((event) => event.prospectId === prospectId)
        .map((event) => event.type)
    );
    const applied = applyHostProspectEventPage(nextState, response.json);
    assertValid("Host prospect event application", applied);
    nextState = applied.state;
    pagesRead += 1;
    if (!response.json.hasMore) return { state: nextState, pagesRead, eventTypes: unique(eventTypes) };
  }
  throw new Error("Event feed exceeded the 100-page smoke safety limit.");
}

function requireNonProdBaseUrl() {
  const smokeEnv = requiredEnv("HOST_PROSPECT_SMOKE_ENV").toLowerCase();
  if (!["local", "beta", "staging"].includes(smokeEnv)) {
    throw new Error("HOST_PROSPECT_SMOKE_ENV must be local, beta, or staging");
  }
  const url = normalizeApiBaseUrl(requiredEnv("HOST_PROSPECT_API_BASE_URL"), {
    allowInsecureLocal: args.allowInsecureLocal
  });
  if (url.hostname === "api.beglib.com" || url.hostname === "beglib.com") {
    throw new Error("The non-production smoke command refuses the production beGlib origin.");
  }
  return url;
}

function assertRecordOrigin(record, baseUrl) {
  if (record.apiOrigin !== baseUrl.origin) {
    throw new Error(`Smoke record origin ${record.apiOrigin} does not match ${baseUrl.origin}`);
  }
}

function findRecord(state, prospectId) {
  const record = state.records?.find((item) => item.prospectId === prospectId);
  if (!record) throw new Error(`Smoke prospect ${prospectId} is missing from private state`);
  return record;
}

async function requiredRecord(recordPath) {
  const record = await readJson(recordPath, null);
  if (!record) throw new Error(`Smoke record does not exist: ${recordPath}`);
  return record;
}

function assertApiSuccess(operation, response) {
  if (response.ok) return;
  const code = response.json?.code ? ` ${response.json.code}` : "";
  const message = response.json?.message ? `: ${response.json.message}` : "";
  throw new Error(`${operation} failed with HTTP ${response.status}${code}${message}`);
}

function assertValid(label, result) {
  if (result?.ok) return;
  throw new Error(`${label} failed validation: ${(result?.errors ?? ["unknown error"]).join("; ")}`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function csvValues(value) {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function emptyState() {
  return { records: [], processedEventIds: [], cursor: null };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(values) {
  const parsed = { live: false, allowInsecureLocal: false, help: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--phase") parsed.phase = values[++index];
    else if (value === "--request") parsed.request = values[++index];
    else if (value === "--state") parsed.state = values[++index];
    else if (value === "--record") parsed.record = values[++index];
    else if (value === "--live") parsed.live = true;
    else if (value === "--allow-insecure-local") parsed.allowInsecureLocal = true;
    else if (value === "--help" || value === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  npm run host-prospect:smoke -- --phase create --request <request.json> --live
  npm run host-prospect:smoke -- --phase verify-onboarding --live
  npm run host-prospect:smoke -- --phase revoke --live

Options:
  --state <path>   Private state path
  --record <path>  Redacted smoke evidence path
  --allow-insecure-local  Permit HTTP only for localhost

The command refuses production origins. Complete OTP and Google/Apple SSO manually
between create and verify-onboarding, and stop before final Host activation.`);
}
