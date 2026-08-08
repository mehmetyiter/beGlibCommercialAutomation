import { consumeApproval, loadApprovalState } from './outreach-approvals.mjs';
import {
  getTemplate,
  getTemplateForCategory,
  renderOutreachMessage,
  validateRenderedMessage,
} from './outreach-mail.mjs';
import {
  claimMessage,
  enqueueMessage,
  listOutbox,
  loadOutboxState,
  markAttemptFailed,
  markSent,
  markSuppressed,
  summarizeOutbox,
  updateMessageStatus,
} from './outreach-outbox.mjs';
import { resolveInviteForCandidate } from './outreach-invite.mjs';
import { evaluateDeliveryPreflight, evaluateSendPreflight } from './outreach-policy.mjs';
import { isTerminalProviderError, sendViaSes } from './outreach-provider-ses.mjs';
import { appendAudit, isoNow, normalizeEmail } from './outreach-store.mjs';
import { findSuppression, loadSuppressionState } from './outreach-suppression.mjs';
import { findActiveVerification, loadVerificationState } from './outreach-verifications.mjs';

export async function loadAllStates(config) {
  const [suppression, verifications, approvals, outbox] = await Promise.all([
    loadSuppressionState(config),
    loadVerificationState(config),
    loadApprovalState(config),
    loadOutboxState(config),
  ]);

  return { suppression, verifications, approvals, outbox };
}

/**
 * Reduces a dossier row (or a CLI JSON file) to the fields the send path is allowed to
 * reason about. Nothing else from the dossier — notes, raw evidence, social handles —
 * reaches the message renderer or the outbox.
 */
export function normalizeCandidateInput(input) {
  const topics = (Array.isArray(input?.topics) ? input.topics : input?.subcategories ?? [])
    .map((topic) => (typeof topic === 'string' ? topic.trim() : ''))
    .filter(Boolean)
    .slice(0, 5);

  return {
    id: typeof input?.id === 'string' ? input.id : input?.candidateId ?? '',
    name: typeof input?.name === 'string' ? input.name.trim() : '',
    // Carried through for the jurisdiction check in the send preflight.
    country: typeof input?.country === 'string' ? input.country.trim() : '',
    category: input?.category ?? input?.primaryCategory ?? null,
    status: input?.status ?? null,
    consentStatus: input?.consentStatus ?? 'unknown',
    riskLevel: input?.riskLevel ?? null,
    sensitiveFlags: Array.isArray(input?.sensitiveFlags) ? input.sensitiveFlags : [],
    datasetId: input?.datasetId ?? null,
    topics,
  };
}

function resolveTemplate(candidate, templateId) {
  return templateId ? getTemplate(templateId) : getTemplateForCategory(candidate.category);
}

/**
 * Renders the exact message and runs every gate against it without changing any state.
 * The dashboard calls this on every keystroke-free change so the operator sees the real
 * bytes and the real blockers before an approval exists.
 */
export async function buildPreview(config, { candidate: candidateInput, templateId, email, states }) {
  const candidate = normalizeCandidateInput(candidateInput);
  const loadedStates = states ?? (await loadAllStates(config));
  const normalizedEmail = normalizeEmail(email);
  const template = resolveTemplate(candidate, templateId);

  if (!template) {
    return { ok: false, errors: [`Unknown template id "${templateId}".`] };
  }

  // Only the invitation template reaches for a claim link, and only then is the Host
  // prospect state opened at all.
  let invite = null;

  if (template.requiresCta) {
    const resolved = await resolveInviteForCandidate(config, {
      candidateId: candidate.id,
      campaignId: config.campaignId,
    });

    if (!resolved.ok) {
      return {
        ok: false,
        errors: resolved.errors,
        candidate,
        template: { id: template.id, name: template.name, requiredReview: template.requiredReview },
      };
    }

    invite = resolved.invite;
  }

  // Pull the source URL from the human verification rather than the dossier, so the
  // "why you are receiving this" line always cites the evidence a reviewer actually saw.
  const verification = findActiveVerification(loadedStates.verifications, {
    candidateId: candidate.id,
    email: normalizedEmail,
    verificationMaxAgeDays: config.verificationMaxAgeDays,
  });

  const rendered = renderOutreachMessage({
    config,
    template,
    candidate,
    contact: { email: normalizedEmail, sourceUrl: verification?.sourceUrl ?? '' },
    invite,
  });

  if (!rendered.ok) {
    return {
      ok: false,
      errors: rendered.errors,
      candidate,
      template: { id: template.id, name: template.name, requiredReview: template.requiredReview },
    };
  }

  const preflight = evaluateSendPreflight({
    config,
    candidate,
    message: rendered.message,
    states: loadedStates,
  });

  return {
    ok: true,
    candidate,
    template: {
      id: template.id,
      name: template.name,
      requiredReview: template.requiredReview,
      requiresCta: template.requiresCta === true,
    },
    message: rendered.message,
    // Safe to hand to a browser: same bytes, same hash, claim token masked.
    displayMessage: rendered.displayMessage,
    preflight,
  };
}

/**
 * Stages an approved message into the outbox. Preflight runs again here rather than
 * trusting the preview the browser last saw, and the approval is consumed in the same
 * step so it cannot authorise a second message.
 */
