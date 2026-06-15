import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadLocalEnv } from './lib/local-env.mjs';

const identityClaimMap = {
  P856: { platform: 'website', label: 'Official website', url: (value) => value },
  P496: { platform: 'orcid', label: 'ORCID', url: (value) => `https://orcid.org/${value}` },
  P2002: { platform: 'x', label: 'X/Twitter', url: (value) => `https://x.com/${cleanHandle(value)}` },
  P2003: { platform: 'instagram', label: 'Instagram', url: (value) => `https://www.instagram.com/${cleanHandle(value)}/` },
  P2397: { platform: 'youtube', label: 'YouTube', url: (value) => `https://www.youtube.com/channel/${value}` },
  P2013: { platform: 'facebook', label: 'Facebook', url: (value) => `https://www.facebook.com/${cleanHandle(value)}` },
  P6634: { platform: 'linkedin', label: 'LinkedIn', url: (value) => `https://www.linkedin.com/in/${cleanHandle(value)}` },
  P7085: { platform: 'tiktok', label: 'TikTok', url: (value) => `https://www.tiktok.com/@${cleanHandle(value)}` },
  P4033: { platform: 'mastodon', label: 'Mastodon', url: (value) => mastodonUrl(value) },
};
const confidenceRank = {
  low: 1,
  medium: 2,
  high: 3,
};
const nameStopWords = new Set(['dr', 'prof', 'professor']);
const topicStopWords = new Set(['and', 'with', 'from', 'that', 'this', 'public', 'candidate', 'research']);

