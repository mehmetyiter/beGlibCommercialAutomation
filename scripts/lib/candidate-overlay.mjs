import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { appendAudit, isoNow, newId, readState, updateState } from './outreach-store.mjs';

/**
 * Hand-entered operator truth, kept in its own file and merged over the generated dossier
 * export at read time. The export is regenerable and gets overwritten on every rebuild;
 * anything a human typed must therefore live outside it, or a rebuild destroys the work.
 * That is exactly the failure documented in docs/dashboard-completion-plan.md.
 */
export const DEFAULT_CANDIDATE_OVERLAY_PATH = './data/candidate-overlay.local.json';

export const OVERLAY_EMPTY_STATE = { version: 1, records: [], updatedAt: null };

export const REVIEW_OUTCOME_STATUSES = ['pending', 'approved', 'rejected', 'deferred'];

export const OVERLAY_CONSENT_STATUSES = [
  'unknown',
  'public-business-contact',
  'representative-contact',
  'contact-form-only',
  'opted-out',
  'not-allowed',
];

export const OVERLAY_RISK_LEVELS = ['low', 'medium', 'high'];

export const MANUAL_CANDIDATE_CATEGORIES = [
  'science',
  'arts',
  'youtube',
  'podcast',
  'thought-leadership',
  'religion',
  'psychology',
  'therapy',
  'medicine',
  'academia',
  'journalism',
  'education',
  'technology',
];

const SENSITIVE_CATEGORIES = new Set(['psychology', 'therapy', 'medicine']);

/**
 * A rejected review is not just a label: it has to stop the send path, so it maps onto the
 * candidate status the preflight already blocks on.
 */
const STATUS_BY_OUTCOME = {
  approved: 'approved',
  rejected: 'do-not-contact',
  deferred: 'needs-review',
};

export function resolveOverlayPath(env = process.env) {
  const configured = typeof env?.CANDIDATE_OVERLAY_PATH === 'string' ? env.CANDIDATE_OVERLAY_PATH.trim() : '';

  return resolve(configured || DEFAULT_CANDIDATE_OVERLAY_PATH);
}

export async function loadOverlayState(path = resolveOverlayPath()) {
  return readState(path, OVERLAY_EMPTY_STATE);
}

export function listOverlayRecords(state, datasetId) {
  const records = state?.records ?? [];

  return datasetId ? records.filter((record) => record.datasetId === datasetId) : records;
}

