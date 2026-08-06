import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  assessContactPageAttribution,
  assessEmailAttribution,
  assessFeedAttribution,
  assessPageIdentity,
  assessSocialAttribution,
  inferAssociatedPersonLabel,
  isBlockedRoute,
} from './lib/candidate-attribution.mjs';
import { isLikelySyndicationFeed } from './lib/feed-source-quality.mjs';
import { loadLocalEnv } from './lib/local-env.mjs';

const supportedModes = new Set([
  'candidate-batch',
  'orcid-source-discovery',
  'public-identity-source-discovery',
  'public-page-contact-source-discovery',
]);
const pageLikePlatforms = new Set(['website', 'blog', 'newsletter', 'podcast', 'profile']);
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
const genericEmailLocalParts = new Set([
  'admin',
  'admissions',
  'contact',
  'events',
  'hello',
  'info',
  'media',
  'office',
  'press',
  'pr',
  'secretariat',
  'service',
  'speakers',
  'speakers_bureau',
  'studies',
  'support',
  'webmaster',
]);

const args = parseArgs(process.argv.slice(2));
const localEnv = await loadLocalEnv(args['local-env'] ?? args['env-path'] ?? args['env-file']);
const inputDir = resolve(args['input-dir'] ?? 'exports');
const sourceBatchId = args['source-batch-id'];
const filenameIncludes = listArg(args['filename-includes']);
const filenameExcludes = listArg(args['filename-excludes']);
const sourcePackagePaths = unique([
  ...listArg(args['source-package']),
  ...listArg(args.batch),
]).map((file) => resolve(file));
const includePlatformPages = Boolean(args['include-platform-pages']);
const sourceLimit = boundedNumber(args.limit, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);
const sourceOffset = boundedNumber(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
const delayMs = boundedNumber(args['delay-ms'], 1000, 0, 60000);
const requestRetries = boundedNumber(args.retries, 1, 0, 5);
const retryDelayMs = boundedNumber(args['retry-delay-ms'], 3000, 250, 60000);
const timeoutMs = boundedNumber(args['timeout-ms'], 15000, 1000, 120000);
const maxBytes = boundedNumber(args['max-bytes'], 600000, 50000, 2500000);
const maxTraversalDepth = boundedNumber(args['max-depth'], 1, 0, 3);
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
    phoneCandidates: items.reduce((count, item) => count + (item.phoneCandidates?.length ?? 0), 0),
    socialLinks: items.reduce((count, item) => count + item.socialLinks.length, 0),
    feedLinks: items.reduce((count, item) => count + item.feedLinks.length, 0),
    quarantinedContactPageCandidates: items.reduce(
      (count, item) => count + (item.quarantinedContactPageCandidates?.length ?? 0),
      0,
    ),
    quarantinedEmailCandidates: items.reduce(
      (count, item) => count + (item.quarantinedEmailCandidates?.length ?? 0),
      0,
    ),
    quarantinedPhoneCandidates: items.reduce(
      (count, item) => count + (item.quarantinedPhoneCandidates?.length ?? 0),
      0,
    ),
    quarantinedSocialLinks: items.reduce((count, item) => count + (item.quarantinedSocialLinks?.length ?? 0), 0),
    quarantinedFeedLinks: items.reduce((count, item) => count + (item.quarantinedFeedLinks?.length ?? 0), 0),
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
    'The worker records public page links, explicit mailto links, and explicit public component/API contact fields from the same page; it does not guess emails.',
    'The worker does not store raw HTML.',
    'Known social, academic-index, DOI, and knowledge-graph hosts are skipped by default instead of fetched.',
    'Candidate identity must be supported by the page title, heading, URL, or explicit representative context before a route is attributed.',
    'Directory, browse, login, search, pagination, site-wide social, and unrelated-person records are quarantined instead of attributed.',
    `Contact-page traversal is capped at ${maxTraversalDepth} hop(s) by default.`,
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
console.log(`Public email candidates: ${discoveryPackage.summary.mailtoEmailCandidates}`);
console.log(`Phone candidates: ${discoveryPackage.summary.phoneCandidates}`);
console.log(`Social links: ${discoveryPackage.summary.socialLinks}`);
console.log(`Feed links: ${discoveryPackage.summary.feedLinks}`);
console.log(
  `Quarantined discoveries: ${
    discoveryPackage.summary.quarantinedContactPageCandidates +
    discoveryPackage.summary.quarantinedEmailCandidates +
    discoveryPackage.summary.quarantinedPhoneCandidates +
    discoveryPackage.summary.quarantinedSocialLinks +
    discoveryPackage.summary.quarantinedFeedLinks
  }`,
);
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
      const mode = packageMode(payload);
      if (!supportedModes.has(mode)) {
        continue;
      }

      if (sourceBatchId && packageSourceBatchId(payload) !== sourceBatchId) {
        continue;
      }

      packages.push({ file, mode, payload });
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
      if (entry.mode === 'orcid-source-discovery') {
        sources.push(...orcidItemSources(item, entry.file));
      }

      if (entry.mode === 'public-identity-source-discovery') {
        sources.push(...identityItemSources(item, entry.file));
      }

      if (entry.mode === 'public-page-contact-source-discovery') {
        sources.push(...contactCandidateSources(item, entry.file));
      }
    }

    if (entry.mode === 'candidate-batch') {
      sources.push(...candidateBatchSources(entry.payload, entry.file));
    }
  }

  return uniqueByKey(
    sources.filter((source) => source.url && isHttpUrl(source.url)),
    (source) => `${source.candidateId}|${normalizeUrl(source.url)}`,
  );
}

