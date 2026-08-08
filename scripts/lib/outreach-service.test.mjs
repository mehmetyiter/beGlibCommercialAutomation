import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { recordApproval } from './outreach-approvals.mjs';
import { loadOutreachConfig } from './outreach-config.mjs';
import { loadOutboxState } from './outreach-outbox.mjs';
import { applyProviderEvents, parseProviderEvent, suppressionReasonForEvent } from './outreach-provider-events.mjs';
import { buildPreview, drainOutbox, retryFailedMessages, stageMessage } from './outreach-service.mjs';
import { addSuppression, loadSuppressionState, summarizeSuppression } from './outreach-suppression.mjs';
import { recordVerification } from './outreach-verifications.mjs';

const CANDIDATE = {
  id: 'cand_0001',
  name: 'Ada Lovelace',
  category: 'science',
  status: 'approved',
  consentStatus: 'public-business-contact',
  riskLevel: 'low',
  sensitiveFlags: [],
  topics: ['computing', 'mathematics'],
};

const EMAIL = 'ada@example.org';

async function withConfig(overrides, run) {
  const dir = await mkdtemp(join(tmpdir(), 'beglib-outreach-'));

  const config = loadOutreachConfig({
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
    SUPPRESSION_LIST_PATH: join(dir, 'suppression.json'),
    OUTREACH_VERIFICATIONS_PATH: join(dir, 'verifications.json'),
    OUTREACH_APPROVALS_PATH: join(dir, 'approvals.json'),
    OUTREACH_OUTBOX_PATH: join(dir, 'outbox.json'),
    OUTREACH_PROVIDER_EVENTS_PATH: join(dir, 'provider-events.json'),
    OUTREACH_AUDIT_PATH: join(dir, 'audit.jsonl'),
    ...overrides,
  });

  try {
    await run(config);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function verifyContact(config) {
  const result = await recordVerification(config, {
    candidateId: CANDIDATE.id,
    candidateName: CANDIDATE.name,
    email: EMAIL,
    routeType: 'public-business-email',
    consentBasis: 'public-business-contact',
    sourceUrl: 'https://example.org/ada/contact',
    verificationMethod: 'official-site-contact-page',
    verificationFreshUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    reviewerRef: 'reviewer:mehmet',
    evidenceNote: 'Listed under "Contact" on the official site.',
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));

  return result.verification;
}

async function approveCurrentPreview(config, overrides = {}) {
  const preview = await buildPreview(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

  assert.equal(preview.ok, true, JSON.stringify(preview.errors));

  const result = await recordApproval(
    config,
    {
      candidateId: CANDIDATE.id,
      candidateName: CANDIDATE.name,
      email: EMAIL,
      templateId: preview.message.templateId,
      subject: preview.message.subject,
      bodyHash: preview.message.bodyHash,
      approvedBy: 'reviewer:mehmet',
      note: 'Pilot wave 1.',
      ...overrides,
    },
    { requiresSensitiveApproval: false, requiresSeniorApproval: false },
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors));

  return { preview, approval: result.approval };
}

function fakeSender(sent) {
  return async (config, record) => {
    sent.push(record);
    return { provider: 'ses', providerMessageId: `ses-${sent.length}` };
  };
}

test('verify, approve, stage, and drain delivers exactly one message', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);

    const staged = await stageMessage(config, {
      candidate: CANDIDATE,
      templateId: 'tmpl-science',
      email: EMAIL,
      enqueuedBy: 'operator:mehmet',
    });

    assert.equal(staged.ok, true, JSON.stringify(staged.errors));

    const sent = [];
    const drained = await drainOutbox(config, { sender: fakeSender(sent) });

    assert.equal(drained.results.length, 1);
    assert.equal(drained.results[0].outcome, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, EMAIL);
    assert.match(sent[0].bodyText, /beGlib Ltd/);

    // Draining again must not re-send an already-sent record.
    const secondDrain = await drainOutbox(config, { sender: fakeSender(sent) });
    assert.equal(secondDrain.results.length, 0);
    assert.equal(sent.length, 1);
  });
});

test('staging without an approval is refused', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);

    const staged = await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

    assert.equal(staged.ok, false);
    assert.ok(staged.preflight.blockers.some((blocker) => blocker.code === 'no_approval'));
  });
});

test('staging without a verified contact route is refused', async () => {
  await withConfig({}, async (config) => {
    const staged = await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

    assert.equal(staged.ok, false);
    assert.ok(staged.preflight.blockers.some((blocker) => blocker.code === 'no_verified_route'));
  });
});

