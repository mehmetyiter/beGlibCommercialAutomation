export type CandidateCategory =
  | 'science'
  | 'arts'
  | 'youtube'
  | 'podcast'
  | 'thought-leadership'
  | 'religion'
  | 'psychology'
  | 'therapy'
  | 'medicine'
  | 'academia'
  | 'journalism'
  | 'education'
  | 'technology';

export type CandidateStatus =
  | 'researching'
  | 'needs-review'
  | 'approved'
  | 'contacted'
  | 'responded'
  | 'do-not-contact';

export type ConsentStatus =
  | 'unknown'
  | 'public-business-contact'
  | 'representative-contact'
  | 'contact-form-only'
  | 'opted-out'
  | 'not-allowed';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ChannelPlatform =
  | 'website'
  | 'youtube'
  | 'x'
  | 'instagram'
  | 'tiktok'
  | 'linkedin'
  | 'podcast'
  | 'newsletter'
  | 'wikipedia'
  | 'orcid'
  | 'openalex';

export interface TaxonomyNode {
  slug: CandidateCategory;
  label: string;
  description: string;
  subcategories: string[];
}

export interface SocialChannel {
  platform: ChannelPlatform;
  label: string;
  url: string;
  verified: boolean;
}

export interface ContactRoute {
  type:
    | 'public-business-email'
    | 'representative-email'
    | 'contact-form'
    | 'social-dm'
    | 'none';
  value: string;
  sourceUrl: string;
  verifiedAt: string;
}

export type StarRating = 1 | 2 | 3 | 4 | 5;

export interface InfluenceSignals {
  hasPodcast?: boolean;
  hasYoutubeShow?: boolean;
  xFollowers?: number;
  instagramFollowers?: number;
  linkedinFollowers?: number;
  tiktokFollowers?: number;
  youtubeSubscribers?: number;
  newsletterSubscribers?: number;
  activePlatforms?: ChannelPlatform[];
  notableSignals?: string[];
}

export interface Candidate {
  id: string;
  name: string;
  title: string;
  country: string;
  languages: string[];
  primaryCategory: CandidateCategory;
  subcategories: string[];
  fitScore: number;
  reachScore: number;
  status: CandidateStatus;
  consentStatus: ConsentStatus;
  riskLevel: RiskLevel;
  channels: SocialChannel[];
  contactRoutes: ContactRoute[];
  sourceUrls: string[];
  lastVerifiedAt: string;
  rationale: string;
  influenceSignals?: InfluenceSignals;
}

// ComplianceAssessment and StarAssessment lived here for `src/lib/compliance.ts` and
// `src/lib/starRating.ts`, deleted 2026-08-08. Both rule sets now have exactly one
// implementation each, server-side: the send gates in scripts/lib/outreach-policy.mjs and the
// discovery stars in scripts/build-candidate-discovery-dossiers.mjs.

export interface FaqItem {
  id: string;
  topic: string;
  likelyQuestion: string;
  answerDraft: string;
  owner: 'ai-draft' | 'human-review' | 'legal-review';
}

// Outreach templates live in scripts/lib/outreach-mail.mjs, which is the single source the
// local outreach server renders from. Keeping a second copy here risked the two drifting
// apart and a stale template reaching a real candidate.

export type ReplyClass =
  | 'interested'
  | 'more-info'
  | 'compensation'
  | 'rights'
  | 'privacy'
  | 'meeting'
  | 'representative'
  | 'not-interested'
  | 'unsubscribe'
  | 'complaint';

export interface ReplyExample {
  id: string;
  candidateId: string;
  fromLabel: string;
  receivedAt: string;
  excerpt: string;
  replyClass: ReplyClass;
  confidence: number;
  recommendedOwner: 'ai-draft' | 'human-review' | 'legal-review';
  recommendedAction: string;
}

export interface ResearchBatch {
  batchId: string;
  createdAt: string;
  sourceLabel: string;
  researcher: string;
  notes: string;
  candidates: Candidate[];
}

export type OfficialSourceOutcomeStatus =
  | 'pending'
  | 'verified-route'
  | 'profile-only'
  | 'needs-more-review'
  | 'rejected'
  | 'do-not-contact';

export type OfficialSourceSuppressionStatus =
  | 'unknown'
  | 'clear'
  | 'do-not-contact'
  | 'opted-out'
  | 'not-allowed';

export type OfficialSourceSensitiveReviewStatus =
  | 'pending'
  | 'not-required'
  | 'approved'
  | 'rejected'
  | 'legal-review-required';

export interface OfficialSourceReviewOutcome {
  candidateId: string;
  outcomeStatus: OfficialSourceOutcomeStatus;
  officialProfileUrl: string;
  officialContactRouteType: ContactRoute['type'] | '';
  officialContactRouteValue: string;
  contactRouteSourceUrl: string;
  verifiedAt: string;
  jurisdiction: string;
  suppressionStatus: OfficialSourceSuppressionStatus;
  sensitiveCategoryReviewStatus: OfficialSourceSensitiveReviewStatus;
  reviewerNotes: string;
}

