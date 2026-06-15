import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { loadLocalEnv } from './lib/local-env.mjs';

const supportedSources = new Set(['youtube', 'podcastindex', 'rss']);
const creatorPlatforms = new Set(['youtube', 'podcast', 'newsletter']);
const parser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
});

const args = parseArgs(process.argv.slice(2));
const localEnv = await loadLocalEnv(args['env-file']);
const batchPath = resolve(args.batch ?? args._[0] ?? 'examples/research-batch.synthetic.json');
const sourceConfigPath = args.config ? resolve(args.config) : undefined;
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const sourceConfig = sourceConfigPath ? JSON.parse(await readFile(sourceConfigPath, 'utf8')) : {};
const allCandidates = Array.isArray(batch.candidates) ? batch.candidates : [];
const selectedCandidates = selectCandidates(allCandidates, args);
const sources = getSources(args.sources);
const defaultSlug = slugify(batch.batchId ?? 'research-batch');
const markdownPath = resolve(args.output ?? `exports/${defaultSlug}-creator-source-discovery.local.md`);
const jsonPath = resolve(args['json-output'] ?? `exports/${defaultSlug}-creator-source-discovery.local.json`);
const maxResults = boundedNumber(args.max, 3, 1, 10);
const failures = [];
const skippedSources = [];
const items = [];

for (const candidate of selectedCandidates) {
  const suggestions = [];

  if (sources.has('youtube')) {
    if (!process.env.YOUTUBE_API_KEY) {
      skippedSources.push({ source: 'youtube', candidateId: candidate.id, reason: 'YOUTUBE_API_KEY is not set.' });
    } else {
      suggestions.push(...(await discoverYouTube(candidate, maxResults, failures)));
    }
  }

  if (sources.has('podcastindex')) {
    if (!process.env.PODCASTINDEX_API_KEY || !process.env.PODCASTINDEX_API_SECRET) {
      skippedSources.push({
        source: 'podcastindex',
        candidateId: candidate.id,
        reason: 'PODCASTINDEX_API_KEY or PODCASTINDEX_API_SECRET is not set.',
      });
    } else {
      suggestions.push(...(await discoverPodcastIndex(candidate, maxResults, failures)));
    }
  }

  if (sources.has('rss')) {
    suggestions.push(...(await discoverRss(candidate, sourceConfig.feeds ?? [], failures)));
  }

  items.push(buildReviewItem(candidate, suggestions));
}

const reviewPackage = {
  reviewId: `${defaultSlug}-creator-source-discovery`,
  createdAt: new Date().toISOString(),
  sourceBatchId: batch.batchId ?? null,
  sourceLabel: batch.sourceLabel ?? null,
  sourceFile: batchPath,
  mode: 'creator-source-discovery',
  summary: {
    inputCandidates: allCandidates.length,
    selectedCandidates: selectedCandidates.length,
    sources: Array.from(sources),
    youtubeSuggestions: countSuggestions(items, 'youtube-data-api'),
    podcastIndexSuggestions: countSuggestions(items, 'podcastindex-api'),
    rssSuggestions: countSuggestions(items, 'rss-feed'),
    skippedSources: skippedSources.length,
    failures: failures.length,
  },
  rules: [
    'Suggestions are not verified channels.',
    'A human must confirm identity match before copying suggestions into reviewOutcome.',
    'Do not infer audience counts from unavailable or hidden source data.',
    'Do not treat creator/media discovery as permission to contact.',
    'Keep generated operational outputs in ignored local files or a private database.',
  ],
  skippedSources,
  failures,
  items,
};

await mkdir(dirname(markdownPath), { recursive: true });
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(reviewPackage, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(reviewPackage), 'utf8');

console.log(`Creator source discovery JSON written to ${jsonPath}`);
console.log(`Creator source discovery checklist written to ${markdownPath}`);
console.log(`Candidates: ${reviewPackage.summary.selectedCandidates}`);
console.log(`YouTube suggestions: ${reviewPackage.summary.youtubeSuggestions}`);
console.log(`PodcastIndex suggestions: ${reviewPackage.summary.podcastIndexSuggestions}`);
console.log(`RSS suggestions: ${reviewPackage.summary.rssSuggestions}`);
console.log(`Skipped source attempts: ${reviewPackage.summary.skippedSources}`);
console.log(`Failures: ${reviewPackage.summary.failures}`);

