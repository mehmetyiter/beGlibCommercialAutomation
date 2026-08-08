import assert from 'node:assert/strict';
import test from 'node:test';
import {
  identityConfidence,
  podcastIdentityConfidence,
  youtubeIdentityConfidence,
} from './creator-source-confidence.mjs';

const musician = {
  name: 'David Gilmour',
  title: 'English guitarist and singer-songwriter connected to musician',
  primaryCategory: 'arts',
  sourceUrls: [],
  channels: [],
};

test('keeps a known official creator URL even when the channel uses an alias', () => {
  const candidate = {
    ...musician,
    name: 'Timati',
    sourceUrls: ['https://www.youtube.com/channel/official'],
  };

  assert.equal(
    identityConfidence(candidate, ['Тимати', 'Official artist channel'], 'https://youtube.com/channel/official'),
    'high',
  );
});

test('quarantines auto-generated Topic channels even when a source lists the URL', () => {
  const candidate = {
    ...musician,
    sourceUrls: ['https://www.youtube.com/channel/topic'],
  };

  assert.equal(
    identityConfidence(candidate, ['David Gilmour - Topic'], 'https://youtube.com/channel/topic'),
    'low',
  );
});

test('does not attribute a channel from a candidate mention in its description', () => {
  const candidate = {
    name: 'Dita Von Teese',
    title: 'American burlesque performer connected to dancer',
    primaryCategory: 'arts',
  };

  assert.equal(
    identityConfidence(candidate, ['Jessabelle Thunder', 'Performed alongside Dita Von Teese in burlesque shows']),
    'medium',
  );

  assert.equal(
    youtubeIdentityConfidence({
      candidate,
      label: 'Jessabelle Thunder',
      description: 'Performed alongside Dita Von Teese in burlesque shows',
      subscriberCount: 500000,
      videoCount: 1000,
    }),
    'low',
  );
});

test('does not attribute an interview channel from a guest mention', () => {
  const candidate = {
    name: 'Michael Shellenberger',
    title: 'American environmental policy advocate',
    primaryCategory: 'environment',
  };

  assert.equal(
    youtubeIdentityConfidence({
      candidate,
      label: 'Dad Saves America',
      description: 'Interviews include Michael Shellenberger and other guests.',
      subscriberCount: 496000,
      videoCount: 1517,
    }),
    'low',
  );
});

test('keeps a candidate-named channel with matching professional context', () => {
  const candidate = {
    name: 'Marcus Samuelsson',
    title: 'Swedish-American chef and restaurateur',
    primaryCategory: 'food',
  };

  assert.equal(
    identityConfidence(candidate, ['Marcus Samuelsson', 'Chef behind restaurants and cooking shows']),
    'high',
  );
});

test('quarantines fan channels instead of treating them as candidate-owned', () => {
  const candidate = {
    name: 'Nicole Scherzinger',
    title: 'American singer and television personality',
    primaryCategory: 'arts',
  };

  assert.equal(
    identityConfidence(candidate, ['NScherzingerFan', 'Dedicated to videos of Nicole Scherzinger']),
    'low',
  );
});

test('quarantines restored and archive channels despite a candidate-named label', () => {
  const candidate = {
    name: 'Tom Green',
    title: 'Canadian comedian and television host',
    primaryCategory: 'arts',
  };

  assert.equal(
    youtubeIdentityConfidence({
      candidate,
      label: 'MTVs Tom Green Show Restored',
      description: 'Restored episodes from the classic television show.',
      subscriberCount: 910,
      videoCount: 4,
    }),
    'low',
  );
});

test('keeps an established exact-name YouTube channel with an explicit official self-description', () => {
  const candidate = {
    name: 'Tom Green',
    title: 'Canadian comedian and television host',
    primaryCategory: 'arts',
  };

  assert.equal(
    youtubeIdentityConfidence({
      candidate,
      label: 'Tom Green',
      description: 'Welcome to the OFFICIAL YOUTUBE CHANNEL for all things related to Tom Green.',
      subscriberCount: 377000,
      videoCount: 507,
    }),
    'high',
  );
});

test('does not attribute a podcast that is about the candidate', () => {
  const candidate = {
    name: 'John Carpenter',
    title: 'American filmmaker and composer',
    primaryCategory: 'arts',
  };

  assert.equal(
    podcastIdentityConfidence(
      candidate,
      'The Carpenter Shop: A John Carpenter Podcast',
      ['War Starts at Midnight'],
      ['War Starts at Midnight', 'TV & Film, Arts, Podcasts'],
    ),
    'medium',
  );
});