const args = parseArgs(process.argv.slice(2));
const localEnv = await loadLocalEnv(args['local-env'] ?? args['env-path'] ?? args['env-file']);
const batchPath = resolve(args.batch ?? args._[0] ?? 'data/openalex-wave-001-broad-experts.local/_merged-wave.local.json');
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const allCandidates = Array.isArray(batch.candidates) ? batch.candidates : [];
const selectedCandidates = selectCandidates(allCandidates, args);
const candidateOffset = boundedNumber(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
const wikidataLimit = boundedNumber(args['wikidata-limit'], 3, 1, 5);
const minConfidence = getMinConfidence(args);
const delayMs = boundedNumber(args['delay-ms'], 1000, 0, 30000);
const requestRetries = boundedNumber(args.retries, 3, 0, 5);
const retryDelayMs = boundedNumber(args['retry-delay-ms'], 5000, 250, 60000);
const defaultSlug = slugify(batch.batchId ?? 'research-batch');
const markdownPath = resolve(args.output ?? `exports/${defaultSlug}-public-identity-sources.local.md`);
const jsonPath = resolve(args['json-output'] ?? `exports/${defaultSlug}-public-identity-sources.local.json`);
const failures = [];
const items = [];

for (let index = 0; index < selectedCandidates.length; index += 1) {
  const candidate = selectedCandidates[index];
  const item = await buildIdentityItem(candidate);
  items.push(item);

  if (delayMs > 0 && index < selectedCandidates.length - 1) {
    await sleep(delayMs);
  }
}

const discoveryPackage = {
  reviewId: `${defaultSlug}-public-identity-sources`,
  createdAt: new Date().toISOString(),
  sourceBatchId: batch.batchId ?? null,
  sourceLabel: batch.sourceLabel ?? null,
  sourceFile: batchPath,
  mode: 'public-identity-source-discovery',
  summary: {
    inputCandidates: allCandidates.length,
    selectedCandidates: selectedCandidates.length,
    offset: candidateOffset,
    wikidataLimit,
    minConfidence,
    wikidataEntities: items.reduce((count, item) => count + item.wikidataSuggestions.length, 0),
    priorityEntities: items.reduce((count, item) => count + item.priorityWikidataSuggestions.length, 0),
    officialWebsiteClaims: countLinks(items, 'website'),
    wikipediaProfiles: countLinks(items, 'wikipedia'),
    orcidProfiles: countLinks(items, 'orcid'),
    socialProfileClaims: countSocialLinks(items),
    candidatesWithAnyIdentitySource: items.filter((item) => item.identityLinks.length > 0).length,
    failures: failures.length,
    delayMs,
    requestRetries,
    retryDelayMs,
  },
  rules: [
    'Public identity suggestions are discovery records, not verified contact routes.',
    'Keep low-confidence and no-star candidates in the database.',
    'Do not guess emails or derive address patterns from names or domains.',
    'Do not use private, login-only, hidden, breached, or technically restricted data.',
    'Only convert a source into a contact route after human verification from an official professional or representative page.',
  ],
  failures,
  items,
};

await mkdir(dirname(markdownPath), { recursive: true });
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(discoveryPackage, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(discoveryPackage), 'utf8');

console.log(`Public identity source JSON written to ${jsonPath}`);
console.log(`Public identity source checklist written to ${markdownPath}`);
console.log(`Candidates: ${discoveryPackage.summary.selectedCandidates}`);
console.log(`Offset: ${discoveryPackage.summary.offset}`);
console.log(`Wikidata entities: ${discoveryPackage.summary.wikidataEntities}`);
console.log(`Priority entities: ${discoveryPackage.summary.priorityEntities}`);
console.log(`Official website claims: ${discoveryPackage.summary.officialWebsiteClaims}`);
console.log(`Social profile claims: ${discoveryPackage.summary.socialProfileClaims}`);
console.log(`Candidates with identity sources: ${discoveryPackage.summary.candidatesWithAnyIdentitySource}`);
console.log(`Failures: ${discoveryPackage.summary.failures}`);

if (localEnv.loaded) {
  console.log(`Loaded local env file: ${localEnv.path} (${localEnv.variables.length} values applied)`);
}

async function buildIdentityItem(candidate) {
  const wikidata = await fetchWikidataSuggestions(candidate, wikidataLimit);
  if (wikidata.status === 'error') {
    failures.push({
      source: 'wikidata',
      candidateId: candidate.id,
      message: wikidata.error,
    });
  }

  const wikidataSuggestions = wikidata.suggestions ?? [];
  const priorityWikidataSuggestions = wikidataSuggestions.filter(
    (suggestion) => confidenceRank[suggestion.confidence] >= confidenceRank[minConfidence],
  );
  const identityLinks = uniqueByUrl(wikidataSuggestions.flatMap((suggestion) => suggestion.identityLinks));

  return {
    candidateId: candidate.id,
    name: candidate.name,
    title: candidate.title,
    category: candidate.primaryCategory,
    country: candidate.country,
    sourceHints: (candidate.sourceUrls ?? []).slice(0, 8),
    wikidataStatus: wikidata.status,
    wikidataSuggestions,
    priorityWikidataSuggestions,
    identityLinks,
    searchTargets: buildSearchTargets(candidate, identityLinks),
    reviewChecks: [
      'Confirm identity match against name, field, affiliations, country, and known source evidence.',
      'Treat social/profile links as discovery-only until a human verifies ownership.',
      'Search official website, institution, representative, press, speaker, or booking pages for professional contact routes.',
      'Do not add personal or guessed email addresses.',
      'Record source URL and verification date before applying any contact route.',
    ],
    reviewOutcome: {
      candidateId: candidate.id,
      outcomeStatus: 'pending',
      verifiedIdentityLinks: [],
      verifiedContactRoutes: [],
      sourceUrls: [],
      reviewerNotes: '',
    },
  };
}

async function fetchWikidataSuggestions(candidate, limit) {
  try {
    const searchUrl = new URL('https://www.wikidata.org/w/api.php');
    searchUrl.searchParams.set('action', 'wbsearchentities');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('language', 'en');
    searchUrl.searchParams.set('search', candidate.name);
    searchUrl.searchParams.set('limit', String(limit));

    const searchPayload = await fetchJson(searchUrl);
    const matches = Array.isArray(searchPayload.search) ? searchPayload.search : [];
    const ids = matches.map((match) => match.id).filter(Boolean);

    if (ids.length === 0) {
      return { status: 'no-match', suggestions: [] };
    }

    const entityUrl = new URL('https://www.wikidata.org/w/api.php');
    entityUrl.searchParams.set('action', 'wbgetentities');
    entityUrl.searchParams.set('format', 'json');
    entityUrl.searchParams.set('ids', ids.join('|'));
    entityUrl.searchParams.set('props', 'claims|descriptions|sitelinks|aliases');

    const entityPayload = await fetchJson(entityUrl);
    const entities = entityPayload.entities ?? {};

    return {
      status: 'suggested',
      suggestions: matches.map((match) => {
        const entity = entities[match.id] ?? {};
        const description = entity.descriptions?.en?.value ?? match.description ?? '';
        const aliases = (entity.aliases?.en ?? []).map((alias) => alias.value).filter(Boolean);
        const wikipediaUrl = entity.sitelinks?.enwiki?.title
          ? `https://en.wikipedia.org/wiki/${encodeURIComponent(entity.sitelinks.enwiki.title.replaceAll(' ', '_'))}`
          : '';
        const baseLinks = [
          {
            source: 'wikidata',
            platform: 'wikidata',
            label: match.label ?? match.id,
            url: `https://www.wikidata.org/wiki/${match.id}`,
            verified: false,
            confidence: identityConfidence(candidate, [match.label, description, ...aliases]),
          },
          wikipediaUrl
            ? {
                source: 'wikidata-sitelink',
                platform: 'wikipedia',
                label: match.label ?? match.id,
                url: wikipediaUrl,
                verified: false,
                confidence: identityConfidence(candidate, [match.label, description, ...aliases]),
              }
            : null,
        ].filter(Boolean);
        const claimLinks = extractIdentityLinks(entity, candidate, match.label ?? match.id, description, aliases);
        const identityLinks = uniqueByUrl([...baseLinks, ...claimLinks]);
        const confidence = identityConfidence(candidate, [
          match.label,
          description,
          ...aliases,
          ...identityLinks.map((link) => `${link.label} ${link.platform}`),
        ]);

        return {
          wikidataId: match.id,
          label: match.label,
          description,
          aliases: aliases.slice(0, 8),
          wikidataUrl: `https://www.wikidata.org/wiki/${match.id}`,
          confidence,
          identityLinks,
          verificationNote: 'Suggestion only. Human identity match is required before using any source.',
        };
      }),
    };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      suggestions: [],
    };
  }
}

