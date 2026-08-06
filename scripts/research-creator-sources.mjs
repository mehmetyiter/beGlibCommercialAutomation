import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import {
  identityConfidence,
  podcastIdentityConfidence,
  youtubeIdentityConfidence,
} from './lib/creator-source-confidence.mjs';
import { loadLocalEnv } from './lib/local-env.mjs';
import {
  candidateKnownYouTubeChannelLocators,
  candidateQuarantinedYouTubeChannelLocators,
  chunks,
} from './lib/youtube-channel-locators.mjs';

const supportedSources = new Set(['youtube', 'podcastindex', 'rss']);
const creatorPlatforms = new Set(['youtube', 'podcast', 'newsletter']);
const confidenceRank = {
  low: 1,
  medium: 2,
  high: 3,
};
const parser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
});

const args = parseArgs(process.argv.slice(2));
const localEnv = await loadLocalEnv(args['local-env'] ?? args['env-path'] ?? args['env-file']);
const batchPath = resolve(args.batch ?? args._[0] ?? 'examples/research-batch.synthetic.json');
const sourceConfigPath = args.config ? resolve(args.config) : undefined;
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const sourceConfig = sourceConfigPath ? JSON.parse(await readFile(sourceConfigPath, 'utf8')) : {};
const allCandidates = Array.isArray(batch.candidates) ? batch.candidates : [];
const youtubeMode = getYouTubeMode(args['youtube-mode']);
const youtubeLocatorDossierPath = args['youtube-locator-dossier']
  ? resolve(args['youtube-locator-dossier'])
  : undefined;
const youtubeLocatorsByCandidate =
  youtubeMode === 'locator-only'
    ? await loadQuarantinedYouTubeLocators(youtubeLocatorDossierPath)
    : new Map();
const candidatePool =
  youtubeMode === 'locator-only'
    ? allCandidates.filter((candidate) => youtubeLocatorsByCandidate.has(candidate.id))
    : allCandidates;
const selectedCandidates = selectCandidates(candidatePool, args);
const candidateOffset = getCandidateOffset(args);
const sources = getSources(args.sources);
const defaultSlug = slugify(batch.batchId ?? 'research-batch');
const markdownPath = resolve(args.output ?? `exports/${defaultSlug}-creator-source-discovery.local.md`);
const jsonPath = resolve(args['json-output'] ?? `exports/${defaultSlug}-creator-source-discovery.local.json`);
const maxResults = boundedNumber(args.max, 3, 1, 10);
const minConfidence = getMinConfidence(args);
const candidateDelayMs = boundedNumber(args['delay-ms'], 0, 0, 60000);
const requestRetries = boundedNumber(args.retries, 2, 0, 5);
const retryDelayMs = boundedNumber(args['retry-delay-ms'], 2000, 250, 60000);
const timeoutMs = boundedNumber(args['timeout-ms'], 15000, 1000, 120000);
const youtubeDirectDelayMs = boundedNumber(args['youtube-direct-delay-ms'], 250, 0, 60000);
const youtubeSearchLimit = boundedNumber(args['youtube-search-limit'], 100, 0, 100000);
const failures = [];
const skippedSources = [];
const fallbackSources = [];
let deprioritizedSuggestions = 0;
let youtubeDirectLookupCalls = 0;
let youtubeDirectCandidateCount = 0;
let youtubeSearchCalls = 0;
let youtubeSearchLimitSkips = 0;
const items = [];
const knownYouTubeSuggestions =
  sources.has('youtube') && process.env.YOUTUBE_API_KEY && youtubeMode !== 'search-only'
    ? await discoverKnownYouTubeChannels(selectedCandidates, maxResults, failures, {
        locatorOverrides: youtubeMode === 'locator-only' ? youtubeLocatorsByCandidate : undefined,
        trustLocatorSources: youtubeMode !== 'locator-only',
        discoveryPrefix: youtubeMode === 'locator-only' ? 'locator' : 'known',
      })
    : new Map();