test('does not treat a candidate-named podcast title as the candidate owner', () => {
  const candidate = {
    name: 'Guillermo del Toro',
    title: 'Mexican filmmaker and author',
    primaryCategory: 'arts',
  };

  assert.equal(
    podcastIdentityConfidence(
      candidate,
      'The Guillermo del Toro Podcast',
      ['The Guillermo del Toro Podcast'],
      ['The Guillermo del Toro Podcast', 'Arts, Podcasts'],
    ),
    'medium',
  );
});

test('keeps a podcast when its publisher names the candidate as owner', () => {
  assert.equal(
    podcastIdentityConfidence(
      musician,
      'The David Gilmour Podcast',
      ['David Gilmour'],
      ['David Gilmour', 'Music, Arts, Podcasts'],
    ),
    'high',
  );
});

test('requires manual review when host wording lacks topical ownership evidence', () => {
  const candidate = {
    name: 'George Lopez',
    title: 'American comedian and actor connected to screenwriter',
    primaryCategory: 'arts',
  };

  assert.equal(
    podcastIdentityConfidence(
      candidate,
      'OMG Hi! with George Lopez Podcast',
      ['All Things Comedy'],
      ['All Things Comedy', 'Comedy, Business, TV & Film, Podcasts'],
    ),
    'medium',
  );
});

test('does not attribute same-name owners to a mononymous candidate', () => {
  const candidate = {
    name: 'Miguel',
    title: 'American singer and songwriter',
    primaryCategory: 'arts',
  };

  assert.equal(
    podcastIdentityConfidence(
      candidate,
      'Learning Spanish for Beginners Podcast',
      ['Miguel Lira'],
      ['Miguel Lira', 'Education, Podcasts'],
    ),
    'low',
  );
});

test('quarantines tiny inferred YouTube channels despite a matching name and topic', () => {
  const candidate = {
    name: 'Martin Yan',
    title: 'Chinese-American chef and television host',
    primaryCategory: 'food',
  };

  assert.equal(
    youtubeIdentityConfidence({
      candidate,
      label: 'Chef Martin Yan',
      subscriberCount: 3,
      videoCount: 1,
    }),
    'medium',
  );
});

test('quarantines inferred YouTube impersonation contact signals', () => {
  const candidate = {
    name: 'John Travolta',
    title: 'American actor and dancer',
    primaryCategory: 'arts',
  };

  assert.equal(
    youtubeIdentityConfidence({
      candidate,
      label: 'John Travolta',
      description: 'Actor and dancer. Interactive on Google chat or email.',
      subscriberCount: 2,
      videoCount: 2,
    }),
    'low',
  );
});

test('keeps a small known official YouTube channel', () => {
  const url = 'https://www.youtube.com/channel/official';
  const candidate = {
    name: 'Martin Yan',
    title: 'Chinese-American chef and television host',
    primaryCategory: 'food',
    sourceUrls: [url],
  };

  assert.equal(
    youtubeIdentityConfidence({
      candidate,
      label: 'Chef Martin Yan',
      suggestionUrl: url,
      subscriberCount: 3,
      videoCount: 1,
    }),
    'high',
  );
});

test('keeps an established inferred YouTube channel with strong identity context', () => {
  const candidate = {
    name: 'Ellen Lupton',
    title: 'American graphic designer, writer, and educator',
    primaryCategory: 'arts',
  };

  assert.equal(
    youtubeIdentityConfidence({
      candidate,
      label: 'Ellen Lupton',
      description: "I'm Ellen Lupton, a designer, writer, and educator sharing graphic design lessons.",
      subscriberCount: 1460,
      videoCount: 41,
    }),
    'high',
  );
});

test('a surname collision stays low no matter what the title says', () => {
  const musicianWithCommonName = {
    name: 'Claire Grimes',
    title: 'Canadian musician',
    primaryCategory: 'music',
    subcategories: ['musician'],
    sourceUrls: [],
    channels: [],
  };

  assert.equal(
    podcastIdentityConfidence(
      musicianWithCommonName,
      'Jam Crack - The Niall Grimes Climbing Podcast',
      ['Niall Grimes'],
      ['Niall Grimes', 'Sports, Podcasts'],
    ),
    'low',
  );
});