export async function stageMessage(config, { candidate: candidateInput, templateId, email, enqueuedBy }) {
  const states = await loadAllStates(config);
  const preview = await buildPreview(config, { candidate: candidateInput, templateId, email, states });

  if (!preview.ok) {
    return { ok: false, errors: preview.errors };
  }

  if (!preview.preflight.ok) {
    return { ok: false, errors: preview.preflight.blockers.map((blocker) => blocker.message), preflight: preview.preflight };
  }

  const enqueued = await enqueueMessage(config, {
    message: preview.message,
    candidate: preview.candidate,
    approvalId: preview.preflight.approval?.id ?? null,
    verificationId: preview.preflight.verification?.id ?? null,
    enqueuedBy,
    mode: config.mode,
  });

  if (!enqueued.ok) {
    return { ok: false, errors: enqueued.errors, deduped: enqueued.deduped, existing: enqueued.existing };
  }

  if (preview.preflight.approval) {
    const consumed = await consumeApproval(config, {
      approvalId: preview.preflight.approval.id,
      messageId: enqueued.message.id,
    });

    // Losing the race for the approval means another staging call already used it.
    // Suppress the message we just created rather than sending an unapproved copy.
    if (!consumed.ok) {
      await markSuppressed(config, enqueued.message.id, 'approval_already_consumed');

      return {
        ok: false,
        errors: ['That approval was consumed by another staging request. Approve the message again to retry.'],
      };
    }
  }

  return { ok: true, message: enqueued.message, preflight: preview.preflight };
}

/**
 * Returns a failed message to the queue without asking for a fresh approval.
 *
 * This is deliberately narrow. The approval that authorised the message was bound to its
 * body hash, and a provider-side failure (throttling, a misconfigured IAM policy, an SES
 * outage) does not change a single byte of what was approved — so re-queueing the exact
 * same bytes stays inside the original authorisation. Anything that *would* change the
 * bytes, or that suggests the recipient should not be written to at all, still blocks:
 * the stored message is re-validated against current configuration, and the suppression
 * and consent checks run again here as well as at delivery.
 */
export async function retryFailedMessages(config, { messageId, all = false, actor } = {}) {
  const state = await loadOutboxState(config);
  const failed = (state.messages ?? []).filter(
    (message) => message.status === 'failed' && (all || message.id === messageId),
  );

  if (failed.length === 0) {
    return { ok: false, errors: [messageId ? `No failed message with id ${messageId}.` : 'No failed messages to retry.'] };
  }

  const states = await loadAllStates(config);
  const results = [];

  for (const record of failed) {
    const blockers = [];

    // Config drift since the approval would mean re-sending copy nobody signed off on.
    const rendered = validateRenderedMessage(config, record);
    for (const error of rendered.errors) {
      blockers.push(error);
    }

    const suppression = findSuppression(states.suppression, record.to);
    if (suppression) {
      blockers.push(`Address is now suppressed (${suppression.reason}); it must not be retried.`);
    }

    const verification = findActiveVerification(states.verifications, {
      candidateId: record.candidateId,
      email: record.to,
      verificationMaxAgeDays: config.verificationMaxAgeDays,
    });

    if (!verification) {
      blockers.push('The contact verification has expired or been revoked; re-verify before retrying.');
    }

    if (blockers.length > 0) {
      results.push({ id: record.id, to: record.to, outcome: 'blocked', reasons: blockers });
      continue;
    }

    await updateMessageStatus(config, record.id, {
      status: 'pending',
      attempts: 0,
      lastError: null,
      retriedAt: isoNow(),
      retriedBy: actor ?? null,
    });

    await appendAudit(config.paths.audit, {
      action: 'message_retried',
      messageId: record.id,
      candidateId: record.candidateId,
      email: record.to,
      bodyHash: record.bodyHash,
      previousError: record.lastError,
      actor: actor ?? null,
    });

    results.push({ id: record.id, to: record.to, outcome: 'requeued' });
  }

  return { ok: true, results, requeued: results.filter((entry) => entry.outcome === 'requeued').length };
}

/**
 * Works the pending queue. Every record is re-checked against live state immediately
 * before delivery, so a suppression or limit change between staging and drain wins.
 */
export async function drainOutbox(config, { limit = 25, sender = sendViaSes } = {}) {
  const initialState = await loadOutboxState(config);
  const pending = listOutbox(initialState, { status: 'pending', limit }).reverse();
  const results = [];

  for (const queued of pending) {
    const claim = await claimMessage(config, queued.id);

    if (!claim.ok) {
      results.push({ id: queued.id, outcome: 'skipped', reason: 'not claimable' });
      continue;
    }

    const record = claim.message;
    const states = await loadAllStates(config);
    const preflight = evaluateDeliveryPreflight({ config, record, states });

    if (!preflight.ok) {
      const blockedByMode = preflight.blockers.find((blocker) => blocker.code === 'mode_not_live');
      const reason = blockedByMode ? (config.mode === 'off' ? 'mode_off' : 'dry_run') : preflight.blockers[0].code;

      await markSuppressed(config, record.id, reason);
      results.push({
        id: record.id,
        to: record.to,
        outcome: 'suppressed',
        reason,
        details: preflight.blockers.map((blocker) => blocker.message),
      });
      continue;
    }

    try {
      const sent = await sender(config, record);
      await markSent(config, record.id, sent);
      results.push({ id: record.id, to: record.to, outcome: 'sent', providerMessageId: sent.providerMessageId });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const terminal = isTerminalProviderError(error) || record.attempts >= config.maxAttempts;

      await markAttemptFailed(config, record.id, { error: messageText, terminal });
      results.push({ id: record.id, to: record.to, outcome: terminal ? 'failed' : 'retry', reason: messageText });
    }
  }

  const finalState = await loadOutboxState(config);

  return {
    ok: true,
    processed: results.length,
    results,
    summary: summarizeOutbox(finalState),
  };
}
