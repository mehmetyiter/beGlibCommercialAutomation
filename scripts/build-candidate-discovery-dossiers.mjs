import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  assessContactPageAttribution,
  assessCreatorSuggestionAttribution,
  assessCreatorDescriptionEmailAttribution,
  assessEmailAttribution,
  assessFeedAttribution,
  assessFeedEmailAttribution,
  assessOrcidEmailAttribution,
  assessPageIdentity,
  assessSocialAttribution,
  extractExplicitPublicEmailCandidates,
  isPublicResearcherUrl,
  isSocialAccountProfileUrl,
} from './lib/candidate-attribution.mjs';
import {
  identityConfidence,
  podcastIdentityConfidence,
  youtubeIdentityConfidence,
} from './lib/creator-source-confidence.mjs';
import { mergeChannelCandidates } from './lib/channel-candidate-merge.mjs';
import { isLikelySyndicationFeed } from './lib/feed-source-quality.mjs';

const supportedModes = new Set([
  'creator-source-discovery',
  'feed-source-signal-discovery',
  'orcid-source-discovery',
  'public-identity-source-discovery',
  'public-page-contact-source-discovery',
]);
const socialPlatforms = new Set(['youtube', 'x', 'instagram', 'linkedin', 'facebook', 'tiktok', 'newsletter', 'podcast']);
const socialAccountPlatforms = new Set(['youtube', 'x', 'instagram', 'linkedin', 'facebook', 'tiktok']);

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
  qualityVersion: 'candidate-attribution-v2',
  inputDir,
  discoveryPackageFiles: packages.map((entry) => entry.file),
  summary,
  rules: [
    'Discovery dossiers are not outreach approval.',
    'Discovery stars are prioritization signals, not inclusion filters and not compliance status.',
    'Keep every candidate, including low-star and no-star records.',
    'Do not use public email candidates, contact page links, or social profiles until human verification is complete.',
    'Do not guess emails or derive address patterns.',
    'Only identity-attributed direct or representative routes count as candidate contacts; unresolved discoveries remain quarantined for audit.',
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
console.log(`Quarantined channel candidates: ${summary.quarantinedChannelCandidates}`);
console.log(`Quarantined contact candidates: ${summary.quarantinedContactCandidates}`);
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
  const baseChannelCandidates = (candidate.channels ?? []).map((channel) => ({
    source: 'candidate-record',
    platform: channel.platform,
    label: channel.label,
    url: channel.url,
    verified: Boolean(channel.verified),
    confidence: channel.verified ? 'verified' : 'unknown',
  }));
  const allChannelCandidates = [
    ...baseChannelCandidates,
    ...relevantItems.flatMap((entry) => entry.channels),
  ];
  const eligibleChannelCandidates = allChannelCandidates.filter(
    (channel) => !socialAccountPlatforms.has(channel.platform) || isSocialAccountProfileUrl(channel.url),
  );
  const quarantinedNonProfileChannels = allChannelCandidates
    .filter((channel) => socialAccountPlatforms.has(channel.platform) && !isSocialAccountProfileUrl(channel.url))
    .map((channel) => ({
      ...channel,
      identityAttribution: 'unresolved',
      identityScore: 0,
      identityConfidence: 'low',
      identityEvidence: [
        ...(channel.identityEvidence ?? []),
        'social-url-is-not-an-account-profile',
      ],
      eligibleForReview: false,
    }));
  const discoveryChannels = mergeChannelCandidates(
    eligibleChannelCandidates,
    (channel) => `${channel.platform}|${normalizeUrl(channel.url)}`,
  );
  const contactCandidates = dedupeContactCandidates(relevantItems.flatMap((entry) => entry.contactCandidates));
  const acceptedChannelKeys = new Set(
    discoveryChannels.map((channel) => `${channel.platform}|${normalizeUrl(channel.url)}`),
  );
  const quarantinedChannels = uniqueByKey(
    [...quarantinedNonProfileChannels, ...relevantItems.flatMap((entry) => entry.quarantinedChannels ?? [])],
    (channel) => `${channel.platform}|${normalizeUrl(channel.url)}`,
  ).filter((channel) => !acceptedChannelKeys.has(`${channel.platform}|${normalizeUrl(channel.url)}`));
  const acceptedContactKeys = new Set(contactCandidates.map(contactCandidateKey));
  const quarantinedContactCandidates = dedupeContactCandidates(
    relevantItems.flatMap((entry) => entry.quarantinedContactCandidates ?? []),
  ).filter((contact) => !acceptedContactKeys.has(contactCandidateKey(contact)));
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
  const creatorSuggestions = discoveryChannels.filter((channel) => isCreatorSuggestionChannel(channel)).length;
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
      quarantinedChannels: quarantinedChannels.length,
      quarantinedContactCandidates: quarantinedContactCandidates.length,
    },
    discoveryChannels,
    contactCandidates,
    quarantinedChannels,
    quarantinedContactCandidates,
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
    return normalizeCreatorDiscoveryItem(item, packageFile);
  }

  if (mode === 'orcid-source-discovery') {
    return normalizeOrcidDiscoveryItem(item, packageFile);
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
    return normalizePageContactDiscoveryItem(item, packageFile);
  }

  if (mode === 'feed-source-signal-discovery') {
    return normalizeFeedDiscoveryItem(item, packageFile);
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

function normalizeOrcidDiscoveryItem(item, packageFile) {
  const contactCandidates = [];
  const quarantinedContactCandidates = [];
  const identityConfidence = item.identityConfidence ?? 'low';
  const acceptedResearcherUrls = (item.researcherUrls ?? []).filter((link) =>
    isPublicResearcherUrl(link.url),
  );
  const quarantinedResearcherUrls = (item.researcherUrls ?? []).filter(
    (link) => !isPublicResearcherUrl(link.url),
  );

  for (const email of item.publicEmails ?? []) {
    const assessment = assessOrcidEmailAttribution({
      candidateName: item.name,
      orcidName: item.orcidName,
      identityConfidence,
      email: email.value,
      orcidVerified: email.orcidVerified,
    });
    const contact = {
      source: email.source ?? 'orcid-public-email',
      type: 'public-email-candidate',
      value: email.value,
      sourceUrl: email.sourceUrl,
      verified: false,
      reviewerNote: email.reviewerNote ?? '',
      ...assessment,
    };
    (assessment.eligibleForReview ? contactCandidates : quarantinedContactCandidates).push(contact);
  }

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
              confidence: identityConfidence,
            },
          ]
        : []),
      ...acceptedResearcherUrls.map((link) => ({
        source: link.source ?? 'orcid-researcher-url',
        platform: link.platform,
        label: link.label,
        url: link.url,
        verified: false,
        confidence: link.confidence ?? 'unknown',
      })),
    ],
    quarantinedChannels: quarantinedResearcherUrls.map((link) => ({
      source: link.source ?? 'orcid-researcher-url',
      platform: link.platform,
      label: link.label,
      url: link.url,
      verified: false,
      confidence: 'low',
      role: 'non-public-environment-url',
      identityAttribution: 'unresolved',
      identityConfidence: 'low',
      identityEvidence: ['researcher-url-targets-non-public-environment'],
      eligibleForReview: false,
    })),
    contactCandidates,
    quarantinedContactCandidates,
    affiliations: item.affiliations ?? [],
    searchTargets: item.searchTargets ?? [],
    creatorSuggestions: 0,
  };
}

