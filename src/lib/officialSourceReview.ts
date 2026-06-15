import type {
  Candidate,
  ContactRoute,
  OfficialSourceApplyResult,
  OfficialSourceApplySummary,
  OfficialSourceOutcomeStatus,
  OfficialSourceReviewOutcome,
  OfficialSourceSensitiveReviewStatus,
  OfficialSourceSuppressionStatus,
  SocialChannel,
} from '../types';

type ApprovedContactRouteType = Extract<
  ContactRoute['type'],
  'public-business-email' | 'representative-email' | 'contact-form'
>;

const allowedRouteTypes = new Set<ApprovedContactRouteType>([
  'public-business-email',
  'representative-email',
  'contact-form',
]);
const outcomeStatuses = new Set<OfficialSourceOutcomeStatus>([
  'pending',
  'verified-route',
  'profile-only',
  'needs-more-review',
  'rejected',
  'do-not-contact',
]);
const suppressionStatuses = new Set<OfficialSourceSuppressionStatus>([
  'unknown',
  'clear',
  'do-not-contact',
  'opted-out',
  'not-allowed',
]);
const sensitiveReviewStatuses = new Set<OfficialSourceSensitiveReviewStatus>([
  'pending',
  'not-required',
  'approved',
  'rejected',
  'legal-review-required',
]);
const consumerEmailDomains = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'proton.me',
]);

