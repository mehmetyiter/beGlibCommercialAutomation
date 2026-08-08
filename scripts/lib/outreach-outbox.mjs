import { appendAudit, isoNow, newId, normalizeEmail, readState, updateState } from './outreach-store.mjs';

const EMPTY_STATE = { version: 1, messages: [], updatedAt: null };

export const OUTBOX_STATUSES = ['pending', 'sent', 'failed', 'suppressed'];

/**
 * One first-touch per person per campaign. The template is deliberately excluded so
 * that switching templates cannot be used to message the same candidate twice.
 */
export function buildDedupeKey(config, { candidateId, email }) {
  return [config.emailEnv, config.campaignId, candidateId, normalizeEmail(email)].join(':');
}

export async function loadOutboxState(config) {
  return readState(config.paths.outbox, EMPTY_STATE);
}

export function findByDedupeKey(state, dedupeKey) {
  return (state?.messages ?? []).find((message) => message.dedupeKey === dedupeKey) ?? null;
}

/**
 * Only real provider sends consume the daily budget: dry-run and suppressed records
 * stay visible in the outbox but must not eat into the live quota.
 */
export function countSentToday(state, now = new Date()) {
  const today = isoNow(now).slice(0, 10);

  return (state?.messages ?? []).filter(
    (message) => message.status === 'sent' && typeof message.sentAt === 'string' && message.sentAt.slice(0, 10) === today,
  ).length;
}

export function listOutbox(state, { status, candidateId, limit = 200 } = {}) {
  return (state?.messages ?? [])
    .filter((message) => (status ? message.status === status : true))
    .filter((message) => (candidateId ? message.candidateId === candidateId : true))
    .sort((left, right) => String(right.enqueuedAt).localeCompare(String(left.enqueuedAt)))
    .slice(0, limit);
}

export function summarizeOutbox(state, now = new Date()) {
  const messages = state?.messages ?? [];
  const byStatus = {};

  for (const status of OUTBOX_STATUSES) {
    byStatus[status] = messages.filter((message) => message.status === status).length;
  }

  return {
    total: messages.length,
    byStatus,
    sentToday: countSentToday(state, now),
    lastEnqueuedAt: messages.reduce(
      (latest, message) => (String(message.enqueuedAt) > String(latest) ? message.enqueuedAt : latest),
      '',
    ),
  };
}

export async function enqueueMessage(config, { message, candidate, approvalId, verificationId, enqueuedBy, mode }) {
  const dedupeKey = buildDedupeKey(config, { candidateId: candidate.id, email: message.to });
  let record = null;
  let duplicate = null;

  await updateState(config.paths.outbox, EMPTY_STATE, (state) => {
    const existing = findByDedupeKey(state, dedupeKey);

    // A previously failed attempt may be retried; anything pending or already sent may not.
    if (existing && existing.status !== 'failed') {
      duplicate = existing;
      return null;
    }

    record = {
      id: newId('msg'),
      dedupeKey,
      status: 'pending',
      mode,
      campaignId: config.campaignId,
      emailEnv: config.emailEnv,
      candidateId: candidate.id,
      candidateName: candidate.name,
      datasetId: candidate.datasetId ?? null,
      templateId: message.templateId,
      approvalId: approvalId ?? null,
      verificationId: verificationId ?? null,
      to: message.to,
      from: message.from,
      fromDisplay: message.fromDisplay,
      replyTo: message.replyTo,
      subject: message.subject,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
      bodyHash: message.bodyHash,
      headers: message.headers ?? [],
      requiresCta: message.requiresCta === true,
      ctaUrl: message.ctaUrl ?? null,
      ctaExpiresAt: message.ctaExpiresAt ?? null,
      prospectId: message.prospectId ?? null,
      attempts: 0,
      lastError: null,
      provider: null,
      providerMessageId: null,
      suppressedReason: null,
      enqueuedBy: enqueuedBy ?? null,
      enqueuedAt: isoNow(),
      sentAt: null,
    };

    const withoutRetried = (state.messages ?? []).filter((entry) => entry.dedupeKey !== dedupeKey);

    return { ...state, messages: [...withoutRetried, record] };
  });

  if (duplicate) {
    await appendAudit(config.paths.audit, {
      action: 'message_deduped',
      dedupeKey,
      candidateId: candidate.id,
      email: message.to,
      existingMessageId: duplicate.id,
      existingStatus: duplicate.status,
      actor: enqueuedBy ?? null,
    });

    return { ok: false, deduped: true, existing: duplicate, errors: [`This candidate already has a ${duplicate.status} message in campaign ${config.campaignId}.`] };
  }

  await appendAudit(config.paths.audit, {
    action: 'message_enqueued',
    messageId: record.id,
    dedupeKey,
    candidateId: candidate.id,
    email: message.to,
    templateId: message.templateId,
    approvalId: approvalId ?? null,
    bodyHash: message.bodyHash,
    mode,
    actor: enqueuedBy ?? null,
  });

  return { ok: true, deduped: false, message: record };
}