function normalizeCreatorDiscoveryItem(item, packageFile) {
  const channels = [];
  const quarantinedChannels = [];
  const contactCandidates = [];
  const quarantinedContactCandidates = [];
  const reviewedChannels = (item.reviewOutcome?.channels ?? []).filter((channel) => channel.url);
  const reviewedByUrl = new Map(
    reviewedChannels.map((channel) => [normalizeUrl(channel.url), channel]),
  );
  const reviewedSourceUrls = item.reviewOutcome?.sourceUrls ?? [];
  const knownSourceUrls = [
    ...(item.sourceHints ?? []),
    ...reviewedSourceUrls,
    ...reviewedChannels.map((channel) => channel.url),
  ];
  const candidate = {
    name: item.name,
    title: item.title,
    primaryCategory: item.category,
    sourceUrls: knownSourceUrls,
  };
  const suggestions = [...(item.suggestions ?? []), ...(item.deprioritizedSuggestions ?? [])];
  for (const suggestion of suggestions) {
    const evidence = suggestion.evidence ?? [];
    const review = reviewedByUrl.get(normalizeUrl(suggestion.url));
    const attributedSourceUrl = (suggestion.sourceUrls ?? []).find((sourceUrl) =>
      knownSourceUrls.some((knownUrl) => normalizeUrl(knownUrl) === normalizeUrl(sourceUrl)),
    );
    const discoveredConfidence =
      suggestion.platform === 'podcast'
        ? podcastIdentityConfidence(candidate, suggestion.label, evidence.slice(0, 2), evidence, suggestion.url)
        : suggestion.platform === 'youtube'
          ? youtubeIdentityConfidence({
              candidate,
              label: suggestion.label,
              description: youtubeDescription(evidence),
              suggestionUrl: attributedSourceUrl ?? suggestion.url,
              subscriberCount: suggestion.publicCounts?.youtubeSubscribers,
              videoCount: suggestion.publicCounts?.youtubeVideos ?? youtubeVideoCount(evidence),
            })
          : identityConfidence(candidate, [suggestion.label, ...evidence], suggestion.url);
    const confidence = review ? 'verified' : discoveredConfidence;
    const assessment = assessCreatorSuggestionAttribution({
      url: suggestion.url,
      label: suggestion.label,
      evidence,
      confidence: review ? 'high' : confidence,
      knownSourceUrls,
    });
    const channel = {
      source: review?.source ?? suggestion.source,
      platform: review?.platform ?? suggestion.platform,
      label: review?.label ?? suggestion.label,
      url: suggestion.url,
      verified: Boolean(review) && assessment.eligibleForReview,
      confidence,
      discoveredConfidence: suggestion.confidence ?? 'unknown',
      evidence: [...evidence, ...(review?.evidence ?? [])],
      publicCounts: suggestion.publicCounts ?? {},
      discoveryMethod: suggestion.discoveryMethod,
      ...assessment,
    };
    (assessment.eligibleForReview ? channels : quarantinedChannels).push(channel);

    if (suggestion.platform === 'youtube') {
      const description = youtubeDescription(evidence);
      for (const email of extractExplicitPublicEmailCandidates(description)) {
        const emailAssessment = assessCreatorDescriptionEmailAttribution({
          candidateName: item.name,
          email: email.value,
          contextText: email.intentContextText,
          channelAssessment: assessment,
        });
        const contact = {
          source: 'youtube-channel-description',
          type: 'public-email-candidate',
          value: email.value,
          sourceUrl: suggestion.url,
          contextText: email.contextText,
          intentContextText: email.intentContextText,
          verified: false,
          reviewerNote:
            'Explicit email published in public YouTube channel metadata. Human verification is required before campaign use.',
          ...emailAssessment,
        };
        (emailAssessment.eligibleForReview ? contactCandidates : quarantinedContactCandidates).push(contact);
      }
    }
  }

  const suggestionUrls = new Set(suggestions.map((suggestion) => normalizeUrl(suggestion.url)));
  for (const reviewedChannel of reviewedChannels) {
    if (suggestionUrls.has(normalizeUrl(reviewedChannel.url))) {
      continue;
    }

    const evidence = reviewedChannel.evidence ?? [];
    const assessment = assessCreatorSuggestionAttribution({
      url: reviewedChannel.url,
      label: reviewedChannel.label,
      evidence,
      confidence: 'high',
      knownSourceUrls,
    });
    const channel = {
      source: reviewedChannel.source ?? 'manual-creator-review',
      platform: reviewedChannel.platform,
      label: reviewedChannel.label,
      url: reviewedChannel.url,
      verified: assessment.eligibleForReview,
      confidence: 'verified',
      discoveredConfidence: 'manual-review',
      evidence,
      ...assessment,
    };
    (assessment.eligibleForReview ? channels : quarantinedChannels).push(channel);
  }

  return {
    packageFile,
    channels,
    quarantinedChannels,
    contactCandidates,
    quarantinedContactCandidates,
    affiliations: [],
    searchTargets: [],
    creatorSuggestions: channels.length,
  };
}