function extractIdentityLinks(entity, candidate, label, description, aliases) {
  return Object.entries(identityClaimMap).flatMap(([propertyId, config]) => {
    const claims = entity.claims?.[propertyId] ?? [];
    return claims
      .map((claim) => claim.mainsnak?.datavalue?.value)
      .filter((value) => typeof value === 'string')
      .map((value) => ({
        source: `wikidata-${propertyId}`,
        platform: config.platform,
        label: config.label,
        url: config.url(value),
        verified: false,
        confidence: identityConfidence(candidate, [label, description, ...aliases, value]),
      }))
      .filter((link) => isValidUrl(link.url));
  });
}

function buildSearchTargets(candidate, identityLinks) {
  const name = quoted(candidate.name);
  const officialSites = identityLinks.filter((link) => link.platform === 'website').map((link) => link.url);
  const domainQueries = officialSites.flatMap((url) => {
    const domain = getDomain(url);
    return domain
      ? [
          `site:${domain} ${name} contact`,
          `site:${domain} ${name} email`,
          `site:${domain} ${name} booking OR speaking OR press`,
        ]
      : [];
  });
  const genericQueries = [
    `${name} official website`,
    `${name} contact`,
    `${name} public email`,
    `${name} speaker booking`,
    `${name} press contact`,
    `${name} X OR Twitter`,
    `${name} Instagram`,
    `${name} LinkedIn`,
    `${name} Substack OR newsletter`,
    `${name} blog OR Medium`,
  ];

  return unique([...domainQueries, ...genericQueries]).slice(0, 16);
}