function contactCandidateSources(item, file) {
  const currentDepth = Number.isInteger(item.sourceDepth)
    ? item.sourceDepth
    : item.sourceType === 'public-page-link'
      ? 1
      : 0;
  const nextDepth = currentDepth + 1;

  if (nextDepth > maxTraversalDepth) {
    return [];
  }

  return (item.contactPageCandidates ?? [])
    .filter((page) => page.eligibleForReview !== false)
    .filter((page) => !isBlockedRoute(page.url))
    .map((page) => ({
      candidateId: item.candidateId,
      name: item.name,
      category: item.category,
      country: item.country,
      sourcePackageFile: file,
      sourceType: page.source ?? 'public-page-contact-candidate',
      sourcePlatform: classifyPlatform(page.url),
      sourceConfidence: page.identityConfidence ?? (page.verified ? 'verified' : item.sourceConfidence ?? 'discovered'),
      sourceDepth: nextDepth,
      label: page.label ?? page.reason ?? 'Contact page candidate',
      url: page.url,
    }));
}

function candidateBatchSources(batch, file) {
  return (batch.candidates ?? []).flatMap((candidate) => {
    const channelSources = (candidate.channels ?? [])
      .filter((channel) => channel.url && pageLikePlatforms.has(channel.platform ?? classifyPlatform(channel.url)))
      .filter((channel) => !isPlatformHost(channel.url))
      .map((channel) => ({
        candidateId: candidate.id,
        name: candidate.name,
        category: candidate.primaryCategory,
        country: candidate.country,
        sourcePackageFile: file,
        sourceType: 'candidate-channel',
        sourcePlatform: channel.platform ?? classifyPlatform(channel.url),
        sourceConfidence: channel.verified ? 'verified' : 'unknown',
        sourceDepth: 0,
        label: channel.label ?? 'Candidate public page',
        url: channel.url,
      }));

    const channelUrls = new Set(channelSources.map((source) => normalizeUrl(source.url)));
    const sourceUrlSources = (candidate.sourceUrls ?? [])
      .filter((url) => isHttpUrl(url))
      .filter((url) => pageLikePlatforms.has(classifyPlatform(url)))
      .filter((url) => !isPlatformHost(url))
      .filter((url) => !channelUrls.has(normalizeUrl(url)))
      .map((url) => ({
        candidateId: candidate.id,
        name: candidate.name,
        category: candidate.primaryCategory,
        country: candidate.country,
        sourcePackageFile: file,
        sourceType: 'candidate-source-url',
        sourcePlatform: classifyPlatform(url),
        sourceConfidence: 'unknown',
        sourceDepth: 0,
        label: 'Candidate source URL',
        url,
      }));

    return [...channelSources, ...sourceUrlSources];
  });
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
    sourceDepth: 0,
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
      sourceDepth: 0,
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
    sourceDepth: pageSource.sourceDepth ?? 0,
    sourceLabel: pageSource.label,
    sourceUrl: pageSource.url,
    finalUrl: '',
    fetchStatus: 'pending',
    httpStatus: null,
    contentType: '',
    pageTitle: '',
    pageHeading: '',
    metaDescription: '',
    canonicalUrl: '',
    pageIdentity: {
      level: 'unresolved',
      score: 0,
      evidence: [],
      eligible: false,
    },
    contactPageCandidates: [],
    emailCandidates: [],
    phoneCandidates: [],
    socialLinks: [],
    feedLinks: [],
    quarantinedContactPageCandidates: [],
    quarantinedEmailCandidates: [],
    quarantinedSocialLinks: [],
    quarantinedFeedLinks: [],
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
    const pageHeading = extractPrimaryHeading(html);
    const metaDescription = extractMetaDescription(html);
    const canonicalUrl = extractCanonicalUrl(html, finalUrl);
    const links = extractLinks(html, finalUrl);
    const pageIdentity = assessPageIdentity({
      candidateName: pageSource.name,
      pageTitle,
      pageHeading,
      metaDescription,
      sourceLabel: pageSource.label,
      sourceUrl: pageSource.url,
      finalUrl,
      canonicalUrl,
    });
    const structuredContactCandidates = await extractStructuredContactCandidates({ html, pageSource, sourceUrl: finalUrl });
    const emailDiscovery = extractPublicEmailCandidates({
      html,
      links,
      sourceUrl: finalUrl,
      pageSource,
      pageIdentity,
      structuredEmailCandidates: structuredContactCandidates.emailCandidates,
    });
    const phoneDiscovery = classifyStructuredPhoneCandidates(
      structuredContactCandidates.phoneCandidates,
      pageIdentity,
    );
    const contactPageDiscovery = extractContactPageCandidates(links, pageSource, pageIdentity, finalUrl);
    const socialDiscovery = extractSocialLinks(links, pageSource, pageIdentity, finalUrl);
    const feedDiscovery = extractFeedLinks(links, pageSource, pageIdentity, finalUrl);

    return {
      ...baseItem,
      finalUrl,
      fetchStatus: 'fetched',
      httpStatus: response.status,
      contentType,
      pageTitle,
      pageHeading,
      metaDescription,
      canonicalUrl,
      pageIdentity,
      contactPageCandidates: contactPageDiscovery.accepted,
      emailCandidates: emailDiscovery.accepted,
      phoneCandidates: phoneDiscovery.accepted,
      socialLinks: socialDiscovery.accepted,
      feedLinks: feedDiscovery.accepted,
      quarantinedContactPageCandidates: contactPageDiscovery.quarantined,
      quarantinedEmailCandidates: emailDiscovery.quarantined,
      quarantinedPhoneCandidates: phoneDiscovery.quarantined,
      quarantinedSocialLinks: socialDiscovery.quarantined,
      quarantinedFeedLinks: feedDiscovery.quarantined,
      searchTargets: buildSearchTargets(pageSource, contactPageDiscovery.accepted),
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

async function fetchWithRetries(url, options = {}) {
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    const response = await fetch(url, {
      headers: requestHeaders(options),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
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
    const matchStart = match.index ?? 0;
    const contextHtml = html.slice(Math.max(0, matchStart - 500), matchStart + match[0].length + 220);
    const contextText = normalizeWhitespace(decodeHtml(stripTags(contextHtml))).slice(-500);
    return linkFromAttributes(attrs, stripTags(match[2]), baseUrl, 'a', contextText);
  });
  const links = Array.from(html.matchAll(/<link\b([^>]*)>/gi)).map((match) => {
    const attrs = parseAttributes(match[1]);
    return linkFromAttributes(attrs, attrs.title ?? attrs.rel ?? attrs.type ?? '', baseUrl, 'link');
  });

  return [...anchors, ...links].filter((link) => link.href);
}

function linkFromAttributes(attrs, text, baseUrl, tagName, contextText = '') {
  const rawHref = attrs.href ?? '';
  const href = resolveHref(rawHref, baseUrl);

  return {
    tagName,
    href,
    rawHref,
    text: normalizeWhitespace(decodeHtml(text)).slice(0, 160),
    contextText,
    rel: normalizeWhitespace(attrs.rel ?? '').toLowerCase(),
    type: normalizeWhitespace(attrs.type ?? '').toLowerCase(),
  };
}

function extractPublicEmailCandidates({ html, links, sourceUrl, pageSource, pageIdentity, structuredEmailCandidates = [] }) {
  const candidates = [
    ...structuredEmailCandidates,
    ...extractMailtoEmailCandidates(links, sourceUrl),
    ...extractPlainTextEmailCandidates(html, sourceUrl),
  ]
    .map((candidate) => {
      const assessment = assessEmailAttribution({
        candidateName: pageSource.name,
        email: candidate.value,
        role: candidate.role,
        label: candidate.label,
        linkText: candidate.linkText,
        contextText: candidate.contextText,
        pageIdentity,
      });
      const inferredLabel =
        candidate.label || inferAssociatedPersonLabel(candidate.contextText, candidate.value, assessment.role);
      return {
        ...candidate,
        ...assessment,
        label: inferredLabel || candidate.label,
      };
    });
  const uniqueCandidates = uniqueByKey(
    candidates,
    (candidate) => candidate.value.toLowerCase(),
  ).sort(compareEmailCandidates);

  return {
    accepted: uniqueCandidates.filter((candidate) => candidate.eligibleForReview).slice(0, 20),
    quarantined: uniqueCandidates.filter((candidate) => !candidate.eligibleForReview).slice(0, 50),
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
      contextText: entry.link.contextText,
      role: emailRole(entry.email),
      verified: false,
      reviewerNote:
        'Explicit mailto link found on a public page. Human verification is required before using as a contact route.',
    }));

  return uniqueByKey(candidates, (candidate) => candidate.value.toLowerCase()).slice(0, 30);
}