function youtubeVideoCount(evidence) {
  for (const item of evidence) {
    const match = String(item).match(/^(\d+) public videos reported by API\.$/);
    if (match) {
      return Number(match[1]);
    }
  }

  return undefined;
}

function youtubeDescription(evidence) {
  return evidence.find(
    (item) =>
      !/^Resolved from known candidate YouTube URL: /i.test(String(item)) &&
      !/^\d+ public (videos|subscribers) reported by API\.$/.test(String(item)),
  );
}

function normalizeFeedDiscoveryItem(item, packageFile) {
  const contactCandidates = [];
  const quarantinedContactCandidates = [];
  for (const email of item.publicEmailCandidates ?? []) {
    const assessment = assessFeedEmailAttribution({
      candidateName: item.name,
      email: email.value,
      feedUrl: item.feedUrl,
      siteUrl: item.siteUrl,
      sourcePageUrl: item.sourcePageUrl,
      sourcePageTitle: item.sourcePageTitle,
      title: item.title,
      authorCandidates: item.authorCandidates ?? [],
    });
    const contact = {
      source: email.source ?? 'feed-public-email',
      type: 'public-email-candidate',
      value: email.value,
      sourceUrl: email.sourceUrl,
      verified: false,
      reviewerNote: email.reviewerNote ?? '',
      ...assessment,
    };
    (assessment.eligibleForReview ? contactCandidates : quarantinedContactCandidates).push(contact);
  }

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
    contactCandidates,
    quarantinedContactCandidates,
    affiliations: [],
    searchTargets: [],
    creatorSuggestions: item.feedStatus === 'parsed' && ['podcast', 'newsletter'].includes(item.feedType) ? 1 : 0,
  };
}

