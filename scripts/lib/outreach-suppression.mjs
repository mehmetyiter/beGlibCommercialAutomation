import { appendAudit, emailDomain, isoNow, newId, normalizeEmail, readState, updateState } from './outreach-store.mjs';

const EMPTY_STATE = { version: 1, entries: [], updatedAt: null };

export const SUPPRESSION_REASONS = [
  'opt-out-request',
  'deletion-request',
  'complaint',
  'hard-bounce',
  'spam-complaint',
  'do-not-contact',
  'manual-review',
  'unknown',
];

export function normalizeSuppressionValue(kind, value) {
  if (kind === 'domain') {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return raw.startsWith('@') ? raw.slice(1) : raw;
  }

  return normalizeEmail(value);
}

/**
 * Suppression wins over every other signal, so a match on either the exact address
 * or its domain blocks the send. Revoked entries are kept for audit but stop matching.
 */
export function findSuppression(state, email) {
  const normalizedEmail = normalizeEmail(email);
  const domain = emailDomain(normalizedEmail);

  if (!normalizedEmail) {
    return null;
  }

  const active = (state?.entries ?? []).filter((entry) => !entry.revokedAt);

  return (
    active.find((entry) => entry.kind === 'email' && entry.value === normalizedEmail) ??
    active.find((entry) => entry.kind === 'domain' && domain && entry.value === domain) ??
    null
  );
}

export async function loadSuppressionState(config) {
  return readState(config.paths.suppression, EMPTY_STATE);
}

export async function isSuppressed(config, email) {
  return findSuppression(await loadSuppressionState(config), email);
}

export async function addSuppression(config, input) {
  const kind = input.kind === 'domain' ? 'domain' : 'email';
  const value = normalizeSuppressionValue(kind, input.value);
  const reason = SUPPRESSION_REASONS.includes(input.reason) ? input.reason : 'unknown';

  if (!value) {
    return { ok: false, errors: ['A suppression entry needs an email address or a domain.'] };
  }

  if (kind === 'email' && !value.includes('@')) {
    return { ok: false, errors: [`"${value}" is not a valid email address.`] };
  }

  if (!input.addedBy) {
    return { ok: false, errors: ['addedBy is required so every suppression change has a named owner.'] };
  }

  let entry = null;
  let created = false;

  await updateState(config.paths.suppression, EMPTY_STATE, (state) => {
    const existing = (state.entries ?? []).find(
      (candidate) => candidate.kind === kind && candidate.value === value && !candidate.revokedAt,
    );

    if (existing) {
      entry = existing;
      return null;
    }

    entry = {
      id: newId('sup'),
      kind,
      value,
      reason,
      source: input.source ?? 'manual',
      note: input.note ?? '',
      candidateId: input.candidateId ?? null,
      addedBy: input.addedBy,
      addedAt: isoNow(),
      revokedAt: null,
    };
    created = true;

    return { ...state, entries: [...(state.entries ?? []), entry] };
  });

  if (created) {
    await appendAudit(config.paths.audit, {
      action: 'suppression_added',
      suppressionId: entry.id,
      kind,
      value,
      reason,
      source: entry.source,
      candidateId: entry.candidateId,
      actor: input.addedBy,
    });
  }

  return { ok: true, created, entry };
}

/**
 * Un-suppressing is deliberately awkward: it needs a named actor and a reason, and it
 * leaves the original entry in place with a revocation stamp rather than deleting it.
 */
export async function revokeSuppression(config, { id, revokedBy, note }) {
  if (!revokedBy) {
    return { ok: false, errors: ['revokedBy is required; suppression changes always need a named owner.'] };
  }

  let entry = null;

  const result = await updateState(config.paths.suppression, EMPTY_STATE, (state) => {
    const target = (state.entries ?? []).find((candidate) => candidate.id === id && !candidate.revokedAt);

    if (!target) {
      return null;
    }

    entry = { ...target, revokedAt: isoNow(), revokedBy, revocationNote: note ?? '' };

    return {
      ...state,
      entries: (state.entries ?? []).map((candidate) => (candidate.id === id ? entry : candidate)),
    };
  });

  if (!result.written) {
    return { ok: false, errors: [`No active suppression entry with id ${id}.`] };
  }

  await appendAudit(config.paths.audit, {
    action: 'suppression_revoked',
    suppressionId: id,
    kind: entry.kind,
    value: entry.value,
    actor: revokedBy,
    note: note ?? '',
  });

  return { ok: true, entry };
}

export function summarizeSuppression(state) {
  const entries = state?.entries ?? [];
  const active = entries.filter((entry) => !entry.revokedAt);
  const byReason = {};

  for (const entry of active) {
    byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
  }

  return {
    total: entries.length,
    active: active.length,
    revoked: entries.length - active.length,
    emails: active.filter((entry) => entry.kind === 'email').length,
    domains: active.filter((entry) => entry.kind === 'domain').length,
    byReason,
  };
}
