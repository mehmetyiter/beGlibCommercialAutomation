import { resolve } from 'node:path';

import { DEFAULT_CANDIDATE_OVERLAY_PATH } from './candidate-overlay.mjs';

export const OUTREACH_MODES = ['off', 'dry_run', 'live'];

const DEFAULT_PATHS = {
  candidateOverlay: DEFAULT_CANDIDATE_OVERLAY_PATH,
  suppression: './data/outreach-suppression.local.json',
  verifications: './data/outreach-contacts.local.json',
  approvals: './data/outreach-approvals.local.json',
  outbox: './data/outreach-outbox.local.json',
  providerEvents: './data/outreach-ses-events.local.json',
  audit: './data/outreach-audit.local.jsonl',
  hostProspectState: './exports/host-prospect-state.local.json',
};

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value, fallback, { min, max }) {
  const parsed = Number.parseInt(trimmed(value), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function boolean(value, fallback) {
  const normalized = trimmed(value).toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return fallback;
}

export function loadOutreachConfig(env = process.env) {
  const rawMode = trimmed(env.OUTREACH_EMAIL_MODE).toLowerCase();
  const mode = OUTREACH_MODES.includes(rawMode) ? rawMode : 'off';

  const config = {
    mode,
    modeIsValid: rawMode === '' || OUTREACH_MODES.includes(rawMode),
    rawMode,
    emailEnv: trimmed(env.OUTREACH_EMAIL_ENV) || 'local',
    campaignId: trimmed(env.OUTREACH_CAMPAIGN_ID) || 'host-pilot-001',

    region: trimmed(env.OUTREACH_AWS_REGION) || 'ca-central-1',
    accessKeyId: trimmed(env.OUTREACH_AWS_ACCESS_KEY_ID),
    secretAccessKey: trimmed(env.OUTREACH_AWS_SECRET_ACCESS_KEY),
    configurationSet: trimmed(env.OUTREACH_SES_CONFIGURATION_SET),
    eventQueueUrl: trimmed(env.OUTREACH_SES_EVENT_QUEUE_URL),

    // Shared with the Host prospect CLI so a claim link cannot be emailed from an origin
    // the operator has not explicitly allowlisted.
    allowedCtaOrigins: trimmed(env.HOST_PROSPECT_ALLOWED_CTA_ORIGINS)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),

    fromAddress: trimmed(env.OUTREACH_FROM_ADDRESS).toLowerCase(),
    fromName: trimmed(env.OUTREACH_FROM_NAME) || 'beGlib Host Team',
    replyToAddress: trimmed(env.OUTREACH_REPLY_TO_ADDRESS).toLowerCase(),
    unsubscribeMailto: trimmed(env.OUTREACH_UNSUBSCRIBE_MAILTO).toLowerCase(),
    senderLegalName: trimmed(env.OUTREACH_SENDER_LEGAL_NAME),
    physicalMailingAddress: trimmed(env.PHYSICAL_MAILING_ADDRESS),

    requireHumanApproval: boolean(env.OUTREACH_REQUIRE_HUMAN_APPROVAL, true),
    dailySendLimit: integer(env.OUTREACH_DAILY_SEND_LIMIT, 25, { min: 1, max: 500 }),
    maxAttempts: integer(env.OUTREACH_MAX_ATTEMPTS, 3, { min: 1, max: 10 }),
    verificationMaxAgeDays: integer(env.OUTREACH_VERIFICATION_MAX_AGE_DAYS, 90, { min: 1, max: 365 }),

    serverPort: integer(env.OUTREACH_SERVER_PORT, 5174, { min: 1024, max: 65_535 }),
    serverToken: trimmed(env.OUTREACH_SERVER_TOKEN),

    paths: {
      candidateOverlay: resolve(trimmed(env.CANDIDATE_OVERLAY_PATH) || DEFAULT_PATHS.candidateOverlay),
      suppression: resolve(trimmed(env.SUPPRESSION_LIST_PATH) || DEFAULT_PATHS.suppression),
      verifications: resolve(trimmed(env.OUTREACH_VERIFICATIONS_PATH) || DEFAULT_PATHS.verifications),
      approvals: resolve(trimmed(env.OUTREACH_APPROVALS_PATH) || DEFAULT_PATHS.approvals),
      outbox: resolve(trimmed(env.OUTREACH_OUTBOX_PATH) || DEFAULT_PATHS.outbox),
      providerEvents: resolve(trimmed(env.OUTREACH_PROVIDER_EVENTS_PATH) || DEFAULT_PATHS.providerEvents),
      hostProspectState: resolve(trimmed(env.HOST_PROSPECT_STATE_PATH) || DEFAULT_PATHS.hostProspectState),
      audit: resolve(trimmed(env.OUTREACH_AUDIT_PATH) || DEFAULT_PATHS.audit),
    },
  };

  return { ...config, issues: describeConfigIssues(config) };
}

/**
 * Configuration problems that must block a live send. These are reported rather than
 * thrown so the dashboard can show the operator exactly what is missing while the
 * system stays usable in `off` and `dry_run` mode.
 */
export function describeConfigIssues(config) {
  const issues = [];

  if (!config.modeIsValid) {
    issues.push(
      `OUTREACH_EMAIL_MODE="${config.rawMode}" is not one of ${OUTREACH_MODES.join(', ')}; falling back to off.`,
    );
  }

  if (!config.fromAddress) {
    issues.push('OUTREACH_FROM_ADDRESS is required so recipients can see an accurate sender identity.');
  }

  if (!config.senderLegalName) {
    issues.push('OUTREACH_SENDER_LEGAL_NAME is required for the commercial-message sender identity footer.');
  }

  if (!config.physicalMailingAddress) {
    issues.push('PHYSICAL_MAILING_ADDRESS is required; CAN-SPAM needs a valid postal address in every commercial message.');
  }

  if (!config.replyToAddress) {
    issues.push('OUTREACH_REPLY_TO_ADDRESS is required so replies and opt-outs reach a monitored human mailbox.');
  }

  if (!config.unsubscribeMailto) {
    issues.push('OUTREACH_UNSUBSCRIBE_MAILTO is required for the List-Unsubscribe header and the opt-out footer.');
  }

  if (config.mode === 'live' && !config.configurationSet) {
    issues.push(
      'OUTREACH_SES_CONFIGURATION_SET is required in live mode so outreach reputation stays isolated from transactional mail.',
    );
  }

  if (config.mode === 'live' && Boolean(config.accessKeyId) !== Boolean(config.secretAccessKey)) {
    issues.push(
      'Set both OUTREACH_AWS_ACCESS_KEY_ID and OUTREACH_AWS_SECRET_ACCESS_KEY, or neither to use the ambient AWS credential chain.',
    );
  }

  if (config.fromAddress && config.replyToAddress && config.fromAddress === config.replyToAddress) {
    issues.push(
      'OUTREACH_REPLY_TO_ADDRESS matches the from address; use a separately monitored mailbox for replies and opt-outs.',
    );
  }

  return issues;
}

/**
 * The only shape allowed to cross into the browser. Credentials, queue URLs, and
 * absolute local paths never appear here.
 */
export function publicOutreachConfig(config) {
  return {
    mode: config.mode,
    emailEnv: config.emailEnv,
    campaignId: config.campaignId,
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    replyToAddress: config.replyToAddress,
    unsubscribeMailto: config.unsubscribeMailto,
    senderLegalName: config.senderLegalName,
    physicalMailingAddress: config.physicalMailingAddress,
    requireHumanApproval: config.requireHumanApproval,
    dailySendLimit: config.dailySendLimit,
    verificationMaxAgeDays: config.verificationMaxAgeDays,
    configurationSetConfigured: Boolean(config.configurationSet),
    allowedCtaOrigins: config.allowedCtaOrigins,
    providerEventQueueConfigured: Boolean(config.eventQueueUrl),
    issues: config.issues,
  };
}
