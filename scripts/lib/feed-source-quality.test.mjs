import test from 'node:test';
import assert from 'node:assert/strict';

import { isLikelySyndicationFeed, isTechnicalDocumentEndpoint } from './feed-source-quality.mjs';

test('accepts explicit RSS, Atom, JSON Feed, and conventional feed URLs', () => {
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/feed/',
    label: 'Updates',
  }), true);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/atom.xml',
    type: 'application/atom+xml',
    rel: 'alternate',
  }), true);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/feed.json',
    type: 'application/feed+json',
    rel: 'alternate',
  }), true);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/?feed=rss2',
    label: 'Updates',
  }), true);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/?feed=comments-rss2',
    label: 'Comments',
  }), true);
});

test('rejects WordPress REST, oEmbed, and generic JSON documents', () => {
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/wp-json/oembed/1.0/embed?url=https://example.com',
    type: 'application/json',
    rel: 'alternate',
  }), false);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/wp-json/wp/v2/pages/42',
    label: 'JSON',
  }), false);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/profile.json',
    type: 'application/json',
    rel: 'alternate',
  }), false);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/wp-includes/wlwmanifest.xml',
    type: 'application/xml',
  }), false);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/schedule/?ical=1',
    label: 'iCal feed',
  }), false);
  assert.equal(isLikelySyndicationFeed({
    url: 'https://example.com/podcast',
    label: 'Podcast',
  }), false);
});

test('recognizes technical document endpoint paths defensively', () => {
  assert.equal(isTechnicalDocumentEndpoint('/wp-json/'), true);
  assert.equal(isTechnicalDocumentEndpoint('/api/oembed/1.0'), true);
  assert.equal(isTechnicalDocumentEndpoint('/feed/'), false);
});
