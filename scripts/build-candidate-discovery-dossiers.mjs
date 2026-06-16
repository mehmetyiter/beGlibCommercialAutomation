import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const supportedModes = new Set([
  'creator-source-discovery',
  'feed-source-signal-discovery',
  'orcid-source-discovery',
  'public-identity-source-discovery',
  'public-page-contact-source-discovery',
]);
const socialPlatforms = new Set(['youtube', 'x', 'instagram', 'linkedin', 'facebook', 'tiktok', 'newsletter', 'podcast']);

const args = parseArgs(process.argv.slice(2));
const batchPath = resolve(args.batch ?? args._[0] ?? 'data/openalex-wave-001-broad-experts.local/_merged-wave.local.json');
const inputDir = resolve(args['input-dir'] ?? 'exports');
const sourceBatchId = args['source-batch-id'];
const filenameIncludes = listArg(args['filename-includes']);
const filenameExcludes = listArg(args['filename-excludes']);
const outputPath = resolve(args.output ?? 'exports/candidate-discovery-dossiers.local.json');
const markdownPath = resolve(args['markdown-output'] ?? 'exports/candidate-discovery-dossiers.local.md');
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const candidates = Array.isArray(batch.candidates) ? batch.candidates : [];
const parseFailures = [];
const packages = await loadDiscoveryPackages();
const dossiers = candidates.map((candidate) => buildDossier(candidate, packages));
const summary = buildSummary(dossiers);
const dossierPackage = {
  reviewId: `${slugify(batch.batchId ?? 'research-batch')}-candidate-discovery-dossiers`,
  createdAt: new Date().toISOString(),
  sourceBatchId: batch.batchId ?? null,
  sourceLabel: batch.sourceLabel ?? null,
  sourceFile: batchPath,
  mode: 'candidate-discovery-dossiers',
  inputDir,
  discoveryPackageFiles: packages.map((entry) => entry.file),
  summary,
  rules: [
    'Discovery dossiers are not outreach approval.',
    'Discovery stars are prioritization signals, not inclusion filters and not compliance status.',
    'Keep every candidate, including low-star and no-star records.',
    'Do not use public email candidates, contact page links, or social profiles until human verification is complete.',
    'Do not guess emails or derive address patterns.',
    'Suppression, jurisdiction, professional context, and sensitive-category review must be complete before campaign use.',
  ],
  parseFailures,
  dossiers,
};

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(markdownPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(dossierPackage, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(dossierPackage), 'utf8');

console.log(`Candidate discovery dossier JSON written to ${outputPath}`);
console.log(`Candidate discovery dossier markdown written to ${markdownPath}`);
console.log(`Candidates: ${summary.candidates}`);
console.log(`Discovery packages: ${summary.discoveryPackages}`);
console.log(`Channel candidates: ${summary.channelCandidates}`);
console.log(`Contact candidates: ${summary.contactCandidates}`);
console.log(`Public email candidates: ${summary.publicEmailCandidates}`);
console.log(`Contact page candidates: ${summary.contactPageCandidates}`);
console.log(`Creator suggestions: ${summary.creatorSuggestions}`);
console.log(`Five-star discovery dossiers: ${summary.discoveryStars.five}`);

async function loadDiscoveryPackages() {
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

function buildDossier(candidate, packages) {
  const relevantItems = packages.flatMap((entry) => packageItemsForCandidate(entry, candidate.id));
  const baseChannels = (candidate.channels ?? []).map((channel) => ({
    source: 'candidate-record',
    platform: channel.platform,
    label: channel.label,
    url: channel.url,
    verified: Boolean(channel.verified),
    confidence: channel.verified ? 'verified' : 'unknown',
  }));
  const discoveryChannels = uniqueByKey(
    [...baseChannels, ...relevantItems.flatMap((entry) => entry.channels)],
    (channel) => `${channel.platform}|${normalizeUrl(channel.url)}`,
  );
  const contactCandidates = uniqueByKey(
    relevantItems.flatMap((entry) => entry.contactCandidates),
    (contact) => `${contact.type}|${normalizeContactValue(contact.value)}|${normalizeUrl(contact.sourceUrl)}`,
  );
  const affiliations = uniqueByKey(
    relevantItems.flatMap((entry) => entry.affiliations),
    (affiliation) =>
      [affiliation.type, affiliation.organization, affiliation.roleTitle, affiliation.departmentName, affiliation.country].join('|'),
  );
  const searchTargets = unique(relevantItems.flatMap((entry) => entry.searchTargets)).slice(0, 40);
  const sourceUrls = unique([
    ...(candidate.sourceUrls ?? []),
    ...discoveryChannels.map((channel) => channel.url),
    ...contactCandidates.map((contact) => contact.sourceUrl),
  ]).slice(0, 80);
  const creatorSuggestions = relevantItems.reduce((count, entry) => count + entry.creatorSuggestions, 0);
  const discoveryStar = assessDiscoveryStar(candidate, discoveryChannels, contactCandidates, creatorSuggestions);

  return {
    candidateId: candidate.id,
    name: candidate.name,
    title: candidate.title,
    category: candidate.primaryCategory,
    subcategories: candidate.subcategories ?? [],
    country: candidate.country,
    fitScore: candidate.fitScore,
    reachScore: candidate.reachScore,
    status: candidate.status,
    consentStatus: candidate.consentStatus,
    riskLevel: candidate.riskLevel,
    sensitiveFlags: buildSensitivityFlags(candidate),
    discoveryStar,
    counts: {
      discoveryChannels: discoveryChannels.length,
      contactCandidates: contactCandidates.length,
      publicEmailCandidates: contactCandidates.filter((contact) => contact.type === 'public-email-candidate').length,
      contactPageCandidates: contactCandidates.filter((contact) => contact.type === 'contact-page-candidate').length,
      creatorSuggestions,
      affiliations: affiliations.length,
      searchTargets: searchTargets.length,
      sourcePackages: new Set(relevantItems.map((entry) => entry.packageFile)).size,
    },
    discoveryChannels,
    contactCandidates,
    affiliations,
    searchTargets,
    sourceUrls,
    reviewChecks: [
      'Confirm identity match for every source before applying it to the candidate record.',
      'Convert only verified professional or representative routes into contactRoutes.',
      'Keep unverified public email, social, and page links as discovery records.',
      'Check suppression, jurisdiction, and sensitive-category status before campaign use.',
      'Do not delete low-star or no-star candidates from the database.',
    ],
    reviewOutcome: {
      candidateId: candidate.id,
      outcomeStatus: 'pending',
      verifiedChannels: [],
      verifiedContactRoutes: [],
      verifiedSourceUrls: [],
      reviewerNotes: '',
    },
  };
}

function packageItemsForCandidate(entry, candidateId) {
  const packageFile = entry.file;

  return (entry.payload.items ?? [])
    .filter((item) => item.candidateId === candidateId)
    .map((item) => normalizeDiscoveryItem(entry.payload.mode, item, packageFile));
}

function normalizeDiscoveryItem(mode, item, packageFile) {
  if (mode === 'creator-source-discovery') {
    const suggestions = [...(item.suggestions ?? []), ...(item.deprioritizedSuggestions ?? [])];
    return {
      packageFile,
      channels: suggestions.map((suggestion) => ({
        source: suggestion.source,
        platform: suggestion.platform,
        label: suggestion.label,
        url: suggestion.url,
        verified: false,
        confidence: suggestion.confidence ?? 'unknown',
        evidence: suggestion.evidence ?? [],
      })),
      contactCandidates: [],
      affiliations: [],
      searchTargets: [],
      creatorSuggestions: suggestions.length,
    };
  }

  if (mode === 'orcid-source-discovery') {
    return {
      packageFile,
      channels: [
        ...(item.orcidUrl
          ? [
              {
                source: 'orcid-record',
                platform: 'orcid',
                label: 'ORCID',
                url: item.orcidUrl,
                verified: false,
                confidence: item.identityConfidence ?? 'unknown',
              },
            ]
          : []),
        ...(item.researcherUrls ?? []).map((link) => ({
          source: link.source ?? 'orcid-researcher-url',
          platform: link.platform,
          label: link.label,
          url: link.url,
          verified: false,
          confidence: link.confidence ?? 'unknown',
        })),
      ],
      contactCandidates: (item.publicEmails ?? []).map((email) => ({
        source: email.source ?? 'orcid-public-email',
        type: 'public-email-candidate',
        value: email.value,
        sourceUrl: email.sourceUrl,
        verified: false,
        reviewerNote: email.reviewerNote ?? '',
      })),
      affiliations: item.affiliations ?? [],
      searchTargets: item.searchTargets ?? [],
      creatorSuggestions: 0,
    };
  }

  if (mode === 'public-identity-source-discovery') {
    return {
      packageFile,
      channels: (item.identityLinks ?? []).map((link) => ({
        source: link.source,
        platform: link.platform,
        label: link.label,
        url: link.url,
        verified: false,
        confidence: link.confidence ?? 'unknown',
      })),
      contactCandidates: [],
      affiliations: [],
      searchTargets: item.searchTargets ?? [],
      creatorSuggestions: 0,
    };
  }

  if (mode === 'public-page-contact-source-discovery') {
    return {
      packageFile,
      channels: [
        ...(item.finalUrl
          ? [
              {
                source: 'public-page-source',
                platform: item.sourcePlatform ?? classifyPlatform(item.finalUrl),
                label: item.pageTitle || item.sourceLabel || 'Public page',
                url: item.finalUrl,
                verified: false,
                confidence: item.sourceConfidence ?? 'unknown',
              },
            ]
          : []),
        ...(item.socialLinks ?? []).map((link) => ({
          source: link.source ?? 'public-page-link',
          platform: link.platform,
          label: link.label,
          url: link.url,
          verified: false,
          confidence: 'discovered',
        })),
        ...(item.feedLinks ?? []).map((link) => ({
          source: link.source ?? 'public-page-feed-link',
          platform: 'newsletter',
          label: link.label,
          url: link.url,
          verified: false,
          confidence: 'discovered',
        })),
      ],
      contactCandidates: [
        ...(item.emailCandidates ?? []).map((email) => ({
          source: email.source ?? 'public-page-mailto',
          type: 'public-email-candidate',
          value: email.value,
          sourceUrl: email.sourceUrl,
          verified: false,
          reviewerNote: email.reviewerNote ?? '',
        })),
        ...(item.contactPageCandidates ?? []).map((page) => ({
          source: page.source ?? 'public-page-link',
          type: 'contact-page-candidate',
          value: page.url,
          sourceUrl: item.finalUrl || item.sourceUrl,
          label: page.label,
          reason: page.reason,
          verified: false,
        })),
      ],
      affiliations: [],
      searchTargets: item.searchTargets ?? [],
      creatorSuggestions: 0,
    };
  }

  if (mode === 'feed-source-signal-discovery') {
    return {
      packageFile,
      channels:
        item.feedStatus === 'parsed'
          ? [
              {
                source: 'feed-source-signal',
                platform: feedPlatform(item.feedType),
                label: item.title || item.feedLabel || 'Feed',
                url: item.feedUrl,
                verified: false,
                confidence: item.activityStatus === 'active' ? 'active' : 'discovered',
                evidence: item.recentItems?.slice(0, 3).map((feedItem) => feedItem.title).filter(Boolean) ?? [],
              },
            ]
          : [],
      contactCandidates: (item.publicEmailCandidates ?? []).map((email) => ({
        source: email.source ?? 'feed-public-email',
        type: 'public-email-candidate',
        value: email.value,
        sourceUrl: email.sourceUrl,
        verified: false,
        reviewerNote: email.reviewerNote ?? '',
      })),
      affiliations: [],
      searchTargets: [],
      creatorSuggestions: item.feedStatus === 'parsed' && ['podcast', 'newsletter'].includes(item.feedType) ? 1 : 0,
    };
  }

  return {
    packageFile,
    channels: [],
    contactCandidates: [],
    affiliations: [],
    searchTargets: [],
    creatorSuggestions: 0,
  };
}

function feedPlatform(feedType) {
  if (feedType === 'podcast') {
    return 'podcast';
  }

  if (feedType === 'newsletter') {
    return 'newsletter';
  }

  return 'website';
}

function assessDiscoveryStar(candidate, channels, contactCandidates, creatorSuggestions) {
  const activePlatforms = unique(channels.map((channel) => channel.platform).filter((platform) => socialPlatforms.has(platform)));
  const hasPodcast = channels.some((channel) => channel.platform === 'podcast');
  const hasYoutube = channels.some((channel) => channel.platform === 'youtube');
  const publicEmailCount = contactCandidates.filter((contact) => contact.type === 'public-email-candidate').length;
  const contactPageCount = contactCandidates.filter((contact) => contact.type === 'contact-page-candidate').length;
  const reasons = [];
  const missingSignals = [];
  let score = 0;

  if (hasPodcast) {
    score += 20;
    reasons.push('Podcast discovery signal found.');
  } else {
    missingSignals.push('No podcast signal found yet.');
  }

  if (hasYoutube) {
    score += 20;
    reasons.push('YouTube discovery signal found.');
  } else {
    missingSignals.push('No YouTube signal found yet.');
  }

  if (activePlatforms.length >= 4) {
    score += 16;
    reasons.push('Four or more public platform signals found.');
  } else if (activePlatforms.length === 3) {
    score += 12;
    reasons.push('Three public platform signals found.');
  } else if (activePlatforms.length === 2) {
    score += 8;
    reasons.push('Two public platform signals found.');
  } else if (activePlatforms.length === 1) {
    score += 4;
    reasons.push('One public platform signal found.');
  } else {
    missingSignals.push('No public platform signal found yet.');
  }

  if (publicEmailCount > 0) {
    score += 15;
    reasons.push('Public email candidate found.');
  } else {
    missingSignals.push('No public email candidate found yet.');
  }

  if (contactPageCount > 0) {
    score += 8;
    reasons.push('Contact, press, booking, or profile page candidate found.');
  }

  if (creatorSuggestions > 0) {
    score += Math.min(10, creatorSuggestions * 2);
    reasons.push('Creator or media source suggestion found.');
  }

  if (candidate.reachScore >= 82) {
    score += 6;
    reasons.push('High existing reach score.');
  } else if (candidate.reachScore >= 72) {
    score += 4;
    reasons.push('Solid existing reach score.');
  }

  const boundedScore = Math.min(100, score);
  const stars = scoreToStars(boundedScore);

  return {
    stars,
    score: boundedScore,
    label: discoveryStarLabel(stars),
    reasons: reasons.slice(0, 6),
    missingSignals: missingSignals.slice(0, 5),
    note: 'Discovery stars are prioritization only; they are not contact permission or compliance approval.',
  };
}

function scoreToStars(score) {
  if (score >= 60) {
    return 5;
  }
  if (score >= 45) {
    return 4;
  }
  if (score >= 30) {
    return 3;
  }
  if (score >= 15) {
    return 2;
  }
  return 1;
}

function discoveryStarLabel(stars) {
  if (stars === 5) {
    return 'Priority discovery dossier';
  }
  if (stars === 4) {
    return 'Strong discovery dossier';
  }
  if (stars === 3) {
    return 'Promising discovery dossier';
  }
  if (stars === 2) {
    return 'Needs more source signals';
  }
  return 'Retained discovery record';
}

function buildSensitivityFlags(candidate) {
  const flags = [];

  if (['psychology', 'therapy', 'medicine'].includes(candidate.primaryCategory)) {
    flags.push('health-or-mental-health');
  }

  if (candidate.primaryCategory === 'religion') {
    flags.push('religion');
  }

  if (candidate.riskLevel === 'high') {
    flags.push('high-risk');
  }

  return unique(flags);
}

function buildSummary(dossiers) {
  const discoveryStars = {
    one: dossiers.filter((dossier) => dossier.discoveryStar.stars === 1).length,
    two: dossiers.filter((dossier) => dossier.discoveryStar.stars === 2).length,
    three: dossiers.filter((dossier) => dossier.discoveryStar.stars === 3).length,
    four: dossiers.filter((dossier) => dossier.discoveryStar.stars === 4).length,
    five: dossiers.filter((dossier) => dossier.discoveryStar.stars === 5).length,
  };

  return {
    candidates: dossiers.length,
    discoveryPackages: packages.length,
    dossiersWithAnyDiscovery: dossiers.filter(
      (dossier) => dossier.counts.discoveryChannels > 0 || dossier.counts.contactCandidates > 0,
    ).length,
    channelCandidates: dossiers.reduce((count, dossier) => count + dossier.counts.discoveryChannels, 0),
    contactCandidates: dossiers.reduce((count, dossier) => count + dossier.counts.contactCandidates, 0),
    publicEmailCandidates: dossiers.reduce((count, dossier) => count + dossier.counts.publicEmailCandidates, 0),
    contactPageCandidates: dossiers.reduce((count, dossier) => count + dossier.counts.contactPageCandidates, 0),
    candidatesWithPublicEmail: dossiers.filter((dossier) => dossier.counts.publicEmailCandidates > 0).length,
    candidatesWithContactCandidate: dossiers.filter((dossier) => dossier.counts.contactCandidates > 0).length,
    creatorSuggestions: dossiers.reduce((count, dossier) => count + dossier.counts.creatorSuggestions, 0),
    affiliations: dossiers.reduce((count, dossier) => count + dossier.counts.affiliations, 0),
    sensitiveReviewRequired: dossiers.filter((dossier) => dossier.sensitiveFlags.length > 0).length,
    discoveryStars,
    parseFailures: parseFailures.length,
  };
}

function renderMarkdown(dossierPackage) {
  const lines = [
    `# Candidate Discovery Dossiers: ${dossierPackage.sourceBatchId ?? dossierPackage.reviewId}`,
    '',
    `Generated: ${dossierPackage.createdAt}`,
    `Candidates: ${dossierPackage.summary.candidates}`,
    `Discovery packages: ${dossierPackage.summary.discoveryPackages}`,
    '',
    'Discovery dossiers are source intelligence only. They do not approve outreach.',
    '',
    '## Summary',
    '',
    `- Dossiers with any discovery: ${dossierPackage.summary.dossiersWithAnyDiscovery}`,
    `- Channel candidates: ${dossierPackage.summary.channelCandidates}`,
    `- Contact candidates: ${dossierPackage.summary.contactCandidates}`,
    `- Public email candidates: ${dossierPackage.summary.publicEmailCandidates}`,
    `- Contact page candidates: ${dossierPackage.summary.contactPageCandidates}`,
    `- Candidates with public email candidates: ${dossierPackage.summary.candidatesWithPublicEmail}`,
    `- Creator suggestions: ${dossierPackage.summary.creatorSuggestions}`,
    `- Affiliations: ${dossierPackage.summary.affiliations}`,
    `- Sensitive review required: ${dossierPackage.summary.sensitiveReviewRequired}`,
    `- Five-star discovery dossiers: ${dossierPackage.summary.discoveryStars.five}`,
    `- Four-star discovery dossiers: ${dossierPackage.summary.discoveryStars.four}`,
    `- One-star retained records: ${dossierPackage.summary.discoveryStars.one}`,
    '',
    '## Guardrails',
    '',
    ...dossierPackage.rules.map((rule) => `- ${rule}`),
    '',
    '## Dossiers',
    '',
  ];

  dossierPackage.dossiers.forEach((dossier, index) => {
    lines.push(`### ${index + 1}. ${dossier.name}`);
    lines.push('');
    lines.push(`- Category: ${dossier.category}`);
    lines.push(`- Discovery stars: ${dossier.discoveryStar.stars} (${dossier.discoveryStar.label})`);
    lines.push(`- Channels: ${dossier.counts.discoveryChannels}`);
    lines.push(`- Contact candidates: ${dossier.counts.contactCandidates}`);
    lines.push(`- Public email candidates: ${dossier.counts.publicEmailCandidates}`);
    lines.push(`- Contact page candidates: ${dossier.counts.contactPageCandidates}`);
    lines.push(`- Creator suggestions: ${dossier.counts.creatorSuggestions}`);
    if (dossier.sensitiveFlags.length > 0) {
      lines.push(`- Sensitive flags: ${dossier.sensitiveFlags.join(', ')}`);
    }

    if (dossier.discoveryStar.reasons.length > 0) {
      lines.push('- Star reasons:');
      dossier.discoveryStar.reasons.forEach((reason) => lines.push(`  - ${reason}`));
    }

    if (dossier.contactCandidates.length > 0) {
      lines.push('- Contact candidates:');
      dossier.contactCandidates.slice(0, 8).forEach((contact) => {
        lines.push(`  - ${contact.type}: ${contact.value}`);
      });
    }

    lines.push('');
  });

  return `${lines.join('\n')}\n`;
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
  if (host.includes('podcasts.apple.com') || host.includes('spotify.com') || host.includes('podbean.com')) {
    return 'podcast';
  }

  return 'website';
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

function normalizeContactValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}
