import { appendAudit, isoNow, newId, normalizeEmail, readState, updateState } from './outreach-store.mjs';

const EMPTY_STATE = { version: 1, verifications: [], updatedAt: null };
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const SENDABLE_ROUTE_TYPE = 'public-business-email';
export const SENDABLE_CONSENT_BASIS = 'public-business-contact';

/**
 * Only routes a person actually published for professional contact qualify. Anything
 * derived from a pattern guess, a scraped obfuscated endpoint, or a third-party list
 * has no entry here by design.
 */
export const VERIFICATION_METHODS = [
  'official-site-contact-page',
  'official-site-imprint',
  'institution-directory',
  'press-or-media-kit',
  'public-booking-page',
  'public-profile-listing',
];

function isGuessedPattern(email) {
  return /\{|\}|first\.last|firstname|lastname|initial\./i.test(email);
}

export async function loadVerificationState(config) {
  return readState(config.paths.verifications, EMPTY_STATE);
}

/**
 * A verification expires at the earlier of its explicit freshness date and the
 * configured maximum age, so a reviewer cannot grant themselves an unbounded window.
 */
export function verificationExpiry(verification, verificationMaxAgeDays) {
  const verifiedAtMs = Date.parse(verification.verifiedAt);
  const explicitMs = Date.parse(verification.verificationFreshUntil);
  const cappedMs = Number.isFinite(verifiedAtMs) ? verifiedAtMs + verificationMaxAgeDays * DAY_MS : Number.NaN;

  const candidates = [explicitMs, cappedMs].filter((value) => Number.isFinite(value));

  return candidates.length > 0 ? new Date(Math.min(...candidates)) : null;
}

export function findActiveVerification(state, { candidateId, email, now = new Date(), verificationMaxAgeDays = 90 }) {
  const normalizedEmail = normalizeEmail(email);

  return (
    (state?.verifications ?? []).find((verification) => {
      if (verification.revokedAt) {
        return false;
      }

      if (verification.candidateId !== candidateId || verification.email !== normalizedEmail) {
        return false;
      }

      const expiry = verificationExpiry(verification, verificationMaxAgeDays);

      return Boolean(expiry) && expiry.getTime() > now.getTime();
    }) ?? null
  );
}

export function listVerificationsForCandidate(state, candidateId) {
  return (state?.verifications ?? []).filter((verification) => verification.candidateId === candidateId);
}

export function validateVerificationInput(input) {
  const errors = [];
  const email = normalizeEmail(input?.email);

  if (!input?.candidateId) {
    errors.push('candidateId is required.');
  }

  if (!input?.candidateName) {
    errors.push('candidateName is required so the outbox record is readable without the dossier.');
  }

  if (!EMAIL_PATTERN.test(email)) {
    errors.push('A valid email address is required.');
  }

  if (email && isGuessedPattern(email)) {
    errors.push('This address looks like a guessed pattern rather than a published contact route.');
  }

  if (input?.routeType !== SENDABLE_ROUTE_TYPE) {
    errors.push(`routeType must be ${SENDABLE_ROUTE_TYPE}; representative and contact-form routes cannot be emailed.`);
  }

  if (input?.consentBasis !== SENDABLE_CONSENT_BASIS) {
    errors.push(`consentBasis must be ${SENDABLE_CONSENT_BASIS}.`);
  }

  if (!VERIFICATION_METHODS.includes(input?.verificationMethod)) {
    errors.push(`verificationMethod must be one of: ${VERIFICATION_METHODS.join(', ')}.`);
  }

  if (!input?.sourceUrl || !/^https?:\/\//i.test(input.sourceUrl)) {
    errors.push('sourceUrl must be the public page where this contact route is published.');
  }

  if (!input?.reviewerRef) {
    errors.push('reviewerRef is required; every verification needs a named human owner.');
  }

  if (!input?.evidenceNote) {
    errors.push('evidenceNote is required; record what you saw on the source page.');
  }

  const freshUntilMs = Date.parse(input?.verificationFreshUntil ?? '');
  if (!Number.isFinite(freshUntilMs)) {
    errors.push('verificationFreshUntil must be a valid date-time.');
  } else if (freshUntilMs <= Date.now()) {
    errors.push('verificationFreshUntil must be in the future.');
  }

  return { ok: errors.length === 0, errors };
}

export async function recordVerification(config, input) {
  const validation = validateVerificationInput(input);

  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const email = normalizeEmail(input.email);
  const verifiedAt = isoNow(input.verifiedAt ?? new Date());
  let verification = null;

  await updateState(config.paths.verifications, EMPTY_STATE, (state) => {
    // Re-verifying the same route supersedes the previous record instead of stacking
    // duplicates, so "which verification authorised this send" always has one answer.
    const superseded = (state.verifications ?? []).map((existing) =>
      existing.candidateId === input.candidateId && existing.email === email && !existing.revokedAt
        ? { ...existing, revokedAt: isoNow(), revokedBy: input.reviewerRef, revocationNote: 'superseded by re-verification' }
        : existing,
    );

    verification = {
      id: newId('ver'),
      candidateId: input.candidateId,
      candidateName: input.candidateName,
      datasetId: input.datasetId ?? null,
      email,
      routeType: input.routeType,
      consentBasis: input.consentBasis,
      sourceUrl: input.sourceUrl,
      verificationMethod: input.verificationMethod,
      verifiedAt,
      verificationFreshUntil: isoNow(input.verificationFreshUntil),
      reviewerRef: input.reviewerRef,
      evidenceNote: input.evidenceNote,
      candidateCategory: input.candidateCategory ?? null,
      candidateRiskLevel: input.candidateRiskLevel ?? null,
      candidateSensitiveFlags: Array.isArray(input.candidateSensitiveFlags) ? input.candidateSensitiveFlags : [],
      revokedAt: null,
    };

    return { ...state, verifications: [...superseded, verification] };
  });

  await appendAudit(config.paths.audit, {
    action: 'contact_verified',
    verificationId: verification.id,
    candidateId: verification.candidateId,
    email,
    verificationMethod: verification.verificationMethod,
    sourceUrl: verification.sourceUrl,
    actor: verification.reviewerRef,
  });

  return { ok: true, verification };
}

export async function revokeVerification(config, { id, revokedBy, note }) {
  if (!revokedBy) {
    return { ok: false, errors: ['revokedBy is required.'] };
  }

  let verification = null;

  const result = await updateState(config.paths.verifications, EMPTY_STATE, (state) => {
    const target = (state.verifications ?? []).find((entry) => entry.id === id && !entry.revokedAt);

    if (!target) {
      return null;
    }

    verification = { ...target, revokedAt: isoNow(), revokedBy, revocationNote: note ?? '' };

    return {
      ...state,
      verifications: (state.verifications ?? []).map((entry) => (entry.id === id ? verification : entry)),
    };
  });

  if (!result.written) {
    return { ok: false, errors: [`No active verification with id ${id}.`] };
  }

  await appendAudit(config.paths.audit, {
    action: 'contact_verification_revoked',
    verificationId: id,
    candidateId: verification.candidateId,
    email: verification.email,
    actor: revokedBy,
    note: note ?? '',
  });

  return { ok: true, verification };
}
