#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { listApprovalsForCandidate, loadApprovalState, recordApproval, revokeApproval } from './lib/outreach-approvals.mjs';
import { loadOutreachConfig, publicOutreachConfig } from './lib/outreach-config.mjs';
import { listDossierDatasets, loadCandidateFromDataset } from './lib/outreach-dossier.mjs';
import { listTemplates } from './lib/outreach-mail.mjs';
import { listOutbox, loadOutboxState, redactOutboxBodies, summarizeOutbox } from './lib/outreach-outbox.mjs';
import { requiresSensitiveApproval, requiresSeniorApproval } from './lib/outreach-policy.mjs';
import { applyProviderEvents, loadProviderEventState, parseProviderEvent } from './lib/outreach-provider-events.mjs';
import { buildPreview, drainOutbox, retryFailedMessages, stageMessage } from './lib/outreach-service.mjs';
import { addSuppression, loadSuppressionState, revokeSuppression, summarizeSuppression } from './lib/outreach-suppression.mjs';
import {
  listVerificationsForCandidate,
  loadVerificationState,
  recordVerification,
  revokeVerification,
} from './lib/outreach-verifications.mjs';
import { loadLocalEnv } from './lib/local-env.mjs';

const USAGE = `beGlib outreach CLI

  node scripts/outreach.mjs <command> [options]

Commands
  config                        Show the effective outreach configuration and any blocking issues.
  templates                     List the outreach templates.
  datasets                      List local dossier datasets available under exports/.
  candidate                     Show a candidate's discovery contact suggestions and verification state.
  verify                        Record a human verification of a published contact route.
  revoke-verification           Revoke a contact verification.
  preview                       Render the exact message and run every preflight gate.
  approve                       Approve a rendered preview for one send.
  revoke-approval               Revoke an unused approval.
  stage                         Preflight and enqueue an approved message into the outbox.
  retry                         Re-queue failed messages without a fresh approval.
  send                          Drain pending outbox messages (dry-run unless mode is live).
  status                        Show outbox, suppression, and provider-event counters.
  suppress                      Add an address or domain to the suppression list.
  unsuppress                    Revoke a suppression entry.
  pull-events                   Poll the SES event queue and apply bounces/complaints.
  redact                        Drop message bodies from old terminal outbox records.

Common options
  --dataset <id>                Dossier dataset id from exports/ (see: datasets).
  --candidate-id <id>           Candidate id inside the dataset.
  --email <address>             Contact route address.
  --template <id>               Template id (defaults to the candidate's category template).
  --json                        Emit machine-readable JSON.
`;