for (let candidateIndex = 0; candidateIndex < selectedCandidates.length; candidateIndex += 1) {
  const candidate = selectedCandidates[candidateIndex];
  const rawSuggestions = [];

  if (sources.has('youtube')) {
    if (!process.env.YOUTUBE_API_KEY) {
      skippedSources.push({ source: 'youtube', candidateId: candidate.id, reason: 'YOUTUBE_API_KEY is not set.' });
    } else {
      const knownSuggestions = knownYouTubeSuggestions.get(candidate.id) ?? [];
      rawSuggestions.push(...knownSuggestions);

      const shouldSearch =
        youtubeMode === 'search-only' || (youtubeMode === 'direct-first' && knownSuggestions.length === 0);
      if (shouldSearch && youtubeSearchCalls < youtubeSearchLimit) {
        youtubeSearchCalls += 1;
        rawSuggestions.push(...(await discoverYouTube(candidate, maxResults, failures)));
      } else if (shouldSearch) {
        youtubeSearchLimitSkips += 1;
        skippedSources.push({
          source: 'youtube-search',
          candidateId: candidate.id,
          reason: `YouTube search limit of ${youtubeSearchLimit} calls reached; candidate retained for a later run.`,
        });
      }
    }
  }

  if (sources.has('podcastindex')) {
    if (!process.env.PODCASTINDEX_API_KEY || !process.env.PODCASTINDEX_API_SECRET) {
      if (process.env.PODCASTINDEX_API_KEY && !process.env.PODCASTINDEX_API_SECRET) {
        fallbackSources.push({
          source: 'podcastindex-authenticated',
          candidateId: candidate.id,
          reason: 'PODCASTINDEX_API_SECRET is not set; using public PodcastIndex search fallback.',
        });
      }

      rawSuggestions.push(...(await discoverPodcastIndexPublic(candidate, maxResults, failures)));
    } else {
      rawSuggestions.push(...(await discoverPodcastIndex(candidate, maxResults, failures)));
    }
  }

  if (sources.has('rss')) {
    rawSuggestions.push(...(await discoverRss(candidate, sourceConfig.feeds ?? [], failures)));
  }

  const suggestions = filterSuggestions(rawSuggestions, minConfidence);
  const deferredSuggestions = rawSuggestions.filter((suggestion) => !suggestions.includes(suggestion));
  deprioritizedSuggestions += deferredSuggestions.length;
  items.push(buildReviewItem(candidate, suggestions, deferredSuggestions));

  if (candidateDelayMs > 0 && candidateIndex < selectedCandidates.length - 1) {
    await sleep(candidateDelayMs);
  }
}