async function fetchJson(url) {
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    const response = await fetch(url, { headers: requestHeaders() });
    if (response.ok) {
      return response.json();
    }

    const message = `${url.hostname} request failed: ${response.status} ${response.statusText}`;
    if (!isRetryableStatus(response.status) || attempt >= requestRetries) {
      throw new Error(message);
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw new Error(`${url.hostname} request failed after retries.`);
}

function requestHeaders() {
  return {
    'user-agent':
      process.env.BEGLIB_RESEARCH_USER_AGENT ??
      'beGlibCommercialAutomation/0.1 (public-identity-source-discovery; local private research)',
  };
}

function renderMarkdown(discoveryPackage) {
  const lines = [
    `# Public Identity Source Discovery: ${discoveryPackage.sourceBatchId ?? discoveryPackage.reviewId}`,
    '',
    `Source: ${discoveryPackage.sourceLabel ?? 'Unknown'}`,
    `Generated: ${discoveryPackage.createdAt}`,
    `Candidates: ${discoveryPackage.summary.selectedCandidates}`,
    `Offset: ${discoveryPackage.summary.offset}`,
    '',
    'These are discovery hints only. Do not treat them as verified contact routes or outreach permission.',
    '',
    '## Summary',
    '',
    `- Wikidata entities: ${discoveryPackage.summary.wikidataEntities}`,
    `- Priority entities: ${discoveryPackage.summary.priorityEntities}`,
    `- Official website claims: ${discoveryPackage.summary.officialWebsiteClaims}`,
    `- Wikipedia profiles: ${discoveryPackage.summary.wikipediaProfiles}`,
    `- ORCID profiles: ${discoveryPackage.summary.orcidProfiles}`,
    `- Social profile claims: ${discoveryPackage.summary.socialProfileClaims}`,
    `- Candidates with identity sources: ${discoveryPackage.summary.candidatesWithAnyIdentitySource}`,
    `- Failures: ${discoveryPackage.summary.failures}`,
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
    lines.push(`- Wikidata status: ${item.wikidataStatus}`);
    lines.push(`- Identity links retained: ${item.identityLinks.length}`);
    lines.push(`- Priority Wikidata suggestions: ${item.priorityWikidataSuggestions.length}`);

    if (item.identityLinks.length > 0) {
      lines.push('- Identity/source links:');
      item.identityLinks.slice(0, 12).forEach((link) => {
        lines.push(`  - ${link.platform}: ${link.url} (${link.confidence})`);
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

function selectCandidates(candidates, options) {
  const categoryFilter = options.categories
    ? new Set(String(options.categories).split(',').map((category) => category.trim()).filter(Boolean))
    : null;
  const candidateLimit = boundedNumber(options.limit, candidates.length, 1, candidates.length || 1);
  const candidateOffset = boundedNumber(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  return candidates
    .filter((candidate) => !categoryFilter || categoryFilter.has(candidate.primaryCategory))
    .slice(candidateOffset, candidateOffset + candidateLimit);
}

function getMinConfidence(options) {
  const requested = String(options['min-confidence'] ?? 'medium').toLowerCase();
  return confidenceRank[requested] ? requested : 'medium';
}

function countLinks(items, platform) {
  return items.reduce((count, item) => count + item.identityLinks.filter((link) => link.platform === platform).length, 0);
}

function countSocialLinks(items) {
  const socialPlatforms = new Set(['x', 'instagram', 'youtube', 'facebook', 'linkedin', 'tiktok', 'mastodon']);
  return items.reduce((count, item) => count + item.identityLinks.filter((link) => socialPlatforms.has(link.platform)).length, 0);
}

function identityConfidence(candidate, textParts) {
  const text = normalizeSearchText(textParts.filter(Boolean).join(' '));
  const name = getNameParts(candidate.name);
  const topicOverlap = hasTopicOverlap(candidate, text);

  if (!name.first || !name.last) {
    return 'low';
  }

  const exactFullName = name.fullVariants.some((variant) => text.includes(variant));
  const firstAndLast = tokenInText(text, name.first) && tokenInText(text, name.last);

  if (exactFullName && topicOverlap) {
    return 'high';
  }

  if (exactFullName || (firstAndLast && topicOverlap)) {
    return 'medium';
  }

  if (firstAndLast || (tokenInText(text, name.last) && topicOverlap)) {
    return 'low';
  }

  return 'low';
}

function getNameParts(name) {
  const tokens = normalizeSearchText(name)
    .split(' ')
    .filter((token) => token.length > 1 && !nameStopWords.has(token));
  const substantialTokens = tokens.filter((token) => token.length > 2);
  const first = substantialTokens[0] ?? '';
  const last = substantialTokens[substantialTokens.length - 1] ?? '';
  const fullVariants = new Set();

  if (first && last) {
    fullVariants.add(`${first} ${last}`);
    fullVariants.add(tokens.join(' '));
  }

  return { first, last, fullVariants: Array.from(fullVariants) };
}

function hasTopicOverlap(candidate, text) {
  const topicTokens = topicText(candidate)
    .split(' ')
    .filter((token) => token.length > 3 && !topicStopWords.has(token));

  return topicTokens.some((token) => tokenInText(text, token));
}

function topicText(candidate) {
  return normalizeSearchText(
    [
      candidate.title,
      candidate.primaryCategory,
      ...(candidate.subcategories ?? []),
      candidate.rationale,
      ...(candidate.influenceSignals?.notableSignals ?? []),
    ]
      .filter(Boolean)
      .join(' '),
  );
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

function cleanHandle(value) {
  return String(value).replace(/^@/, '').trim();
}

function mastodonUrl(value) {
  const normalized = String(value).trim().replace(/^@/, '');
  const [user, host] = normalized.split('@');
  return user && host ? `https://${host}/@${user}` : `https://mastodon.social/@${normalized}`;
}

function getDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueByUrl(values) {
  const seen = new Set();
  return values.filter((item) => {
    if (!item?.url || seen.has(item.url)) {
      return false;
    }

    seen.add(item.url);
    return true;
  });
}

function quoted(value) {
  return `"${String(value).replaceAll('"', '').trim()}"`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