function extractPlainTextEmailCandidates(html, sourceUrl) {
  const visibleText = normalizeWhitespace(
    decodeHtml(
      stripTags(
        String(html ?? '')
          .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style\b[\s\S]*?<\/style>/gi, ' '),
      ),
    ),
  );
  const pattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;
  const candidates = [];

  for (const match of visibleText.matchAll(pattern)) {
    const email = match[0].replace(/[.,;:!?]+$/, '');
    if (!isEmail(email)) {
      continue;
    }

    const start = Math.max(0, (match.index ?? 0) - 180);
    const end = Math.min(visibleText.length, (match.index ?? 0) + match[0].length + 180);
    candidates.push({
      source: 'public-page-text-email',
      type: 'public-email-candidate',
      value: email,
      sourceUrl,
      contextText: visibleText.slice(start, end),
      role: emailRole(email),
      verified: false,
      reviewerNote:
        'Explicit email text found on a public page. Human verification is required before using as a contact route.',
    });
  }

  return uniqueByKey(candidates, (candidate) => candidate.value.toLowerCase()).slice(0, 30);
}

function classifyStructuredPhoneCandidates(candidates, pageIdentity) {
  const enriched = (candidates ?? []).map((candidate) => {
    const explicitRole = candidate.role ?? '';
    const eligibleForReview =
      pageIdentity.level === 'direct' && ['direct-person', 'support-staff', 'representative'].includes(explicitRole);
    return {
      ...candidate,
      identityAttribution:
        explicitRole === 'direct-person'
          ? 'direct'
          : ['support-staff', 'representative'].includes(explicitRole)
            ? 'representative'
            : 'unresolved',
      identityScore: eligibleForReview ? Math.max(80, pageIdentity.score) : Math.min(49, pageIdentity.score),
      identityConfidence: eligibleForReview ? 'high' : 'low',
      identityEvidence: unique([
        ...(pageIdentity.evidence ?? []),
        eligibleForReview ? 'explicit-structured-contact-role' : 'phone-lacks-candidate-or-representative-identity',
      ]),
      eligibleForReview,
    };
  });

  return {
    accepted: enriched.filter((candidate) => candidate.eligibleForReview),
    quarantined: enriched.filter((candidate) => !candidate.eligibleForReview),
  };
}

