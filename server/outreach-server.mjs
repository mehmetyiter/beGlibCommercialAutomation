#!/usr/bin/env node
import { createServer } from 'node:http';

import {
  createManualCandidate,
  listOverlayRecords,
  loadOverlayState,
  recordReviewOutcome,
  recordReviewOutcomes,
  revokeChannelVerification,
  verifyChannel,
} from '../scripts/lib/candidate-overlay.mjs';
import { listApprovalsForCandidate, loadApprovalState, recordApproval, revokeApproval } from '../scripts/lib/outreach-approvals.mjs';
import { loadOutreachConfig, publicOutreachConfig } from '../scripts/lib/outreach-config.mjs';
import { listDossierDatasets, loadCandidateFromDataset } from '../scripts/lib/outreach-dossier.mjs';
import { listTemplates } from '../scripts/lib/outreach-mail.mjs';
import { OUTBOX_STATUSES, listOutbox, loadOutboxState, summarizeOutbox } from '../scripts/lib/outreach-outbox.mjs';
import { requiresSensitiveApproval, requiresSeniorApproval } from '../scripts/lib/outreach-policy.mjs';
import { loadProviderEventState } from '../scripts/lib/outreach-provider-events.mjs';
import { resolveServerToken, timingSafeEqualString } from '../scripts/lib/outreach-server-token.mjs';
import { buildPreview, drainOutbox, retryFailedMessages, stageMessage } from '../scripts/lib/outreach-service.mjs';
import {
  addSuppression,
  loadSuppressionState,
  revokeSuppression,
  summarizeSuppression,
} from '../scripts/lib/outreach-suppression.mjs';
import {
  listVerificationsForCandidate,
  loadVerificationState,
  recordVerification,
  revokeVerification,
} from '../scripts/lib/outreach-verifications.mjs';
import { loadLocalEnv } from '../scripts/lib/local-env.mjs';

const MAX_BODY_BYTES = 256 * 1024;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body is too large.');
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.');
  }

  return parsed;
}

/**
 * Loopback binding alone would not stop a page in another browser tab from POSTing here,
 * so mutations additionally require the proxy-injected token and a JSON content type.
 * Any `Origin` header at all means a browser initiated the request cross-origin.
 */
function authorize(request, token) {
  const provided = request.headers['x-outreach-token'];

  if (!timingSafeEqualString(Array.isArray(provided) ? provided[0] : provided ?? '', token)) {
    return { ok: false, status: 401, error: 'Missing or invalid outreach server token.' };
  }

  if (request.method !== 'GET') {
    const contentType = String(request.headers['content-type'] ?? '');

    if (!contentType.startsWith('application/json')) {
      return { ok: false, status: 415, error: 'Mutations must use Content-Type: application/json.' };
    }
  }

  return { ok: true };
}

async function loadCandidateContext(config, { dataset, candidateId }) {
  if (!dataset || !candidateId) {
    return { ok: false, errors: ['dataset and candidateId are required.'] };
  }

  const loaded = await loadCandidateFromDataset(dataset, candidateId, {
    overlayPath: config.paths.candidateOverlay,
  });

  if (!loaded.ok) {
    return loaded;
  }

  const [verificationState, approvalState, outboxState] = await Promise.all([
    loadVerificationState(config),
    loadApprovalState(config),
    loadOutboxState(config),
  ]);

  return {
    ok: true,
    candidate: loaded.candidate,
    title: loaded.title,
    country: loaded.country,
    emailCandidates: loaded.emailCandidates,
    sourceUrls: loaded.sourceUrls,
    verifications: listVerificationsForCandidate(verificationState, loaded.candidate.id),
    approvals: listApprovalsForCandidate(approvalState, loaded.candidate.id),
    // Message bodies stay server-side; the dashboard only needs the delivery trail.
    outbox: listOutbox(outboxState, { candidateId: loaded.candidate.id, limit: 20 }).map(toPublicOutboxRecord),
    requirements: {
      sensitiveCategoryApproval: requiresSensitiveApproval(loaded.candidate),
      seniorApproval: requiresSeniorApproval(loaded.candidate),
    },
  };
}