test('one approval authorises one message; the second staging attempt is refused', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);

    const first = await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });
    assert.equal(first.ok, true);

    const second = await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });
    assert.equal(second.ok, false);
    assert.ok(second.preflight.blockers.some((blocker) => blocker.code === 'duplicate'));
  });
});

test('dry_run stages the record but never calls the provider', async () => {
  await withConfig({ OUTREACH_EMAIL_MODE: 'dry_run' }, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);

    const staged = await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });
    assert.equal(staged.ok, true, JSON.stringify(staged.errors));

    const sent = [];
    const drained = await drainOutbox(config, { sender: fakeSender(sent) });

    assert.equal(sent.length, 0);
    assert.equal(drained.results[0].outcome, 'suppressed');
    assert.equal(drained.results[0].reason, 'dry_run');
  });
});

test('a suppression added after staging stops the queued message at delivery', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);

    const staged = await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });
    assert.equal(staged.ok, true);

    await addSuppression(config, {
      kind: 'email',
      value: EMAIL,
      reason: 'opt-out-request',
      addedBy: 'operator:mehmet',
    });

    const sent = [];
    const drained = await drainOutbox(config, { sender: fakeSender(sent) });

    assert.equal(sent.length, 0);
    assert.equal(drained.results[0].outcome, 'suppressed');
    assert.equal(drained.results[0].reason, 'suppressed');
  });
});

test('the daily limit stops further deliveries once it is reached', async () => {
  await withConfig({ OUTREACH_DAILY_SEND_LIMIT: '1' }, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);
    await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

    const sent = [];
    await drainOutbox(config, { sender: fakeSender(sent) });
    assert.equal(sent.length, 1);

    // A second candidate is fully verified and approved, but the budget is spent.
    const second = { ...CANDIDATE, id: 'cand_0002', name: 'Grace Hopper' };
    const secondEmail = 'grace@example.org';

    await recordVerification(config, {
      candidateId: second.id,
      candidateName: second.name,
      email: secondEmail,
      routeType: 'public-business-email',
      consentBasis: 'public-business-contact',
      sourceUrl: 'https://example.org/grace/contact',
      verificationMethod: 'official-site-contact-page',
      verificationFreshUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      reviewerRef: 'reviewer:mehmet',
      evidenceNote: 'Listed under "Contact".',
    });

    const preview = await buildPreview(config, { candidate: second, templateId: 'tmpl-science', email: secondEmail });
    assert.equal(preview.ok, true);
    assert.ok(preview.preflight.blockers.some((blocker) => blocker.code === 'daily_limit'));
  });
});

test('a transient provider failure keeps the message pending for a retry', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);
    await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

    const failing = async () => {
      const error = new Error('Throttled');
      error.name = 'TooManyRequestsException';
      throw error;
    };

    const drained = await drainOutbox(config, { sender: failing });
    assert.equal(drained.results[0].outcome, 'retry');

    const state = await loadOutboxState(config);
    assert.equal(state.messages[0].status, 'pending');
    assert.equal(state.messages[0].attempts, 1);
  });
});

test('a terminal provider rejection fails the message immediately', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);
    await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

    const rejecting = async () => {
      const error = new Error('Email address is not verified.');
      error.name = 'MessageRejected';
      throw error;
    };

    const drained = await drainOutbox(config, { sender: rejecting });
    assert.equal(drained.results[0].outcome, 'failed');

    const state = await loadOutboxState(config);
    assert.equal(state.messages[0].status, 'failed');
  });
});

test('a failed message can be retried without a fresh approval', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);
    await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

    const rejecting = async () => {
      const error = new Error('Temporary infrastructure fault.');
      error.name = 'MessageRejected';
      throw error;
    };

    await drainOutbox(config, { sender: rejecting });
    assert.equal((await loadOutboxState(config)).messages[0].status, 'failed');

    const retried = await retryFailedMessages(config, { all: true, actor: 'operator:mehmet' });
    assert.equal(retried.requeued, 1);

    const sent = [];
    const drained = await drainOutbox(config, { sender: fakeSender(sent) });

    assert.equal(drained.results[0].outcome, 'sent');
    assert.equal(sent.length, 1);
  });
});

test('retry refuses once the address has been suppressed', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);
    await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

    const rejecting = async () => {
      const error = new Error('MessageRejected');
      error.name = 'MessageRejected';
      throw error;
    };
    await drainOutbox(config, { sender: rejecting });

    await addSuppression(config, {
      kind: 'email',
      value: EMAIL,
      reason: 'opt-out-request',
      addedBy: 'operator:mehmet',
    });

    const retried = await retryFailedMessages(config, { all: true, actor: 'operator:mehmet' });

    assert.equal(retried.requeued, 0);
    assert.equal(retried.results[0].outcome, 'blocked');
    assert.match(retried.results[0].reasons.join(' '), /suppressed/i);
  });
});

