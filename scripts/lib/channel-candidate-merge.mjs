export function mergeChannelCandidates(values, keyFn) {
  const merged = new Map();

  for (const channel of values) {
    const key = keyFn(channel);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, channel);
      continue;
    }

    const preferred = channelQualityScore(channel) > channelQualityScore(existing) ? channel : existing;
    const secondary = preferred === channel ? existing : channel;
    merged.set(key, {
      ...secondary,
      ...preferred,
      verified: Boolean(existing.verified || channel.verified),
      evidence: unique([...(existing.evidence ?? []), ...(channel.evidence ?? [])]),
      publicCounts: {
        ...(existing.publicCounts ?? {}),
        ...(channel.publicCounts ?? {}),
      },
    });
  }

  return Array.from(merged.values());
}

function channelQualityScore(channel) {
  const confidenceScore = {
    unknown: 0,
    low: 1,
    medium: 2,
    high: 3,
    verified: 4,
  }[channel.confidence] ?? 0;
  const publicCountScore = Object.values(channel.publicCounts ?? {}).some((value) => typeof value === 'number') ? 2 : 0;

  return (
    (channel.verified ? 20 : 0) +
    (channel.eligibleForReview ? 10 : 0) +
    confidenceScore +
    publicCountScore +
    ((channel.evidence ?? []).length > 0 ? 1 : 0)
  );
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
