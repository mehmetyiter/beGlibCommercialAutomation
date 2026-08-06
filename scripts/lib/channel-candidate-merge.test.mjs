import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeChannelCandidates } from './channel-candidate-merge.mjs';

test('keeps API enrichment when a candidate record has the same channel URL', () => {
  const url = 'https://www.youtube.com/channel/UCkSEq4JuI5VxqWIrRY2-pew';
  const [channel] = mergeChannelCandidates(
    [
      {
        source: 'candidate-record',
        platform: 'youtube',
        url,
        confidence: 'unknown',
      },
      {
        source: 'youtube-data-api',
        platform: 'youtube',
        url,
        confidence: 'high',
        eligibleForReview: true,
        evidence: ['Official channel identity match.'],
        publicCounts: { youtubeSubscribers: 374000, youtubeVideos: 757 },
      },
    ],
    (item) => `${item.platform}|${item.url}`,
  );

  assert.equal(channel.source, 'youtube-data-api');
  assert.equal(channel.confidence, 'high');
  assert.deepEqual(channel.publicCounts, { youtubeSubscribers: 374000, youtubeVideos: 757 });
});

test('preserves verified status and evidence while merging duplicates', () => {
  const [channel] = mergeChannelCandidates(
    [
      { platform: 'youtube', url: 'channel', verified: true, evidence: ['manual review'] },
      { platform: 'youtube', url: 'channel', confidence: 'high', evidence: ['API match'] },
    ],
    (item) => `${item.platform}|${item.url}`,
  );

  assert.equal(channel.verified, true);
  assert.deepEqual(channel.evidence, ['manual review', 'API match']);
});
