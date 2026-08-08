import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOutreachConfig } from './outreach-config.mjs';
import { getTemplate, renderOutreachMessage, validateRenderedMessage } from './outreach-mail.mjs';
import { buildDedupeKey, countSentToday } from './outreach-outbox.mjs';
import { evaluateDeliveryPreflight, evaluateSendPreflight, jurisdictionNotes } from './outreach-policy.mjs';
import { findSuppression } from './outreach-suppression.mjs';
import { findActiveVerification, validateVerificationInput, verificationExpiry } from './outreach-verifications.mjs';

const NOW = new Date('2026-08-06T12:00:00.000Z');

function config(overrides = {}) {
  const base = loadOutreachConfig({
    OUTREACH_EMAIL_MODE: 'live',
    OUTREACH_EMAIL_ENV: 'test',
    OUTREACH_CAMPAIGN_ID: 'host-pilot-test',
    OUTREACH_FROM_ADDRESS: 'hosts@outreach.example.com',
    OUTREACH_FROM_NAME: 'beGlib Host Team',
    OUTREACH_REPLY_TO_ADDRESS: 'hosts@example.com',
    OUTREACH_UNSUBSCRIBE_MAILTO: 'unsubscribe@outreach.example.com',
    OUTREACH_SENDER_LEGAL_NAME: 'beGlib Ltd',
    PHYSICAL_MAILING_ADDRESS: '1 Example Street, Toronto, ON, Canada',
    OUTREACH_SES_CONFIGURATION_SET: 'beglib-outreach-test',
    OUTREACH_DAILY_SEND_LIMIT: '25',
    ...overrides,
  });

  return { ...base, issues: base.issues };
}

function candidate(overrides = {}) {
  return {
    id: 'cand_0001',
    name: 'Ada Lovelace',
    category: 'science',
    status: 'approved',
    consentStatus: 'public-business-contact',
    riskLevel: 'low',
    sensitiveFlags: [],
    topics: ['computing', 'mathematics'],
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    id: 'ver_0001',
    candidateId: 'cand_0001',
    email: 'ada@example.org',
    routeType: 'public-business-email',
    consentBasis: 'public-business-contact',
    sourceUrl: 'https://example.org/ada/contact',
    verificationMethod: 'official-site-contact-page',
    verifiedAt: '2026-08-01T00:00:00.000Z',
    verificationFreshUntil: '2026-10-01T00:00:00.000Z',
    reviewerRef: 'reviewer:mehmet',
    revokedAt: null,
    ...overrides,
  };
}

function renderFor(cfg, cand, email = 'ada@example.org', sourceUrl = 'https://example.org/ada/contact') {
  const result = renderOutreachMessage({
    config: cfg,
    template: getTemplate('tmpl-science'),
    candidate: cand,
    contact: { email, sourceUrl },
  });

  assert.equal(result.ok, true, `render failed: ${result.errors?.join(', ')}`);

  return result.message;
}

function states({ suppression = [], verifications = [verification()], approvals = [], outbox = [] } = {}) {
  return {
    suppression: { entries: suppression },
    verifications: { verifications },
    approvals: { approvals },
    outbox: { messages: outbox },
  };
}

function approval(message, overrides = {}) {
  return {
    id: 'apr_0001',
    candidateId: 'cand_0001',
    email: 'ada@example.org',
    templateId: message.templateId,
    bodyHash: message.bodyHash,
    approvedBy: 'reviewer:mehmet',
    approvedAt: '2026-08-06T11:00:00.000Z',
    sensitiveCategoryApprovedBy: null,
    seniorApprovalRef: null,
    consumedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

test('rendered message carries sender identity, postal address, and an opt-out route', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());

  assert.match(message.bodyText, /beGlib Ltd/);
  assert.match(message.bodyText, /1 Example Street, Toronto, ON, Canada/);
  assert.match(message.bodyText, /unsubscribe@outreach\.example\.com/);
  assert.match(message.bodyText, /https:\/\/example\.org\/ada\/contact/);
  assert.equal(message.headers[0].name, 'List-Unsubscribe');
  assert.equal(validateRenderedMessage(cfg, message).ok, true);
});

test('render refuses to leave template placeholders unresolved', () => {
  const result = renderOutreachMessage({
    config: config(),
    template: getTemplate('tmpl-science'),
    candidate: candidate({ topics: [] }),
    contact: { email: 'ada@example.org', sourceUrl: 'https://example.org' },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /topic/i);
});

test('tampering with a rendered body invalidates its hash', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());
  const tampered = { ...message, bodyText: message.bodyText.replace('beGlib Ltd', 'Someone Else') };

  assert.equal(validateRenderedMessage(cfg, tampered).ok, false);
});

