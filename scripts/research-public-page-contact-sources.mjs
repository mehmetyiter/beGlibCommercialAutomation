import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { loadLocalEnv } from './lib/local-env.mjs';

const supportedModes = new Set(['orcid-source-discovery', 'public-identity-source-discovery']);
const contactKeywords = [
  'contact',
  'about',
  'bio',
  'profile',
  'people',
  'team',
  'staff',
  'faculty',
  'lab',
  'media',
  'press',
  'booking',
  'speaker',
  'speaking',
  'invite',
  'appearance',
  'management',
  'manager',
  'agent',
  'representative',
  'office',
  'consult',
  'consulting',
];
const platformHosts = [
  'orcid.org',
  'openalex.org',
  'doi.org',
  'wikipedia.org',
  'wikidata.org',
  'youtube.com',
  'youtu.be',
  'x.com',
  'twitter.com',
  'instagram.com',
  'linkedin.com',
  'facebook.com',
  'tiktok.com',
  'researchgate.net',
  'scholar.google.com',
  'semanticscholar.org',
  'scopus.com',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'crossref.org',
];

const args = parseArgs(process.argv.slice(2));
const localEnv = await loadLocalEnv(args['local-env'] ?? args['env-path'] ?? args['env-file']);
const inputDir = resolve(args['input-dir'] ?? 'exports');
const sourceBatchId = args['source-batch-id'];
const filenameIncludes = listArg(args['filename-includes']);
const filenameExcludes = listArg(args['filename-excludes']);
const sourcePackagePaths = listArg(args['source-package']).map((file) => resolve(file));
const includePlatformPages = Boolean(args['include-platform-pages']);
const sourceLimit = boundedNumber(args.limit, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
const sourceOffset = boundedNumber(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
const delayMs = boundedNumber(args['delay-ms'], 1000, 0, 60000);
const requestRetries = boundedNumber(args.retries, 1, 0, 5);
const retryDelayMs = boundedNumber(args['retry-delay-ms'], 3000, 250, 60000);
const timeoutMs = boundedNumber(args['timeout-ms'], 15000, 1000, 120000);
const maxBytes = boundedNumber(args['max-bytes'], 600000, 50000, 2500000);
const defaultSlug = slugify(sourceBatchId ?? 'public-page-contact-sources');
const markdownPath = resolve(args.output ?? `exports/${defaultSlug}-page-contact-sources.local.md`);
const jsonPath = resolve(args['json-output'] ?? `exports/${defaultSlug}-page-contact-sources.local.json`);
const parseFailures = [];
const sourcePackages = await loadSourcePackages();
const allPageSources = collectPageSources(sourcePackages);
const selectedPageSources = allPageSources.slice(sourceOffset, sourceOffset + sourceLimit);
const scanFailures = [];
const items = [];

for (let index = 0; index < selectedPageSources.length; index += 1) {
  const pageSource = selectedPageSources[index];
  const item = await scanPageSource(pageSource);
  items.push(item);

  if (delayMs > 0 && index < selectedPageSources.length - 1) {
    await sleep(delayMs);
  }
}

const discoveryPackage = {
  reviewId: `${defaultSlug}-page-contact-sources`,
  createdAt: new Date().toISOString(),
  sourceBatchId: sourceBatchId ?? inferSourceBatchId(sourcePackages),
  mode: 'public-page-contact-source-discovery',
  inputDir,
  sourcePackageFiles: sourcePackages.map((entry) => entry.file),
  summary: {
    sourcePackages: sourcePackages.length,
    discoveredPageSources: allPageSources.length,
    selectedPageSources: selectedPageSources.length,
    offset: sourceOffset,
    fetchedPages: items.filter((item) => item.fetchStatus === 'fetched').length,
    skippedPages: items.filter((item) => item.fetchStatus.startsWith('skipped')).length,
    failedPages: items.filter((item) => item.fetchStatus === 'error').length,
    contactPageCandidates: items.reduce((count, item) => count + item.contactPageCandidates.length, 0),
    mailtoEmailCandidates: items.reduce((count, item) => count + item.emailCandidates.length, 0),
    socialLinks: items.reduce((count, item) => count + item.socialLinks.length, 0),
    feedLinks: items.reduce((count, item) => count + item.feedLinks.length, 0),
    candidatesWithMailto: new Set(items.filter((item) => item.emailCandidates.length > 0).map((item) => item.candidateId))
      .size,
    candidatesWithContactPages: new Set(
      items.filter((item) => item.contactPageCandidates.length > 0).map((item) => item.candidateId),
    ).size,
    parseFailures: parseFailures.length,
    scanFailures: scanFailures.length,
    delayMs,
    requestRetries,
    retryDelayMs,
    timeoutMs,
    maxBytes,
    includePlatformPages,
  },
  rules: [
    'Public page contact discovery is not outreach approval.',
    'The worker only records public page links and explicit mailto links; it does not guess emails.',
    'The worker does not store raw HTML.',
    'Known social, academic-index, DOI, and knowledge-graph hosts are skipped by default instead of fetched.',
    'Human verification is required before converting any page, email, social profile, or form into a contact route.',
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

console.log(`Public page contact source JSON written to ${jsonPath}`);
console.log(`Public page contact source checklist written to ${markdownPath}`);
console.log(`Source packages: ${discoveryPackage.summary.sourcePackages}`);
console.log(`Page sources: ${discoveryPackage.summary.selectedPageSources}`);
console.log(`Fetched pages: ${discoveryPackage.summary.fetchedPages}`);
console.log(`Skipped pages: ${discoveryPackage.summary.skippedPages}`);
console.log(`Contact page candidates: ${discoveryPackage.summary.contactPageCandidates}`);
console.log(`Mailto email candidates: ${discoveryPackage.summary.mailtoEmailCandidates}`);
console.log(`Social links: ${discoveryPackage.summary.socialLinks}`);
console.log(`Feed links: ${discoveryPackage.summary.feedLinks}`);
console.log(`Scan failures: ${discoveryPackage.summary.scanFailures}`);

if (localEnv.loaded) {
  console.log(`Loaded local env file: ${localEnv.path} (${localEnv.variables.length} values applied)`);
}

async function loadSourcePackages() {
  const files = sourcePackagePaths.length > 0 ? sourcePackagePaths : await findJsonFiles(inputDir);
  const packages = [];

  for (const file of files) {
    try {
      const fileName = basename(file);
      if (sourcePackagePaths.length === 0 && !matchesFilenameFilters(fileName)) {
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

function collectPageSources(packages) {
  const sources = [];

  for (const entry of packages) {
    for (const item of entry.payload.items ?? []) {
      if (entry.payload.mode === 'orcid-source-discovery') {
        sources.push(...orcidItemSources(item, entry.file));
      }

      if (entry.payload.mode === 'public-identity-source-discovery') {
        sources.push(...identityItemSources(item, entry.file));
      }
    }
  }

  return uniqueByKey(
    sources.filter((source) => source.url && isHttpUrl(source.url)),
    (source) => `${source.candidateId}|${normalizeUrl(source.url)}`,
  );
}

function orcidItemSources(item, file) {
  return (item.researcherUrls ?? []).map((link) => ({
    candidateId: item.candidateId,
    name: item.name,
    category: item.category,
    country: item.country,
    sourcePackageFile: file,
    sourceType: link.source ?? 'orcid-researcher-url',
    sourcePlatform: link.platform ?? classifyPlatform(link.url),
    sourceConfidence: link.confidence ?? 'unknown',
    label: link.label ?? '',
    url: link.url,
  }));
}

function identityItemSources(item, file) {
  return (item.identityLinks ?? [])
    .filter((link) => ['website', 'profile'].includes(link.platform))
    .map((link) => ({
      candidateId: item.candidateId,
      name: item.name,
      category: item.category,
      country: item.country,
      sourcePackageFile: file,
      sourceType: link.source ?? 'public-identity-link',
      sourcePlatform: link.platform ?? classifyPlatform(link.url),
      sourceConfidence: link.confidence ?? 'unknown',
      label: link.label ?? '',
      url: link.url,
    }));
}

async function scanPageSource(pageSource) {
  const baseItem = {
    candidateId: pageSource.candidateId,
    name: pageSource.name,
    category: pageSource.category,
    country: pageSource.country,
    sourcePackageFile: pageSource.sourcePackageFile,
    sourceType: pageSource.sourceType,
    sourcePlatform: pageSource.sourcePlatform,
    sourceConfidence: pageSource.sourceConfidence,
    sourceLabel: pageSource.label,
    sourceUrl: pageSource.url,
    finalUrl: '',
    fetchStatus: 'pending',
    httpStatus: null,
    contentType: '',
    pageTitle: '',
    metaDescription: '',
    canonicalUrl: '',
    contactPageCandidates: [],
    emailCandidates: [],
    socialLinks: [],
    feedLinks: [],
    searchTargets: buildSearchTargets(pageSource, []),
    reviewChecks: [
      'Confirm the page belongs to the same person or an official representative, employer, institution, or project.',
      'Open contact-page candidates manually before applying a route.',
      'Treat mailto links as public email candidates only until professional context and jurisdiction are confirmed.',
      'Do not add guessed, obfuscated, private, login-only, or technically restricted contact data.',
      'Complete suppression and sensitive-category review before any campaign use.',
    ],
    reviewOutcome: {
      candidateId: pageSource.candidateId,
      outcomeStatus: 'pending',
      verifiedPageUrl: '',
      verifiedContactRoutes: [],
      verifiedChannels: [],
      sourceUrls: [],
      reviewerNotes: '',
    },
  };

  if (!isHttpUrl(pageSource.url)) {
    return { ...baseItem, fetchStatus: 'skipped-invalid-url' };
  }

  if (!includePlatformPages && isPlatformHost(pageSource.url)) {
    return {
      ...baseItem,
      fetchStatus: 'skipped-platform-host',
      finalUrl: pageSource.url,
      searchTargets: buildSearchTargets(pageSource, []),
    };
  }

  try {
    const response = await fetchWithRetries(pageSource.url);
    const contentType = response.headers.get('content-type') ?? '';
    const finalUrl = response.url || pageSource.url;

    if (!isHtmlContent(contentType)) {
      return {
        ...baseItem,
        fetchStatus: 'skipped-non-html',
        finalUrl,
        httpStatus: response.status,
        contentType,
      };
    }

    const html = (await response.text()).slice(0, maxBytes);
    const pageTitle = extractTitle(html);
    const metaDescription = extractMetaDescription(html);
    const canonicalUrl = extractCanonicalUrl(html, finalUrl);
    const links = extractLinks(html, finalUrl);
    const emailCandidates = extractMailtoEmailCandidates(links, finalUrl);
    const contactPageCandidates = extractContactPageCandidates(links);
    const socialLinks = extractSocialLinks(links);
    const feedLinks = extractFeedLinks(links);

    return {
      ...baseItem,
      finalUrl,
      fetchStatus: 'fetched',
      httpStatus: response.status,
      contentType,
      pageTitle,
      metaDescription,
      canonicalUrl,
      contactPageCandidates,
      emailCandidates,
      socialLinks,
      feedLinks,
      searchTargets: buildSearchTargets(pageSource, contactPageCandidates),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scanFailures.push({
      candidateId: pageSource.candidateId,
      sourceUrl: pageSource.url,
      message,
    });

    return {
      ...baseItem,
      fetchStatus: 'error',
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

function extractLinks(html, baseUrl) {
  const anchors = Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map((match) => {
    const attrs = parseAttributes(match[1]);
    return linkFromAttributes(attrs, stripTags(match[2]), baseUrl, 'a');
  });
  const links = Array.from(html.matchAll(/<link\b([^>]*)>/gi)).map((match) => {
    const attrs = parseAttributes(match[1]);
    return linkFromAttributes(attrs, attrs.title ?? attrs.rel ?? attrs.type ?? '', baseUrl, 'link');
  });

  return [...anchors, ...links].filter((link) => link.href);
}

function linkFromAttributes(attrs, text, baseUrl, tagName) {
  const rawHref = attrs.href ?? '';
  const href = resolveHref(rawHref, baseUrl);

  return {
    tagName,
    href,
    rawHref,
    text: normalizeWhitespace(decodeHtml(text)).slice(0, 160),
    rel: normalizeWhitespace(attrs.rel ?? '').toLowerCase(),
    type: normalizeWhitespace(attrs.type ?? '').toLowerCase(),
  };
}

function extractMailtoEmailCandidates(links, sourceUrl) {
  const candidates = links
    .filter((link) => link.rawHref.toLowerCase().startsWith('mailto:'))
    .flatMap((link) => mailtoEmails(link.rawHref).map((email) => ({ email, link })))
    .filter((entry) => isEmail(entry.email))
    .map((entry) => ({
      source: 'public-page-mailto',
      type: 'public-email-candidate',
      value: entry.email,
      sourceUrl,
      linkText: entry.link.text,
      verified: false,
      reviewerNote:
        'Explicit mailto link found on a public page. Human verification is required before using as a contact route.',
    }));

  return uniqueByKey(candidates, (candidate) => candidate.value.toLowerCase()).slice(0, 10);
}

function extractContactPageCandidates(links) {
  const candidates = links
    .filter((link) => isHttpUrl(link.href))
    .map((link) => {
      const reason = contactReason(link);
      return reason
        ? {
            source: 'public-page-link',
            url: link.href,
            label: link.text || link.rel || link.type || getDomain(link.href),
            reason,
            verified: false,
          }
        : null;
    })
    .filter(Boolean);

  return uniqueByKey(candidates, (candidate) => normalizeUrl(candidate.url)).slice(0, 15);
}

function extractSocialLinks(links) {
  const socialPlatforms = new Set(['youtube', 'x', 'instagram', 'linkedin', 'facebook', 'tiktok', 'newsletter']);
  const socialLinks = links
    .filter((link) => isHttpUrl(link.href))
    .map((link) => ({
      source: 'public-page-link',
      platform: classifyPlatform(link.href),
      url: link.href,
      label: link.text || platformLabel(classifyPlatform(link.href)),
      verified: false,
    }))
    .filter((link) => socialPlatforms.has(link.platform));

  return uniqueByKey(socialLinks, (link) => `${link.platform}|${normalizeUrl(link.url)}`).slice(0, 15);
}

function extractFeedLinks(links) {
  const feeds = links
    .filter((link) => isHttpUrl(link.href))
    .filter((link) => isFeedLikeLink(link))
    .map((link) => ({
      source: 'public-page-feed-link',
      url: link.href,
      label: link.text || link.type || 'Feed',
      verified: false,
    }));

  return uniqueByKey(feeds, (link) => normalizeUrl(link.url)).slice(0, 8);
}

function isFeedLikeLink(link) {
  const relTokens = new Set(link.rel.split(/\s+/).filter(Boolean));
  const type = link.type.toLowerCase();
  const text = normalizeSearchText(link.text);
  const url = new URL(link.href);
  const path = url.pathname.toLowerCase();

  if (relTokens.has('alternate') && /rss|atom|xml|jsonfeed/.test(type)) {
    return true;
  }

  if (/application\/(rss|atom|feed|json)/.test(type) || /text\/xml/.test(type)) {
    return true;
  }

  if (/(^| )rss( |$)|(^| )atom( |$)|(^| )podcast( |$)|(^| )feed( |$)/.test(text)) {
    return true;
  }

  return /(^|\/)(feed|rss|atom|podcast)(\/|\.xml|\.rss|\.atom|$)/.test(path);
}

function contactReason(link) {
  const haystack = normalizeSearchText([link.href, link.rawHref, link.text, link.rel, link.type].join(' '));
  return contactKeywords.find((keyword) => tokenInText(haystack, keyword)) ?? '';
}

function buildSearchTargets(pageSource, contactPageCandidates) {
  const name = quoted(pageSource.name);
  const domain = getDomain(pageSource.url);
  const domainQueries = domain
    ? [
        `site:${domain} ${name} contact`,
        `site:${domain} ${name} email`,
        `site:${domain} ${name} press OR media OR booking`,
      ]
    : [];
  const contactUrlQueries = contactPageCandidates.slice(0, 5).flatMap((candidate) => {
    const contactDomain = getDomain(candidate.url);
    return contactDomain ? [`site:${contactDomain} ${name} email`, `site:${contactDomain} ${name} contact`] : [];
  });
  const genericQueries = [
    `${name} official contact`,
    `${name} public email`,
    `${name} speaker booking`,
    `${name} media office`,
    `${name} representative contact`,
  ];

  return unique([...domainQueries, ...contactUrlQueries, ...genericQueries]).slice(0, 16);
}

function renderMarkdown(discoveryPackage) {
  const lines = [
    `# Public Page Contact Source Discovery: ${discoveryPackage.sourceBatchId ?? discoveryPackage.reviewId}`,
    '',
    `Generated: ${discoveryPackage.createdAt}`,
    `Source packages: ${discoveryPackage.summary.sourcePackages}`,
    `Page sources: ${discoveryPackage.summary.selectedPageSources}`,
    `Offset: ${discoveryPackage.summary.offset}`,
    '',
    'Public page contact findings are discovery hints only. Human verification is required before applying contact routes.',
    '',
    '## Summary',
    '',
    `- Fetched pages: ${discoveryPackage.summary.fetchedPages}`,
    `- Skipped pages: ${discoveryPackage.summary.skippedPages}`,
    `- Failed pages: ${discoveryPackage.summary.failedPages}`,
    `- Contact page candidates: ${discoveryPackage.summary.contactPageCandidates}`,
    `- Mailto email candidates: ${discoveryPackage.summary.mailtoEmailCandidates}`,
    `- Candidates with mailto candidates: ${discoveryPackage.summary.candidatesWithMailto}`,
    `- Social links: ${discoveryPackage.summary.socialLinks}`,
    `- Feed links: ${discoveryPackage.summary.feedLinks}`,
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
    lines.push(`- Fetch status: ${item.fetchStatus}`);
    lines.push(`- Source URL: ${item.sourceUrl}`);
    if (item.finalUrl) {
      lines.push(`- Final URL: ${item.finalUrl}`);
    }
    if (item.pageTitle) {
      lines.push(`- Page title: ${item.pageTitle}`);
    }
    lines.push(`- Contact page candidates: ${item.contactPageCandidates.length}`);
    lines.push(`- Mailto email candidates: ${item.emailCandidates.length}`);
    lines.push(`- Social links: ${item.socialLinks.length}`);
    lines.push(`- Feed links: ${item.feedLinks.length}`);

    if (item.contactPageCandidates.length > 0) {
      lines.push('- Contact page candidates:');
      item.contactPageCandidates.slice(0, 8).forEach((candidate) => {
        lines.push(`  - ${candidate.reason}: ${candidate.url}`);
      });
    }

    if (item.emailCandidates.length > 0) {
      lines.push('- Mailto email candidates:');
      item.emailCandidates.forEach((candidate) => {
        lines.push(`  - ${candidate.value}`);
      });
    }

    if (item.socialLinks.length > 0) {
      lines.push('- Social links:');
      item.socialLinks.slice(0, 8).forEach((link) => {
        lines.push(`  - ${link.platform}: ${link.url}`);
      });
    }

    lines.push('- Search targets:');
    item.searchTargets.slice(0, 8).forEach((target) => lines.push(`  - ${target}`));
    lines.push('- Review checks:');
    item.reviewChecks.forEach((check) => lines.push(`  - [ ] ${check}`));
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function parseAttributes(value) {
  const attrs = {};
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match = pattern.exec(value);

  while (match) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[3] ?? match[4] ?? match[5] ?? '');
    match = pattern.exec(value);
  }

  return attrs;
}

function resolveHref(rawHref, baseUrl) {
  const href = decodeHtml(String(rawHref ?? '').trim());

  if (!href || href.startsWith('#') || /^javascript:/i.test(href) || /^tel:/i.test(href)) {
    return '';
  }

  if (/^mailto:/i.test(href)) {
    return href;
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

function mailtoEmails(rawHref) {
  const value = rawHref.replace(/^mailto:/i, '').split('?')[0];
  return value
    .split(/[;,]/)
    .map((item) => {
      try {
        return decodeURIComponent(item).trim();
      } catch {
        return item.trim();
      }
    })
    .filter(Boolean);
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeWhitespace(decodeHtml(stripTags(match[1]))).slice(0, 180) : '';
}

function extractMetaDescription(html) {
  const metas = Array.from(html.matchAll(/<meta\b([^>]*)>/gi));
  const description = metas
    .map((match) => parseAttributes(match[1]))
    .find((attrs) => ['description', 'og:description', 'twitter:description'].includes((attrs.name ?? attrs.property ?? '').toLowerCase()));

  return normalizeWhitespace(description?.content ?? '').slice(0, 300);
}

function extractCanonicalUrl(html, baseUrl) {
  const links = Array.from(html.matchAll(/<link\b([^>]*)>/gi));
  const canonical = links
    .map((match) => parseAttributes(match[1]))
    .find((attrs) => String(attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'));

  return canonical?.href ? resolveHref(canonical.href, baseUrl) : '';
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }

    return named[entity] ?? match;
  });
}

function requestHeaders() {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent':
      process.env.BEGLIB_RESEARCH_USER_AGENT ??
      'beGlibCommercialAutomation/0.1 (public-page-contact-source-discovery; local private research)',
  };
}

function isHtmlContent(contentType) {
  return !contentType || /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function isPlatformHost(value) {
  const host = getDomain(value);
  return (
    host.startsWith('scholar.google.') ||
    platformHosts.some((platformHost) => host === platformHost || host.endsWith(`.${platformHost}`))
  );
}

function classifyPlatform(value) {
  const host = getDomain(value);

  if (!host) {
    return 'profile';
  }

  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    return 'youtube';
  }
  if (host === 'x.com' || host.includes('twitter.com')) {
    return 'x';
  }
  if (host.includes('instagram.com')) {
    return 'instagram';
  }
  if (host.includes('linkedin.com')) {
    return 'linkedin';
  }
  if (host.includes('tiktok.com')) {
    return 'tiktok';
  }
  if (host.includes('facebook.com')) {
    return 'facebook';
  }
  if (host.includes('substack.com') || host.includes('newsletter')) {
    return 'newsletter';
  }
  if (host.includes('medium.com') || host.includes('wordpress.com') || host.includes('blogspot.com')) {
    return 'blog';
  }
  if (host.includes('podcasts.apple.com') || host.includes('spotify.com') || host.includes('podbean.com')) {
    return 'podcast';
  }

  return 'website';
}

function platformLabel(platform) {
  const labels = {
    youtube: 'YouTube',
    x: 'X/Twitter',
    instagram: 'Instagram',
    linkedin: 'LinkedIn',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    newsletter: 'Newsletter',
  };

  return labels[platform] ?? 'Profile';
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
    return String(value).trim();
  }
}

function getDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
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

function inferSourceBatchId(packages) {
  const ids = unique(packages.map((entry) => entry.payload.sourceBatchId).filter(Boolean));
  return ids.length === 1 ? ids[0] : null;
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

function quoted(value) {
  return `"${String(value).replaceAll('"', '').trim()}"`;
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
