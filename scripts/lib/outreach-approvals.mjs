import { appendAudit, isoNow, newId, normalizeEmail, readState, updateState } from './outreach-store.mjs';

const EMPTY_STATE = { version: 1, approvals: [], updatedAt: null };

export async function loadApprovalState(config) {
  return readState(config.paths.approvals, EMPTY_STATE);
}

/**
 * An approval authorises one exact message: the bodyHash binds it to the rendered
 * bytes, so changing the template, the topics, or the sender footer after approval
 * silently invalidates it rather than letting different copy ride an old sign-off.
 */
export function findUsableApproval(state, { candidateId, email, bodyHash }) {
  const normalizedEmail = normalizeEmail(email);

  return (
    (state?.approvals ?? []).find(
      (approval) =>
        !approval.revokedAt &&
        !approval.consumedAt &&
        approval.candidateId === candidateId &&
        approval.email === normalizedEmail &&
        approval.bodyHash === bodyHash,
    ) ?? null
  );
}

export function listApprovalsForCandidate(state, candidateId) {
  return (state?.approvals ?? []).filter((approval) => approval.candidateId === candidateId);
}

export function validateApprovalInput(input, { requiresSensitiveApproval, requiresSeniorApproval }) {
  const errors = [];

  if (!input?.candidateId) {
    errors.push('candidateId is required.');
  }

  if (!normalizeEmail(input?.email)) {
    errors.push('email is required.');
  }

  if (!input?.bodyHash) {
    errors.push('bodyHash is required; approve a rendered preview, not a template id.');
  }

  if (!input?.templateId) {
    errors.push('templateId is required.');
  }

  if (!input?.approvedBy) {
    errors.push('approvedBy is required; approvals always name the human who gave them.');
  }

  if (requiresSensitiveApproval && !input?.sensitiveCategoryApprovedBy) {
    errors.push(
      'This candidate is in a sensitive category; sensitiveCategoryApprovedBy is required alongside the standard approval.',
    );
  }

  if (requiresSeniorApproval && !input?.seniorApprovalRef) {
    errors.push('This candidate is high risk; seniorApprovalRef is required before any message can leave the system.');
  }

  return { ok: errors.length === 0, errors };
}

export async function recordApproval(config, input, gates) {
  const validation = validateApprovalInput(input, gates);

  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const email = normalizeEmail(input.email);
  let approval = null;

  await updateState(config.paths.approvals, EMPTY_STATE, (state) => {
    approval = {
      id: newId('apr'),
      campaignId: input.campaignId ?? config.campaignId,
      candidateId: input.candidateId,
      candidateName: input.candidateName ?? null,
      email,
      templateId: input.templateId,
      subject: input.subject ?? null,
      bodyHash: input.bodyHash,
      approvedBy: input.approvedBy,
      approvedAt: isoNow(),
      note: input.note ?? '',
      sensitiveCategoryApprovedBy: input.sensitiveCategoryApprovedBy ?? null,
      seniorApprovalRef: input.seniorApprovalRef ?? null,
      consumedAt: null,
      consumedByMessageId: null,
      revokedAt: null,
    };

    return { ...state, approvals: [...(state.approvals ?? []), approval] };
  });

  await appendAudit(config.paths.audit, {
    action: 'message_approved',
    approvalId: approval.id,
    candidateId: approval.candidateId,
    email,
    templateId: approval.templateId,
    bodyHash: approval.bodyHash,
    actor: approval.approvedBy,
  });

  return { ok: true, approval };
}

/**
 * Marks an approval spent. One approval authorises exactly one enqueued message, so a
 * second send to the same person needs a second, deliberate sign-off.
 */
export async function consumeApproval(config, { approvalId, messageId }) {
  let approval = null;

  const result = await updateState(config.paths.approvals, EMPTY_STATE, (state) => {
    const target = (state.approvals ?? []).find(
      (entry) => entry.id === approvalId && !entry.consumedAt && !entry.revokedAt,
    );

    if (!target) {
      return null;
    }

    approval = { ...target, consumedAt: isoNow(), consumedByMessageId: messageId };

    return {
      ...state,
      approvals: (state.approvals ?? []).map((entry) => (entry.id === approvalId ? approval : entry)),
    };
  });

  if (!result.written) {
    return { ok: false, errors: [`Approval ${approvalId} is already consumed, revoked, or missing.`] };
  }

  return { ok: true, approval };
}

export async function revokeApproval(config, { id, revokedBy, note }) {
  if (!revokedBy) {
    return { ok: false, errors: ['revokedBy is required.'] };
  }

  let approval = null;

  const result = await updateState(config.paths.approvals, EMPTY_STATE, (state) => {
    const target = (state.approvals ?? []).find((entry) => entry.id === id && !entry.revokedAt && !entry.consumedAt);

    if (!target) {
      return null;
    }

    approval = { ...target, revokedAt: isoNow(), revokedBy, revocationNote: note ?? '' };

    return {
      ...state,
      approvals: (state.approvals ?? []).map((entry) => (entry.id === id ? approval : entry)),
    };
  });

  if (!result.written) {
    return { ok: false, errors: [`No pending approval with id ${id}.`] };
  }

  await appendAudit(config.paths.audit, {
    action: 'message_approval_revoked',
    approvalId: id,
    candidateId: approval.candidateId,
    email: approval.email,
    actor: revokedBy,
    note: note ?? '',
  });

  return { ok: true, approval };
}
