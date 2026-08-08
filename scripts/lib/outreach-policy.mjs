import { findUsableApproval } from './outreach-approvals.mjs';
import { validateRenderedMessage } from './outreach-mail.mjs';
import { buildDedupeKey, countSentToday, findByDedupeKey } from './outreach-outbox.mjs';
import { normalizeEmail } from './outreach-store.mjs';
import { findSuppression } from './outreach-suppression.mjs';
import { findActiveVerification, verificationExpiry } from './outreach-verifications.mjs';

const SENSITIVE_CATEGORIES = new Set(['religion', 'psychology', 'therapy', 'medicine']);
const BLOCKING_CONSENT_STATUSES = new Set(['opted-out', 'not-allowed']);

/**
 * Ported from the dashboard-side compliance module that was deleted with the rest of
 * `src/lib/*`: the recipient's country decides which consent regime applies, and that check
 * existed nowhere else. These are warnings, not blockers — the lawful basis is recorded on
 * the contact verification, and this is the reminder to confirm it says the right thing for
 * where the recipient actually is.
 */
const JURISDICTIONS = [
  {
    code: 'jurisdiction_casl',
    countries: ['canada'],
    message: 'Recipient is in Canada: confirm the CASL basis and that the opt-out wording matches it.',
  },
  {
    code: 'jurisdiction_gdpr',
    countries: [
      'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czechia', 'czech republic', 'denmark',
      'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'iceland', 'ireland', 'italy',
      'latvia', 'liechtenstein', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'norway', 'poland',
      'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden', 'switzerland',
      'united kingdom', 'england', 'scotland', 'wales', 'northern ireland',
    ],
    message: 'Recipient is in the EEA, the UK, or Switzerland: confirm the GDPR/ePrivacy basis before direct marketing.',
  },
  {
    code: 'jurisdiction_kvkk',
    countries: ['turkey', 'türkiye', 'turkiye'],
    message: 'Recipient is in Türkiye: confirm the KVKK basis and the electronic-message consent rules.',
  },
];

export function jurisdictionNotes(country) {
  const normalized = String(country ?? '').trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  return JURISDICTIONS.filter((entry) => entry.countries.includes(normalized)).map((entry) => ({
    code: entry.code,
    message: entry.message,
  }));
}

export function requiresSensitiveApproval(candidate) {
  return (
    SENSITIVE_CATEGORIES.has(candidate?.category) ||
    (Array.isArray(candidate?.sensitiveFlags) && candidate.sensitiveFlags.length > 0)
  );
}

export function requiresSeniorApproval(candidate) {
  return String(candidate?.riskLevel ?? '').toLowerCase() === 'high';
}

/**
 * The single gate every send path runs through. It is a pure function over already-loaded
 * state so the dashboard preview, the enqueue call, and the drain loop all evaluate the
 * exact same rules — the drain re-runs it immediately before handing bytes to SES, which
 * is what makes a suppression added mid-flight actually stop a queued message.
 */
