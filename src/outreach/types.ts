export type OutreachMode = 'off' | 'dry_run' | 'live';

export interface OutreachConfig {
  mode: OutreachMode;
  emailEnv: string;
  campaignId: string;
  fromAddress: string;
  fromName: string;
  replyToAddress: string;
  unsubscribeMailto: string;
  senderLegalName: string;
  physicalMailingAddress: string;
  requireHumanApproval: boolean;
  dailySendLimit: number;
  verificationMaxAgeDays: number;
  configurationSetConfigured: boolean;
  allowedCtaOrigins?: string[];
  providerEventQueueConfigured: boolean;
  issues: string[];
}

export interface OutboxRecord {
  id: string;
  status: 'pending' | 'sent' | 'failed' | 'suppressed';
  mode: OutreachMode;
  candidateId: string;
  candidateName: string;
  to: string;
  subject: string;
  templateId: string;
  attempts: number;
  lastError: string | null;
  provider: string | null;
  providerMessageId: string | null;
  suppressedReason: string | null;
  prospectId?: string | null;
  enqueuedAt: string;
  sentAt: string | null;
}

export interface OutreachStatus {
  outbox: {
    total: number;
    byStatus: Record<string, number>;
    sentToday: number;
    lastEnqueuedAt: string;
  };
  suppression: {
    total: number;
    active: number;
    revoked: number;
    emails: number;
    domains: number;
    byReason: Record<string, number>;
  };
  providerEvents: { counters: Record<string, number>; lastPolledAt: string | null };
  recent: OutboxRecord[];
}

export interface EmailSuggestion {
  email: string;
  type: string | null;
  role: string | null;
  label: string | null;
  sourceUrl: string | null;
  identityAttribution: string | null;
  identityConfidence: string | null;
}

export interface ContactVerification {
  id: string;
  candidateId: string;
  email: string;
  routeType: string;
  consentBasis: string;
  sourceUrl: string;
  verificationMethod: string;
  verifiedAt: string;
  verificationFreshUntil: string;
  reviewerRef: string;
  evidenceNote: string;
  revokedAt: string | null;
}

export interface MessageApproval {
  id: string;
  candidateId: string;
  email: string;
  templateId: string;
  subject: string | null;
  bodyHash: string;
  approvedBy: string;
  approvedAt: string;
  note: string;
  sensitiveCategoryApprovedBy: string | null;
  seniorApprovalRef: string | null;
  consumedAt: string | null;
  consumedByMessageId: string | null;
  revokedAt: string | null;
}

export interface CandidateContext {
  candidate: {
    id: string;
    name: string;
    category: string | null;
    status: string | null;
    consentStatus: string;
    riskLevel: string | null;
    sensitiveFlags: string[];
    topics: string[];
    datasetId: string | null;
  };
  title: string | null;
  country: string | null;
  emailCandidates: EmailSuggestion[];
  sourceUrls: string[];
  verifications: ContactVerification[];
  approvals: MessageApproval[];
  outbox: OutboxRecord[];
  requirements: { sensitiveCategoryApproval: boolean; seniorApproval: boolean };
}

export interface SuppressionEntry {
  id: string;
  kind: 'email' | 'domain';
  value: string;
  reason: string;
  source: string;
  note: string;
  candidateId: string | null;
  addedBy: string;
  addedAt: string;
  revokedAt: string | null;
  revokedBy?: string;
  revocationNote?: string;
}

export interface OutboxPage {
  summary: OutreachStatus['outbox'];
  dailyLimit: number;
  messages: OutboxRecord[];
}

export interface SuppressionPage {
  summary: OutreachStatus['suppression'];
  entries: SuppressionEntry[];
}

export interface OverlayVerifiedChannel {
  url: string;
  platform: string;
  label: string;
  evidenceNote: string;
  verifiedBy: string;
  verifiedAt: string;
}

export type ReviewOutcomeStatus = 'pending' | 'approved' | 'rejected' | 'deferred';

export interface OverlayReview {
  outcomeStatus: ReviewOutcomeStatus;
  note: string;
  consentStatus: string | null;
  riskLevel: string | null;
  star: number | null;
  reviewedBy: string;
  reviewedAt: string;
}

export interface OverlayRecord {
  id: string;
  candidateId: string;
  datasetId: string;
  manualCandidate: {
    name: string;
    title: string;
    category: string;
    country: string;
    sourceUrl: string;
    note: string;
    createdBy: string;
    createdAt: string;
  } | null;
  review: OverlayReview | null;
  verifiedChannels?: OverlayVerifiedChannel[];
  createdAt: string;
  updatedAt: string;
}

export interface PreflightNote {
  code: string;
  message: string;
}

export interface Preflight {
  ok: boolean;
  blockers: PreflightNote[];
  warnings: PreflightNote[];
  requirements: { humanApproval: boolean; sensitiveCategoryApproval: boolean; seniorApproval: boolean };
  verification: ContactVerification | null;
  approval: MessageApproval | null;
  dedupe: { key: string; existing: OutboxRecord | null };
  quota: { dailyLimit: number; sentToday: number; remaining: number };
}

export interface RenderedMessage {
  templateId: string;
  requiredReview: string[];
  /** Present on invitation messages, with the claim token masked server-side. */
  ctaUrl?: string | null;
  ctaExpiresAt?: string | null;
  prospectId?: string | null;
  requiresCta?: boolean;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  from: string;
  fromDisplay: string;
  replyTo: string;
  to: string;
  bodyHash: string;
  headers: Array<{ name: string; value: string }>;
}

export interface PreviewResult {
  template: { id: string; name: string; requiredReview: string[]; requiresCta?: boolean };
  message: RenderedMessage;
  preflight: Preflight;
}

export interface TemplateSummary {
  id: string;
  category: string;
  name: string;
  requiresCta?: boolean;
  previewText: string;
  subject: string;
  requiredReview: string[];
  bodyLength: number;
}

export interface DrainResult {
  processed: number;
  results: Array<{
    id: string;
    to?: string;
    outcome: 'sent' | 'suppressed' | 'failed' | 'retry' | 'skipped';
    reason?: string;
    providerMessageId?: string | null;
  }>;
  status: OutreachStatus;
}
