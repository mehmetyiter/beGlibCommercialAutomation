import type {
  CandidateContext,
  DrainResult,
  OutboxPage,
  OutreachConfig,
  OutreachStatus,
  OverlayRecord,
  PreviewResult,
  ReviewOutcomeStatus,
  SuppressionPage,
  TemplateSummary,
} from './types';

/**
 * Every call goes through the Vite dev proxy, which injects the outreach server token
 * server-side. The browser never holds a credential, so there is nothing to leak here.
 */
export class OutreachApiError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors[0] ?? 'Outreach request failed.');
    this.name = 'OutreachApiError';
    this.errors = errors;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`/api/outreach${path}`, {
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new OutreachApiError([
      'Local outreach server is unreachable. Start it with "npm run outreach:server" in a second terminal.',
    ]);
  }

  // The Vite proxy answers with a gateway error (not JSON) when the outreach server is
  // down, which is the common case worth naming precisely.
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new OutreachApiError([
      'Local outreach server is not running. Start it with "npm run outreach:server" in a second terminal.',
    ]);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new OutreachApiError([`Outreach server returned a non-JSON response (${response.status}).`]);
  }

  const body = payload as { ok?: boolean; errors?: string[] } & Record<string, unknown>;

  if (!response.ok || body.ok === false) {
    throw new OutreachApiError(body.errors ?? [`Outreach request failed with status ${response.status}.`]);
  }

  return body as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function fetchOutreachConfig() {
  return request<{ config: OutreachConfig; status: OutreachStatus }>('/config');
}

export function fetchOutreachStatus() {
  return request<{ status: OutreachStatus }>('/status');
}

export function fetchTemplates() {
  return request<{ templates: TemplateSummary[] }>('/templates');
}

export function fetchCandidateContext(dataset: string, candidateId: string) {
  return request<CandidateContext>(
    `/candidate?dataset=${encodeURIComponent(dataset)}&candidateId=${encodeURIComponent(candidateId)}`,
  );
}

export function fetchOutbox(input: { status?: string; limit?: number } = {}) {
  const params = new URLSearchParams();

  if (input.status) {
    params.set('status', input.status);
  }

  if (input.limit) {
    params.set('limit', String(input.limit));
  }

  const query = params.toString();

  return request<OutboxPage>(`/outbox${query ? `?${query}` : ''}`);
}

export function fetchSuppressions() {
  return request<SuppressionPage>('/suppressions');
}

export function revokeSuppression(input: { id: string; actor: string; note?: string }) {
  return post<{ entry: unknown }>('/suppressions/revoke', input);
}

/** Identity attribution for a discovery channel. Never a contact route on its own. */
export function verifyChannel(input: {
  dataset: string;
  candidateId: string;
  url: string;
  platform?: string;
  label?: string;
  evidenceNote: string;
  actor: string;
}) {
  return post<{ verification: unknown }>('/channels/verify', input);
}

export function revokeChannelVerification(input: {
  dataset: string;
  candidateId: string;
  url: string;
  actor: string;
  note?: string;
}) {
  return post<Record<string, never>>('/channels/revoke', input);
}

export function fetchOverlayRecords(dataset: string) {
  return request<{ records: OverlayRecord[] }>(`/overlay?dataset=${encodeURIComponent(dataset)}`);
}

/**
 * Hand-entered candidate. It is stored in the operator overlay, not in the generated
 * dossier export, so rebuilding the pool cannot erase it.
 */
export function createManualCandidate(input: {
  dataset: string;
  name: string;
  title?: string;
  category: string;
  country: string;
  sourceUrl: string;
  note?: string;
  actor: string;
}) {
  return post<{ record: OverlayRecord }>('/candidates', input);
}

export function recordReviewOutcome(input: {
  dataset: string;
  candidateId: string;
  outcomeStatus: ReviewOutcomeStatus;
  note?: string;
  consentStatus?: string;
  riskLevel?: string;
  star?: number | '';
  actor: string;
}) {
  return post<{ record: OverlayRecord }>('/review', input);
}

/** One decision across a selection, written server-side under a single lock. */
export function recordBulkReviewOutcome(input: {
  dataset: string;
  candidateIds: string[];
  outcomeStatus: ReviewOutcomeStatus;
  note?: string;
  consentStatus?: string;
  riskLevel?: string;
  star?: number | '';
  actor: string;
}) {
  return post<{ updated: number; candidateIds: string[] }>('/review/bulk', input);
}

export function fetchPreview(input: { dataset: string; candidateId: string; email: string; templateId?: string }) {
  return post<PreviewResult>('/preview', input);
}

export function recordVerification(input: {
  dataset: string;
  candidateId: string;
  email: string;
  sourceUrl: string;
  verificationMethod: string;
  verificationFreshUntil: string;
  reviewerRef: string;
  evidenceNote: string;
}) {
  return post<{ verification: unknown }>('/verifications', input);
}

export function revokeVerification(input: { id: string; actor: string; note?: string }) {
  return post<{ verification: unknown }>('/verifications/revoke', input);
}

export function recordApproval(input: {
  dataset: string;
  candidateId: string;
  email: string;
  templateId: string;
  bodyHash: string;
  approvedBy: string;
  note?: string;
  sensitiveCategoryApprovedBy?: string;
  seniorApprovalRef?: string;
}) {
  return post<{ approval: unknown }>('/approvals', input);
}

export function stageMessage(input: {
  dataset: string;
  candidateId: string;
  email: string;
  templateId: string;
  actor: string;
}) {
  return post<{ message: unknown }>('/stage', input);
}

export function drainQueue(input: { confirmLive: boolean; limit?: number }) {
  return post<DrainResult>('/send', input);
}

export function retryFailed(input: { id?: string; all?: boolean; actor: string }) {
  return post<{ requeued: number; results: Array<{ id: string; to: string; outcome: string; reasons?: string[] }> }>(
    '/retry',
    input,
  );
}

export function addSuppression(input: {
  kind: 'email' | 'domain';
  value: string;
  reason: string;
  actor: string;
  note?: string;
  candidateId?: string;
}) {
  return post<{ created: boolean; entry: unknown }>('/suppressions', input);
}
