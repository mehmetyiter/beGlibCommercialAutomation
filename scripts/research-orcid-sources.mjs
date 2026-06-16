import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadLocalEnv } from './lib/local-env.mjs';

const nameStopWords = new Set(['dr', 'prof', 'professor']);
const topicStopWords = new Set(['and', 'with', 'from', 'that', 'this', 'public', 'candidate', 'research']);
const affiliationSources = [
  { recordKey: 'employments', summaryKey: 'employment-summary', type: 'employment' },
  { recordKey: 'educations', summaryKey: 'education-summary', type: 'education' },
  { recordKey: 'memberships', summaryKey: 'membership-summary', type: 'membership' },
  { recordKey: 'qualifications', summaryKey: 'qualification-summary', type: 'qualification' },
  { recordKey: 'invited-positions', summaryKey: 'invited-position-summary', type: 'invited-position' },
];

const args = parseArgs(process.argv.slice(2));
const localEnv = await loadLocalEnv(args['local-env'] ?? args['env-path'] ?? args['env-file']);
const batchPath = resolve(args.batch ?? args._[0] ?? 'data/openalex-wave-001-broad-experts.local/_merged-wave.local.json');
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const allCandidates = Array.isArray(batch.candidates) ? batch.candidates : [];
const selectedCandidates = selectCandidates(allCandidates, args);
const candidateOffset = boundedNumber(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
const delayMs = boundedNumber(args['delay-ms'], 1000, 0, 60000);
const requestRetries = boundedNumber(args.retries, 2, 0, 5);
const retryDelayMs = boundedNumber(args['retry-delay-ms'], 3000, 250, 60000);
const defaultSlug = slugify(batch.batchId ?? 'research-batch');
const markdownPath = resolve(args.output ?? `exports/${defaultSlug}-orcid-source-discovery.local.md`);
const jsonPath = resolve(args['json-output'] ?? `exports/${defaultSlug}-orcid-source-discovery.local.json`);
const failures = [];
const items = [];

for (let index = 0; index < selectedCandidates.length; index += 1) {
  const candidate = selectedCandidates[index];
  const item = await buildOrcidItem(candidate);
  items.push(item);

  if (delayMs > 0 && index < selectedCandidates.length - 1) {
    await sleep(delayMs);
  }
}

const discoveryPackage = {
  reviewId: `${defaultSlug}-orcid-source-discovery`,
  createdAt: new Date().toISOString(),
  sourceBatchId: batch.batchId ?? null,
  sourceLabel: batch.sourceLabel ?? null,
  sourceFile: batchPath,
  mode: 'orcid-source-discovery',
  summary: {
    inputCandidates: allCandidates.length,
    selectedCandidates: selectedCandidates.length,
    offset: candidateOffset,
    candidatesWithOrcid: items.filter((item) => Boolean(item.orcidId)).length,
    fetchedRecords: items.filter((item) => item.orcidStatus === 'fetched').length,
    skippedNoOrcid: items.filter((item) => item.orcidStatus === 'skipped-no-orcid').length,
    researcherUrls: items.reduce((count, item) => count + item.researcherUrls.length, 0),
    publicEmailCandidates: items.reduce((count, item) => count + item.publicEmails.length, 0),
    affiliations: items.reduce((count, item) => count + item.affiliations.length, 0),
    externalIdentifiers: items.reduce((count, item) => count + item.externalIdentifiers.length, 0),
    candidatesWithDiscoveryLinks: items.filter((item) => item.researcherUrls.length > 0 || item.publicEmails.length > 0)
      .length,
    failures: failures.length,
    delayMs,
    requestRetries,
    retryDelayMs,
  },
  rules: [
    'ORCID records are public identity metadata, not outreach permission.',
    'Researcher URLs, external identifiers, and public emails remain discovery-only until human verification.',
    'Do not guess emails or derive address patterns from names, ORCID records, or domains.',
    'Keep candidates with no ORCID, no public email, and low/no creator signals in the database.',
    'Only convert a public email or page into a contact route after confirming it is professional, current, attributable, and allowed for outreach.',
    'Health, mental-health, religion, and other sensitive categories require specialist or legal review before campaign use.',
  ],
  failures,
  items,
};

await mkdir(dirname(markdownPath), { recursive: true });
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(discoveryPackage, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(discoveryPackage), 'utf8');

console.log(`ORCID source discovery JSON written to ${jsonPath}`);
console.log(`ORCID source discovery checklist written to ${markdownPath}`);
console.log(`Candidates: ${discoveryPackage.summary.selectedCandidates}`);
console.log(`Offset: ${discoveryPackage.summary.offset}`);
console.log(`Candidates with ORCID: ${discoveryPackage.summary.candidatesWithOrcid}`);
console.log(`Fetched records: ${discoveryPackage.summary.fetchedRecords}`);
console.log(`Researcher URLs: ${discoveryPackage.summary.researcherUrls}`);
console.log(`Public email candidates: ${discoveryPackage.summary.publicEmailCandidates}`);
console.log(`Affiliations: ${discoveryPackage.summary.affiliations}`);
console.log(`Failures: ${discoveryPackage.summary.failures}`);

if (localEnv.loaded) {
  console.log(`Loaded local env file: ${localEnv.path} (${localEnv.variables.length} values applied)`);
}

async function buildOrcidItem(candidate) {
  const orcidId = extractOrcidId(candidate);
  const baseItem = {
    candidateId: candidate.id,
    name: candidate.name,
    title: candidate.title,
    category: candidate.primaryCategory,
    country: candidate.country,
    sourceHints: (candidate.sourceUrls ?? []).slice(0, 8),
    orcidId,
    orcidUrl: orcidId ? `https://orcid.org/${orcidId}` : '',
    orcidStatus: orcidId ? 'pending' : 'skipped-no-orcid',
    orcidName: '',
    identityConfidence: 'low',
    researcherUrls: [],
    publicEmails: [],
    affiliations: [],
    externalIdentifiers: [],
    keywords: [],
    searchTargets: buildSearchTargets(candidate, [], []),
    reviewChecks: [
      'Confirm the ORCID record belongs to the same person using name, field, affiliation, country, and source evidence.',
      'Verify researcher URLs as official or representative before copying them into candidate channels.',
      'Treat public emails as contact candidates only; confirm professional context, source URL, jurisdiction, and suppression status before use.',
      'Do not add guessed emails, private data, login-only data, or scraped hidden contact routes.',
      'Require sensitive-category review before any health, mental-health, religion, or similarly sensitive campaign use.',
    ],
    reviewOutcome: {
      candidateId: candidate.id,
      outcomeStatus: 'pending',
      verifiedAt: '',
      verifiedIdentityLinks: [],
      verifiedResearcherUrls: [],
      verifiedPublicEmails: [],
      verifiedContactRoutes: [],
      sourceUrls: [],
      reviewerNotes: '',
    },
  };

  if (!orcidId) {
    return baseItem;
  }

  try {
    const record = await fetchOrcidRecord(orcidId);
    const orcidName = extractOrcidName(record);
    const researcherUrls = extractResearcherUrls(record, candidate, orcidName);
    const publicEmails = extractPublicEmails(record, orcidId);
    const affiliations = extractAffiliations(record);
    const externalIdentifiers = extractExternalIdentifiers(record);
    const keywords = extractKeywords(record);

    return {
      ...baseItem,
      orcidStatus: 'fetched',
      orcidName,
      identityConfidence: identityConfidence(candidate, [
        orcidName,
        ...researcherUrls.map((link) => `${link.label} ${link.url}`),
        ...affiliations.map((affiliation) => `${affiliation.organization} ${affiliation.roleTitle}`),
        ...keywords,
      ]),
      researcherUrls,
      publicEmails,
      affiliations,
      externalIdentifiers,
      keywords,
      searchTargets: buildSearchTargets(candidate, researcherUrls, affiliations),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({
      source: 'orcid-public-api',
      candidateId: candidate.id,
      orcidId,
      message,
    });

    return {
      ...baseItem,
      orcidStatus: 'error',
      error: message,
    };
  }
}

async function fetchOrcidRecord(orcidId) {
  const url = new URL(`https://pub.orcid.org/v3.0/${orcidId}/record`);
  return fetchJson(url);
}

function extractResearcherUrls(record, candidate, orcidName) {
  const researcherUrls = asArray(record.person?.['researcher-urls']?.['researcher-url']);
  const links = researcherUrls
    .filter((item) => isPublicVisibility(item?.visibility))
    .map((item) => {
      const url = textValue(item?.url?.value ?? item?.url);
      const platform = classifyPlatform(url);
      const label = textValue(item?.['url-name']?.value ?? item?.['url-name']) || platformLabel(platform);

      return {
        source: 'orcid-researcher-url',
        platform,
        label,
        url,
        verified: false,
        confidence: identityConfidence(candidate, [orcidName, label, url]),
        sourceUrls: [recordUrl(record), url].filter(Boolean),
        reviewerNote: 'Public ORCID researcher URL. Human identity and ownership verification required.',
      };
    })
    .filter((link) => isValidUrl(link.url));

  return uniqueByUrl(links).slice(0, 20);
}

function extractPublicEmails(record, orcidId) {
  return asArray(record.person?.emails?.email)
    .filter((item) => isPublicVisibility(item?.visibility))
    .map((item) => ({
      source: 'orcid-public-email',
      type: 'public-email-candidate',
      value: String(item?.email ?? '').trim(),
      verified: false,
      sourceUrl: `https://orcid.org/${orcidId}`,
      visibility: item?.visibility ?? 'public-api',
      orcidVerified: Boolean(item?.verified),
      reviewerNote:
        'Public ORCID email candidate only. Confirm professional context, lawful basis, suppression status, and sensitive-category review before use.',
    }))
    .filter((item) => isEmail(item.value))
    .slice(0, 10);
}

function extractAffiliations(record) {
  const affiliations = affiliationSources.flatMap((source) => {
    const groups = asArray(record['activities-summary']?.[source.recordKey]?.['affiliation-group']);
    return groups.flatMap((group) =>
      asArray(group?.summaries).flatMap((summary) => {
        const value = summary?.[source.summaryKey];
        return value ? [affiliationSummary(value, source.type)] : [];
      }),
    );
  });

  return uniqueByKey(
    affiliations.filter((item) => isPublicVisibility(item.visibility) && item.organization),
    (item) => [item.type, item.organization, item.roleTitle, item.departmentName, item.startYear, item.endYear].join('|'),
  ).slice(0, 30);
}

function affiliationSummary(summary, type) {
  const organization = summary.organization ?? {};
  const address = organization.address ?? {};

  return {
    source: 'orcid-affiliation',
    type,
    roleTitle: textValue(summary['role-title']?.title?.value ?? summary['role-title']?.value ?? summary['role-title']),
    departmentName: textValue(summary['department-name']?.value ?? summary['department-name']),
    organization: textValue(organization.name),
    city: textValue(address.city),
    region: textValue(address.region),
    country: textValue(address.country),
    startYear: textValue(summary['start-date']?.year?.value),
    endYear: textValue(summary['end-date']?.year?.value),
    url: textValue(summary.url?.value ?? summary.url),
    visibility: summary.visibility ?? 'public-api',
    sourceUrl: recordPathUrl(summary.path),
  };
}

function extractExternalIdentifiers(record) {
  return asArray(record.person?.['external-identifiers']?.['external-identifier'])
    .filter((item) => isPublicVisibility(item?.visibility))
    .map((item) => {
      const url = textValue(item?.['external-id-url']?.value ?? item?.['external-id-url']);
      return {
        source: 'orcid-external-identifier',
        type: textValue(item?.['external-id-type']),
        label: textValue(item?.['external-id-common-name']?.value ?? item?.['external-id-common-name']),
        reference: textValue(item?.['external-id-value']),
        relationship: textValue(item?.['external-id-relationship']),
        url,
        platform: classifyPlatform(url),
      };
    })
    .filter((item) => item.type || item.reference || isValidUrl(item.url))
    .slice(0, 20);
}

function extractKeywords(record) {
  return asArray(record.person?.keywords?.keyword)
    .filter((item) => isPublicVisibility(item?.visibility))
    .map((item) => textValue(item?.content ?? item?.value ?? item))
    .filter(Boolean)
    .slice(0, 20);
}

function extractOrcidName(record) {
  const name = record.person?.name;
  const creditName = textValue(name?.['credit-name']?.value ?? name?.['credit-name']);
  const given = textValue(name?.['given-names']?.value ?? name?.['given-names']);
  const family = textValue(name?.['family-name']?.value ?? name?.['family-name']);

  return creditName || [given, family].filter(Boolean).join(' ');
}

function buildSearchTargets(candidate, researcherUrls, affiliations) {
  const name = quoted(candidate.name);
  const domainQueries = researcherUrls.flatMap((link) => {
    const domain = getDomain(link.url);
    return domain
      ? [
          `site:${domain} ${name} contact`,
          `site:${domain} ${name} email`,
          `site:${domain} ${name} booking OR speaking OR media`,
        ]
      : [];
  });
  const organizationQueries = affiliations
    .map((affiliation) => affiliation.organization)
    .filter(Boolean)
    .slice(0, 5)
    .flatMap((organization) => [
      `${name} "${organization}" profile`,
      `${name} "${organization}" contact`,
      `${name} "${organization}" email`,
    ]);
  const genericQueries = [
    `${name} official website`,
    `${name} public email`,
    `${name} contact`,
    `${name} speaker booking`,
    `${name} media office`,
    `${name} press contact`,
    `${name} LinkedIn`,
    `${name} X OR Twitter`,
    `${name} Instagram`,
    `${name} YouTube`,
    `${name} podcast`,
    `${name} Substack OR newsletter`,
  ];

  return unique([...domainQueries, ...organizationQueries, ...genericQueries]).slice(0, 28);
}

async function fetchJson(url) {
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    const response = await fetch(url, { headers: requestHeaders() });
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
  const suffix = body ? ` (${body.slice(0, 160).replace(/\s+/g, ' ')})` : '';
  return `${url.hostname} request failed: ${response.status} ${response.statusText}${suffix}`;
}

function requestHeaders() {
  return {
    Accept: 'application/json',
    'User-Agent':
      process.env.BEGLIB_RESEARCH_USER_AGENT ??
      'beGlibCommercialAutomation/0.1 (orcid-source-discovery; local private research)',
  };
}

function renderMarkdown(discoveryPackage) {
  const lines = [
    `# ORCID Source Discovery: ${discoveryPackage.sourceBatchId ?? discoveryPackage.reviewId}`,
    '',
    `Source: ${discoveryPackage.sourceLabel ?? 'Unknown'}`,
    `Generated: ${discoveryPackage.createdAt}`,
    `Candidates: ${discoveryPackage.summary.selectedCandidates}`,
    `Offset: ${discoveryPackage.summary.offset}`,
    '',
    'ORCID records are discovery hints only. Human verification is required before applying identity links or contact routes.',
    '',
    '## Summary',
    '',
    `- Candidates with ORCID: ${discoveryPackage.summary.candidatesWithOrcid}`,
    `- Fetched records: ${discoveryPackage.summary.fetchedRecords}`,
    `- Skipped no ORCID: ${discoveryPackage.summary.skippedNoOrcid}`,
    `- Researcher URLs: ${discoveryPackage.summary.researcherUrls}`,
    `- Public email candidates: ${discoveryPackage.summary.publicEmailCandidates}`,
    `- Affiliations: ${discoveryPackage.summary.affiliations}`,
    `- External identifiers: ${discoveryPackage.summary.externalIdentifiers}`,
    `- Candidates with discovery links: ${discoveryPackage.summary.candidatesWithDiscoveryLinks}`,
    `- Failures: ${discoveryPackage.summary.failures}`,
    `- Candidate delay: ${discoveryPackage.summary.delayMs}ms`,
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
    lines.push(`- ORCID status: ${item.orcidStatus}`);
    lines.push(`- ORCID: ${item.orcidUrl || 'None found in candidate record'}`);
    lines.push(`- ORCID name: ${item.orcidName || 'Not available'}`);
    lines.push(`- Identity confidence: ${item.identityConfidence}`);
    lines.push(`- Researcher URLs: ${item.researcherUrls.length}`);
    lines.push(`- Public email candidates: ${item.publicEmails.length}`);
    lines.push(`- Affiliations: ${item.affiliations.length}`);

    if (item.researcherUrls.length > 0) {
      lines.push('- Researcher URLs:');
      item.researcherUrls.slice(0, 8).forEach((link) => {
        lines.push(`  - ${link.platform}: ${link.url} (${link.confidence})`);
      });
    }

    if (item.publicEmails.length > 0) {
      lines.push('- Public email candidates:');
      item.publicEmails.forEach((email) => {
        lines.push(`  - ${email.value} (ORCID verified: ${email.orcidVerified ? 'yes' : 'no'})`);
      });
    }

    if (item.affiliations.length > 0) {
      lines.push('- Affiliation hints:');
      item.affiliations.slice(0, 6).forEach((affiliation) => {
        const details = [
          affiliation.roleTitle,
          affiliation.departmentName,
          affiliation.organization,
          affiliation.country,
        ].filter(Boolean);
        lines.push(`  - ${affiliation.type}: ${details.join(', ')}`);
      });
    }

    lines.push('- Search targets:');
    item.searchTargets.slice(0, 10).forEach((target) => lines.push(`  - ${target}`));
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

function extractOrcidId(candidate) {
  const channelSources = (candidate.channels ?? [])
    .filter((channel) => channel.platform === 'orcid')
    .map((channel) => channel.url);
  const sources = [...channelSources, ...(candidate.sourceUrls ?? [])];

  for (const source of sources) {
    const match = String(source).match(/orcid\.org\/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return '';
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
    website: 'Website',
    youtube: 'YouTube',
    x: 'X/Twitter',
    instagram: 'Instagram',
    linkedin: 'LinkedIn',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    newsletter: 'Newsletter',
    blog: 'Blog',
    podcast: 'Podcast',
    profile: 'Profile',
  };

  return labels[platform] ?? 'Profile';
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

function isPublicVisibility(visibility) {
  return !visibility || visibility === 'public';
}

function isValidUrl(value) {
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

function getDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function recordUrl(record) {
  const path = String(record.path ?? '').replace(/^\/+/, '');
  return path ? `https://orcid.org/${path}` : '';
}

function recordPathUrl(path) {
  const normalized = String(path ?? '').replace(/^\/+/, '');
  return normalized ? `https://orcid.org/${normalized}` : '';
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