test('preflight passes for a verified, approved, low-risk candidate', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message,
    states: states({ approvals: [approval(message)] }),
    now: NOW,
  });

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(result.quota.remaining, 25);
});

test('the recipient country raises the matching consent-regime warning', () => {
  const cfg = config();

  const check = (country) => {
    const subject = candidate({ country });

    return evaluateSendPreflight({
      config: cfg,
      candidate: subject,
      message: renderFor(cfg, subject),
      states: states({ approvals: [approval(renderFor(cfg, subject))] }),
      now: NOW,
    });
  };

  const canada = check('Canada');
  const germany = check('Germany');
  const uk = check('United Kingdom');
  const unknown = check('');

  assert.equal(canada.ok, true, JSON.stringify(canada.blockers));
  assert.ok(canada.warnings.some((warning) => warning.code === 'jurisdiction_casl'));
  assert.ok(germany.warnings.some((warning) => warning.code === 'jurisdiction_gdpr'));
  assert.ok(uk.warnings.some((warning) => warning.code === 'jurisdiction_gdpr'));
  assert.equal(
    unknown.warnings.filter((warning) => warning.code.startsWith('jurisdiction_')).length,
    0,
  );
});

test('jurisdiction notes are advisory and never block a send', () => {
  const notes = jurisdictionNotes('türkiye');

  assert.equal(notes.length, 1);
  assert.equal(notes[0].code, 'jurisdiction_kvkk');
  assert.deepEqual(jurisdictionNotes('Kenya'), []);
  assert.deepEqual(jurisdictionNotes(undefined), []);
});

test('suppression blocks a send that would otherwise pass every other gate', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message,
    states: states({
      approvals: [approval(message)],
      suppression: [{ kind: 'email', value: 'ada@example.org', reason: 'opt-out-request', revokedAt: null }],
    }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'suppressed'));
});

test('a suppressed domain blocks every address under it', () => {
  const suppression = { entries: [{ kind: 'domain', value: 'example.org', reason: 'complaint', revokedAt: null }] };

  assert.ok(findSuppression(suppression, 'someone.else@example.org'));
  assert.equal(findSuppression(suppression, 'someone@other.org'), null);
});

test('a revoked suppression entry stops matching', () => {
  const suppression = {
    entries: [{ kind: 'email', value: 'ada@example.org', reason: 'complaint', revokedAt: '2026-08-05T00:00:00.000Z' }],
  };

  assert.equal(findSuppression(suppression, 'ada@example.org'), null);
});

test('an unverified contact route cannot be staged', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message,
    states: states({ verifications: [], approvals: [approval(message)] }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'no_verified_route'));
});

test('verification freshness is capped by the configured maximum age', () => {
  // The reviewer claimed a year of freshness; the 90-day cap wins.
  const expiry = verificationExpiry(verification({ verificationFreshUntil: '2027-08-01T00:00:00.000Z' }), 90);

  assert.equal(expiry.toISOString(), '2026-10-30T00:00:00.000Z');
});

test('an expired verification stops authorising sends', () => {
  const found = findActiveVerification(
    { verifications: [verification({ verificationFreshUntil: '2026-08-01T00:00:00.000Z' })] },
    { candidateId: 'cand_0001', email: 'ada@example.org', now: NOW, verificationMaxAgeDays: 90 },
  );

  assert.equal(found, null);
});

test('verification input rejects guessed address patterns', () => {
  const result = validateVerificationInput({
    candidateId: 'cand_0001',
    candidateName: 'Ada Lovelace',
    email: 'first.last@example.org',
    routeType: 'public-business-email',
    consentBasis: 'public-business-contact',
    verificationMethod: 'official-site-contact-page',
    sourceUrl: 'https://example.org/contact',
    reviewerRef: 'reviewer:mehmet',
    evidenceNote: 'Listed on the contact page.',
    verificationFreshUntil: '2027-01-01T00:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /guessed pattern/);
});

test('an approval for different copy does not authorise this message', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message,
    states: states({ approvals: [approval(message, { bodyHash: 'hash-of-some-earlier-draft' })] }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'no_approval'));
});

test('a consumed approval cannot authorise a second message', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message,
    states: states({ approvals: [approval(message, { consumedAt: '2026-08-06T11:30:00.000Z' })] }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'no_approval'));
});

