import type { Candidate, ChannelPlatform, StarAssessment, StarRating } from '../types';

const activeSocialPlatforms = new Set<ChannelPlatform>([
  'youtube',
  'podcast',
  'x',
  'instagram',
  'tiktok',
  'linkedin',
  'newsletter',
]);

export function assessStarRating(candidate: Candidate): StarAssessment {
  const signals = candidate.influenceSignals;
  const channelPlatforms = candidate.channels
    .map((channel) => channel.platform)
    .filter((platform) => activeSocialPlatforms.has(platform));
  const activePlatforms = unique([...(signals?.activePlatforms ?? []), ...channelPlatforms]).filter((platform) =>
    activeSocialPlatforms.has(platform),
  );
  const verifiedActiveChannels = candidate.channels.filter(
    (channel) => channel.verified && activeSocialPlatforms.has(channel.platform),
  ).length;
  const hasPodcast = Boolean(signals?.hasPodcast || channelPlatforms.includes('podcast'));
  const hasYoutubeShow = Boolean(signals?.hasYoutubeShow || channelPlatforms.includes('youtube'));
  const scoreParts: number[] = [];
  const reasons: string[] = [];
  const missingSignals: string[] = [];

  if (hasPodcast) {
    scoreParts.push(22);
    reasons.push('Existing podcast or interview format signal.');
  } else {
    missingSignals.push('No podcast/long-form hosting signal yet.');
  }

  if (hasYoutubeShow) {
    scoreParts.push(22);
    reasons.push('Existing YouTube/video publishing signal.');
  } else {
    missingSignals.push('No YouTube show signal yet.');
  }

  scoreParts.push(scoreAudience('X', signals?.xFollowers, [100000, 25000, 5000], [20, 14, 8, 4], reasons, missingSignals));
  scoreParts.push(
    scoreAudience('YouTube', signals?.youtubeSubscribers, [100000, 25000, 5000], [18, 12, 7, 3], reasons, missingSignals),
  );
  scoreParts.push(
    scoreAudience('Instagram', signals?.instagramFollowers, [100000, 25000, 5000], [10, 7, 4, 2], reasons, missingSignals),
  );
  scoreParts.push(
    scoreAudience('TikTok', signals?.tiktokFollowers, [100000, 25000, 5000], [10, 7, 4, 2], reasons, missingSignals),
  );
  scoreParts.push(
    scoreAudience('Newsletter', signals?.newsletterSubscribers, [50000, 10000, 2500], [10, 6, 3, 1], reasons, missingSignals),
  );

  if (activePlatforms.length >= 5) {
    scoreParts.push(18);
    reasons.push('Active across five or more social/media platforms.');
  } else if (activePlatforms.length === 4) {
    scoreParts.push(14);
    reasons.push('Active across four social/media platforms.');
  } else if (activePlatforms.length === 3) {
    scoreParts.push(10);
    reasons.push('Active across three social/media platforms.');
  } else if (activePlatforms.length === 2) {
    scoreParts.push(5);
    reasons.push('Active across two social/media platforms.');
  } else {
    missingSignals.push('Limited multi-platform activity signal.');
  }

  if (verifiedActiveChannels >= 3) {
    scoreParts.push(10);
    reasons.push('Three or more verified active media channels.');
  } else if (verifiedActiveChannels === 2) {
    scoreParts.push(6);
    reasons.push('Two verified active media channels.');
  }

  if (candidate.reachScore >= 82) {
    scoreParts.push(6);
    reasons.push('High existing reach score.');
  } else if (candidate.reachScore >= 72) {
    scoreParts.push(4);
    reasons.push('Solid existing reach score.');
  }

  signals?.notableSignals?.slice(0, 3).forEach((signal) => reasons.push(signal));

  const score = Math.min(100, Math.round(scoreParts.reduce((sum, value) => sum + value, 0)));
  const stars = scoreToStars(score);

  return {
    stars,
    score,
    label: getStarLabel(stars),
    reasons: reasons.slice(0, 6),
    missingSignals: unique(missingSignals).slice(0, 4),
  };
}

function scoreAudience(
  label: string,
  value: number | undefined,
  thresholds: [number, number, number],
  points: [number, number, number, number],
  reasons: string[],
  missingSignals: string[],
) {
  if (typeof value !== 'number' || value <= 0) {
    missingSignals.push(`${label} audience size unknown.`);
    return 0;
  }

  if (value >= thresholds[0]) {
    reasons.push(`${label} audience is 100k+.`);
    return points[0];
  }

  if (value >= thresholds[1]) {
    reasons.push(`${label} audience is 25k+.`);
    return points[1];
  }

  if (value >= thresholds[2]) {
    reasons.push(`${label} audience is 5k+.`);
    return points[2];
  }

  reasons.push(`${label} audience is tracked.`);
  return points[3];
}

function scoreToStars(score: number): StarRating {
  if (score >= 82) {
    return 5;
  }

  if (score >= 64) {
    return 4;
  }

  if (score >= 46) {
    return 3;
  }

  if (score >= 28) {
    return 2;
  }

  return 1;
}

function getStarLabel(stars: StarRating) {
  if (stars === 5) {
    return 'Priority host';
  }

  if (stars === 4) {
    return 'Strong prospect';
  }

  if (stars === 3) {
    return 'Promising';
  }

  if (stars === 2) {
    return 'Needs signal';
  }

  return 'Discovery only';
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