export function findOverlayRecord(state, { datasetId, candidateId }) {
  return (
    (state?.records ?? []).find(
      (record) => record.candidateId === candidateId && record.datasetId === datasetId,
    ) ?? null
  );
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function slugify(value) {
  return trimmed(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '');
}

export function validateManualCandidateInput(input) {
  const errors = [];

  if (!trimmed(input?.datasetId)) {
    errors.push('datasetId is required so the candidate appears in the dataset the operator is working in.');
  }

  if (trimmed(input?.name).length < 2) {
    errors.push('name is required.');
  }

  if (!MANUAL_CANDIDATE_CATEGORIES.includes(trimmed(input?.category))) {
    errors.push(`category must be one of: ${MANUAL_CANDIDATE_CATEGORIES.join(', ')}.`);
  }

  if (!trimmed(input?.country)) {
    errors.push('country is required; jurisdiction drives the outreach rules that apply.');
  }

  if (!/^https?:\/\//i.test(trimmed(input?.sourceUrl))) {
    errors.push('sourceUrl must be the public page this person was found on.');
  }

  if (!trimmed(input?.operatorRef)) {
    errors.push('operatorRef is required; every hand-entered record needs a named owner.');
  }

  return { ok: errors.length === 0, errors };
}

export function validateChannelVerificationInput(input) {
  const errors = [];

  if (!trimmed(input?.candidateId)) {
    errors.push('candidateId is required.');
  }

  if (!trimmed(input?.datasetId)) {
    errors.push('datasetId is required.');
  }

  if (!/^https?:\/\//i.test(trimmed(input?.url))) {
    errors.push('url must be the channel URL you opened and checked.');
  }

  if (!trimmed(input?.operatorRef)) {
    errors.push('operatorRef is required; every channel verification needs a named owner.');
  }

  if (!trimmed(input?.evidenceNote)) {
    errors.push('evidenceNote is required; record what tied this channel to this person.');
  }

  return { ok: errors.length === 0, errors };
}

export function validateReviewOutcomeInput(input) {
  const errors = [];

  if (!trimmed(input?.candidateId)) {
    errors.push('candidateId is required.');
  }

  if (!trimmed(input?.datasetId)) {
    errors.push('datasetId is required.');
  }

  if (!REVIEW_OUTCOME_STATUSES.includes(trimmed(input?.outcomeStatus))) {
    errors.push(`outcomeStatus must be one of: ${REVIEW_OUTCOME_STATUSES.join(', ')}.`);
  }

  if (!trimmed(input?.operatorRef)) {
    errors.push('operatorRef is required; every review outcome needs a named owner.');
  }

  const consentStatus = trimmed(input?.consentStatus);
  if (consentStatus && !OVERLAY_CONSENT_STATUSES.includes(consentStatus)) {
    errors.push(`consentStatus must be one of: ${OVERLAY_CONSENT_STATUSES.join(', ')}.`);
  }

  const riskLevel = trimmed(input?.riskLevel);
  if (riskLevel && !OVERLAY_RISK_LEVELS.includes(riskLevel)) {
    errors.push(`riskLevel must be one of: ${OVERLAY_RISK_LEVELS.join(', ')}.`);
  }

  if (input?.star !== undefined && input?.star !== null && input?.star !== '') {
    const star = Number(input.star);

    if (!Number.isInteger(star) || star < 1 || star > 5) {
      errors.push('star must be an integer between 1 and 5, or empty to keep the discovery score.');
    }
  }

  return { ok: errors.length === 0, errors };
}

function upsertRecord(records, { datasetId, candidateId }, apply) {
  const index = records.findIndex(
    (record) => record.candidateId === candidateId && record.datasetId === datasetId,
  );
  const now = isoNow();
  const existing = index === -1 ? null : records[index];
  const next = {
    ...(existing ?? {
      id: newId('ovl'),
      candidateId,
      datasetId,
      manualCandidate: null,
      review: null,
      verifiedChannels: [],
      createdAt: now,
    }),
    updatedAt: now,
  };
  const updated = apply(next, now);

  if (index === -1) {
    return { records: [...records, updated], record: updated };
  }

  return {
    records: records.map((record, position) => (position === index ? updated : record)),
    record: updated,
  };
}

export async function createManualCandidate(config, input) {
  const validation = validateManualCandidateInput(input);

  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const datasetId = trimmed(input.datasetId);
  const name = trimmed(input.name);
  const candidateId = `manual-${slugify(name) || 'candidate'}-${randomUUID().slice(0, 8)}`;
  let created = null;

  await updateState(config.paths.candidateOverlay, OVERLAY_EMPTY_STATE, (state) => {
    const result = upsertRecord(state.records ?? [], { datasetId, candidateId }, (record, now) => ({
      ...record,
      manualCandidate: {
        name,
        title: trimmed(input.title),
        category: trimmed(input.category),
        country: trimmed(input.country),
        sourceUrl: trimmed(input.sourceUrl),
        note: trimmed(input.note),
        createdBy: trimmed(input.operatorRef),
        createdAt: now,
      },
    }));

    created = result.record;

    return { ...state, records: result.records };
  });

  await appendAudit(config.paths.audit, {
    action: 'candidate_manually_created',
    candidateId,
    datasetId,
    name,
    sourceUrl: trimmed(input.sourceUrl),
    actor: trimmed(input.operatorRef),
  });

  return { ok: true, record: created };
}

export async function recordReviewOutcome(config, input) {
  const validation = validateReviewOutcomeInput(input);

  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const datasetId = trimmed(input.datasetId);
  const candidateId = trimmed(input.candidateId);
  const star = input.star === undefined || input.star === null || input.star === '' ? null : Number(input.star);
  let saved = null;

  await updateState(config.paths.candidateOverlay, OVERLAY_EMPTY_STATE, (state) => {
    const result = upsertRecord(state.records ?? [], { datasetId, candidateId }, (record, now) => ({
      ...record,
      review: {
        outcomeStatus: trimmed(input.outcomeStatus),
        note: trimmed(input.note),
        consentStatus: trimmed(input.consentStatus) || null,
        riskLevel: trimmed(input.riskLevel) || null,
        star,
        reviewedBy: trimmed(input.operatorRef),
        reviewedAt: now,
      },
    }));

    saved = result.record;

    return { ...state, records: result.records };
  });

  await appendAudit(config.paths.audit, {
    action: 'candidate_review_recorded',
    candidateId,
    datasetId,
    outcomeStatus: trimmed(input.outcomeStatus),
    consentStatus: trimmed(input.consentStatus) || null,
    riskLevel: trimmed(input.riskLevel) || null,
    star,
    actor: trimmed(input.operatorRef),
  });

  return { ok: true, record: saved };
}

/**
 * Channel identity verification: a human opened the URL and confirmed it really belongs to
 * this candidate. It replaces the `review:official-sources` CLI round-trip, and like every
 * other operator record it lives in the overlay rather than in the regenerable export.
 *
 * This is identity attribution only. It is not a contact route and grants no permission to
 * send anything: emailing still requires a contact verification through the outreach gate.
 */
export async function verifyChannel(config, input) {
  const validation = validateChannelVerificationInput(input);

  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const datasetId = trimmed(input.datasetId);
  const candidateId = trimmed(input.candidateId);
  const url = trimmed(input.url);
  const key = normalizeChannelUrl(url);
  let verification = null;

  await updateState(config.paths.candidateOverlay, OVERLAY_EMPTY_STATE, (state) => {
    const result = upsertRecord(state.records ?? [], { datasetId, candidateId }, (record, now) => {
      verification = {
        url,
        platform: trimmed(input.platform),
        label: trimmed(input.label),
        evidenceNote: trimmed(input.evidenceNote),
        verifiedBy: trimmed(input.operatorRef),
        verifiedAt: now,
      };

      return {
        ...record,
        verifiedChannels: [
          ...(record.verifiedChannels ?? []).filter((entry) => normalizeChannelUrl(entry.url) !== key),
          verification,
        ],
      };
    });

    return { ...state, records: result.records };
  });

  await appendAudit(config.paths.audit, {
    action: 'channel_verified',
    candidateId,
    datasetId,
    url,
    platform: verification.platform,
    actor: verification.verifiedBy,
  });

  return { ok: true, verification };
}

export async function revokeChannelVerification(config, { datasetId, candidateId, url, operatorRef, note }) {
  const key = normalizeChannelUrl(trimmed(url));

  if (!trimmed(operatorRef)) {
    return { ok: false, errors: ['operatorRef is required.'] };
  }

  if (!key) {
    return { ok: false, errors: ['url is required.'] };
  }

  let removed = false;

  await updateState(config.paths.candidateOverlay, OVERLAY_EMPTY_STATE, (state) => {
    const records = state.records ?? [];
    const index = records.findIndex(
      (record) =>
        record.candidateId === trimmed(candidateId) &&
        record.datasetId === trimmed(datasetId) &&
        (record.verifiedChannels ?? []).some((entry) => normalizeChannelUrl(entry.url) === key),
    );

    if (index === -1) {
      return null;
    }

    removed = true;

    return {
      ...state,
      records: records.map((record, position) =>
        position === index
          ? {
              ...record,
              updatedAt: isoNow(),
              verifiedChannels: (record.verifiedChannels ?? []).filter(
                (entry) => normalizeChannelUrl(entry.url) !== key,
              ),
            }
          : record,
      ),
    };
  });

  if (!removed) {
    return { ok: false, errors: ['No operator channel verification matches that candidate and URL.'] };
  }

  await appendAudit(config.paths.audit, {
    action: 'channel_verification_revoked',
    candidateId: trimmed(candidateId),
    datasetId: trimmed(datasetId),
    url: trimmed(url),
    actor: trimmed(operatorRef),
    note: trimmed(note),
  });

  return { ok: true };
}

function normalizeChannelUrl(value) {
  try {
    const url = new URL(String(value));
    url.hash = '';

    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    return url.toString();
  } catch {
    return trimmed(value).toLowerCase();
  }
}

export const MAX_BULK_REVIEW_CANDIDATES = 500;

/**
 * The same decision across a selection, written under one lock rather than one request per
 * candidate. Validation is identical to the single-candidate path — a bulk action cannot
 * record something a single review would have rejected.
 */
export async function recordReviewOutcomes(config, input) {
  const candidateIds = Array.from(
    new Set((Array.isArray(input?.candidateIds) ? input.candidateIds : []).map(trimmed).filter(Boolean)),
  );

  if (candidateIds.length === 0) {
    return { ok: false, errors: ['candidateIds must contain at least one candidate.'] };
  }

  if (candidateIds.length > MAX_BULK_REVIEW_CANDIDATES) {
    return {
      ok: false,
      errors: [`A bulk review is limited to ${MAX_BULK_REVIEW_CANDIDATES} candidates per request.`],
    };
  }

  const validation = validateReviewOutcomeInput({ ...input, candidateId: candidateIds[0] });

  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const datasetId = trimmed(input.datasetId);
  const star = input.star === undefined || input.star === null || input.star === '' ? null : Number(input.star);
  const review = {
    outcomeStatus: trimmed(input.outcomeStatus),
    note: trimmed(input.note),
    consentStatus: trimmed(input.consentStatus) || null,
    riskLevel: trimmed(input.riskLevel) || null,
    star,
    reviewedBy: trimmed(input.operatorRef),
    reviewedAt: null,
  };

  await updateState(config.paths.candidateOverlay, OVERLAY_EMPTY_STATE, (state) => {
    let records = state.records ?? [];

    for (const candidateId of candidateIds) {
      const result = upsertRecord(records, { datasetId, candidateId }, (record, now) => ({
        ...record,
        review: { ...review, reviewedAt: now },
      }));

      records = result.records;
    }

    return { ...state, records };
  });

  for (const candidateId of candidateIds) {
    await appendAudit(config.paths.audit, {
      action: 'candidate_review_recorded',
      candidateId,
      datasetId,
      outcomeStatus: review.outcomeStatus,
      consentStatus: review.consentStatus,
      riskLevel: review.riskLevel,
      star,
      bulk: true,
      actor: review.reviewedBy,
    });
  }

  return { ok: true, updated: candidateIds.length, candidateIds };
}

function sensitiveFlagsFor(category, riskLevel) {
  const flags = [];

  if (SENSITIVE_CATEGORIES.has(category)) {
    flags.push('health-or-mental-health');
  }

  if (category === 'religion') {
    flags.push('religion');
  }

  if (riskLevel === 'high') {
    flags.push('high-risk');
  }

  return flags;
}

/**
 * A hand-entered person enters the pool with no discovery evidence at all: no channels, no
 * contact candidates, one source URL. It stays that way until a human verifies a route
 * through the same gate every generated candidate goes through.
 */
export function buildManualDossier(record) {
  const manual = record.manualCandidate;
  const riskLevel = record.review?.riskLevel ?? 'medium';

  return {
    candidateId: record.candidateId,
    name: manual.name,
    title: manual.title || '',
    category: manual.category,
    subcategories: [],
    country: manual.country,
    fitScore: 0,
    reachScore: 0,
    status: 'researching',
    consentStatus: 'unknown',
    riskLevel,
    sensitiveFlags: sensitiveFlagsFor(manual.category, riskLevel),
    origin: 'manual-entry',
    manualEntry: { createdBy: manual.createdBy, createdAt: manual.createdAt, note: manual.note },
    discoveryStar: {
      stars: 0,
      score: 0,
      label: 'Elle girilen aday',
      reasons: ['Operator tarafindan elle eklendi.'],
      missingSignals: ['Kesif taramasi bu aday icin calistirilmadi.'],
      note: 'Discovery stars are prioritization only; they are not contact permission or compliance approval.',
    },
    counts: {
      discoveryChannels: 0,
      contactCandidates: 0,
      publicEmailCandidates: 0,
      contactPageCandidates: 0,
      creatorSuggestions: 0,
      affiliations: 0,
      searchTargets: 0,
      sourcePackages: 0,
      quarantinedChannels: 0,
      quarantinedContactCandidates: 0,
    },
    discoveryChannels: [],
    contactCandidates: [],
    quarantinedChannels: [],
    quarantinedContactCandidates: [],
    affiliations: [],
    searchTargets: [],
    sourceUrls: [manual.sourceUrl],
    reviewChecks: [
      'Confirm identity match for every source before applying it to the candidate record.',
      'Convert only verified professional or representative routes into contactRoutes.',
      'Check suppression, jurisdiction, and sensitive-category status before campaign use.',
    ],
    reviewOutcome: {
      candidateId: record.candidateId,
      outcomeStatus: 'pending',
      verifiedChannels: [],
      verifiedContactRoutes: [],
      verifiedSourceUrls: [],
      reviewerNotes: '',
    },
  };
}

function applyVerifiedChannels(dossier, record) {
  const verified = record.verifiedChannels ?? [];

  if (verified.length === 0) {
    return dossier;
  }

  const byUrl = new Map(verified.map((entry) => [normalizeChannelUrl(entry.url), entry]));
  const channels = (dossier.discoveryChannels ?? []).map((channel) => {
    const entry = byUrl.get(normalizeChannelUrl(channel.url));

    if (!entry) {
      return channel;
    }

    byUrl.delete(normalizeChannelUrl(channel.url));

    return { ...channel, verified: true, confidence: 'verified', operatorVerification: entry };
  });

  // A channel the operator verified from the quarantine list, or one they typed in, still
  // has to appear somewhere: it becomes a discovery channel carrying its own evidence.
  const added = Array.from(byUrl.values()).map((entry) => ({
    source: 'operator-review',
    platform: entry.platform || 'website',
    label: entry.label || entry.url,
    url: entry.url,
    verified: true,
    confidence: 'verified',
    identityAttribution: 'direct',
    identityConfidence: 'high',
    identityEvidence: [entry.evidenceNote].filter(Boolean),
    eligibleForReview: true,
    operatorVerification: entry,
  }));
  const discoveryChannels = [...channels, ...added];
  const quarantinedChannels = (dossier.quarantinedChannels ?? []).filter(
    (channel) => !byUrlHas(verified, channel.url),
  );

  return {
    ...dossier,
    discoveryChannels,
    quarantinedChannels,
    counts: {
      ...(dossier.counts ?? {}),
      discoveryChannels: discoveryChannels.length,
      quarantinedChannels: quarantinedChannels.length,
      verifiedChannels: verified.length,
    },
  };
}

function applyReview(dossierInput, record) {
  const dossier = applyVerifiedChannels(dossierInput, record);
  const review = record.review;

  if (!review) {
    return { ...dossier, overlay: overlaySummary(record) };
  }

  const riskLevel = review.riskLevel ?? dossier.riskLevel;
  const consentStatus = review.consentStatus ?? dossier.consentStatus;
  const sensitiveFlags = Array.from(
    new Set([
      ...(dossier.sensitiveFlags ?? []).filter((flag) => flag !== 'high-risk'),
      ...(riskLevel === 'high' ? ['high-risk'] : []),
    ]),
  );

  return {
    ...dossier,
    status: STATUS_BY_OUTCOME[review.outcomeStatus] ?? dossier.status,
    consentStatus,
    riskLevel,
    sensitiveFlags,
    discoveryStar:
      review.star === null
        ? dossier.discoveryStar
        : {
            ...(dossier.discoveryStar ?? {}),
            stars: review.star,
            discoveredStars: dossier.discoveryStar?.stars ?? 0,
            label: `Operator ${review.star} yildiz verdi`,
          },
    reviewOutcome: {
      ...(dossier.reviewOutcome ?? {}),
      candidateId: dossier.candidateId,
      outcomeStatus: review.outcomeStatus,
      reviewerNotes: review.note,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      source: 'operator-overlay',
    },
    overlay: overlaySummary(record),
  };
}

function byUrlHas(entries, url) {
  const key = normalizeChannelUrl(url);

  return entries.some((entry) => normalizeChannelUrl(entry.url) === key);
}

function overlaySummary(record) {
  return {
    recordId: record.id,
    manual: Boolean(record.manualCandidate),
    review: record.review ?? null,
    verifiedChannels: record.verifiedChannels ?? [],
    updatedAt: record.updatedAt,
  };
}

/**
 * Merges the overlay over a generated dossier package. Pure and side-effect free so the
 * dashboard read path, the outreach server, and the CLI all see the same candidate.
 */
export function applyOverlay(dossierPackage, state, datasetId) {
  const records = listOverlayRecords(state, datasetId);

  if (records.length === 0) {
    return dossierPackage;
  }

  const byCandidateId = new Map(records.map((record) => [record.candidateId, record]));
  const dossiers = (dossierPackage?.dossiers ?? []).map((dossier) => {
    const record = byCandidateId.get(dossier.candidateId);

    return record ? applyReview(dossier, record) : dossier;
  });
  const known = new Set(dossiers.map((dossier) => dossier.candidateId));
  const manual = records
    .filter((record) => record.manualCandidate && !known.has(record.candidateId))
    .map((record) => applyReview(buildManualDossier(record), record));
  const merged = [...manual, ...dossiers];

  return {
    ...dossierPackage,
    dossiers: merged,
    summary: {
      ...(dossierPackage?.summary ?? {}),
      candidates: merged.length,
      manualCandidates: manual.length,
      operatorReviews: records.filter((record) => record.review).length,
      operatorVerifiedChannels: records.reduce(
        (count, record) => count + (record.verifiedChannels ?? []).length,
        0,
      ),
    },
  };
}