/**
 * Atomically takes ownership of a pending message and burns one attempt. Two drain
 * loops racing on the same outbox can therefore never both send the same record.
 */
export async function claimMessage(config, messageId) {
  let claimed = null;

  const result = await updateState(config.paths.outbox, EMPTY_STATE, (state) => {
    const target = (state.messages ?? []).find((message) => message.id === messageId);

    if (!target || target.status !== 'pending' || target.attempts >= config.maxAttempts) {
      return null;
    }

    claimed = { ...target, attempts: target.attempts + 1, lastError: null };

    return {
      ...state,
      messages: (state.messages ?? []).map((message) => (message.id === messageId ? claimed : message)),
    };
  });

  return result.written ? { ok: true, message: claimed } : { ok: false, message: null };
}

export async function updateMessageStatus(config, messageId, patch) {
  let updated = null;

  const result = await updateState(config.paths.outbox, EMPTY_STATE, (state) => {
    const target = (state.messages ?? []).find((message) => message.id === messageId);

    if (!target) {
      return null;
    }

    updated = { ...target, ...patch };

    return {
      ...state,
      messages: (state.messages ?? []).map((message) => (message.id === messageId ? updated : message)),
    };
  });

  return result.written ? { ok: true, message: updated } : { ok: false, message: null };
}

export async function markSent(config, messageId, { provider, providerMessageId }) {
  const result = await updateMessageStatus(config, messageId, {
    status: 'sent',
    provider,
    providerMessageId: providerMessageId ?? null,
    lastError: null,
    suppressedReason: null,
    sentAt: isoNow(),
  });

  if (result.ok) {
    await appendAudit(config.paths.audit, {
      action: 'message_sent',
      messageId,
      candidateId: result.message.candidateId,
      email: result.message.to,
      provider,
      providerMessageId: providerMessageId ?? null,
      bodyHash: result.message.bodyHash,
    });
  }

  return result;
}

export async function markSuppressed(config, messageId, reason) {
  const result = await updateMessageStatus(config, messageId, {
    status: 'suppressed',
    suppressedReason: reason,
    lastError: null,
  });

  if (result.ok) {
    await appendAudit(config.paths.audit, {
      action: 'message_suppressed',
      messageId,
      candidateId: result.message.candidateId,
      email: result.message.to,
      reason,
    });
  }

  return result;
}

export async function markAttemptFailed(config, messageId, { error, terminal }) {
  const result = await updateMessageStatus(config, messageId, {
    status: terminal ? 'failed' : 'pending',
    lastError: error,
  });

  if (result.ok) {
    await appendAudit(config.paths.audit, {
      action: 'message_failed',
      messageId,
      candidateId: result.message.candidateId,
      email: result.message.to,
      attempts: result.message.attempts,
      terminal,
      reason: error,
    });
  }

  return result;
}

/**
 * Message bodies are the most sensitive thing in local state. This keeps the audit trail
 * (who, when, which hash) while dropping the copy once a record is well past terminal.
 */
export async function redactOutboxBodies(config, { olderThanDays = 90, now = new Date() } = {}) {
  const cutoffMs = now.getTime() - olderThanDays * 24 * 60 * 60 * 1000;
  let redacted = 0;

  await updateState(config.paths.outbox, EMPTY_STATE, (state) => {
    const messages = (state.messages ?? []).map((message) => {
      if (message.bodyRedactedAt || !message.bodyText) {
        return message;
      }

      if (message.status === 'pending') {
        return message;
      }

      const stampMs = Date.parse(message.sentAt ?? message.enqueuedAt ?? '');

      if (!Number.isFinite(stampMs) || stampMs > cutoffMs) {
        return message;
      }

      redacted += 1;

      return { ...message, bodyText: null, bodyHtml: null, ctaUrl: null, bodyRedactedAt: isoNow(now) };
    });

    return redacted > 0 ? { ...state, messages } : null;
  });

  return { ok: true, redacted };
}