const OPTIONS = {
  dataset: { type: 'string' },
  'candidate-id': { type: 'string' },
  email: { type: 'string' },
  template: { type: 'string' },
  json: { type: 'boolean', default: false },

  // verify
  'source-url': { type: 'string' },
  method: { type: 'string' },
  'fresh-until': { type: 'string' },
  reviewer: { type: 'string' },
  note: { type: 'string' },

  // approve
  'approved-by': { type: 'string' },
  'sensitive-approved-by': { type: 'string' },
  'senior-approval-ref': { type: 'string' },

  // suppression
  kind: { type: 'string', default: 'email' },
  value: { type: 'string' },
  reason: { type: 'string' },
  actor: { type: 'string' },
  id: { type: 'string' },

  // send / retry / pull-events / redact
  limit: { type: 'string' },
  live: { type: 'boolean', default: false },
  all: { type: 'boolean', default: false },
  'older-than-days': { type: 'string' },
};

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function emit(values, payload, humanLines) {
  if (values.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  for (const line of humanLines) {
    console.log(line);
  }
}

async function requireCandidate(values) {
  if (!values.dataset || !values['candidate-id']) {
    return { ok: false, errors: ['--dataset and --candidate-id are required.'] };
  }

  return loadCandidateFromDataset(values.dataset, values['candidate-id']);
}

function formatPreflight(preflight) {
  const lines = [];

  lines.push(`Preflight: ${preflight.ok ? 'PASS' : 'BLOCKED'}`);
  lines.push(
    `Quota: ${preflight.quota.sentToday}/${preflight.quota.dailyLimit} sent today, ${preflight.quota.remaining} remaining`,
  );

  for (const blocker of preflight.blockers) {
    lines.push(`  [block] ${blocker.code}: ${blocker.message}`);
  }

  for (const warning of preflight.warnings) {
    lines.push(`  [warn ] ${warning.code}: ${warning.message}`);
  }

  return lines;
}

const commands = {
  async config(config, values) {
    const summary = publicOutreachConfig(config);

    emit(values, summary, [
      `Mode: ${summary.mode}`,
      `Campaign: ${summary.campaignId} (${summary.emailEnv})`,
      `From: ${summary.fromName} <${summary.fromAddress}>`,
      `Reply-To: ${summary.replyToAddress || '(not set)'}`,
      `Opt-out mailbox: ${summary.unsubscribeMailto || '(not set)'}`,
      `Daily limit: ${summary.dailySendLimit}`,
      `Human approval required: ${summary.requireHumanApproval}`,
      `SES configuration set: ${summary.configurationSetConfigured ? 'configured' : 'MISSING'}`,
      `SES event queue: ${summary.providerEventQueueConfigured ? 'configured' : 'not configured'}`,
      ...(summary.issues.length > 0
        ? ['', 'Blocking configuration issues:', ...summary.issues.map((issue) => `  - ${issue}`)]
        : ['', 'No blocking configuration issues.']),
    ]);
  },

  async templates(config, values) {
    const templates = listTemplates();

    emit(
      values,
      templates,
      templates.map((template) => `${template.id.padEnd(18)} ${template.category.padEnd(16)} ${template.name}`),
    );
  },

  async datasets(config, values) {
    const datasets = await listDossierDatasets();

    if (datasets.length === 0) {
      emit(values, [], ['No dossier datasets under exports/. Run npm run build:dossiers first.']);
      return;
    }

    emit(values, datasets, datasets.map((dataset) => `${dataset.id}  (${dataset.mtime})`));
  },

  async candidate(config, values) {
    const loaded = await requireCandidate(values);

    if (!loaded.ok) {
      fail(loaded.errors.join(' '));
      return;
    }

    const [verificationState, approvalState] = await Promise.all([
      loadVerificationState(config),
      loadApprovalState(config),
    ]);

    const verifications = listVerificationsForCandidate(verificationState, loaded.candidate.id);
    const approvals = listApprovalsForCandidate(approvalState, loaded.candidate.id);

    emit(values, { ...loaded, verifications, approvals }, [
      `${loaded.candidate.name} (${loaded.candidate.id})`,
      `Category: ${loaded.candidate.category ?? 'unknown'} | Risk: ${loaded.candidate.riskLevel ?? 'unknown'} | Consent: ${loaded.candidate.consentStatus}`,
      `Sensitive flags: ${loaded.candidate.sensitiveFlags.join(', ') || 'none'}`,
      `Topics: ${loaded.candidate.topics.join(', ') || 'none'}`,
      '',
      'Discovery email suggestions (NOT verified routes):',
      ...(loaded.emailCandidates.length > 0
        ? loaded.emailCandidates.map(
            (contact) => `  ${contact.email}  role=${contact.role ?? '-'}  source=${contact.sourceUrl ?? '-'}`,
          )
        : ['  (none)']),
      '',
      'Recorded verifications:',
      ...(verifications.length > 0
        ? verifications.map(
            (entry) =>
              `  ${entry.id}  ${entry.email}  ${entry.revokedAt ? 'REVOKED' : `fresh until ${entry.verificationFreshUntil}`}`,
          )
        : ['  (none)']),
      '',
      `Approvals recorded: ${approvals.length}`,
    ]);
  },

  async verify(config, values) {
    const loaded = await requireCandidate(values);

    if (!loaded.ok) {
      fail(loaded.errors.join(' '));
      return;
    }

    const result = await recordVerification(config, {
      candidateId: loaded.candidate.id,
      candidateName: loaded.candidate.name,
      datasetId: values.dataset,
      email: values.email,
      routeType: 'public-business-email',
      consentBasis: 'public-business-contact',
      sourceUrl: values['source-url'],
      verificationMethod: values.method,
      verificationFreshUntil: values['fresh-until'],
      reviewerRef: values.reviewer,
      evidenceNote: values.note,
      candidateCategory: loaded.candidate.category,
      candidateRiskLevel: loaded.candidate.riskLevel,
      candidateSensitiveFlags: loaded.candidate.sensitiveFlags,
    });

    if (!result.ok) {
      fail(result.errors.join('\n       '));
      return;
    }

    emit(values, result, [`Recorded verification ${result.verification.id} for ${result.verification.email}.`]);
  },

  async 'revoke-verification'(config, values) {
    const result = await revokeVerification(config, { id: values.id, revokedBy: values.actor, note: values.note });

    if (!result.ok) {
      fail(result.errors.join(' '));
      return;
    }

    emit(values, result, [`Revoked verification ${values.id}.`]);
  },

  async preview(config, values) {
    const loaded = await requireCandidate(values);

    if (!loaded.ok) {
      fail(loaded.errors.join(' '));
      return;
    }

    const preview = await buildPreview(config, {
      candidate: loaded.candidate,
      templateId: values.template,
      email: values.email,
    });

    if (!preview.ok) {
      fail(preview.errors.join('\n       '));
      return;
    }

    emit(values, preview, [
      `Template: ${preview.template.id} (${preview.template.name})`,
      `Review levels: ${preview.template.requiredReview.join(', ')}`,
      `From: ${preview.message.fromDisplay}`,
      `Reply-To: ${preview.message.replyTo}`,
      `To: ${preview.message.to}`,
      `Subject: ${preview.message.subject}`,
      `Body hash: ${preview.message.bodyHash}`,
      '',
      preview.message.bodyText,
      '',
      ...formatPreflight(preview.preflight),
    ]);
  },

  async approve(config, values) {
    const loaded = await requireCandidate(values);

    if (!loaded.ok) {
      fail(loaded.errors.join(' '));
      return;
    }

    const preview = await buildPreview(config, {
      candidate: loaded.candidate,
      templateId: values.template,
      email: values.email,
    });

    if (!preview.ok) {
      fail(preview.errors.join('\n       '));
      return;
    }

    const result = await recordApproval(
      config,
      {
        candidateId: loaded.candidate.id,
        candidateName: loaded.candidate.name,
        email: values.email,
        templateId: preview.message.templateId,
        subject: preview.message.subject,
        bodyHash: preview.message.bodyHash,
        approvedBy: values['approved-by'],
        note: values.note,
        sensitiveCategoryApprovedBy: values['sensitive-approved-by'],
        seniorApprovalRef: values['senior-approval-ref'],
      },
      {
        requiresSensitiveApproval: requiresSensitiveApproval(loaded.candidate),
        requiresSeniorApproval: requiresSeniorApproval(loaded.candidate),
      },
    );

    if (!result.ok) {
      fail(result.errors.join('\n       '));
      return;
    }

    emit(values, result, [
      `Approved ${result.approval.id} for body hash ${result.approval.bodyHash}.`,
      'Editing the message or the sender footer after this point invalidates the approval.',
    ]);
  },

  async 'revoke-approval'(config, values) {
    const result = await revokeApproval(config, { id: values.id, revokedBy: values.actor, note: values.note });

    if (!result.ok) {
      fail(result.errors.join(' '));
      return;
    }

    emit(values, result, [`Revoked approval ${values.id}.`]);
  },

  async stage(config, values) {
    const loaded = await requireCandidate(values);

    if (!loaded.ok) {
      fail(loaded.errors.join(' '));
      return;
    }

    const result = await stageMessage(config, {
      candidate: loaded.candidate,
      templateId: values.template,
      email: values.email,
      enqueuedBy: values.actor ?? values['approved-by'] ?? null,
    });

    if (!result.ok) {
      fail(result.errors.join('\n       '));
      return;
    }

    emit(values, result, [
      `Queued message ${result.message.id} for ${result.message.to} in mode ${config.mode}.`,
      'Run `npm run outreach:send` to work the queue.',
    ]);
  },

  async retry(config, values) {
    if (!values.id && !values.all) {
      fail('Pass --id <messageId> or --all to re-queue every failed message.');
      return;
    }

    const result = await retryFailedMessages(config, {
      messageId: values.id,
      all: values.all,
      actor: values.actor,
    });

    if (!result.ok) {
      fail(result.errors.join('\n       '));
      return;
    }

    emit(values, result, [
      `Re-queued ${result.requeued} message(s). Run \`npm run outreach:send\` to work the queue.`,
      ...result.results.map((entry) =>
        entry.outcome === 'requeued'
          ? `  requeued  ${entry.to}`
          : `  blocked   ${entry.to} - ${entry.reasons.join('; ')}`,
      ),
    ]);
  },

  async send(config, values) {
    // Live delivery needs both the environment mode and an explicit --live on the command,
    // so a stray `npm run outreach:send` in a configured shell cannot post real mail.
    if (config.mode === 'live' && !values.live) {
      fail('Mode is live. Re-run with --live to confirm real delivery.');
      return;
    }

    const limit = Number.parseInt(values.limit ?? '25', 10);
    const result = await drainOutbox(config, { limit: Number.isFinite(limit) ? limit : 25 });

    emit(values, result, [
      `Processed ${result.processed} message(s) in mode ${config.mode}.`,
      ...result.results.map(
        (entry) => `  ${entry.outcome.padEnd(10)} ${entry.to ?? entry.id} ${entry.reason ? `- ${entry.reason}` : ''}`,
      ),
      '',
      `Outbox: ${JSON.stringify(result.summary.byStatus)} | sent today: ${result.summary.sentToday}`,
    ]);
  },

  async status(config, values) {
    const [outbox, suppression, providerEvents] = await Promise.all([
      loadOutboxState(config),
      loadSuppressionState(config),
      loadProviderEventState(config),
    ]);

    const outboxSummary = summarizeOutbox(outbox);
    const suppressionSummary = summarizeSuppression(suppression);
    const recent = listOutbox(outbox, { limit: 10 });

    emit(values, { mode: config.mode, outbox: outboxSummary, suppression: suppressionSummary, providerEvents }, [
      `Mode: ${config.mode} | Campaign: ${config.campaignId}`,
      `Outbox: ${outboxSummary.total} total ${JSON.stringify(outboxSummary.byStatus)}`,
      `Sent today: ${outboxSummary.sentToday}/${config.dailySendLimit}`,
      `Suppression: ${suppressionSummary.active} active (${suppressionSummary.emails} addresses, ${suppressionSummary.domains} domains)`,
      `Provider events: ${JSON.stringify(providerEvents.counters ?? {})} last polled ${providerEvents.lastPolledAt ?? 'never'}`,
      '',
      'Recent outbox records:',
      ...(recent.length > 0
        ? recent.map((message) => `  ${message.status.padEnd(10)} ${message.to}  ${message.enqueuedAt}`)
        : ['  (none)']),
    ]);
  },

  async suppress(config, values) {
    const result = await addSuppression(config, {
      kind: values.kind,
      value: values.value ?? values.email,
      reason: values.reason,
      note: values.note,
      addedBy: values.actor,
      source: 'cli',
    });

    if (!result.ok) {
      fail(result.errors.join('\n       '));
      return;
    }

    emit(values, result, [
      result.created ? `Suppressed ${result.entry.kind} ${result.entry.value}.` : `${result.entry.value} was already suppressed.`,
    ]);
  },

  async unsuppress(config, values) {
    const result = await revokeSuppression(config, { id: values.id, revokedBy: values.actor, note: values.note });

    if (!result.ok) {
      fail(result.errors.join(' '));
      return;
    }

    emit(values, result, [`Revoked suppression ${values.id}.`]);
  },

  async 'pull-events'(config, values) {
    if (!config.eventQueueUrl) {
      fail('OUTREACH_SES_EVENT_QUEUE_URL is not configured.');
      return;
    }

    const { DeleteMessageBatchCommand, ReceiveMessageCommand, SQSClient } = await import('@aws-sdk/client-sqs');

    const client = new SQSClient({
      region: config.region,
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
    });

    const received = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: config.eventQueueUrl,
        MaxNumberOfMessages: Math.min(10, Number.parseInt(values.limit ?? '10', 10) || 10),
        WaitTimeSeconds: 5,
      }),
    );

    const queueMessages = received.Messages ?? [];
    const parsedMessages = queueMessages.map((queueMessage) => ({
      queueMessage,
      parsed: parseProviderEvent(queueMessage.Body ?? ''),
    }));

    const events = parsedMessages.filter((entry) => entry.parsed.ok).map((entry) => entry.parsed.event);
    const notices = parsedMessages.filter((entry) => entry.parsed.kind === 'notice');
    const malformed = parsedMessages.filter((entry) => entry.parsed.kind === 'malformed');

    const applied = await applyProviderEvents(config, events);

    // Delete only after the events are durably recorded, so a crash mid-apply replays
    // rather than silently losing a bounce. Notices carry no data and are dropped in the
    // same batch; leaving them would make them reappear on every poll forever. Malformed
    // messages stay on the queue to expire under its retention policy, so a real parser
    // gap surfaces as a repeated warning instead of vanishing.
    const deletable = [...parsedMessages.filter((entry) => entry.parsed.ok), ...notices];

    if (deletable.length > 0) {
      await client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: config.eventQueueUrl,
          Entries: deletable.map((entry, index) => ({
            Id: String(index),
            ReceiptHandle: entry.queueMessage.ReceiptHandle,
          })),
        }),
      );
    }

    const parseErrors = malformed.map((entry) => ({
      messageId: entry.queueMessage.MessageId,
      error: entry.parsed.error,
    }));

    emit(values, { ...applied, parseErrors, notices: notices.length, received: queueMessages.length }, [
      `Received ${queueMessages.length} queue message(s); applied ${applied.applied}, skipped ${applied.skippedDuplicates} duplicate(s).`,
      ...applied.suppressed.map((entry) => `  suppressed ${entry.email} (${entry.reason})`),
      ...notices.map((entry) => `  [info] discarded non-event notice: ${entry.parsed.error}`),
      ...parseErrors.map((entry) => `  [warn] unparsable message left on the queue ${entry.messageId}: ${entry.error}`),
    ]);
  },

  async redact(config, values) {
    const olderThanDays = Number.parseInt(values['older-than-days'] ?? '90', 10);
    const result = await redactOutboxBodies(config, {
      olderThanDays: Number.isFinite(olderThanDays) ? olderThanDays : 90,
    });

    emit(values, result, [`Redacted ${result.redacted} outbox message body/bodies.`]);
  },
};

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }

  if (!Object.hasOwn(commands, command)) {
    fail(`Unknown command "${command}". Run without arguments for usage.`);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false });
  } catch (error) {
    fail(error.message);
    return;
  }

  await loadLocalEnv();

  const config = loadOutreachConfig();

  await commands[command](config, parsed.values);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
