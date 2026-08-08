import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOutreachConfig } from './outreach-config.mjs';
import { getTemplate, maskCtaUrl, renderOutreachMessage, validateCtaUrl, validateRenderedMessage } from './outreach-mail.mjs';
import { findInvitableProspect } from './outreach-invite.mjs';

const TOKEN = 'A'.repeat(43);
const CTA = `https://app.beglib.com/host/invite#t=${TOKEN}`;
const FUTURE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

function config(overrides = {}) {
  return loadOutreachConfig({
    OUTREACH_EMAIL_MODE: 'live',
    OUTREACH_CAMPAIGN_ID: 'host-pilot-test',
    OUTREACH_FROM_ADDRESS: 'hosts@outreach.example.com',
    OUTREACH_REPLY_TO_ADDRESS: 'hosts@example.com',
    OUTREACH_UNSUBSCRIBE_MAILTO: 'unsubscribe@example.com',
    OUTREACH_SENDER_LEGAL_NAME: 'beGlib',
    PHYSICAL_MAILING_ADDRESS: '60, 45e ave, Montreal, Quebec, Canada, H8T 2L7',
    OUTREACH_SES_CONFIGURATION_SET: 'beglib-outreach-test',
    HOST_PROSPECT_ALLOWED_CTA_ORIGINS: 'https://app.beglib.com',
    ...overrides,
  });
}

const CANDIDATE = { id: 'cand_0001', name: 'Ada Lovelace', topics: ['computing'] };

function renderInvite(cfg, invite) {
  return renderOutreachMessage({
    config: cfg,
    template: getTemplate('tmpl-host-invite'),
    candidate: CANDIDATE,
    contact: { email: 'ada@example.org', sourceUrl: 'https://example.org/contact' },
    invite,
  });
}

test('the production CTA origin is accepted and the apex is not', () => {
  const allowed = ['https://app.beglib.com'];

  assert.equal(validateCtaUrl(CTA, allowed).ok, true);

  // The pre-production allowlist named the apex; a production CTA would have been refused.
  const apexOnly = validateCtaUrl(CTA, ['https://beglib.com']);
  assert.equal(apexOnly.ok, false);
  assert.match(apexOnly.errors.join(' '), /not allowlisted/);
});

test('a reshaped claim link is refused', () => {
  const allowed = ['https://app.beglib.com'];

  // Fragment moved to the query string, which is exactly what a naive tracker does.
  assert.equal(validateCtaUrl(`https://app.beglib.com/host/invite?t=${TOKEN}`, allowed).ok, false);
  // Fragment dropped entirely.
  assert.equal(validateCtaUrl('https://app.beglib.com/host/invite', allowed).ok, false);
  // Token truncated below the 43-character contract length.
  assert.equal(validateCtaUrl(`https://app.beglib.com/host/invite#t=${'A'.repeat(42)}`, allowed).ok, false);
});

test('the invitation renders the claim link verbatim in both bodies', () => {
  const cfg = config();
  const result = renderInvite(cfg, { ctaUrl: CTA, expiresAt: FUTURE, prospectId: 'p1' });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.message.bodyText.includes(CTA));
  assert.ok(result.message.bodyHtml.includes(`href="${CTA}"`));
  assert.equal(validateRenderedMessage(cfg, result.message).ok, true);
});

test('the browser-facing copy masks the claim token but keeps the real hash', () => {
  const cfg = config();
  const result = renderInvite(cfg, { ctaUrl: CTA, expiresAt: FUTURE, prospectId: 'p1' });

  assert.equal(result.displayMessage.bodyText.includes(TOKEN), false);
  assert.equal(result.displayMessage.bodyHtml.includes(TOKEN), false);
  assert.ok(result.displayMessage.bodyText.includes('token hidden'));

  // Approving what is displayed still authorises the exact bytes that will be sent.
  assert.equal(result.displayMessage.bodyHash, result.message.bodyHash);
});

test('the invitation template cannot render without a claim link', () => {
  const result = renderInvite(config(), { ctaUrl: '', expiresAt: FUTURE });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /requires a Conversio claim link/);
});

