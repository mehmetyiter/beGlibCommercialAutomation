import type {
  Candidate,
  ChannelPlatform,
  CreatorSignalApplyResult,
  CreatorSignalApplySummary,
  CreatorSignalOutcomeStatus,
  CreatorSignalReviewOutcome,
  InfluenceSignals,
  SocialChannel,
} from '../types';

const creatorPlatforms = new Set<ChannelPlatform>([
  'youtube',
  'podcast',
  'x',
  'instagram',
  'tiktok',
  'linkedin',
  'newsletter',
]);
const outcomeStatuses = new Set<CreatorSignalOutcomeStatus>([
  'pending',
  'verified-signals',
  'profile-only',
  'needs-more-review',
  'rejected',
]);
const countFields = [
  'xFollowers',
  'instagramFollowers',
  'linkedinFollowers',
  'tiktokFollowers',
  'youtubeSubscribers',
  'newsletterSubscribers',
] as const;

export function applyCreatorSignalReviewToCandidates(
  candidates: Candidate[],
  rawReview: unknown,
): CreatorSignalApplyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const updatesById = new Map<string, Candidate>();
  const outcomes = collectOutcomes(rawReview);
  const summary: CreatorSignalApplySummary = {
    outcomesRead: outcomes.length,
    updated: 0,
    channelsAdded: 0,
    signalFieldsUpdated: 0,
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

    const outcomeErrors = validateOutcome(outcome, prefix);
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

    const channelResult = applyChannels(current, outcome);
    const signalResult = applySignals(current, outcome);
    summary.channelsAdded += channelResult.added;
    summary.signalFieldsUpdated += signalResult.updated;
    current.lastVerifiedAt = outcome.verifiedAt;
    current.status = current.status === 'researching' ? 'needs-review' : current.status;
    current.sourceUrls = unique([
      ...current.sourceUrls,
      ...outcome.sourceUrls,
      ...outcome.channels.map((channel) => channel.url),
    ]);
    current.rationale = appendRationale(current.rationale, outcome, channelResult.added, signalResult.updated);

    if (outcome.outcomeStatus === 'profile-only') {
      warnings.push(`${prefix} applied profile-only creator evidence; no audience counts were required.`);
    }
  });

  const updatedCandidates = Array.from(updatesById.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  summary.updated = updatedCandidates.length;

  if (updatedCandidates.length === 0 && errors.length === 0) {
    errors.push('No completed creator-signal outcomes were available to apply.');
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

function normalizeOutcome(rawOutcome: unknown): CreatorSignalReviewOutcome {
  const outcome = isRecord(rawOutcome) ? rawOutcome : {};
  const influenceSignals = isRecord(outcome.influenceSignals) ? outcome.influenceSignals : {};

  return {
    candidateId: stringValue(outcome.candidateId),
    outcomeStatus: (stringValue(outcome.outcomeStatus ?? outcome.status) || 'pending') as CreatorSignalOutcomeStatus,
    verifiedAt: stringValue(outcome.verifiedAt),
    channels: Array.isArray(outcome.channels) ? outcome.channels.map(normalizeChannel) : [],
    influenceSignals: normalizeInfluenceSignals(influenceSignals),
    sourceUrls: Array.isArray(outcome.sourceUrls) ? outcome.sourceUrls.map(stringValue).filter(Boolean) : [],
    reviewerNotes: stringValue(outcome.reviewerNotes),
  };
}

function normalizeChannel(rawChannel: unknown): SocialChannel {
  const channel = isRecord(rawChannel) ? rawChannel : {};

  return {
    platform: stringValue(channel.platform) as ChannelPlatform,
    label: stringValue(channel.label),
    url: stringValue(channel.url),
    verified: Boolean(channel.verified),
  };
}

function normalizeInfluenceSignals(rawSignals: Record<string, unknown>): InfluenceSignals {
  const normalized: InfluenceSignals = {
    hasPodcast: Boolean(rawSignals.hasPodcast),
    hasYoutubeShow: Boolean(rawSignals.hasYoutubeShow),
    activePlatforms: Array.isArray(rawSignals.activePlatforms)
      ? rawSignals.activePlatforms.map((platform) => stringValue(platform) as ChannelPlatform).filter(Boolean)
      : [],
    notableSignals: Array.isArray(rawSignals.notableSignals)
      ? rawSignals.notableSignals.map(stringValue).filter(Boolean)
      : [],
  };

  countFields.forEach((field) => {
    const value = rawSignals[field];
    if (typeof value !== 'undefined' && value !== '') {
      normalized[field] = Number(value);
    }
  });

  return normalized;
}

function validateOutcome(outcome: CreatorSignalReviewOutcome, prefix: string) {
  const errors: string[] = [];

  if (!outcomeStatuses.has(outcome.outcomeStatus)) {
    errors.push(`${prefix}.outcomeStatus is not supported.`);
  }

  if (['pending', 'needs-more-review', 'rejected'].includes(outcome.outcomeStatus)) {
    return errors;
  }

  if (!isIsoDate(outcome.verifiedAt)) {
    errors.push(`${prefix}.verifiedAt must be an ISO date string like 2026-06-15.`);
  }

  outcome.channels.forEach((channel, channelIndex) => {
    const channelPrefix = `${prefix}.channels[${channelIndex}]`;

    if (!creatorPlatforms.has(channel.platform)) {
      errors.push(`${channelPrefix}.platform is not a supported creator platform.`);
    }

    if (channel.label.length < 2) {
      errors.push(`${channelPrefix}.label is required.`);
    }

    if (!isValidUrl(channel.url)) {
      errors.push(`${channelPrefix}.url must be a valid public URL.`);
    }

    if (!channel.verified) {
      errors.push(`${channelPrefix}.verified must be true before applying creator signals.`);
    }
  });

  outcome.sourceUrls.forEach((sourceUrl, sourceIndex) => {
    if (!isValidUrl(sourceUrl)) {
      errors.push(`${prefix}.sourceUrls[${sourceIndex}] must be a valid URL.`);
    }
  });

  countFields.forEach((field) => {
    const value = outcome.influenceSignals[field];
    if (typeof value !== 'undefined' && (!Number.isFinite(value) || value < 0)) {
      errors.push(`${prefix}.influenceSignals.${field} must be a non-negative number.`);
    }
  });

  outcome.influenceSignals.activePlatforms?.forEach((platform) => {
    if (!creatorPlatforms.has(platform)) {
      errors.push(`${prefix}.influenceSignals.activePlatforms includes unsupported platform ${platform}.`);
    }
  });

  if (
    outcome.outcomeStatus === 'verified-signals' &&
    outcome.channels.length === 0 &&
    (outcome.influenceSignals.activePlatforms?.length ?? 0) === 0
  ) {
    errors.push(`${prefix} must include at least one verified channel or active platform.`);
  }

  return errors;
}

function applyChannels(candidate: Candidate, outcome: CreatorSignalReviewOutcome) {
  let added = 0;
  const nextChannelsByUrl = new Map(candidate.channels.map((channel) => [channel.url, channel]));

  outcome.channels.forEach((channel) => {
    if (!nextChannelsByUrl.has(channel.url)) {
      added += 1;
    }

    nextChannelsByUrl.set(channel.url, {
      ...nextChannelsByUrl.get(channel.url),
      ...channel,
      verified: true,
    });
  });

  candidate.channels = Array.from(nextChannelsByUrl.values());
  return { added };
}

function applySignals(candidate: Candidate, outcome: CreatorSignalReviewOutcome) {
  let updated = 0;
  const existing = candidate.influenceSignals ?? {};
  const activePlatforms = unique([
    ...(existing.activePlatforms ?? []),
    ...(outcome.influenceSignals.activePlatforms ?? []),
    ...outcome.channels.map((channel) => channel.platform),
  ]).filter((platform) => creatorPlatforms.has(platform));
  const notableSignals = unique([
    ...(existing.notableSignals ?? []),
    ...(outcome.influenceSignals.notableSignals ?? []),
    outcome.reviewerNotes,
  ]).slice(0, 12);
  const nextSignals: InfluenceSignals = {
    ...existing,
    activePlatforms,
    notableSignals,
  };

  if (outcome.influenceSignals.hasPodcast) {
    nextSignals.hasPodcast = true;
    updated += 1;
  }

  if (outcome.influenceSignals.hasYoutubeShow) {
    nextSignals.hasYoutubeShow = true;
    updated += 1;
  }

  countFields.forEach((field) => {
    const value = outcome.influenceSignals[field];
    if (typeof value === 'number') {
      nextSignals[field] = value;
      updated += 1;
    }
  });

  if (activePlatforms.length > (existing.activePlatforms?.length ?? 0)) {
    updated += 1;
  }

  if (notableSignals.length > (existing.notableSignals?.length ?? 0)) {
    updated += 1;
  }

  candidate.influenceSignals = nextSignals;
  return { updated };
}

function appendRationale(
  rationale: string,
  outcome: CreatorSignalReviewOutcome,
  channelsAdded: number,
  signalsUpdated: number,
) {
  const reviewerNote = outcome.reviewerNotes ? ` Reviewer note: ${outcome.reviewerNotes}` : '';
  return `${rationale} Creator-signal review on ${outcome.verifiedAt} added ${channelsAdded} channels and ${signalsUpdated} signal fields.${reviewerNote}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
