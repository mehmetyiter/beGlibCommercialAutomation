import assert from 'node:assert/strict';
import test from 'node:test';
import {
  candidateKnownYouTubeChannelIds,
  candidateKnownYouTubeChannelLocators,
  candidateQuarantinedYouTubeChannelLocators,
  chunks,
  youtubeChannelIdFromUrl,
  youtubeChannelLocatorFromUrl,
} from './youtube-channel-locators.mjs';

test('extracts only canonical YouTube channel IDs', () => {
  assert.equal(
    youtubeChannelIdFromUrl('https://www.youtube.com/channel/UCkSEq4JuI5VxqWIrRY2-pew'),
    'UCkSEq4JuI5VxqWIrRY2-pew',
  );
  assert.equal(youtubeChannelIdFromUrl('https://youtube.com/@candidate'), undefined);
  assert.equal(youtubeChannelIdFromUrl('https://example.com/channel/UCkSEq4JuI5VxqWIrRY2-pew'), undefined);
});

test('deduplicates known candidate channel IDs', () => {
  const url = 'https://www.youtube.com/channel/UCkSEq4JuI5VxqWIrRY2-pew';
  assert.deepEqual(
    candidateKnownYouTubeChannelIds({
      sourceUrls: [url],
      channels: [{ platform: 'youtube', url }],
    }),
    ['UCkSEq4JuI5VxqWIrRY2-pew'],
  );
});

test('extracts handle, username, and legacy custom channel locators', () => {
  assert.deepEqual(youtubeChannelLocatorFromUrl('https://youtube.com/@candidate'), {
    filter: 'forHandle',
    value: '@candidate',
    sourceUrl: 'https://youtube.com/@candidate',
  });
  assert.deepEqual(youtubeChannelLocatorFromUrl('https://www.youtube.com/user/candidate'), {
    filter: 'forUsername',
    value: 'candidate',
    sourceUrl: 'https://www.youtube.com/user/candidate',
  });
  assert.deepEqual(youtubeChannelLocatorFromUrl('https://www.youtube.com/candidate'), {
    filter: 'forHandle',
    fallbackFilter: 'forUsername',
    value: 'candidate',
    sourceUrl: 'https://www.youtube.com/candidate',
  });
  assert.equal(youtubeChannelLocatorFromUrl('https://youtube.com/watch?v=abc'), undefined);
});

test('deduplicates all known candidate YouTube locators', () => {
  assert.deepEqual(
    candidateKnownYouTubeChannelLocators({
      sourceUrls: ['https://youtube.com/@candidate', 'https://youtube.com/@candidate'],
      channels: [{ platform: 'youtube', url: 'https://youtube.com/user/legacy' }],
    }),
    [
      {
        filter: 'forHandle',
        value: '@candidate',
        sourceUrl: 'https://youtube.com/@candidate',
      },
      {
        filter: 'forUsername',
        value: 'legacy',
        sourceUrl: 'https://youtube.com/user/legacy',
      },
    ],
  );
});

test('extracts only resolvable non-canonical YouTube locators from dossier quarantine', () => {
  assert.deepEqual(
    candidateQuarantinedYouTubeChannelLocators({
      quarantinedChannels: [
        {
          platform: 'youtube',
          label: 'YouTube',
          url: 'https://youtube.com/@candidate?sub_confirmation=1',
          source: 'public-page-link',
          identityEvidence: ['social-target-lacks-candidate-identity'],
        },
        {
          platform: 'youtube',
          label: 'Duplicate',
          url: 'https://youtube.com/@candidate',
          source: 'public-page-link',
        },
        {
          platform: 'youtube',
          label: 'Video',
          url: 'https://youtube.com/watch?v=abc',
          source: 'public-page-link',
        },
        {
          platform: 'youtube',
          label: 'Canonical channel',
          url: 'https://youtube.com/channel/UCkSEq4JuI5VxqWIrRY2-pew',
          source: 'youtube-data-api',
        },
      ],
    }),
    [
      {
        filter: 'forHandle',
        value: '@candidate',
        sourceUrl: 'https://youtube.com/@candidate?sub_confirmation=1',
        source: 'public-page-link',
        sourceLabel: 'YouTube',
        identityEvidence: ['social-target-lacks-candidate-identity'],
      },
    ],
  );
});

test('chunks channel IDs for channels.list batch requests', () => {
  assert.deepEqual(chunks(['a', 'b', 'c', 'd', 'e'], 2), [['a', 'b'], ['c', 'd'], ['e']]);
});