const reviewPackage = {
  reviewId: `${defaultSlug}-creator-source-discovery`,
  createdAt: new Date().toISOString(),
  sourceBatchId: batch.batchId ?? null,
  sourceLabel: batch.sourceLabel ?? null,
  sourceFile: batchPath,
  locatorSourceFile: youtubeLocatorDossierPath ?? null,
  mode: 'creator-source-discovery',
  summary: {
    inputCandidates: candidatePool.length,
    batchCandidates: allCandidates.length,
    selectedCandidates: selectedCandidates.length,
    offset: candidateOffset,
    sources: Array.from(sources),
    youtubeSuggestions: countAllSuggestions(items, 'youtube-data-api'),
    youtubeMode,
    youtubeLocatorCandidates: youtubeLocatorsByCandidate.size,
    youtubeDirectCandidateCount,
    youtubeDirectLookupCalls,
    youtubeDirectDelayMs,
    youtubeSearchCalls,
    youtubeSearchLimit,
    youtubeSearchLimitSkips,
    podcastIndexSuggestions: countAllSuggestionsByPrefix(items, 'podcastindex-'),
    rssSuggestions: countAllSuggestions(items, 'rss-feed'),
    prioritySuggestions: countPrioritySuggestions(items),
    deprioritizedSuggestions,
    skippedSources: skippedSources.length,
    fallbackSources: fallbackSources.length,
    filteredSuggestions: deprioritizedSuggestions,
    failures: failures.length,
    minConfidence,
    candidateDelayMs,
    requestRetries,
    retryDelayMs,
    timeoutMs,
  },
  rules: [
    'Suggestions are not verified channels.',
    'A human must confirm identity match before copying suggestions into reviewOutcome.',
    'Low-confidence suggestions are retained as deprioritized discovery records, not discarded.',
    'Stars and confidence scores are prioritization signals only; they never remove a candidate from the database.',
    'Do not infer audience counts from unavailable or hidden source data.',
    'Do not treat creator/media discovery as permission to contact.',
    'Keep generated operational outputs in ignored local files or a private database.',
  ],
  skippedSources,
  fallbackSources,
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
console.log(`Offset: ${reviewPackage.summary.offset}`);
console.log(`YouTube suggestions: ${reviewPackage.summary.youtubeSuggestions}`);
console.log(`YouTube mode: ${reviewPackage.summary.youtubeMode}`);
console.log(`YouTube locator candidates: ${reviewPackage.summary.youtubeLocatorCandidates}`);
console.log(`YouTube known-channel candidates: ${reviewPackage.summary.youtubeDirectCandidateCount}`);
console.log(`YouTube channels.list calls: ${reviewPackage.summary.youtubeDirectLookupCalls}`);
console.log(`YouTube channels.list delay: ${reviewPackage.summary.youtubeDirectDelayMs}ms`);
console.log(`YouTube search.list calls: ${reviewPackage.summary.youtubeSearchCalls}`);
console.log(`YouTube search limit skips: ${reviewPackage.summary.youtubeSearchLimitSkips}`);
console.log(`PodcastIndex suggestions: ${reviewPackage.summary.podcastIndexSuggestions}`);
console.log(`RSS suggestions: ${reviewPackage.summary.rssSuggestions}`);
console.log(`Skipped source attempts: ${reviewPackage.summary.skippedSources}`);
console.log(`Fallback source attempts: ${reviewPackage.summary.fallbackSources}`);
console.log(`Priority suggestions: ${reviewPackage.summary.prioritySuggestions}`);
console.log(`Deprioritized suggestions retained: ${reviewPackage.summary.deprioritizedSuggestions}`);
console.log(`Minimum confidence: ${reviewPackage.summary.minConfidence}`);
console.log(`Candidate delay: ${reviewPackage.summary.candidateDelayMs}ms`);
console.log(`Request retries: ${reviewPackage.summary.requestRetries}`);
console.log(`Request timeout: ${reviewPackage.summary.timeoutMs}ms`);
console.log(`Failures: ${reviewPackage.summary.failures}`);

if (localEnv.loaded) {
  console.log(`Loaded local env file: ${localEnv.path} (${localEnv.variables.length} values applied)`);
}
console.log(`Credential status: ${credentialStatus(sources)}`);

function selectCandidates(candidates, options) {
  const categoryFilter = options.categories
    ? new Set(String(options.categories).split(',').map((category) => category.trim()).filter(Boolean))
    : null;
  const candidateLimit = boundedNumber(options.limit, candidates.length, 1, candidates.length || 1);
  const candidateOffset = getCandidateOffset(options);

  return candidates
    .filter((candidate) => !categoryFilter || categoryFilter.has(candidate.primaryCategory))
    .slice(candidateOffset, candidateOffset + candidateLimit);
}

async function loadQuarantinedYouTubeLocators(dossierPath) {
  if (!dossierPath) {
    throw new Error('--youtube-locator-dossier is required when --youtube-mode locator-only is used.');
  }

  const payload = JSON.parse(await readFile(dossierPath, 'utf8'));
  if (!Array.isArray(payload.dossiers)) {
    throw new Error(`${dossierPath} is not a candidate discovery dossier package.`);
  }

  const locatorsByCandidate = new Map();
  for (const dossier of payload.dossiers) {
    const locators = candidateQuarantinedYouTubeChannelLocators(dossier);
    if (locators.length > 0) {
      locatorsByCandidate.set(dossier.candidateId, locators);
    }
  }

  return locatorsByCandidate;
}

function getCandidateOffset(options) {
  return boundedNumber(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
}

function getSources(value) {
  const requested = String(value ?? 'youtube,podcastindex,rss')
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);
  const sources = new Set(requested.filter((source) => supportedSources.has(source)));

  return sources.size > 0 ? sources : new Set(['rss']);
}

function getMinConfidence(options) {
  if (options['include-low-confidence']) {
    return 'low';
  }

  const requested = String(options['min-confidence'] ?? 'medium').toLowerCase();
  return confidenceRank[requested] ? requested : 'medium';
}

function filterSuggestions(suggestions, minimumConfidence) {
  return suggestions.filter((suggestion) => confidenceRank[suggestion.confidence] >= confidenceRank[minimumConfidence]);
}

function credentialStatus(sources) {
  const statuses = [];

  if (sources.has('youtube')) {
    statuses.push(`YouTube ${process.env.YOUTUBE_API_KEY ? 'ready' : 'missing'}`);
  }

  if (sources.has('podcastindex')) {
    const isReady = process.env.PODCASTINDEX_API_KEY && process.env.PODCASTINDEX_API_SECRET;
    statuses.push(`PodcastIndex ${isReady ? 'authenticated' : 'public fallback'}`);
  }

  if (sources.has('rss')) {
    statuses.push('RSS no key needed');
  }

  return statuses.join(', ');
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

async function discoverKnownYouTubeChannels(
  candidates,
  max,
  failuresList,
  { locatorOverrides, trustLocatorSources = true, discoveryPrefix = 'known' } = {},
) {
  const candidatesByChannelId = new Map();
  const candidatesByLocator = new Map();
  const suggestionsByCandidateId = new Map();

  for (const candidate of candidates) {
    const locators = (locatorOverrides?.get(candidate.id) ?? candidateKnownYouTubeChannelLocators(candidate)).slice(
      0,
      max,
    );
    if (locators.length === 0) {
      continue;
    }

    youtubeDirectCandidateCount += 1;
    for (const locator of locators) {
      if (locator.filter === 'id') {
        const entries = candidatesByChannelId.get(locator.value) ?? [];
        entries.push(candidate);
        candidatesByChannelId.set(locator.value, entries);
        continue;
      }

      const key = `${locator.filter}|${locator.value.toLowerCase()}`;
      const entry = candidatesByLocator.get(key) ?? { locator, candidates: [] };
      entry.candidates.push(candidate);
      candidatesByLocator.set(key, entry);
    }
  }

  for (const channelIds of chunks(Array.from(candidatesByChannelId.keys()), 50)) {
    const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelUrl.searchParams.set('part', 'snippet,statistics');
    channelUrl.searchParams.set('id', channelIds.join(','));
    channelUrl.searchParams.set('maxResults', '50');
    channelUrl.searchParams.set('key', process.env.YOUTUBE_API_KEY);
    youtubeDirectLookupCalls += 1;

    try {
      const channelPayload = await fetchJson(channelUrl);
      for (const item of channelPayload.items ?? []) {
        for (const candidate of candidatesByChannelId.get(item.id) ?? []) {
          addKnownYouTubeSuggestion(suggestionsByCandidateId, candidate, item, 'known-channel-id');
        }
      }
    } catch (error) {
      failuresList.push({
        source: 'youtube-known-channel-batch',
        channelIds,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const { locator, candidates: locatorCandidates } of candidatesByLocator.values()) {
    try {
      let channelPayload = await fetchKnownYouTubeLocator(locator.filter, locator.value);
      let discoveryMethod = `${discoveryPrefix}-${locator.filter}`;
      if ((channelPayload.items ?? []).length === 0 && locator.fallbackFilter) {
        channelPayload = await fetchKnownYouTubeLocator(locator.fallbackFilter, locator.value);
        discoveryMethod = `${discoveryPrefix}-${locator.fallbackFilter}`;
      }

      for (const item of channelPayload.items ?? []) {
        for (const candidate of locatorCandidates) {
          addKnownYouTubeSuggestion(
            suggestionsByCandidateId,
            candidate,
            item,
            discoveryMethod,
            {
              provenanceSourceUrl: locator.sourceUrl,
              trustedKnownSourceUrl: trustLocatorSources ? locator.sourceUrl : undefined,
            },
          );
        }
      }
    } catch (error) {
      failuresList.push({
        source: `${discoveryPrefix}-youtube-channel-locator`,
        locator,
        candidateIds: locatorCandidates.map((candidate) => candidate.id),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return suggestionsByCandidateId;
}

async function fetchKnownYouTubeLocator(filter, value) {
  const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
  channelUrl.searchParams.set('part', 'snippet,statistics');
  channelUrl.searchParams.set(filter, value);
  channelUrl.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  youtubeDirectLookupCalls += 1;
  const payload = await fetchJson(channelUrl);
  if (youtubeDirectDelayMs > 0) {
    await sleep(youtubeDirectDelayMs);
  }
  return payload;
}

function addKnownYouTubeSuggestion(
  suggestionsByCandidateId,
  candidate,
  item,
  discoveryMethod,
  sourceContext,
) {
  const suggestions = suggestionsByCandidateId.get(candidate.id) ?? [];
  const suggestion = youtubeSuggestion(candidate, item, discoveryMethod, sourceContext);
  if (!suggestions.some((existing) => existing.url === suggestion.url)) {
    suggestions.push(suggestion);
  }
  suggestionsByCandidateId.set(candidate.id, suggestions);
}

function youtubeSuggestion(candidate, item, discoveryMethod = 'search', sourceContext = {}) {
  const channelId = item.id;
  const statistics = item.statistics ?? {};
  const hiddenSubscriberCount = Boolean(statistics.hiddenSubscriberCount);
  const subscriberCount = hiddenSubscriberCount ? undefined : numberOrUndefined(statistics.subscriberCount);
  const videoCount = numberOrUndefined(statistics.videoCount);
  const label = item.snippet?.title ?? 'YouTube channel';
  const description = item.snippet?.description;
  const url = `https://www.youtube.com/channel/${channelId}`;
  const provenanceSourceUrl = sourceContext.provenanceSourceUrl;
  const trustedKnownSourceUrl = sourceContext.trustedKnownSourceUrl;

  return {
    source: 'youtube-data-api',
    platform: 'youtube',
    label,
    url,
    candidateId: candidate.id,
    confidence: youtubeIdentityConfidence({
      candidate,
      label,
      description,
      suggestionUrl: trustedKnownSourceUrl ?? url,
      subscriberCount,
      videoCount,
    }),
    evidence: [
      description,
      provenanceSourceUrl
        ? `Resolved from candidate-page YouTube locator: ${provenanceSourceUrl}`
        : undefined,
      typeof videoCount === 'number' ? `${videoCount} public videos reported by API.` : undefined,
      typeof subscriberCount === 'number' ? `${subscriberCount} public subscribers reported by API.` : undefined,
    ].filter(Boolean),
    publicCounts: {
      youtubeSubscribers: subscriberCount,
      youtubeVideos: videoCount,
    },
    sourceUrls: Array.from(new Set([provenanceSourceUrl, url].filter(Boolean))),
    verified: false,
    discoveryMethod,
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

async function discoverPodcastIndexPublic(candidate, max, failuresList) {
  try {
    const url = new URL('https://api.podcastindex.org/search');
    url.searchParams.set('term', `${candidate.name} podcast`);

    const payload = await fetchJson(url, { headers: podcastIndexPublicHeaders() });
    return (payload.results ?? []).slice(0, max).map((feed) => podcastIndexPublicSuggestion(candidate, feed));
  } catch (error) {
    failuresList.push({
      source: 'podcastindex-public',
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
    'User-Agent': researchUserAgent(),
    'X-Auth-Key': authKey,
    'X-Auth-Date': authDate,
    Authorization: authorization,
  };
}

function podcastIndexPublicHeaders() {
  return {
    'User-Agent': researchUserAgent(),
  };
}

function researchUserAgent() {
  return (
    process.env.BEGLIB_RESEARCH_USER_AGENT ??
    'beGlibCommercialAutomation/0.1 (creator-source-discovery; local private research)'
  );
}

function podcastIndexSuggestion(candidate, feed) {
  const label = feed.title ?? feed.author ?? 'Podcast feed';
  const url = feed.link || feed.url || feed.originalUrl || `https://podcastindex.org/podcast/${feed.id}`;
  const ownerEvidence = [feed.author, feed.ownerName].filter(Boolean);
  const evidence = [...ownerEvidence, feed.description].filter(Boolean).slice(0, 4);

  return {
    source: 'podcastindex-api',
    platform: 'podcast',
    label,
    url,
    candidateId: candidate.id,
    confidence: podcastIdentityConfidence(candidate, label, ownerEvidence, evidence, url),
    evidence,
    publicCounts: {},
    sourceUrls: [feed.url, feed.originalUrl, url].filter(Boolean),
    verified: false,
    reviewerNote: 'Suggestion only. Human identity match required before applying as verified podcast signal.',
  };
}

function podcastIndexPublicSuggestion(candidate, feed) {
  const label = feed.trackName ?? feed.collectionName ?? 'Podcast feed';
  const url = feed.feedUrl || feed.collectionViewUrl || feed.trackViewUrl;
  const ownerEvidence = [feed.artistName].filter(Boolean);
  const evidence = [
    ...ownerEvidence,
    Array.isArray(feed.genres) ? feed.genres.join(', ') : undefined,
    typeof feed.trackCount === 'number' ? `${feed.trackCount} public episodes reported by API.` : undefined,
  ].filter(Boolean);

  return {
    source: 'podcastindex-public-search',
    platform: 'podcast',
    label,
    url,
    candidateId: candidate.id,
    confidence: podcastIdentityConfidence(candidate, label, ownerEvidence, evidence, url),
    evidence,
    publicCounts: {
      podcastEpisodes: numberOrUndefined(feed.trackCount),
    },
    sourceUrls: [feed.feedUrl, feed.collectionViewUrl, feed.trackViewUrl].filter(Boolean),
    verified: false,
    reviewerNote: 'Public search suggestion only. Human identity match required before applying as verified podcast signal.',
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
  const evidence = [
    parsedFeed.description,
    ...parsedFeed.items.map((item) => [item.title, item.pubDate].filter(Boolean).join(' — ')),
  ].filter(Boolean).slice(0, 5);

  return {
    source: 'rss-feed',
    platform,
    label,
    url,
    candidateId: candidate.id,
    confidence: identityConfidence(candidate, [label, ...evidence], url),
    evidence,
    publicCounts: {},
    sourceUrls: [feed.url, url].filter(Boolean),
    verified: false,
    reviewerNote: 'Suggestion only. Human identity match required before applying as verified creator signal.',
  };
}

function buildReviewItem(candidate, suggestions, deprioritizedSuggestionsForCandidate) {
  return {
    candidateId: candidate.id,
    name: candidate.name,
    title: candidate.title,
    category: candidate.primaryCategory,
    country: candidate.country,
    priority: suggestions.length > 0 ? 'medium' : deprioritizedSuggestionsForCandidate.length > 0 ? 'low' : 'high',
    sourceHints: (candidate.sourceUrls ?? []).slice(0, 8),
    suggestions,
    deprioritizedSuggestions: deprioritizedSuggestionsForCandidate,
    filteredSuggestionCount: deprioritizedSuggestionsForCandidate.length,
    discoveredSuggestionsCount: suggestions.length + deprioritizedSuggestionsForCandidate.length,
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
    `Offset: ${reviewPackage.summary.offset}`,
    '',
    'Suggestions are discovery hints only. Human identity match is required before applying creator signals.',
    '',
    '## Summary',
    '',
    `- YouTube suggestions: ${reviewPackage.summary.youtubeSuggestions}`,
    `- YouTube mode: ${reviewPackage.summary.youtubeMode}`,
    `- Known-channel candidates: ${reviewPackage.summary.youtubeDirectCandidateCount}`,
    `- channels.list calls: ${reviewPackage.summary.youtubeDirectLookupCalls}`,
    `- search.list calls: ${reviewPackage.summary.youtubeSearchCalls}`,
    `- Search-limit skips: ${reviewPackage.summary.youtubeSearchLimitSkips}`,
    `- PodcastIndex suggestions: ${reviewPackage.summary.podcastIndexSuggestions}`,
    `- RSS suggestions: ${reviewPackage.summary.rssSuggestions}`,
    `- Skipped source attempts: ${reviewPackage.summary.skippedSources}`,
    `- Fallback source attempts: ${reviewPackage.summary.fallbackSources}`,
    `- Priority suggestions: ${reviewPackage.summary.prioritySuggestions}`,
    `- Deprioritized suggestions retained: ${reviewPackage.summary.deprioritizedSuggestions}`,
    `- Minimum confidence: ${reviewPackage.summary.minConfidence}`,
    `- Candidate delay: ${reviewPackage.summary.candidateDelayMs}ms`,
    `- Request retries: ${reviewPackage.summary.requestRetries}`,
    `- Request timeout: ${reviewPackage.summary.timeoutMs}ms`,
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
    lines.push(`- Total discovered suggestions: ${item.discoveredSuggestionsCount}`);
    lines.push(`- Deprioritized suggestions retained: ${item.deprioritizedSuggestions.length}`);
    lines.push('- Priority suggestions:');

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

    if (item.deprioritizedSuggestions.length > 0) {
      lines.push('- Deprioritized suggestions retained:');
      item.deprioritizedSuggestions.forEach((suggestion) => {
        lines.push(`  - ${suggestion.platform}: ${suggestion.label}`);
        lines.push(`    - URL: ${suggestion.url}`);
        lines.push(`    - Source: ${suggestion.source}`);
        lines.push(`    - Confidence: ${suggestion.confidence}`);
      });
    }

    lines.push('- Review checks:');
    item.reviewChecks.forEach((check) => lines.push(`  - [ ] ${check}`));
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

async function fetchJson(url, init = {}) {
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      return response.json();
    }

    const message = await responseErrorMessage(url, response);
    const canRetry = isRetryableStatus(response.status) && attempt < requestRetries;
    if (!canRetry) {
      throw new Error(message);
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw new Error(`${url.hostname} request failed after retries.`);
}

async function responseErrorMessage(url, response) {
  const body = await response.text();
  const reason = extractErrorReason(body);
  const suffix = reason ? ` (${reason})` : '';

  return `${url.hostname} request failed: ${response.status} ${response.statusText}${suffix}`;
}

function extractErrorReason(body) {
  if (!body) {
    return '';
  }

  try {
    const payload = JSON.parse(body);
    return payload.error?.errors?.[0]?.reason || payload.error?.message || '';
  } catch {
    return body.slice(0, 160);
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function readTextSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) });
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

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function countAllSuggestions(items, source) {
  return items.reduce(
    (count, item) =>
      count +
      item.suggestions.filter((suggestion) => suggestion.source === source).length +
      item.deprioritizedSuggestions.filter((suggestion) => suggestion.source === source).length,
    0,
  );
}

function countAllSuggestionsByPrefix(items, prefix) {
  return items.reduce(
    (count, item) =>
      count +
      item.suggestions.filter((suggestion) => suggestion.source.startsWith(prefix)).length +
      item.deprioritizedSuggestions.filter((suggestion) => suggestion.source.startsWith(prefix)).length,
    0,
  );
}

function countPrioritySuggestions(items) {
  return items.reduce((count, item) => count + item.suggestions.length, 0);
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

function getYouTubeMode(value) {
  const mode = String(value ?? 'direct-first').trim().toLowerCase();
  if (!['direct-first', 'known-only', 'locator-only', 'search-only'].includes(mode)) {
    throw new Error('--youtube-mode must be direct-first, known-only, locator-only, or search-only.');
  }

  return mode;
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