export function evaluateSendPreflight({ config, candidate, message, states, now = new Date() }) {
  const blockers = [];
  const warnings = [];

  const add = (list, code, msg) => list.push({ code, message: msg });

  const email = normalizeEmail(message?.to);
  const requirements = {
    humanApproval: config.requireHumanApproval,
    sensitiveCategoryApproval: requiresSensitiveApproval(candidate),
    seniorApproval: requiresSeniorApproval(candidate),
  };

  for (const issue of config.issues ?? []) {
    add(blockers, 'config_incomplete', issue);
  }

  if (config.mode === 'off') {
    add(blockers, 'mode_off', 'OUTREACH_EMAIL_MODE is off. Set it to dry_run or live to stage a message.');
  }

  if (!email) {
    add(blockers, 'no_recipient', 'No recipient address on the rendered message.');
  }

  // --- Candidate-level suppression and consent -------------------------------------

  if (candidate?.status === 'do-not-contact') {
    add(blockers, 'do_not_contact', 'Candidate is marked do-not-contact.');
  }

  if (BLOCKING_CONSENT_STATUSES.has(candidate?.consentStatus)) {
    add(blockers, 'consent_blocked', `Candidate consent status is ${candidate.consentStatus}.`);
  }

  for (const note of jurisdictionNotes(candidate?.country)) {
    add(warnings, note.code, note.message);
  }

  const suppression = findSuppression(states.suppression, email);
  if (suppression) {
    add(
      blockers,
      'suppressed',
      `${suppression.kind === 'domain' ? 'Domain' : 'Address'} is on the suppression list (${suppression.reason}).`,
    );
  }

  // --- Human verification of the contact route --------------------------------------

  const verification = findActiveVerification(states.verifications, {
    candidateId: candidate?.id,
    email,
    now,
    verificationMaxAgeDays: config.verificationMaxAgeDays,
  });

  if (!verification) {
    add(
      blockers,
      'no_verified_route',
      'No current human verification for this address. Verify the published contact route before staging a message.',
    );
  } else {
    const expiry = verificationExpiry(verification, config.verificationMaxAgeDays);
    const daysLeft = expiry ? Math.floor((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : 0;

    if (daysLeft <= 14) {
      add(warnings, 'verification_expiring', `Contact verification expires in ${daysLeft} day(s); re-check the source page.`);
    }

    if (candidate?.consentStatus === 'unknown') {
      add(
        warnings,
        'dossier_consent_stale',
        'The dossier still records consentStatus "unknown". The human verification supplies the lawful basis; promote the dossier record with review:apply-official-sources to keep them in sync.',
      );
    }
  }

  // --- Message content ---------------------------------------------------------------

  const rendered = validateRenderedMessage(config, message);
  for (const error of rendered.errors) {
    add(blockers, 'invalid_message', error);
  }

  // --- Approvals ----------------------------------------------------------------------

  const approval = message?.bodyHash
    ? findUsableApproval(states.approvals, { candidateId: candidate?.id, email, bodyHash: message.bodyHash })
    : null;

  if (requirements.humanApproval && !approval) {
    add(
      blockers,
      'no_approval',
      'No unused approval matches this exact message. Approve the rendered preview before sending; edits invalidate an earlier approval.',
    );
  }

  if (requirements.sensitiveCategoryApproval && !approval?.sensitiveCategoryApprovedBy) {
    add(
      blockers,
      'no_sensitive_approval',
      'Sensitive-category candidate: the approval must record a sensitive-category reviewer.',
    );
  }

  if (requirements.seniorApproval && !approval?.seniorApprovalRef) {
    add(blockers, 'no_senior_approval', 'High-risk candidate: the approval must record a senior approval reference.');
  }

  // --- Duplicate suppression and daily budget ------------------------------------------

  const dedupeKey = buildDedupeKey(config, { candidateId: candidate?.id, email });
  const existing = findByDedupeKey(states.outbox, dedupeKey);

  if (existing && existing.status !== 'failed') {
    add(
      blockers,
      'duplicate',
      `Campaign ${config.campaignId} already has a ${existing.status} message for this candidate (${existing.id}).`,
    );
  }

  const sentToday = countSentToday(states.outbox, now);
  const remaining = Math.max(0, config.dailySendLimit - sentToday);

  if (config.mode === 'live' && remaining <= 0) {
    add(blockers, 'daily_limit', `Daily send limit of ${config.dailySendLimit} is already used up.`);
  }

  if (config.mode === 'dry_run') {
    add(warnings, 'dry_run', 'Mode is dry_run: the message will be recorded and suppressed, not delivered.');
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    requirements,
    verification: verification ?? null,
    approval: approval ?? null,
    dedupe: { key: dedupeKey, existing: existing ?? null },
    quota: { dailyLimit: config.dailySendLimit, sentToday, remaining },
  };
}

/**
 * Re-checks only the conditions that can change between staging and delivery. The
 * message bytes were already frozen at enqueue time and are re-validated here too.
 */
export function evaluateDeliveryPreflight({ config, record, states, now = new Date() }) {
  const blockers = [];
  const add = (code, msg) => blockers.push({ code, message: msg });

  if (config.mode !== 'live') {
    add('mode_not_live', `Mode is ${config.mode}; no provider delivery is attempted.`);
  }

  const suppression = findSuppression(states.suppression, record?.to);
  if (suppression) {
    add('suppressed', `Address was suppressed after staging (${suppression.reason}).`);
  }

  const rendered = validateRenderedMessage(config, record);
  for (const error of rendered.errors) {
    add('invalid_message', error);
  }

  const sentToday = countSentToday(states.outbox, now);
  if (sentToday >= config.dailySendLimit) {
    add('daily_limit', `Daily send limit of ${config.dailySendLimit} reached.`);
  }

  return { ok: blockers.length === 0, blockers, quota: { dailyLimit: config.dailySendLimit, sentToday } };
}
