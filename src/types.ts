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

export interface ComplianceAssessment {
  sendable: boolean;
  label: string;
  severity: RiskLevel;
  blockers: string[];
  requiredActions: string[];
}

export interface StarAssessment {
  stars: StarRating;
  score: number;
  label: string;
  reasons: string[];
  missingSignals: string[];
}

export interface FaqItem {
  id: string;
  topic: string;
  likelyQuestion: string;
  answerDraft: string;
  owner: 'ai-draft' | 'human-review' | 'legal-review';
}

export interface OutreachTemplate {
  id: string;
  category: CandidateCategory | 'default';
  name: string;
  subject: string;
  previewText: string;
  body: string;
  requiredReview: Array<'brand' | 'legal' | 'privacy' | 'commercial' | 'sensitive-category'>;
}

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

export type AuditEventType =
  | 'vault_initialized'
  | 'batch_imported'
  | 'discovery_dossier_imported'
  | 'candidate_selected'
  | 'vault_reset'
  | 'validation_failed';

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  createdAt: string;
  actor: 'system' | 'human';
  summary: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface VaultState {
  candidates: Candidate[];
  discoveryDossierPackage?: CandidateDiscoveryDossierPackage;
  auditEvents: AuditEvent[];
  updatedAt: string;
}

export type VerificationPriority = 'urgent' | 'high' | 'medium' | 'low';

export type VerificationTaskType =
  | 'official-profile'
  | 'contact-route'
  | 'identity-match'
  | 'jurisdiction'
  | 'suppression'
  | 'sensitive-category';

export interface VerificationTask {
  id: string;
  candidateId: string;
  candidateName: string;
  priority: VerificationPriority;
  type: VerificationTaskType;
  summary: string;
  sourceHints: string[];
  blockers: string[];
}

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