function toPublicOutboxRecord(record) {
  return {
    id: record.id,
    status: record.status,
    mode: record.mode,
    candidateId: record.candidateId,
    candidateName: record.candidateName,
    to: record.to,
    subject: record.subject,
    templateId: record.templateId,
    attempts: record.attempts,
    lastError: record.lastError,
    provider: record.provider,
    providerMessageId: record.providerMessageId,
    suppressedReason: record.suppressedReason,
    prospectId: record.prospectId ?? null,
    enqueuedAt: record.enqueuedAt,
    sentAt: record.sentAt,
  };
}

async function buildStatus(config) {
  const [outbox, suppression, providerEvents] = await Promise.all([
    loadOutboxState(config),
    loadSuppressionState(config),
    loadProviderEventState(config),
  ]);

  return {
    outbox: summarizeOutbox(outbox),
    suppression: summarizeSuppression(suppression),
    providerEvents: { counters: providerEvents.counters ?? {}, lastPolledAt: providerEvents.lastPolledAt ?? null },
    recent: listOutbox(outbox, { limit: 25 }).map(toPublicOutboxRecord),
  };
}

const routes = {
  'GET /config': async (config) => ({
    status: 200,
    payload: { ok: true, config: publicOutreachConfig(config), status: await buildStatus(config) },
  }),

  'GET /templates': async () => ({ status: 200, payload: { ok: true, templates: listTemplates() } }),

  'GET /datasets': async () => ({ status: 200, payload: { ok: true, datasets: await listDossierDatasets() } }),

  'GET /status': async (config) => ({ status: 200, payload: { ok: true, status: await buildStatus(config) } }),

  'GET /candidate': async (config, _body, url) => {
    const result = await loadCandidateContext(config, {
      dataset: url.searchParams.get('dataset'),
      candidateId: url.searchParams.get('candidateId'),
    });

    return { status: result.ok ? 200 : 400, payload: result.ok ? { ok: true, ...result } : { ok: false, errors: result.errors } };
  },

  // The whole campaign, not one candidate: "what went out today" had no answer before this.
  'GET /outbox': async (config, _body, url) => {
    const state = await loadOutboxState(config);
    const status = url.searchParams.get('status') ?? '';
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);

    return {
      status: 200,
      payload: {
        ok: true,
        summary: summarizeOutbox(state),
        dailyLimit: config.dailySendLimit,
        messages: listOutbox(state, {
          status: OUTBOX_STATUSES.includes(status) ? status : undefined,
          candidateId: url.searchParams.get('candidateId') ?? undefined,
          limit: Number.isFinite(limit) ? Math.min(500, Math.max(1, limit)) : 200,
        }).map(toPublicOutboxRecord),
      },
    };
  },

  'GET /suppressions': async (config) => {
    const state = await loadSuppressionState(config);

    return {
      status: 200,
      payload: {
        ok: true,
        summary: summarizeSuppression(state),
        entries: [...(state.entries ?? [])].sort((left, right) =>
          String(right.addedAt).localeCompare(String(left.addedAt)),
        ),
      },
    };
  },

  'GET /overlay': async (config, _body, url) => {
    const state = await loadOverlayState(config.paths.candidateOverlay);

    return {
      status: 200,
      payload: { ok: true, records: listOverlayRecords(state, url.searchParams.get('dataset') ?? '') },
    };
  },

  // Hand-entered candidate. It lands in the overlay, never in the generated export, so a
  // dossier rebuild cannot erase it.
  'POST /candidates': async (config, body) => {
    const result = await createManualCandidate(config, {
      datasetId: body.dataset,
      name: body.name,
      title: body.title,
      category: body.category,
      country: body.country,
      sourceUrl: body.sourceUrl,
      note: body.note,
      operatorRef: body.actor,
    });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  // Identity attribution for a discovery channel, replacing the review:official-sources CLI
  // round-trip. It never becomes a contact route on its own.
  'POST /channels/verify': async (config, body) => {
    const result = await verifyChannel(config, {
      datasetId: body.dataset,
      candidateId: body.candidateId,
      url: body.url,
      platform: body.platform,
      label: body.label,
      evidenceNote: body.evidenceNote,
      operatorRef: body.actor,
    });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /channels/revoke': async (config, body) => {
    const result = await revokeChannelVerification(config, {
      datasetId: body.dataset,
      candidateId: body.candidateId,
      url: body.url,
      operatorRef: body.actor,
      note: body.note,
    });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /review': async (config, body) => {
    const result = await recordReviewOutcome(config, {
      datasetId: body.dataset,
      candidateId: body.candidateId,
      outcomeStatus: body.outcomeStatus,
      note: body.note,
      consentStatus: body.consentStatus,
      riskLevel: body.riskLevel,
      star: body.star,
      operatorRef: body.actor,
    });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /review/bulk': async (config, body) => {
    const result = await recordReviewOutcomes(config, {
      datasetId: body.dataset,
      candidateIds: body.candidateIds,
      outcomeStatus: body.outcomeStatus,
      note: body.note,
      consentStatus: body.consentStatus,
      riskLevel: body.riskLevel,
      star: body.star,
      operatorRef: body.actor,
    });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /preview': async (config, body) => {
    const context = await loadCandidateContext(config, body);

    if (!context.ok) {
      return { status: 400, payload: { ok: false, errors: context.errors } };
    }

    const preview = await buildPreview(config, {
      candidate: context.candidate,
      templateId: body.templateId,
      email: body.email,
    });

    return {
      status: preview.ok ? 200 : 400,
      payload: preview.ok
        ? {
            ok: true,
            template: preview.template,
            // displayMessage, never message: the claim token is a bearer credential and
            // must not reach a browser. Its bodyHash is the real one, so approving what is
            // shown still authorises exactly the bytes that will be sent.
            message: preview.displayMessage,
            preflight: preview.preflight,
          }
        : { ok: false, errors: preview.errors },
    };
  },

  'POST /verifications': async (config, body) => {
    const context = await loadCandidateContext(config, body);

    if (!context.ok) {
      return { status: 400, payload: { ok: false, errors: context.errors } };
    }

    const result = await recordVerification(config, {
      candidateId: context.candidate.id,
      candidateName: context.candidate.name,
      datasetId: body.dataset,
      email: body.email,
      routeType: 'public-business-email',
      consentBasis: 'public-business-contact',
      sourceUrl: body.sourceUrl,
      verificationMethod: body.verificationMethod,
      verificationFreshUntil: body.verificationFreshUntil,
      reviewerRef: body.reviewerRef,
      evidenceNote: body.evidenceNote,
      candidateCategory: context.candidate.category,
      candidateRiskLevel: context.candidate.riskLevel,
      candidateSensitiveFlags: context.candidate.sensitiveFlags,
    });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /verifications/revoke': async (config, body) => {
    const result = await revokeVerification(config, { id: body.id, revokedBy: body.actor, note: body.note });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /approvals': async (config, body) => {
    const context = await loadCandidateContext(config, body);

    if (!context.ok) {
      return { status: 400, payload: { ok: false, errors: context.errors } };
    }

    // Re-render rather than trusting the hash the browser sends, so an approval can only
    // ever be bound to bytes this server produced from current config and state.
    const preview = await buildPreview(config, {
      candidate: context.candidate,
      templateId: body.templateId,
      email: body.email,
    });

    if (!preview.ok) {
      return { status: 400, payload: { ok: false, errors: preview.errors } };
    }

    if (body.bodyHash && body.bodyHash !== preview.message.bodyHash) {
      return {
        status: 409,
        payload: {
          ok: false,
          errors: ['The message changed since this preview was rendered. Re-read the preview before approving.'],
        },
      };
    }

    const result = await recordApproval(
      config,
      {
        candidateId: context.candidate.id,
        candidateName: context.candidate.name,
        email: body.email,
        templateId: preview.message.templateId,
        subject: preview.message.subject,
        bodyHash: preview.message.bodyHash,
        approvedBy: body.approvedBy,
        note: body.note,
        sensitiveCategoryApprovedBy: body.sensitiveCategoryApprovedBy,
        seniorApprovalRef: body.seniorApprovalRef,
      },
      context.requirements,
    );

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /approvals/revoke': async (config, body) => {
    const result = await revokeApproval(config, { id: body.id, revokedBy: body.actor, note: body.note });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /stage': async (config, body) => {
    const context = await loadCandidateContext(config, body);

    if (!context.ok) {
      return { status: 400, payload: { ok: false, errors: context.errors } };
    }

    const result = await stageMessage(config, {
      candidate: context.candidate,
      templateId: body.templateId,
      email: body.email,
      enqueuedBy: body.actor,
    });

    return {
      status: result.ok ? 200 : 400,
      payload: result.ok
        ? { ok: true, message: toPublicOutboxRecord(result.message), preflight: result.preflight }
        : { ok: false, errors: result.errors, preflight: result.preflight ?? null },
    };
  },

  'POST /retry': async (config, body) => {
    const result = await retryFailedMessages(config, {
      messageId: body.id,
      all: body.all === true,
      actor: body.actor,
    });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /send': async (config, body) => {
    // The dashboard cannot flip the mode; live delivery still requires the environment
    // to say live AND the operator to confirm on this request.
    if (config.mode === 'live' && body.confirmLive !== true) {
      return {
        status: 400,
        payload: { ok: false, errors: ['Mode is live. Confirm live delivery explicitly before draining the queue.'] },
      };
    }

    const limit = Number.parseInt(body.limit ?? 25, 10);
    const result = await drainOutbox(config, { limit: Number.isFinite(limit) ? limit : 25 });

    return { status: 200, payload: { ok: true, ...result, status: await buildStatus(config) } };
  },

  'POST /suppressions': async (config, body) => {
    const result = await addSuppression(config, {
      kind: body.kind,
      value: body.value,
      reason: body.reason,
      note: body.note,
      candidateId: body.candidateId,
      addedBy: body.actor,
      source: 'dashboard',
    });

    return { status: result.ok ? 200 : 400, payload: result };
  },

  'POST /suppressions/revoke': async (config, body) => {
    const result = await revokeSuppression(config, { id: body.id, revokedBy: body.actor, note: body.note });

    return { status: result.ok ? 200 : 400, payload: result };
  },
};