function normalizePageContactDiscoveryItem(item, packageFile) {
  const sourceUrl = item.finalUrl || item.sourceUrl || '';
  const pageIdentity = assessPageIdentity({
    candidateName: item.name,
    pageTitle: item.pageTitle,
    pageHeading: item.pageHeading,
    metaDescription: item.metaDescription,
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
    finalUrl: item.finalUrl,
    canonicalUrl: item.canonicalUrl,
  });
  const channels = [];
  const quarantinedChannels = [];
  const contactCandidates = [];
  const quarantinedContactCandidates = [];

  if (item.finalUrl) {
    const channel = {
      source: 'public-page-source',
      platform: item.sourcePlatform ?? classifyPlatform(item.finalUrl),
      label: item.pageTitle || item.sourceLabel || 'Public page',
      url: item.finalUrl,
      verified: false,
      confidence: pageIdentity.eligible ? 'identity-attributed' : 'unresolved',
      role: 'candidate-page',
      ...pageAttributionFields(pageIdentity),
    };
    (pageIdentity.eligible ? channels : quarantinedChannels).push(channel);
  }

  const socialLinks = [...(item.socialLinks ?? []), ...(item.quarantinedSocialLinks ?? [])];
  for (const link of socialLinks) {
    const assessment = assessSocialAttribution({
      candidateName: item.name,
      url: link.url,
      label: link.label,
      contextText: link.contextText,
      sourceUrl,
      pageIdentity,
    });
    const channel = {
      source: link.source ?? 'public-page-link',
      platform: link.platform,
      label: link.label,
      url: link.url,
      verified: false,
      confidence: assessment.identityConfidence,
      ...assessment,
    };
    (assessment.eligibleForReview ? channels : quarantinedChannels).push(channel);
  }

  const feedLinks = [...(item.feedLinks ?? []), ...(item.quarantinedFeedLinks ?? [])];
  for (const link of feedLinks) {
    if (!isLikelySyndicationFeed({ url: link.url, label: link.label, type: link.type, rel: link.rel })) {
      continue;
    }

    const assessment = assessFeedAttribution({
      candidateName: item.name,
      url: link.url,
      label: link.label,
      sourceUrl,
      pageIdentity,
    });
    const channel = {
      source: link.source ?? 'public-page-feed-link',
      platform: 'newsletter',
      label: link.label,
      url: link.url,
      verified: false,
      confidence: assessment.identityConfidence,
      ...assessment,
    };
    (assessment.eligibleForReview ? channels : quarantinedChannels).push(channel);
  }

  const emailCandidates = [...(item.emailCandidates ?? []), ...(item.quarantinedEmailCandidates ?? [])];
  for (const email of emailCandidates) {
    const assessment = assessEmailAttribution({
      candidateName: item.name,
      email: email.value,
      role: email.role,
      label: email.label,
      linkText: email.linkText,
      contextText: email.contextText,
      pageIdentity,
    });
    const contact = {
      source: email.source ?? 'public-page-mailto',
      type: 'public-email-candidate',
      value: email.value,
      sourceUrl: email.sourceUrl || sourceUrl,
      sourceApiUrl: email.sourceApiUrl,
      label: email.label,
      linkText: email.linkText,
      contextText: email.contextText,
      verified: false,
      reviewerNote: email.reviewerNote ?? '',
      ...assessment,
    };
    (assessment.eligibleForReview ? contactCandidates : quarantinedContactCandidates).push(contact);
  }

  const phoneCandidates = [...(item.phoneCandidates ?? []), ...(item.quarantinedPhoneCandidates ?? [])];
  for (const phone of phoneCandidates) {
    const eligibleForReview =
      pageIdentity.level === 'direct' &&
      ['direct-person', 'support-staff', 'representative'].includes(phone.role ?? '');
    const contact = {
      source: phone.source ?? 'public-component-api',
      type: phone.type ?? 'public-phone-candidate',
      value: phone.value,
      sourceUrl: phone.sourceUrl || sourceUrl,
      sourceApiUrl: phone.sourceApiUrl,
      label: phone.label,
      role: phone.role,
      verified: false,
      reviewerNote: phone.reviewerNote ?? '',
      identityAttribution:
        phone.role === 'direct-person'
          ? 'direct'
          : ['support-staff', 'representative'].includes(phone.role)
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
    (eligibleForReview ? contactCandidates : quarantinedContactCandidates).push(contact);
  }

  const pageCandidates = [
    ...(item.contactPageCandidates ?? []),
    ...(item.quarantinedContactPageCandidates ?? []),
  ];
  for (const page of pageCandidates) {
    const assessment = assessContactPageAttribution({
      candidateName: item.name,
      url: page.url,
      label: page.label,
      reason: page.reason,
      contextText: page.contextText,
      sourceUrl,
      pageIdentity,
    });
    const contact = {
      source: page.source ?? 'public-page-link',
      type: 'contact-page-candidate',
      value: page.url,
      sourceUrl,
      label: page.label,
      reason: page.reason,
      contextText: page.contextText,
      verified: false,
      ...assessment,
    };
    (assessment.eligibleForReview ? contactCandidates : quarantinedContactCandidates).push(contact);
  }

  return {
    packageFile,
    channels,
    quarantinedChannels,
    contactCandidates,
    quarantinedContactCandidates,
    affiliations: [],
    searchTargets: item.searchTargets ?? [],
    creatorSuggestions: 0,
  };
}

function pageAttributionFields(pageIdentity) {
  return {
    identityAttribution: pageIdentity.level === 'direct' ? 'direct' : 'unresolved',
    identityScore: pageIdentity.score,
    identityConfidence: pageIdentity.score >= 85 ? 'high' : pageIdentity.score >= 70 ? 'medium' : 'low',
    identityEvidence: pageIdentity.evidence,
    eligibleForReview: pageIdentity.eligible,
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

function isCreatorSuggestionChannel(channel) {
  const source = channel.source ?? '';
  return (
    source === 'rss-feed' ||
    (source === 'feed-source-signal' && ['newsletter', 'podcast'].includes(channel.platform)) ||
    source === 'youtube-data-api' ||
    source.startsWith('podcastindex-')
  );
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
    quarantinedChannelCandidates: dossiers.reduce(
      (count, dossier) => count + dossier.counts.quarantinedChannels,
      0,
    ),
    quarantinedContactCandidates: dossiers.reduce(
      (count, dossier) => count + dossier.counts.quarantinedContactCandidates,
      0,
    ),
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
    `- Quarantined channel candidates: ${dossierPackage.summary.quarantinedChannelCandidates}`,
    `- Quarantined contact candidates: ${dossierPackage.summary.quarantinedContactCandidates}`,
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
    lines.push(`- Quarantined channels: ${dossier.counts.quarantinedChannels}`);
    lines.push(`- Quarantined contacts: ${dossier.counts.quarantinedContactCandidates}`);
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

function dedupeContactCandidates(contacts) {
  const sorted = [...contacts].sort(
    (left, right) =>
      (right.identityScore ?? 0) - (left.identityScore ?? 0) ||
      contactRoleRank(left.role) - contactRoleRank(right.role) ||
      normalizeContactValue(left.value).localeCompare(normalizeContactValue(right.value)),
  );
  return uniqueByKey(sorted, contactCandidateKey);
}

function contactCandidateKey(contact) {
  const type = contact.type ?? 'contact';
  const value = String(contact.value ?? '');
  if (type.includes('email')) {
    return `email|${value.toLowerCase()}`;
  }
  if (type.includes('phone')) {
    return `phone|${value.replace(/\D/g, '')}`;
  }
  if (type === 'contact-page-candidate') {
    const route = normalizeContactRouteUrl(value);
    const label = normalizeContactValue(contact.label).replace(/[^a-z0-9]+/g, ' ').trim();
    if (/^(?:contact|contact me|contact us|contacto|kontakt|media|press)$/.test(label)) {
      return `route|${getDomain(value)}|${contact.reason ?? 'contact'}|${label.replace(/^(?:contacto|kontakt)$/, 'contact')}`;
    }
    return `route|${route || normalizeContactValue(value)}`;
  }
  return `${type}|${normalizeUrl(value) || normalizeContactValue(value)}`;
}

function normalizeContactRouteUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    if (/^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0] ?? '')) {
      segments.shift();
    }
    url.pathname = `/${segments.join('/')}`.replace(/\/+$/, '') || '/';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:cate|day|dy|fbclid|ima|month|ref|source|utm_.+|year)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return normalizeContactValue(value);
  }
}

function contactRoleRank(role) {
  if (role === 'direct-person' || role === 'direct-route') {
    return 0;
  }
  if (role === 'support-staff' || role === 'representative' || role === 'representative-route') {
    return 1;
  }
  if (role === 'generic-office') {
    return 3;
  }
  return 2;
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
