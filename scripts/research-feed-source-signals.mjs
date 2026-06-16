import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { loadLocalEnv } from './lib/local-env.mjs';

const parser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
});
const supportedModes = new Set(['public-page-contact-source-discovery']);
const args = parseArgs(process.argv.slice(2));
const localEnv = await loadLocalEnv(args['local-env'] ?? args['env-path'] ?? args['env-file']);
const inputDir = resolve(args['input-dir'] ?? 'exports');
const sourceBatchId = args['source-batch-id'];
const filenameIncludes = listArg(args['filename-includes']);
const filenameExcludes = listArg(args['filename-excludes']);
const sourceLimit = boundedNumber(args.limit, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
const sourceOffset = boundedNumber(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
const delayMs = boundedNumber(args['delay-ms'], 750, 0, 60000);
const requestRetries = boundedNumber(args.retries, 1, 0, 5);
const retryDelayMs = boundedNumber(args['retry-delay-ms'], 3000, 250, 60000);
const timeoutMs = boundedNumber(args['timeout-ms'], 15000, 1000, 120000);
const maxBytes = boundedNumber(args['max-bytes'], 1200000, 50000, 5000000);
const defaultSlug = slugify(sourceBatchId ?? 'feed-source-signals');
const markdownPath = resolve(args.output ?? `exports/${defaultSlug}-feed-source-signals.local.md`);
const jsonPath = resolve(args['json-output'] ?? `exports/${defaultSlug}-feed-source-signals.local.json`);
const parseFailures = [];
const sourcePackages = await loadSourcePackages();
const allFeedSources = collectFeedSources(sourcePackages);
const selectedFeedSources = allFeedSources.slice(sourceOffset, sourceOffset + sourceLimit);
const scanFailures = [];
const items = [];

for (let index = 0; index < selectedFeedSources.length; index += 1) {
  const feedSource = selectedFeedSources[index];
  const item = await scanFeedSource(feedSource);
  items.push(item);

  if (delayMs > 0 && index < selectedFeedSources.length - 1) {
    await sleep(delayMs);
  }
}

const discoveryPackage = {
  reviewId: `${defaultSlug}-feed-source-signals`,
  createdAt: new Date().toISOString(),
  sourceBatchId: sourceBatchId ?? inferSourceBatchId(sourcePackages),
  mode: 'feed-source-signal-discovery',
  inputDir,
  sourcePackageFiles: sourcePackages.map((entry) => entry.file),
  summary: {
    sourcePackages: sourcePackages.length,
    discoveredFeedSources: allFeedSources.length,
    selectedFeedSources: selectedFeedSources.length,
    offset: sourceOffset,
    parsedFeeds: items.filter((item) => item.feedStatus === 'parsed').length,
    skippedFeeds: items.filter((item) => item.feedStatus.startsWith('skipped')).length,
    failedFeeds: items.filter((item) => item.feedStatus === 'error').length,
    podcastFeeds: items.filter((item) => item.feedType === 'podcast').length,
    newsletterFeeds: items.filter((item) => item.feedType === 'newsletter').length,
    blogFeeds: items.filter((item) => item.feedType === 'blog').length,
    activeFeeds: items.filter((item) => item.activityStatus === 'active').length,
    staleFeeds: items.filter((item) => item.activityStatus === 'stale').length,
    feedItems: items.reduce((count, item) => count + item.recentItems.length, 0),
    publicEmailCandidates: items.reduce((count, item) => count + item.publicEmailCandidates.length, 0),
    candidatesWithParsedFeeds: new Set(items.filter((item) => item.feedStatus === 'parsed').map((item) => item.candidateId))
      .size,
    candidatesWithPublicEmail: new Set(
      items.filter((item) => item.publicEmailCandidates.length > 0).map((item) => item.candidateId),
    ).size,
    parseFailures: parseFailures.length,
    scanFailures: scanFailures.length,
    delayMs,
    requestRetries,
    retryDelayMs,
    timeoutMs,
    maxBytes,
  },
  rules: [
    'Feed source signals are discovery records only.',
    'Feed owner emails and author emails are public email candidates, not verified contact routes.',
    'Do not infer private audience counts or listener counts from feeds.',
    'Do not guess emails or derive address patterns from feed domains.',
    'Human verification is required before applying any feed, podcast, newsletter, author, or email signal to a candidate.',
    'Suppression, jurisdiction, professional context, and sensitive-category review must be complete before campaign use.',
  ],
  parseFailures,
  scanFailures,
  items,
};

await mkdir(dirname(markdownPath), { recursive: true });
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(discoveryPackage, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(discoveryPackage), 'utf8');

console.log(`Feed source signal JSON written to ${jsonPath}`);
console.log(`Feed source signal checklist written to ${markdownPath}`);
console.log(`Feed sources: ${discoveryPackage.summary.selectedFeedSources}`);
console.log(`Parsed feeds: ${discoveryPackage.summary.parsedFeeds}`);
console.log(`Skipped feeds: ${discoveryPackage.summary.skippedFeeds}`);
console.log(`Podcast feeds: ${discoveryPackage.summary.podcastFeeds}`);
console.log(`Newsletter feeds: ${discoveryPackage.summary.newsletterFeeds}`);
console.log(`Blog feeds: ${discoveryPackage.summary.blogFeeds}`);
console.log(`Public email candidates: ${discoveryPackage.summary.publicEmailCandidates}`);
console.log(`Scan failures: ${discoveryPackage.summary.scanFailures}`);

if (localEnv.loaded) {
  console.log(`Loaded local env file: ${localEnv.path} (${localEnv.variables.length} values applied)`);
}

async function loadSourcePackages() {
  const files = await findJsonFiles(inputDir);
  const packages = [];

  for (const file of files) {
    try {
      const fileName = basename(file);
      if (!matchesFilenameFilters(fileName)) {
        continue;
      }

      const payload = JSON.parse(await readFile(file, 'utf8'));
      if (!supportedModes.has(payload.mode)) {
        continue;
      }

      if (sourceBatchId && payload.sourceBatchId !== sourceBatchId) {
        continue;
      }

      packages.push({ file, payload });
    } catch (error) {
      parseFailures.push({
        file,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return packages;
}

async function findJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(dir, entry.name))
    .sort();
}

function collectFeedSources(packages) {
  const sources = [];

  for (const entry of packages) {
    for (const item of entry.payload.items ?? []) {
      for (const feed of item.feedLinks ?? []) {
        sources.push({
          candidateId: item.candidateId,
          name: item.name,
          category: item.category,
          country: item.country,
          sourcePackageFile: entry.file,
          sourcePageUrl: item.finalUrl || item.sourceUrl,
          sourcePageTitle: item.pageTitle,
          label: feed.label,
          url: feed.url,
        });
      }
    }
  }

  return uniqueByKey(
    sources.filter((source) => isHttpUrl(source.url) && isFeedLikeUrl(source.url, source.label)),
    (source) => `${source.candidateId}|${normalizeUrl(source.url)}`,
  );
}

async function scanFeedSource(feedSource) {
  const baseItem = {
    candidateId: feedSource.candidateId,
    name: feedSource.name,
    category: feedSource.category,
    country: feedSource.country,
    sourcePackageFile: feedSource.sourcePackageFile,
    sourcePageUrl: feedSource.sourcePageUrl,
    sourcePageTitle: feedSource.sourcePageTitle,
    feedUrl: feedSource.url,
    feedLabel: feedSource.label,
    finalUrl: '',
    feedStatus: 'pending',
    httpStatus: null,
    contentType: '',
    feedType: 'unknown',
    title: '',
    siteUrl: '',
    description: '',
    language: '',
    authorCandidates: [],
    publicEmailCandidates: [],
    latestPublishedAt: '',
    activityStatus: 'unknown',
    recentItems: [],
    reviewChecks: [
      'Confirm feed ownership and candidate identity match before applying creator/media signals.',
      'Treat feed owner or author emails as public email candidates only.',
      'Do not infer listener, subscriber, or audience counts from feed metadata.',
      'Check source URL, jurisdiction, suppression status, and sensitive-category status before any campaign use.',
    ],
    reviewOutcome: {
      candidateId: feedSource.candidateId,
      outcomeStatus: 'pending',
      verifiedFeedUrl: '',
      verifiedChannelType: '',
      verifiedPublicEmails: [],
      sourceUrls: [],
      reviewerNotes: '',
    },
  };

  try {
    const response = await fetchWithRetries(feedSource.url);
    const contentType = response.headers.get('content-type') ?? '';
    const body = (await response.text()).slice(0, maxBytes);

    if (!looksLikeFeed(body, contentType)) {
      return {
        ...baseItem,
        finalUrl: response.url || feedSource.url,
        feedStatus: 'skipped-not-feed',
        httpStatus: response.status,
        contentType,
      };
    }

    const parsed = parser.parse(body);
    if (!parsed.rss?.channel && !parsed.feed) {
      return {
        ...baseItem,
        finalUrl: response.url || feedSource.url,
        feedStatus: 'skipped-not-feed',
        httpStatus: response.status,
        contentType,
      };
    }

    const feed = normalizeFeed(parsed, feedSource);
    const latestPublishedAt = latestDate(feed.recentItems.map((item) => item.publishedAt));

    return {
      ...baseItem,
      finalUrl: response.url || feedSource.url,
      feedStatus: 'parsed',
      httpStatus: response.status,
      contentType,
      ...feed,
      latestPublishedAt,
      activityStatus: assessActivity(latestPublishedAt),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scanFailures.push({
      candidateId: feedSource.candidateId,
      feedUrl: feedSource.url,
      message,
    });

    return {
      ...baseItem,
      feedStatus: 'error',
      error: message,
    };
  }
}

async function fetchWithRetries(url) {
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    const response = await fetch(url, { headers: requestHeaders(), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      return response;
    }

    const message = `${new URL(url).hostname} request failed: ${response.status} ${response.statusText}`;
    const canRetry = isRetryableStatus(response.status) && attempt < requestRetries;
    if (!canRetry) {
      throw new Error(message);
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw new Error(`${new URL(url).hostname} request failed after retries.`);
}

function normalizeFeed(parsed, feedSource) {
  if (parsed.rss?.channel) {
    return normalizeRssFeed(parsed.rss.channel, feedSource);
  }

  if (parsed.feed) {
    return normalizeAtomFeed(parsed.feed, feedSource);
  }

  throw new Error('Document is not RSS or Atom.');
}

function normalizeRssFeed(channel, feedSource) {
  const items = asArray(channel.item).slice(0, 12).map((item) => ({
    title: textValue(item.title).slice(0, 180),
    url: textValue(item.link || item.guid),
    publishedAt: normalizeDate(textValue(item.pubDate || item['dc:date'] || item['atom:updated'])),
    author: textValue(item.author || item['dc:creator'] || item['itunes:author']),
  }));
  const ownerEmail = textValue(channel['itunes:owner']?.['itunes:email'] || channel['itunes:email'] || channel.managingEditor);
  const authorCandidates = unique([
    textValue(channel.author),
    textValue(channel['itunes:author']),
    textValue(channel.managingEditor).replace(/<[^>]+>/g, '').trim(),
    ...items.map((item) => item.author),
  ]).slice(0, 8);
  const publicEmailCandidates = emailCandidates([ownerEmail, textValue(channel.webMaster), textValue(channel.managingEditor)], feedSource.url);
  const feedType = classifyFeedType({
    feedUrl: feedSource.url,
    title: textValue(channel.title),
    description: textValue(channel.description || channel['itunes:summary']),
    explicitPodcastTag: Boolean(channel['itunes:owner'] || channel['itunes:category'] || channel.enclosure || items.some((item) => item.url?.includes('.mp3'))),
  });

  return {
    feedType,
    title: textValue(channel.title).slice(0, 180),
    siteUrl: textValue(channel.link),
    description: textValue(channel.description || channel['itunes:summary']).slice(0, 500),
    language: textValue(channel.language),
    authorCandidates,
    publicEmailCandidates,
    recentItems: items,
  };
}

function normalizeAtomFeed(feed, feedSource) {
  const entries = asArray(feed.entry).slice(0, 12).map((entry) => ({
    title: textValue(entry.title).slice(0, 180),
    url: getAtomLink(entry.link),
    publishedAt: normalizeDate(textValue(entry.updated || entry.published)),
    author: atomAuthor(entry.author),
  }));
  const authorCandidates = unique([
    atomAuthor(feed.author),
    ...entries.map((entry) => entry.author),
  ]).slice(0, 8);
  const publicEmailCandidates = emailCandidates([atomEmail(feed.author), ...asArray(feed.entry).map((entry) => atomEmail(entry.author))], feedSource.url);
  const title = textValue(feed.title);
  const description = textValue(feed.subtitle || feed.summary);
  const feedType = classifyFeedType({
    feedUrl: feedSource.url,
    title,
    description,
    explicitPodcastTag: false,
  });

  return {
    feedType,
    title: title.slice(0, 180),
    siteUrl: getAtomLink(feed.link),
    description: description.slice(0, 500),
    language: textValue(feed['@_xml:lang']),
    authorCandidates,
    publicEmailCandidates,
    recentItems: entries,
  };
}

function classifyFeedType({ feedUrl, title, description, explicitPodcastTag }) {
  const text = normalizeSearchText([feedUrl, title, description].join(' '));

  if (explicitPodcastTag || tokenInText(text, 'podcast') || tokenInText(text, 'episode')) {
    return 'podcast';
  }

  if (tokenInText(text, 'newsletter') || tokenInText(text, 'substack')) {
    return 'newsletter';
  }

  if (tokenInText(text, 'blog') || tokenInText(text, 'news') || tokenInText(text, 'feed')) {
    return 'blog';
  }

  return 'feed';
}

function emailCandidates(values, sourceUrl) {
  return unique(
    values
      .flatMap((value) => String(value ?? '').match(/[^\s<>()]+@[^\s<>()]+\.[^\s<>()]+/g) ?? [])
      .map((value) => value.replace(/[.,;:]+$/, '').trim())
      .filter(isEmail)
      .map((value) => value.toLowerCase()),
  )
    .slice(0, 8)
    .map((value) => ({
      source: 'feed-public-email',
      type: 'public-email-candidate',
      value,
      sourceUrl,
      verified: false,
      reviewerNote: 'Public feed email candidate only. Human verification is required before using as a contact route.',
    }));
}

function looksLikeFeed(body, contentType) {
  const trimmed = body.trimStart().slice(0, 300).toLowerCase();
  return (
    /rss|atom|xml/.test(contentType.toLowerCase()) ||
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<rss') ||
    trimmed.startsWith('<feed')
  );
}

function isFeedLikeUrl(value, label) {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    const text = normalizeSearchText(label ?? '');
    return (
      /(^|\/)(feed|rss|atom|podcast)(\/|\.xml|\.rss|\.atom|$)/.test(path) ||
      /\.(rss|atom|xml)$/i.test(path) ||
      /(^| )rss( |$)|(^| )atom( |$)|(^| )podcast( |$)|(^| )feed( |$)/.test(text)
    );
  } catch {
    return false;
  }
}

function assessActivity(value) {
  if (!value) {
    return 'unknown';
  }

  const publishedAt = new Date(value);
  if (Number.isNaN(publishedAt.getTime())) {
    return 'unknown';
  }

  const ageDays = (Date.now() - publishedAt.getTime()) / 86400000;
  if (ageDays <= 365) {
    return 'active';
  }

  return 'stale';
}

function latestDate(values) {
  const dates = values
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  return dates[0]?.toISOString() ?? '';
}

function normalizeDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function getAtomLink(link) {
  const links = asArray(link);
  const preferred = links.find((item) => item?.['@_href'] && (!item['@_rel'] || item['@_rel'] === 'alternate')) ?? links[0];
  return textValue(preferred?.['@_href'] ?? preferred);
}

function atomAuthor(author) {
  const first = asArray(author)[0];
  return textValue(first?.name ?? first);
}

function atomEmail(author) {
  const first = asArray(author)[0];
  return textValue(first?.email);
}

function requestHeaders() {
  return {
    Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*;q=0.7',
    'User-Agent':
      process.env.BEGLIB_RESEARCH_USER_AGENT ??
      'beGlibCommercialAutomation/0.1 (feed-source-signal-discovery; local private research)',
  };
}

function renderMarkdown(discoveryPackage) {
  const lines = [
    `# Feed Source Signal Discovery: ${discoveryPackage.sourceBatchId ?? discoveryPackage.reviewId}`,
    '',
    `Generated: ${discoveryPackage.createdAt}`,
    `Feed sources: ${discoveryPackage.summary.selectedFeedSources}`,
    `Offset: ${discoveryPackage.summary.offset}`,
    '',
    'Feed source signals are discovery hints only. Human verification is required before applying feed or email signals.',
    '',
    '## Summary',
    '',
    `- Parsed feeds: ${discoveryPackage.summary.parsedFeeds}`,
    `- Skipped feeds: ${discoveryPackage.summary.skippedFeeds}`,
    `- Failed feeds: ${discoveryPackage.summary.failedFeeds}`,
    `- Podcast feeds: ${discoveryPackage.summary.podcastFeeds}`,
    `- Newsletter feeds: ${discoveryPackage.summary.newsletterFeeds}`,
    `- Blog feeds: ${discoveryPackage.summary.blogFeeds}`,
    `- Active feeds: ${discoveryPackage.summary.activeFeeds}`,
    `- Public email candidates: ${discoveryPackage.summary.publicEmailCandidates}`,
    `- Scan failures: ${discoveryPackage.summary.scanFailures}`,
    '',
    '## Guardrails',
    '',
    ...discoveryPackage.rules.map((rule) => `- ${rule}`),
    '',
  ];

  discoveryPackage.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.name}`);
    lines.push('');
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Feed status: ${item.feedStatus}`);
    lines.push(`- Feed type: ${item.feedType}`);
    lines.push(`- Feed URL: ${item.feedUrl}`);
    if (item.title) {
      lines.push(`- Title: ${item.title}`);
    }
    if (item.latestPublishedAt) {
      lines.push(`- Latest item: ${item.latestPublishedAt}`);
    }
    lines.push(`- Activity: ${item.activityStatus}`);
    lines.push(`- Public email candidates: ${item.publicEmailCandidates.length}`);
    if (item.recentItems.length > 0) {
      lines.push('- Recent items:');
      item.recentItems.slice(0, 5).forEach((feedItem) => {
        lines.push(`  - ${feedItem.publishedAt || 'no date'}: ${feedItem.title}`);
      });
    }
    lines.push('- Review checks:');
    item.reviewChecks.forEach((check) => lines.push(`  - [ ] ${check}`));
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return String(value ?? '').trim();
  }
}

function normalizeSearchText(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenInText(text, token) {
  return new RegExp(`(?:^| )${escapeRegExp(token)}(?: |$)`).test(text);
}

function textValue(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }

  if (value && typeof value === 'object') {
    return textValue(value.value ?? value['#text']);
  }

  return '';
}

function asArray(value) {
  if (typeof value === 'undefined' || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueByKey(values, keyFn) {
  const seen = new Set();
  return values.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function inferSourceBatchId(packages) {
  const ids = unique(packages.map((entry) => entry.payload.sourceBatchId).filter(Boolean));
  return ids.length === 1 ? ids[0] : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArgs(argv) {
  const parsed = {};

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

function matchesFilenameFilters(fileName) {
  const included =
    filenameIncludes.length === 0 || filenameIncludes.some((fragment) => fileName.includes(fragment));
  const excluded = filenameExcludes.some((fragment) => fileName.includes(fragment));

  return included && !excluded;
}

function listArg(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