export function applyOfficialSourceReviewToCandidates(
  candidates: Candidate[],
  rawReview: unknown,
): OfficialSourceApplyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const updatesById = new Map<string, Candidate>();
  const outcomes = collectOutcomes(rawReview);
  const summary: OfficialSourceApplySummary = {
    outcomesRead: outcomes.length,
    updated: 0,
    routesAdded: 0,
    profileOnly: 0,
    suppressed: 0,
    skipped: 0,
  };

  outcomes.forEach((rawOutcome, index) => {
    const prefix = `outcomes[${index}]`;
    const outcome = normalizeOutcome(rawOutcome);

    if (!outcome.candidateId) {
      errors.push(`${prefix}.candidateId is required.`);
      return;
    }

    const candidate = candidatesById.get(outcome.candidateId);
    if (!candidate) {
      errors.push(`${prefix}.candidateId does not match the local vault: ${outcome.candidateId}`);
      return;
    }

    const outcomeErrors = validateOutcome(outcome, candidate, prefix);
    if (outcomeErrors.length > 0) {
      errors.push(...outcomeErrors);
      return;
    }

    if (['pending', 'needs-more-review', 'rejected'].includes(outcome.outcomeStatus)) {
      summary.skipped += 1;
      return;
    }

    const current = updatesById.get(candidate.id) ?? cloneCandidate(candidate);
    updatesById.set(candidate.id, current);

    if (outcome.outcomeStatus === 'do-not-contact') {
      applySuppression(current, outcome);
      summary.suppressed += 1;
      return;
    }

    applyOfficialProfile(current, outcome);

    if (outcome.outcomeStatus === 'profile-only') {
      summary.profileOnly += 1;
      return;
    }

    applyContactRoute(current, outcome);
    summary.routesAdded += 1;

    const domain = outcome.officialContactRouteValue.split('@').pop()?.toLowerCase() ?? '';
    if (outcome.officialContactRouteType === 'public-business-email' && consumerEmailDomains.has(domain)) {
      warnings.push(`${prefix} uses a consumer email domain; keep reviewer evidence and prefer representative routes when possible.`);
    }
  });

  const updatedCandidates = Array.from(updatesById.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  summary.updated = updatedCandidates.length;

  if (updatedCandidates.length === 0 && errors.length === 0) {
    errors.push('No completed official-source outcomes were available to apply.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary,
    updatedCandidates,
  };
}

function collectOutcomes(rawReview: unknown): unknown[] {
  if (!isRecord(rawReview)) {
    return [];
  }

  if (Array.isArray(rawReview.outcomes)) {
    return rawReview.outcomes;
  }

  if (Array.isArray(rawReview.items)) {
    return rawReview.items
      .map((item) => (isRecord(item) ? item.reviewOutcome : undefined))
      .filter((outcome) => typeof outcome !== 'undefined');
  }

  return [];
}

function normalizeOutcome(rawOutcome: unknown): OfficialSourceReviewOutcome {
  const outcome = isRecord(rawOutcome) ? rawOutcome : {};

  return {
    candidateId: stringValue(outcome.candidateId),
    outcomeStatus: (stringValue(outcome.outcomeStatus ?? outcome.status) || 'pending') as OfficialSourceOutcomeStatus,
    officialProfileUrl: stringValue(outcome.officialProfileUrl),
    officialContactRouteType: stringValue(outcome.officialContactRouteType) as ContactRoute['type'] | '',
    officialContactRouteValue: stringValue(outcome.officialContactRouteValue),
    contactRouteSourceUrl: stringValue(outcome.contactRouteSourceUrl),
    verifiedAt: stringValue(outcome.verifiedAt),
    jurisdiction: stringValue(outcome.jurisdiction),
    suppressionStatus: (stringValue(outcome.suppressionStatus) || 'unknown') as OfficialSourceSuppressionStatus,
    sensitiveCategoryReviewStatus: (stringValue(outcome.sensitiveCategoryReviewStatus) ||
      'pending') as OfficialSourceSensitiveReviewStatus,
    reviewerNotes: stringValue(outcome.reviewerNotes),
  };
}

function validateOutcome(
  outcome: OfficialSourceReviewOutcome,
  candidate: Candidate,
  prefix: string,
) {
  const errors: string[] = [];

  if (!outcomeStatuses.has(outcome.outcomeStatus)) {
    errors.push(`${prefix}.outcomeStatus is not supported.`);
  }

  if (!suppressionStatuses.has(outcome.suppressionStatus)) {
    errors.push(`${prefix}.suppressionStatus is not supported.`);
  }

  if (!sensitiveReviewStatuses.has(outcome.sensitiveCategoryReviewStatus)) {
    errors.push(`${prefix}.sensitiveCategoryReviewStatus is not supported.`);
  }

  if (['pending', 'needs-more-review', 'rejected'].includes(outcome.outcomeStatus)) {
    return errors;
  }

  if (outcome.outcomeStatus === 'do-not-contact') {
    if (!['do-not-contact', 'opted-out', 'not-allowed'].includes(outcome.suppressionStatus)) {
      errors.push(`${prefix}.suppressionStatus must confirm suppression for do-not-contact outcomes.`);
    }
    return errors;
  }

  if (!isValidUrl(outcome.officialProfileUrl)) {
    errors.push(`${prefix}.officialProfileUrl must be a valid official URL.`);
  }

  if (!isIsoDate(outcome.verifiedAt)) {
    errors.push(`${prefix}.verifiedAt must be an ISO date string like 2026-06-15.`);
  }

  if (outcome.jurisdiction.length < 2) {
    errors.push(`${prefix}.jurisdiction is required.`);
  }

  if (outcome.suppressionStatus !== 'clear') {
    errors.push(`${prefix}.suppressionStatus must be clear before applying evidence.`);
  }

  if (isSensitive(candidate) && outcome.sensitiveCategoryReviewStatus === 'rejected') {
    errors.push(`${prefix}.sensitiveCategoryReviewStatus cannot be rejected for an applied update.`);
  }

  if (outcome.outcomeStatus === 'profile-only') {
    return errors;
  }

  if (!isAllowedRouteType(outcome.officialContactRouteType)) {
    errors.push(`${prefix}.officialContactRouteType is not an approved route type.`);
  }

  if (!isValidUrl(outcome.contactRouteSourceUrl)) {
    errors.push(`${prefix}.contactRouteSourceUrl must be a valid official URL.`);
  }

  if (outcome.officialContactRouteType === 'contact-form') {
    if (!isValidUrl(outcome.officialContactRouteValue)) {
      errors.push(`${prefix}.officialContactRouteValue must be a valid URL for contact forms.`);
    }
  } else if (!isValidEmail(outcome.officialContactRouteValue)) {
    errors.push(`${prefix}.officialContactRouteValue must be a valid email address.`);
  }

  if (looksGuessed(outcome.officialContactRouteValue)) {
    errors.push(`${prefix}.officialContactRouteValue looks like a guessed pattern.`);
  }

  return errors;
}

function applyOfficialProfile(candidate: Candidate, outcome: OfficialSourceReviewOutcome) {
  candidate.country = outcome.jurisdiction;
  candidate.status = candidate.status === 'researching' ? 'needs-review' : candidate.status;
  candidate.lastVerifiedAt = outcome.verifiedAt;
  candidate.sourceUrls = unique([
    ...candidate.sourceUrls,
    outcome.officialProfileUrl,
    outcome.contactRouteSourceUrl,
  ]);
  candidate.channels = upsertChannel(candidate.channels, {
    platform: 'website',
    label: 'Official profile',
    url: outcome.officialProfileUrl,
    verified: true,
  });
  candidate.rationale = appendRationale(candidate.rationale, outcome);
}

function applyContactRoute(candidate: Candidate, outcome: OfficialSourceReviewOutcome) {
  if (!isAllowedRouteType(outcome.officialContactRouteType)) {
    return;
  }

  const route: ContactRoute = {
    type: outcome.officialContactRouteType,
    value: outcome.officialContactRouteValue,
    sourceUrl: outcome.contactRouteSourceUrl,
    verifiedAt: outcome.verifiedAt,
  };
  const existingRoutes = candidate.contactRoutes.filter((candidateRoute) => candidateRoute.type !== 'none');

  candidate.contactRoutes = upsertRoute(existingRoutes, route);
  candidate.consentStatus = consentStatusForRoute(route.type);
}

function applySuppression(candidate: Candidate, outcome: OfficialSourceReviewOutcome) {
  candidate.status = 'do-not-contact';
  candidate.consentStatus = outcome.suppressionStatus === 'opted-out' ? 'opted-out' : 'not-allowed';
  candidate.lastVerifiedAt = outcome.verifiedAt || new Date().toISOString().slice(0, 10);
  candidate.contactRoutes = [
    {
      type: 'none',
      value: 'Suppression status verified by official-source review',
      sourceUrl: candidate.sourceUrls[0],
      verifiedAt: candidate.lastVerifiedAt,
    },
  ];
  candidate.rationale = `${candidate.rationale} Official-source review marked suppression status: ${outcome.suppressionStatus}.`;
}

function upsertChannel(channels: SocialChannel[], nextChannel: SocialChannel) {
  return [...channels.filter((channel) => channel.url !== nextChannel.url), nextChannel];
}

function upsertRoute(routes: ContactRoute[], nextRoute: ContactRoute) {
  return [
    ...routes.filter(
      (route) =>
        !(
          route.type === nextRoute.type &&
          route.value.toLowerCase() === nextRoute.value.toLowerCase() &&
          route.sourceUrl === nextRoute.sourceUrl
        ),
    ),
    nextRoute,
  ];
}

function consentStatusForRoute(routeType: ContactRoute['type']) {
  if (routeType === 'representative-email') {
    return 'representative-contact';
  }

  if (routeType === 'contact-form') {
    return 'contact-form-only';
  }

  return 'public-business-contact';
}

function isAllowedRouteType(routeType: ContactRoute['type'] | ''): routeType is ApprovedContactRouteType {
  return allowedRouteTypes.has(routeType as ApprovedContactRouteType);
}

function appendRationale(rationale: string, outcome: OfficialSourceReviewOutcome) {
  const reviewerNote = outcome.reviewerNotes ? ` Reviewer note: ${outcome.reviewerNotes}` : '';
  return `${rationale} Official-source review on ${outcome.verifiedAt} verified ${outcome.officialProfileUrl}.${reviewerNote}`;
}

function cloneCandidate(candidate: Candidate): Candidate {
  return {
    ...candidate,
    languages: [...candidate.languages],
    subcategories: [...candidate.subcategories],
    channels: candidate.channels.map((channel) => ({ ...channel })),
    contactRoutes: candidate.contactRoutes.map((route) => ({ ...route })),
    sourceUrls: [...candidate.sourceUrls],
    influenceSignals: candidate.influenceSignals
      ? {
          ...candidate.influenceSignals,
          activePlatforms: candidate.influenceSignals.activePlatforms
            ? [...candidate.influenceSignals.activePlatforms]
            : undefined,
          notableSignals: candidate.influenceSignals.notableSignals
            ? [...candidate.influenceSignals.notableSignals]
            : undefined,
        }
      : undefined,
  };
}

function isSensitive(candidate: Candidate) {
  return ['religion', 'psychology', 'therapy', 'medicine'].includes(candidate.primaryCategory) || candidate.riskLevel === 'high';
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function looksGuessed(value: string) {
  return /[{]|\bfirst[._-]?last\b|\blast[._-]?first\b|\bfname\b|\blname\b/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