test('retry refuses when the approved copy no longer matches current configuration', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);
    await stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL });

    const rejecting = async () => {
      const error = new Error('MessageRejected');
      error.name = 'MessageRejected';
      throw error;
    };
    await drainOutbox(config, { sender: rejecting });

    // The postal address changed after approval, so the queued footer is stale.
    const movedOffice = { ...config, physicalMailingAddress: '2 Other Street, Toronto, ON, Canada' };
    const retried = await retryFailedMessages(movedOffice, { all: true, actor: 'operator:mehmet' });

    assert.equal(retried.requeued, 0);
    assert.equal(retried.results[0].outcome, 'blocked');
    assert.match(retried.results[0].reasons.join(' '), /physical mailing address/i);
  });
});

test('a hard bounce event suppresses the address', async () => {
  await withConfig({}, async (config) => {
    const snsBody = JSON.stringify({
      Type: 'Notification',
      Message: JSON.stringify({
        eventType: 'Bounce',
        mail: { messageId: 'ses-1', destination: [EMAIL], timestamp: '2026-08-06T12:00:00.000Z' },
        bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: EMAIL }] },
      }),
    });

    const parsed = parseProviderEvent(snsBody);
    assert.equal(parsed.ok, true);
    assert.equal(suppressionReasonForEvent(parsed.event), 'hard-bounce');

    const applied = await applyProviderEvents(config, [parsed.event]);
    assert.equal(applied.applied, 1);
    assert.deepEqual(applied.suppressed, [{ email: EMAIL, reason: 'hard-bounce' }]);

    // Replaying the same event must not double-apply.
    const replay = await applyProviderEvents(config, [parsed.event]);
    assert.equal(replay.applied, 0);
    assert.equal(replay.skippedDuplicates, 1);

    const suppression = await loadSuppressionState(config);
    assert.equal(summarizeSuppression(suppression).active, 1);
  });
});

test('a transient bounce is recorded but does not suppress', async () => {
  await withConfig({}, async (config) => {
    const parsed = parseProviderEvent(
      JSON.stringify({
        eventType: 'Bounce',
        mail: { messageId: 'ses-2', destination: [EMAIL] },
        bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: EMAIL }] },
      }),
    );

    assert.equal(suppressionReasonForEvent(parsed.event), null);

    const applied = await applyProviderEvents(config, [parsed.event]);
    assert.equal(applied.applied, 1);
    assert.deepEqual(applied.suppressed, []);
  });
});

test('a non-event SNS notice is classified so the poller can drop it', async () => {
  // SES publishes this plain-text message when an event destination is created. It is not
  // JSON, so it must be recognised as a notice rather than left to recycle forever.
  const notice = parseProviderEvent(
    JSON.stringify({
      Type: 'Notification',
      Message: 'Successfully validated SNS topic for Amazon SES event publishing.',
    }),
  );

  assert.equal(notice.ok, false);
  assert.equal(notice.kind, 'notice');

  const noEventType = parseProviderEvent(JSON.stringify({ Type: 'Notification', Message: '{"foo":1}' }));
  assert.equal(noEventType.kind, 'notice');

  // Genuine garbage stays malformed so a parser gap keeps surfacing.
  assert.equal(parseProviderEvent('not json at all').kind, 'malformed');
});

test('a complaint event suppresses the address', async () => {
  await withConfig({}, async (config) => {
    const parsed = parseProviderEvent(
      JSON.stringify({
        eventType: 'Complaint',
        mail: { messageId: 'ses-3', destination: [EMAIL] },
        complaint: { complainedRecipients: [{ emailAddress: EMAIL }], complaintFeedbackType: 'abuse' },
      }),
    );

    const applied = await applyProviderEvents(config, [parsed.event]);
    assert.deepEqual(applied.suppressed, [{ email: EMAIL, reason: 'spam-complaint' }]);
  });
});

test('concurrent staging of the same candidate produces exactly one queued message', async () => {
  await withConfig({}, async (config) => {
    await verifyContact(config);
    await approveCurrentPreview(config);

    const attempts = await Promise.all([
      stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL }),
      stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL }),
      stageMessage(config, { candidate: CANDIDATE, templateId: 'tmpl-science', email: EMAIL }),
    ]);

    assert.equal(attempts.filter((attempt) => attempt.ok).length, 1);

    const state = await loadOutboxState(config);
    assert.equal(state.messages.filter((message) => message.status === 'pending').length, 1);
  });
});