test('sensitive-category candidates need a sensitive-category reviewer on the approval', () => {
  const cfg = config();
  const sensitive = candidate({ category: 'psychology', sensitiveFlags: ['mental-health'] });
  const message = renderFor(cfg, sensitive);

  const withoutReviewer = evaluateSendPreflight({
    config: cfg,
    candidate: sensitive,
    message,
    states: states({ approvals: [approval(message)] }),
    now: NOW,
  });

  assert.equal(withoutReviewer.ok, false);
  assert.ok(withoutReviewer.blockers.some((blocker) => blocker.code === 'no_sensitive_approval'));

  const withReviewer = evaluateSendPreflight({
    config: cfg,
    candidate: sensitive,
    message,
    states: states({ approvals: [approval(message, { sensitiveCategoryApprovedBy: 'legal:counsel' })] }),
    now: NOW,
  });

  assert.equal(withReviewer.ok, true, JSON.stringify(withReviewer.blockers));
});

test('high-risk candidates need a senior approval reference', () => {
  const cfg = config();
  const risky = candidate({ riskLevel: 'high' });
  const message = renderFor(cfg, risky);

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: risky,
    message,
    // sensitiveFlags is empty, so only the senior gate should fire.
    states: states({ approvals: [approval(message)] }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'no_senior_approval'));
});

test('do-not-contact status blocks regardless of approvals', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate({ status: 'do-not-contact' }),
    message,
    states: states({ approvals: [approval(message)] }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'do_not_contact'));
});

test('a candidate already messaged in this campaign is blocked as a duplicate', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());
  const dedupeKey = buildDedupeKey(cfg, { candidateId: 'cand_0001', email: 'ada@example.org' });

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message,
    states: states({
      approvals: [approval(message)],
      outbox: [{ id: 'msg_prev', dedupeKey, status: 'sent', sentAt: '2026-07-01T09:00:00.000Z' }],
    }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'duplicate'));
});

test('a previously failed message may be retried', () => {
  const cfg = config();
  const message = renderFor(cfg, candidate());
  const dedupeKey = buildDedupeKey(cfg, { candidateId: 'cand_0001', email: 'ada@example.org' });

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message,
    states: states({
      approvals: [approval(message)],
      outbox: [{ id: 'msg_prev', dedupeKey, status: 'failed', sentAt: null }],
    }),
    now: NOW,
  });

  assert.equal(result.ok, true, JSON.stringify(result.blockers));
});

test('the daily limit counts only real sends from today', () => {
  const outbox = {
    messages: [
      { status: 'sent', sentAt: '2026-08-06T08:00:00.000Z' },
      { status: 'sent', sentAt: '2026-08-05T08:00:00.000Z' },
      { status: 'suppressed', sentAt: null },
      { status: 'pending', sentAt: null },
    ],
  };

  assert.equal(countSentToday(outbox, NOW), 1);
});

test('mode off blocks staging even when everything else is in order', () => {
  const cfg = config({ OUTREACH_EMAIL_MODE: 'off' });
  const message = renderFor(cfg, candidate());

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message,
    states: states({ approvals: [approval(message)] }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'mode_off'));
});

test('missing sender identity config blocks a send', () => {
  const cfg = config({ PHYSICAL_MAILING_ADDRESS: '' });

  assert.ok(cfg.issues.some((issue) => issue.includes('PHYSICAL_MAILING_ADDRESS')));

  const result = evaluateSendPreflight({
    config: cfg,
    candidate: candidate(),
    message: { to: 'ada@example.org', subject: 'x', bodyText: 'x', from: cfg.fromAddress },
    states: states(),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'config_incomplete'));
});

test('delivery preflight suppresses a queued message when the address is suppressed after staging', () => {
  const cfg = config();
  const record = renderFor(cfg, candidate());

  const result = evaluateDeliveryPreflight({
    config: cfg,
    record,
    states: states({
      suppression: [{ kind: 'email', value: 'ada@example.org', reason: 'hard-bounce', revokedAt: null }],
    }),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'suppressed'));
});

test('delivery preflight refuses to send in dry_run mode', () => {
  const cfg = config({ OUTREACH_EMAIL_MODE: 'dry_run' });
  const record = renderFor(cfg, candidate());

  const result = evaluateDeliveryPreflight({ config: cfg, record, states: states(), now: NOW });

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === 'mode_not_live'));
});