export interface OfficialSourceApplySummary {
  outcomesRead: number;
  updated: number;
  routesAdded: number;
  profileOnly: number;
  suppressed: number;
  skipped: number;
}

export interface OfficialSourceApplyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: OfficialSourceApplySummary;
  updatedCandidates: Candidate[];
}

export type CreatorSignalOutcomeStatus =
  | 'pending'
  | 'verified-signals'
  | 'profile-only'
  | 'needs-more-review'
  | 'rejected';

export interface CreatorSignalReviewOutcome {
  candidateId: string;
  outcomeStatus: CreatorSignalOutcomeStatus;
  verifiedAt: string;
  channels: SocialChannel[];
  influenceSignals: InfluenceSignals;
  sourceUrls: string[];
  reviewerNotes: string;
}

export interface CreatorSignalApplySummary {
  outcomesRead: number;
  updated: number;
  channelsAdded: number;
  signalFieldsUpdated: number;
  skipped: number;
}

export interface CreatorSignalApplyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: CreatorSignalApplySummary;
  updatedCandidates: Candidate[];
}

// The browser-side vault (`src/lib/localVault.ts`) and its audit events were deleted
// 2026-08-08. Operator records now live in data/candidate-overlay.local.json and every
// mutation is appended to the audit log at data/outreach-audit.local.jsonl, server-side.
//
// VerificationTask and friends belonged to `src/lib/verificationQueue.ts`, also deleted: the
// work queue is now derived from real overlay state in the dashboard rather than synthesised
// from candidate records.

export interface DiscoveryStarAssessment {
  stars: StarRating;
  score: number;
  label: string;
  reasons: string[];
  missingSignals: string[];
  note: string;
}

export interface DiscoveryDossierCounts {
  discoveryChannels: number;
  contactCandidates: number;
  publicEmailCandidates: number;
  contactPageCandidates: number;
  creatorSuggestions: number;
  affiliations: number;
  searchTargets: number;
  sourcePackages: number;
  quarantinedChannels: number;
  quarantinedContactCandidates: number;
}

export interface DiscoveryChannelCandidate {
  source: string;
  platform: string;
  label: string;
  url: string;
  verified: boolean;
  confidence: string;
  role?: string;
  identityAttribution?: string;
  identityScore?: number;
  identityConfidence?: string;
  identityEvidence?: string[];
  eligibleForReview?: boolean;
}

export interface DiscoveryContactCandidate {
  source: string;
  type: 'public-email-candidate' | 'contact-page-candidate' | string;
  value: string;
  sourceUrl: string;
  sourceApiUrl?: string;
  label?: string;
  reason?: string;
  role?: string;
  linkText?: string;
  contextText?: string;
  identityAttribution?: string;
  identityScore?: number;
  identityConfidence?: string;
  identityEvidence?: string[];
  eligibleForReview?: boolean;
  verified: boolean;
  reviewerNote?: string;
}

export interface CandidateDiscoveryDossier {
  candidateId: string;
  name: string;
  title: string;
  category: CandidateCategory;
  subcategories: string[];
  country: string;
  fitScore: number;
  reachScore: number;
  status: CandidateStatus;
  consentStatus: ConsentStatus;
  riskLevel: RiskLevel;
  sensitiveFlags: string[];
  discoveryStar: DiscoveryStarAssessment;
  counts: DiscoveryDossierCounts;
  discoveryChannels: DiscoveryChannelCandidate[];
  contactCandidates: DiscoveryContactCandidate[];
  quarantinedChannels: DiscoveryChannelCandidate[];
  quarantinedContactCandidates: DiscoveryContactCandidate[];
  affiliations: Array<Record<string, string>>;
  searchTargets: string[];
  sourceUrls: string[];
}

export interface CandidateDiscoveryDossierSummary {
  candidates: number;
  discoveryPackages: number;
  dossiersWithAnyDiscovery: number;
  channelCandidates: number;
  contactCandidates: number;
  publicEmailCandidates: number;
  contactPageCandidates: number;
  candidatesWithPublicEmail: number;
  candidatesWithContactCandidate: number;
  quarantinedChannelCandidates: number;
  quarantinedContactCandidates: number;
  creatorSuggestions: number;
  affiliations: number;
  sensitiveReviewRequired: number;
  discoveryStars: {
    one: number;
    two: number;
    three: number;
    four: number;
    five: number;
  };
  parseFailures: number;
}

export interface CandidateDiscoveryDossierPackage {
  reviewId: string;
  createdAt: string;
  sourceBatchId: string | null;
  sourceLabel: string | null;
  sourceFile: string;
  mode: 'candidate-discovery-dossiers';
  qualityVersion?: string;
  summary: CandidateDiscoveryDossierSummary;
  dossiers: CandidateDiscoveryDossier[];
}