async function extractStructuredContactCandidates({ html, pageSource, sourceUrl }) {
  const emailCandidates = [];
  const phoneCandidates = [];

  for (const personId of extractEconUzhPersonIds(html)) {
    const apiUrl = `https://bo.econ.uzh.ch/public/v1/human_resources/people/${personId}`;
    try {
      const response = await fetchWithRetries(apiUrl, { acceptJson: true });
      const payload = await response.json();
      const contacts = extractEconUzhPersonContactCandidates(payload.data ?? payload, sourceUrl, apiUrl, pageSource);
      emailCandidates.push(...contacts.emailCandidates);
      phoneCandidates.push(...contacts.phoneCandidates);
    } catch (error) {
      parseFailures.push({
        candidateId: pageSource.candidateId,
        sourceUrl,
        parser: 'econ-person-detail',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    emailCandidates: uniqueByKey(emailCandidates, (candidate) => `${candidate.value.toLowerCase()}|${candidate.role ?? ''}`).slice(0, 12),
    phoneCandidates: uniqueByKey(phoneCandidates, (candidate) => `${candidate.value}|${candidate.role ?? ''}`).slice(0, 12),
  };
}

function extractEconUzhPersonIds(html) {
  return unique(
    Array.from(html.matchAll(/<econ-person-detail\b([^>]*)>/gi))
      .map((match) => parseAttributes(match[1])['person-id'])
      .filter((value) => /^\d+$/.test(String(value ?? ''))),
  );
}

function extractEconUzhPersonContactCandidates(person, sourceUrl, sourceApiUrl, pageSource) {
  if (!person || typeof person !== 'object') {
    return { emailCandidates: [], phoneCandidates: [] };
  }

  const emailCandidates = [];
  const phoneCandidates = [];
  const personName = normalizePersonName([person.firstname, person.lastname, person.fullname].filter(Boolean).join(' '));
  const candidateName = normalizePersonName(pageSource.name);
  const directRole = namesLikelyMatch(personName, candidateName) ? 'direct-person' : 'listed-person';
  const personLabel = person.fullname || pageSource.name;

  if (isEmail(person.email)) {
    emailCandidates.push({
      source: 'public-component-api',
      type: 'public-email-candidate',
      value: person.email,
      sourceUrl,
      sourceApiUrl,
      label: personLabel,
      role: directRole,
      verified: false,
      reviewerNote:
        'Explicit email field returned by the public UZH person-detail component backing this page. Human verification is required before campaign use.',
    });
  }

  const personPhone = normalizePhone(person.phone_work);
  if (isPublicPhone(personPhone)) {
    phoneCandidates.push({
      source: 'public-component-api',
      type: 'public-phone-candidate',
      value: personPhone,
      sourceUrl,
      sourceApiUrl,
      label: personLabel,
      role: directRole,
      verified: false,
      reviewerNote:
        'Explicit phone_work field returned by the public UZH person-detail component backing this page. Human verification is required before campaign use.',
    });
  }

  const delegate = person.delegate_person;
  if (delegate && typeof delegate === 'object' && isEmail(delegate.email)) {
    emailCandidates.push({
      source: 'public-component-api',
      type: 'public-email-candidate',
      value: delegate.email,
      sourceUrl,
      sourceApiUrl,
      label: delegate.fullname || [delegate.firstname, delegate.lastname].filter(Boolean).join(' '),
      role: 'support-staff',
      verified: false,
      reviewerNote:
        'Explicit support-staff email field returned by the public UZH person-detail component backing this page. Human verification is required before campaign use.',
    });
  }

  const delegatePhone = normalizePhone(delegate?.phone_work);
  if (delegate && typeof delegate === 'object' && isPublicPhone(delegatePhone)) {
    phoneCandidates.push({
      source: 'public-component-api',
      type: 'public-phone-candidate',
      value: delegatePhone,
      sourceUrl,
      sourceApiUrl,
      label: delegate.fullname || [delegate.firstname, delegate.lastname].filter(Boolean).join(' '),
      role: 'support-staff',
      verified: false,
      reviewerNote:
        'Explicit support-staff phone_work field returned by the public UZH person-detail component backing this page. Human verification is required before campaign use.',
    });
  }

  return {
    emailCandidates: emailCandidates.map((candidate) => ({ ...candidate, role: candidate.role ?? emailRole(candidate.value) })),
    phoneCandidates,
  };
}

function compareEmailCandidates(left, right) {
  return emailCandidateRank(left) - emailCandidateRank(right) || left.value.localeCompare(right.value);
}

function emailCandidateRank(candidate) {
  const role = candidate.role ?? emailRole(candidate.value);
  if (role === 'direct-person') {
    return 0;
  }
  if (role === 'listed-person') {
    return 1;
  }
  if (role === 'support-staff') {
    return 2;
  }
  if (role === 'generic-office') {
    return 4;
  }
  return 3;
}

function emailRole(email) {
  const localPart = String(email).split('@')[0]?.toLowerCase() ?? '';
  if (genericEmailLocalParts.has(localPart) || /^(contact|info|press|media|office|support|webmaster)[._-]/.test(localPart)) {
    return 'generic-office';
  }
  return 'public-email';
}

function extractContactPageCandidates(links, pageSource, pageIdentity, sourceUrl) {
  const candidates = links
    .filter((link) => link.tagName === 'a')
    .filter((link) => isHttpUrl(link.href))
    .map((link) => {
      const reason = contactReason(link);
      if (!reason) {
        return null;
      }
      const candidate = {
        source: 'public-page-link',
        url: link.href,
        label: link.text || link.rel || link.type || getDomain(link.href),
        reason,
        contextText: link.contextText,
        verified: false,
      };
      return {
        ...candidate,
        ...assessContactPageAttribution({
          candidateName: pageSource.name,
          url: candidate.url,
          label: candidate.label,
          reason,
          contextText: link.contextText,
          sourceUrl,
          pageIdentity,
        }),
      };
    })
    .filter(Boolean);
  const uniqueCandidates = uniqueByKey(candidates, (candidate) => normalizeUrl(candidate.url));

  return {
    accepted: uniqueCandidates.filter((candidate) => candidate.eligibleForReview).slice(0, 12),
    quarantined: uniqueCandidates.filter((candidate) => !candidate.eligibleForReview).slice(0, 50),
  };
}

function extractSocialLinks(links, pageSource, pageIdentity, sourceUrl) {
  const socialPlatforms = new Set(['youtube', 'x', 'instagram', 'linkedin', 'facebook', 'tiktok', 'newsletter']);
  const socialLinks = links
    .filter((link) => link.tagName === 'a')
    .filter((link) => isHttpUrl(link.href))
    .map((link) => {
      const candidate = {
        source: 'public-page-link',
        platform: classifyPlatform(link.href),
        url: link.href,
        label: link.text || platformLabel(classifyPlatform(link.href)),
        contextText: link.contextText,
        verified: false,
      };
      return {
        ...candidate,
        ...assessSocialAttribution({
          candidateName: pageSource.name,
          url: candidate.url,
          label: candidate.label,
          contextText: link.contextText,
          sourceUrl,
          pageIdentity,
        }),
      };
    })
    .filter((link) => socialPlatforms.has(link.platform));
  const uniqueLinks = uniqueByKey(socialLinks, (link) => `${link.platform}|${normalizeUrl(link.url)}`);

  return {
    accepted: uniqueLinks.filter((link) => link.eligibleForReview).slice(0, 15),
    quarantined: uniqueLinks.filter((link) => !link.eligibleForReview).slice(0, 30),
  };
}

function extractFeedLinks(links, pageSource, pageIdentity, sourceUrl) {
  const feeds = links
    .filter((link) => isHttpUrl(link.href))
    .filter((link) => isFeedLikeLink(link))
    .map((link) => {
      const candidate = {
        source: 'public-page-feed-link',
        url: link.href,
        label: link.text || link.type || 'Feed',
        contextText: link.contextText,
        verified: false,
      };
      return {
        ...candidate,
        ...assessFeedAttribution({
          candidateName: pageSource.name,
          url: candidate.url,
          label: candidate.label,
          sourceUrl,
          pageIdentity,
        }),
      };
    });
  const uniqueFeeds = uniqueByKey(feeds, (link) => normalizeUrl(link.url));

  return {
    accepted: uniqueFeeds.filter((link) => link.eligibleForReview).slice(0, 8),
    quarantined: uniqueFeeds.filter((link) => !link.eligibleForReview).slice(0, 20),
  };
}

function isFeedLikeLink(link) {
  return isLikelySyndicationFeed({
    url: link.href,
    label: link.text,
    type: link.type,
    rel: link.rel,
  });
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
    `- Public email candidates: ${discoveryPackage.summary.mailtoEmailCandidates}`,
    `- Phone candidates: ${discoveryPackage.summary.phoneCandidates}`,
    `- Candidates with public email candidates: ${discoveryPackage.summary.candidatesWithMailto}`,
    `- Social links: ${discoveryPackage.summary.socialLinks}`,
    `- Feed links: ${discoveryPackage.summary.feedLinks}`,
    `- Quarantined contact pages: ${discoveryPackage.summary.quarantinedContactPageCandidates}`,
    `- Quarantined emails: ${discoveryPackage.summary.quarantinedEmailCandidates}`,
    `- Quarantined phones: ${discoveryPackage.summary.quarantinedPhoneCandidates}`,
    `- Quarantined social links: ${discoveryPackage.summary.quarantinedSocialLinks}`,
    `- Quarantined feed links: ${discoveryPackage.summary.quarantinedFeedLinks}`,
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
    lines.push(`- Identity attribution: ${item.pageIdentity?.level ?? 'unresolved'} (${item.pageIdentity?.score ?? 0}/100)`);
    lines.push(`- Contact page candidates: ${item.contactPageCandidates.length}`);
    lines.push(`- Public email candidates: ${item.emailCandidates.length}`);
    lines.push(`- Phone candidates: ${item.phoneCandidates?.length ?? 0}`);
    lines.push(`- Social links: ${item.socialLinks.length}`);
    lines.push(`- Feed links: ${item.feedLinks.length}`);
    lines.push(
      `- Quarantined discoveries: ${
        (item.quarantinedContactPageCandidates?.length ?? 0) +
        (item.quarantinedEmailCandidates?.length ?? 0) +
        (item.quarantinedPhoneCandidates?.length ?? 0) +
        (item.quarantinedSocialLinks?.length ?? 0) +
        (item.quarantinedFeedLinks?.length ?? 0)
      }`,
    );

    if (item.contactPageCandidates.length > 0) {
      lines.push('- Contact page candidates:');
      item.contactPageCandidates.slice(0, 8).forEach((candidate) => {
        lines.push(`  - ${candidate.reason}: ${candidate.url}`);
      });
    }

    if (item.emailCandidates.length > 0) {
      lines.push('- Public email candidates:');
      item.emailCandidates.forEach((candidate) => {
        lines.push(`  - ${candidate.value}`);
      });
    }

    if ((item.phoneCandidates?.length ?? 0) > 0) {
      lines.push('- Phone candidates:');
      item.phoneCandidates.forEach((candidate) => {
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

function extractPrimaryHeading(html) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
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

function requestHeaders(options = {}) {
  return {
    Accept: options.acceptJson
      ? 'application/json,text/plain;q=0.9,*/*;q=0.8'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

function isPublicPhone(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 7;
}

function normalizePhone(value) {
  return normalizeWhitespace(String(value ?? '')).replace(/\s+/g, ' ');
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

function normalizePersonName(value) {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1)
    .join(' ');
}

function namesLikelyMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;

  return overlap >= Math.min(2, leftTokens.size, rightTokens.size);
}

function tokenInText(text, token) {
  return new RegExp(`(?:^| )${escapeRegExp(token)}(?: |$)`).test(text);
}

function inferSourceBatchId(packages) {
  const ids = unique(packages.map((entry) => packageSourceBatchId(entry.payload)).filter(Boolean));
  return ids.length === 1 ? ids[0] : null;
}

function packageMode(payload) {
  if (payload.mode) {
    return payload.mode;
  }

  if (Array.isArray(payload.candidates)) {
    return 'candidate-batch';
  }

  return '';
}

function packageSourceBatchId(payload) {
  return payload.sourceBatchId ?? payload.batchId ?? null;
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