if (localEnv.loaded && localEnv.variables.length > 0) {
  console.log(`Loaded local env: ${localEnv.variables.join(', ')}`);
}

function selectCandidates(candidates, options) {
  const categoryFilter = options.categories
    ? new Set(String(options.categories).split(',').map((category) => category.trim()).filter(Boolean))
    : null;
  const candidateLimit = boundedNumber(options.limit, candidates.length, 1, candidates.length || 1);

  return candidates
    .filter((candidate) => !categoryFilter || categoryFilter.has(candidate.primaryCategory))
    .slice(0, candidateLimit);
}

function getSources(value) {
  const requested = String(value ?? 'youtube,podcastindex,rss')
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);
  const sources = new Set(requested.filter((source) => supportedSources.has(source)));

  return sources.size > 0 ? sources : new Set(['rss']);
}

async function discoverYouTube(candidate, max, failuresList) {
  try {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'channel');
    searchUrl.searchParams.set('q', `${candidate.name} YouTube channel`);
    searchUrl.searchParams.set('maxResults', String(max));
    searchUrl.searchParams.set('key', process.env.YOUTUBE_API_KEY);

    const searchPayload = await fetchJson(searchUrl);
    const channelIds = (searchPayload.items ?? [])
      .map((item) => item.id?.channelId)
      .filter(Boolean)
      .slice(0, max);

    if (channelIds.length === 0) {
      return [];
    }

    const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelUrl.searchParams.set('part', 'snippet,statistics');
    channelUrl.searchParams.set('id', channelIds.join(','));
    channelUrl.searchParams.set('key', process.env.YOUTUBE_API_KEY);

    const channelPayload = await fetchJson(channelUrl);
    return (channelPayload.items ?? []).map((item) => youtubeSuggestion(candidate, item));
  } catch (error) {
    failuresList.push({
      source: 'youtube',
      candidateId: candidate.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function youtubeSuggestion(candidate, item) {
  const channelId = item.id;
  const statistics = item.statistics ?? {};
  const hiddenSubscriberCount = Boolean(statistics.hiddenSubscriberCount);
  const subscriberCount = hiddenSubscriberCount ? undefined : numberOrUndefined(statistics.subscriberCount);
  const videoCount = numberOrUndefined(statistics.videoCount);
  const label = item.snippet?.title ?? 'YouTube channel';
  const url = `https://www.youtube.com/channel/${channelId}`;

  return {
    source: 'youtube-data-api',
    platform: 'youtube',
    label,
    url,
    candidateId: candidate.id,
    confidence: labelMatchesCandidate(label, candidate.name) ? 'medium' : 'low',
    evidence: [
      item.snippet?.description,
      typeof videoCount === 'number' ? `${videoCount} public videos reported by API.` : undefined,
      typeof subscriberCount === 'number' ? `${subscriberCount} public subscribers reported by API.` : undefined,
    ].filter(Boolean),
    publicCounts: {
      youtubeSubscribers: subscriberCount,
    },
    sourceUrls: [url],
    verified: false,
    reviewerNote: 'Suggestion only. Human identity match required before applying as verified channel.',
  };
}

async function discoverPodcastIndex(candidate, max, failuresList) {
  try {
    const url = new URL('https://api.podcastindex.org/api/1.0/search/byterm');
    url.searchParams.set('q', `${candidate.name} podcast`);
    url.searchParams.set('max', String(max));
    url.searchParams.set('clean', 'true');

    const payload = await fetchJson(url, { headers: podcastIndexHeaders() });
    return (payload.feeds ?? []).slice(0, max).map((feed) => podcastIndexSuggestion(candidate, feed));
  } catch (error) {
    failuresList.push({
      source: 'podcastindex',
      candidateId: candidate.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function podcastIndexHeaders() {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const authKey = process.env.PODCASTINDEX_API_KEY;
  const authSecret = process.env.PODCASTINDEX_API_SECRET;
  const authorization = createHash('sha1').update(`${authKey}${authSecret}${authDate}`).digest('hex');

  return {
    'User-Agent':
      process.env.BEGLIB_RESEARCH_USER_AGENT ??
      'beGlibCommercialAutomation/0.1 (creator-source-discovery; local private research)',
    'X-Auth-Key': authKey,
    'X-Auth-Date': authDate,
    Authorization: authorization,
  };
}

function podcastIndexSuggestion(candidate, feed) {
  const label = feed.title ?? feed.author ?? 'Podcast feed';
  const url = feed.link || feed.url || feed.originalUrl || `https://podcastindex.org/podcast/${feed.id}`;

  return {
    source: 'podcastindex-api',
    platform: 'podcast',
    label,
    url,
    candidateId: candidate.id,
    confidence: labelMatchesCandidate(`${label} ${feed.author ?? ''} ${feed.ownerName ?? ''}`, candidate.name)
      ? 'medium'
      : 'low',
    evidence: [feed.author, feed.ownerName, feed.description].filter(Boolean).slice(0, 4),
    publicCounts: {},
    sourceUrls: [feed.url, feed.originalUrl, url].filter(Boolean),
    verified: false,
    reviewerNote: 'Suggestion only. Human identity match required before applying as verified podcast signal.',
  };
}

async function discoverRss(candidate, feeds, failuresList) {
  const candidateFeeds = feeds.filter((feed) => feed.candidateId === candidate.id || feed.name === candidate.name);
  const suggestions = [];

  for (const feed of candidateFeeds) {
    try {
      const parsedFeed = await parseFeed(feed.url);
      suggestions.push(rssSuggestion(candidate, feed, parsedFeed));
    } catch (error) {
      failuresList.push({
        source: 'rss',
        candidateId: candidate.id,
        feedUrl: feed.url,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return suggestions;
}

async function parseFeed(feedUrl) {
  const xml = await readTextSource(feedUrl);
  const parsed = parser.parse(xml);

  if (parsed.rss?.channel) {
    const channel = parsed.rss.channel;
    const items = asArray(channel.item).slice(0, 5);
    return {
      title: textValue(channel.title),
      link: textValue(channel.link),
      description: textValue(channel.description),
      items: items.map((item) => ({
        title: textValue(item.title),
        link: textValue(item.link),
        pubDate: textValue(item.pubDate),
      })),
    };
  }

  if (parsed.feed) {
    const feed = parsed.feed;
    const entries = asArray(feed.entry).slice(0, 5);
    return {
      title: textValue(feed.title),
      link: getAtomLink(feed.link),
      description: textValue(feed.subtitle),
      items: entries.map((entry) => ({
        title: textValue(entry.title),
        link: getAtomLink(entry.link),
        pubDate: textValue(entry.updated ?? entry.published),
      })),
    };
  }

  throw new Error('Feed is not RSS or Atom.');
}

function rssSuggestion(candidate, feed, parsedFeed) {
  const platform = creatorPlatforms.has(feed.platform) ? feed.platform : 'podcast';
  const label = parsedFeed.title || feed.label || `${candidate.name} feed`;
  const url = parsedFeed.link || feed.url;

  return {
    source: 'rss-feed',
    platform,
    label,
    url,
    candidateId: candidate.id,
    confidence: labelMatchesCandidate(label, candidate.name) ? 'medium' : 'low',
    evidence: [
      parsedFeed.description,
      ...parsedFeed.items.map((item) => [item.title, item.pubDate].filter(Boolean).join(' — ')),
    ].filter(Boolean).slice(0, 5),
    publicCounts: {},
    sourceUrls: [feed.url, url].filter(Boolean),
    verified: false,
    reviewerNote: 'Suggestion only. Human identity match required before applying as verified creator signal.',
  };
}

function buildReviewItem(candidate, suggestions) {
  return {
    candidateId: candidate.id,
    name: candidate.name,
    title: candidate.title,
    category: candidate.primaryCategory,
    country: candidate.country,
    priority: suggestions.length > 0 ? 'medium' : 'high',
    sourceHints: (candidate.sourceUrls ?? []).slice(0, 8),
    suggestions,
    reviewChecks: [
      'Confirm the suggested channel/feed belongs to the same person.',
      'Copy only verified suggestions into reviewOutcome.channels.',
      'Set verified:true only after identity match.',
      'Record public counts only when visible and source-supported.',
      'Do not treat creator/media discovery as permission to contact.',
    ],
    reviewOutcome: {
      candidateId: candidate.id,
      outcomeStatus: 'pending',
      verifiedAt: '',
      channels: [],
      influenceSignals: {
        hasPodcast: false,
        hasYoutubeShow: false,
        activePlatforms: [],
        notableSignals: [],
      },
      sourceUrls: [],
      reviewerNotes: '',
    },
  };
}

function renderMarkdown(reviewPackage) {
  const lines = [
    `# Creator Source Discovery: ${reviewPackage.sourceBatchId ?? reviewPackage.reviewId}`,
    '',
    `Source: ${reviewPackage.sourceLabel ?? 'Unknown'}`,
    `Generated: ${reviewPackage.createdAt}`,
    `Candidates: ${reviewPackage.summary.selectedCandidates}`,
    '',
    'Suggestions are discovery hints only. Human identity match is required before applying creator signals.',
    '',
    '## Summary',
    '',
    `- YouTube suggestions: ${reviewPackage.summary.youtubeSuggestions}`,
    `- PodcastIndex suggestions: ${reviewPackage.summary.podcastIndexSuggestions}`,
    `- RSS suggestions: ${reviewPackage.summary.rssSuggestions}`,
    `- Skipped source attempts: ${reviewPackage.summary.skippedSources}`,
    `- Failures: ${reviewPackage.summary.failures}`,
    '',
    '## Guardrails',
    '',
    ...reviewPackage.rules.map((rule) => `- ${rule}`),
    '',
  ];

  reviewPackage.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.name}`);
    lines.push('');
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Priority: ${item.priority.toUpperCase()}`);
    lines.push('- Suggestions:');

    if (item.suggestions.length === 0) {
      lines.push('  - None found or source skipped.');
    }

    item.suggestions.forEach((suggestion) => {
      lines.push(`  - ${suggestion.platform}: ${suggestion.label}`);
      lines.push(`    - URL: ${suggestion.url}`);
      lines.push(`    - Source: ${suggestion.source}`);
      lines.push(`    - Confidence: ${suggestion.confidence}`);
      suggestion.evidence.slice(0, 2).forEach((evidence) => lines.push(`    - Evidence: ${evidence}`));
    });

    lines.push('- Review checks:');
    item.reviewChecks.forEach((check) => lines.push(`  - [ ] ${check}`));
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url.hostname} request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function readTextSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Feed request failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  return readFile(resolve(source), 'utf8');
}

function getAtomLink(link) {
  const links = asArray(link);
  const preferred = links.find((item) => item?.['@_href'] && (!item['@_rel'] || item['@_rel'] === 'alternate')) ?? links[0];

  return textValue(preferred?.['@_href'] ?? preferred);
}

function asArray(value) {
  if (typeof value === 'undefined') {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (value && typeof value === 'object') {
    return textValue(value['#text']);
  }

  return '';
}

function labelMatchesCandidate(label, name) {
  const normalizedLabel = label.toLowerCase();
  const nameParts = name.toLowerCase().split(/\s+/).filter((part) => part.length > 2);

  return nameParts.some((part) => normalizedLabel.includes(part));
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function countSuggestions(items, source) {
  return items.reduce(
    (count, item) => count + item.suggestions.filter((suggestion) => suggestion.source === source).length,
    0,
  );
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value.startsWith('--')) {
      const key = value.slice(2);
      if (!next || next.startsWith('--')) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        index += 1;
      }
    } else {
      parsed._.push(value);
    }
  }

  return parsed;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}