test('a non-invitation template refuses to carry a claim link', () => {
  const result = renderOutreachMessage({
    config: config(),
    template: getTemplate('tmpl-science'),
    candidate: CANDIDATE,
    contact: { email: 'ada@example.org', sourceUrl: 'https://example.org' },
    invite: { ctaUrl: CTA, expiresAt: FUTURE },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /tmpl-host-invite/);
});

test('a stripped claim link is caught before the message reaches the provider', () => {
  const cfg = config();
  const rendered = renderInvite(cfg, { ctaUrl: CTA, expiresAt: FUTURE, prospectId: 'p1' });

  // Simulates a link rewriter that dropped the fragment after rendering.
  const mangled = {
    ...rendered.message,
    bodyText: rendered.message.bodyText.replaceAll(CTA, 'https://app.beglib.com/host/invite'),
    bodyHtml: rendered.message.bodyHtml.replaceAll(CTA, 'https://app.beglib.com/host/invite'),
  };

  const result = validateRenderedMessage(cfg, mangled);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /missing from the text body/);
});

test('an expired prospect cannot be emailed', () => {
  const cfg = config();
  const rendered = renderInvite(cfg, { ctaUrl: CTA, expiresAt: FUTURE, prospectId: 'p1' });
  const stale = { ...rendered.message, ctaExpiresAt: '2020-01-01T00:00:00.000Z' };

  const result = validateRenderedMessage(cfg, stale);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /expired/);
});

test('maskCtaUrl leaves a non-claim URL untouched', () => {
  assert.equal(maskCtaUrl('https://example.org/page'), 'https://example.org/page');
});

// --- Host prospect state selection -------------------------------------------------

function record(overrides = {}) {
  return {
    prospectId: 'prospect-1',
    externalCandidateId: 'cand_0001',
    campaignId: 'host-pilot-test',
    campaignMemberId: 'member-1',
    ctaUrl: CTA,
    expiresAt: FUTURE,
    recordedAt: '2026-08-07T10:00:00.000Z',
    terminalAt: null,
    ...overrides,
  };
}

test('an issued, unexpired prospect is invitable', () => {
  const result = findInvitableProspect({ records: [record()] }, { candidateId: 'cand_0001' });

  assert.equal(result.ok, true);
  assert.equal(result.invite.ctaUrl, CTA);
  assert.equal(result.invite.prospectId, 'prospect-1');
});

test('terminal, expired, and redacted prospects are all refused', () => {
  const terminal = findInvitableProspect(
    { records: [record({ terminalAt: '2026-08-07T11:00:00.000Z', lastAuthoritativeEventType: 'host_prospect.revoked' })] },
    { candidateId: 'cand_0001' },
  );
  assert.equal(terminal.ok, false);
  assert.match(terminal.errors.join(' '), /terminal/);

  const expired = findInvitableProspect(
    { records: [record({ expiresAt: '2020-01-01T00:00:00.000Z' })] },
    { candidateId: 'cand_0001' },
  );
  assert.equal(expired.ok, false);
  assert.match(expired.errors.join(' '), /expired/);

  const redacted = findInvitableProspect(
    { records: [record({ ctaUrl: null, ctaRedactedAt: '2026-08-07T11:00:00.000Z' })] },
    { candidateId: 'cand_0001' },
  );
  assert.equal(redacted.ok, false);
  assert.match(redacted.errors.join(' '), /redacted/);
});

test('the newest record wins when a prospect was re-issued', () => {
  const result = findInvitableProspect(
    {
      records: [
        record({ prospectId: 'old', recordedAt: '2026-08-01T10:00:00.000Z' }),
        record({ prospectId: 'new', recordedAt: '2026-08-07T10:00:00.000Z' }),
      ],
    },
    { candidateId: 'cand_0001' },
  );

  assert.equal(result.invite.prospectId, 'new');
});

test('a prospect from another campaign is not reused', () => {
  const result = findInvitableProspect(
    { records: [record({ campaignId: 'some-other-campaign' })] },
    { candidateId: 'cand_0001', campaignId: 'host-pilot-test' },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /none in campaign/);
});