async function main() {
  await loadLocalEnv();

  const config = loadOutreachConfig();
  const token = await resolveServerToken(process.env, { create: true });

  const server = createServer(async (request, response) => {
    let url;

    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      sendJson(response, 400, { ok: false, errors: ['Malformed request URL.'] });
      return;
    }

    if (!url.pathname.startsWith('/api/outreach')) {
      sendJson(response, 404, { ok: false, errors: ['Not found.'] });
      return;
    }

    const auth = authorize(request, token);

    if (!auth.ok) {
      sendJson(response, auth.status, { ok: false, errors: [auth.error] });
      return;
    }

    const route = `${request.method} ${url.pathname.replace('/api/outreach', '') || '/'}`;
    const handler = routes[route];

    if (!handler) {
      sendJson(response, 404, { ok: false, errors: [`No outreach route for ${route}.`] });
      return;
    }

    try {
      const body = request.method === 'GET' ? {} : await readJsonBody(request);
      // Re-read config per request so an operator can change the mode in .env.local and
      // restart nothing but this process to have it take effect on the next call.
      const result = await handler(loadOutreachConfig(), body, url);

      sendJson(response, result.status, result.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outreach request failed.';

      console.error(`[outreach] ${route} failed:`, message);
      sendJson(response, 500, { ok: false, errors: [message] });
    }
  });

  server.listen(config.serverPort, '127.0.0.1', () => {
    console.log(`[outreach] listening on http://127.0.0.1:${config.serverPort} (mode: ${config.mode})`);
    console.log('[outreach] token is injected by the Vite dev proxy; the browser never sees it.');

    if (config.issues.length > 0) {
      console.log('[outreach] blocking configuration issues:');

      for (const issue of config.issues) {
        console.log(`  - ${issue}`);
      }
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
