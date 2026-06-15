import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const allowedRouteTypes = new Set(['public-business-email', 'representative-email', 'contact-form']);
const outcomeStatuses = new Set([
  'pending',
  'verified-route',
  'profile-only',
  'needs-more-review',
  'rejected',
  'do-not-contact',
]);
const suppressionStatuses = new Set(['unknown', 'clear', 'do-not-contact', 'opted-out', 'not-allowed']);
const sensitiveReviewStatuses = new Set(['pending', 'not-required', 'approved', 'rejected', 'legal-review-required']);
const consumerEmailDomains = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'proton.me']);

const args = parseArgs(process.argv.slice(2));
const batchPath = resolve(args.batch ?? args._[0] ?? 'examples/research-batch.synthetic.json');
const reviewPath = resolve(args.review ?? args._[1] ?? 'examples/official-source-review-outcomes.synthetic.json');
const outputPath = resolve(args.output ?? defaultOutputPath(batchPath));
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
const result = applyOfficialSourceReview(batch, review);

if (result.errors.length > 0) {
  console.error('Official-source review import failed.');
  result.errors.forEach((error) => console.error(`- ${error}`));
  if (result.warnings.length > 0) {
    console.error('Warnings:');
    result.warnings.forEach((warning) => console.error(`- ${warning}`));
  }
  process.exitCode = 1;
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result.batch, null, 2)}\n`, 'utf8');

  console.log(`Official-source candidate update batch written to ${outputPath}`);
  console.log(`Candidates in source batch: ${result.sourceCandidates}`);
  console.log(`Outcomes read: ${result.outcomesRead}`);
  console.log(`Candidates updated: ${result.updated}`);
  console.log(`Routes added: ${result.routesAdded}`);
  console.log(`Profile-only updates: ${result.profileOnly}`);
  console.log(`Suppression updates: ${result.suppressed}`);
  console.log(`Skipped outcomes: ${result.skipped}`);
  if (result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
  console.log('Validate with:');
  console.log(`npm run validate:batch -- ${outputPath}`);
}

function applyOfficialSourceReview(sourceBatch, reviewPackage) {
  const errors = [];
  const warnings = [];
  const candidates = Array.isArray(sourceBatch.candidates) ? sourceBatch.candidates : [];
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const outcomes = collectOutcomes(reviewPackage);
  const updatedCandidates = [];
  let routesAdded = 0;
  let profileOnly = 0;
  let suppressed = 0;
  let skipped = 0;

  outcomes.forEach((outcome, index) => {
    const prefix = `outcomes[${index}]`;
    const normalized = normalizeOutcome(outcome);

    if (!normalized.candidateId) {
      errors.push(`${prefix}.candidateId is required.`);
      return;
    }

    const candidate = candidatesById.get(normalized.candidateId);
    if (!candidate) {
      errors.push(`${prefix}.candidateId does not match any candidate in source batch: ${normalized.candidateId}`);
      return;
    }

    const outcomeErrors = validateOutcome(normalized, candidate, prefix);
    if (outcomeErrors.length > 0) {
      errors.push(...outcomeErrors);
      return;
    }

    if (['pending', 'needs-more-review', 'rejected'].includes(normalized.outcomeStatus)) {
      skipped += 1;
      return;
    }

    const current = updatedCandidates.find((item) => item.id === candidate.id) ?? structuredClone(candidate);
    if (!updatedCandidates.some((item) => item.id === candidate.id)) {
      updatedCandidates.push(current);
    }

    if (normalized.outcomeStatus === 'do-not-contact') {
      applySuppression(current, normalized);
      suppressed += 1;
      return;
    }

    applyOfficialProfile(current, normalized);

    if (normalized.outcomeStatus === 'profile-only') {
      profileOnly += 1;
      return;
    }

    applyContactRoute(current, normalized);
    routesAdded += 1;

    if (normalized.officialContactRouteType === 'public-business-email') {
      const domain = normalized.officialContactRouteValue.split('@').pop()?.toLowerCase();
      if (consumerEmailDomains.has(domain)) {
        warnings.push(`${prefix} uses a consumer email domain; keep reviewer evidence and prefer representative routes when possible.`);
      }
    }
  });

  const outputBatch = {
    batchId: `${sourceBatch.batchId ?? 'research-batch'}-official-source-updates-${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    sourceLabel: `Official-source review updates for ${sourceBatch.sourceLabel ?? sourceBatch.batchId ?? 'research batch'}`,
    researcher: 'beGlib official-source review importer',
    notes:
      'Generated from human-reviewed official-source outcomes. Importing this batch updates candidate evidence and contact routes, but does not approve outreach.',
    candidates: updatedCandidates.sort((left, right) => left.name.localeCompare(right.name)),
  };

  if (updatedCandidates.length === 0 && errors.length === 0) {
    errors.push('No completed official-source outcomes were available to apply.');
  }

  return {
    batch: outputBatch,
    errors,
    warnings,
    sourceCandidates: candidates.length,
    outcomesRead: outcomes.length,
    updated: updatedCandidates.length,
    routesAdded,
    profileOnly,
    suppressed,
    skipped,
  };
}

function collectOutcomes(reviewPackage) {
  if (Array.isArray(reviewPackage.outcomes)) {
    return reviewPackage.outcomes;
  }

  if (Array.isArray(reviewPackage.items)) {
    return reviewPackage.items.map((item) => item.reviewOutcome).filter(Boolean);
  }

  return [];
}

function normalizeOutcome(outcome) {
  return {
    candidateId: stringValue(outcome?.candidateId),
    outcomeStatus: stringValue(outcome?.outcomeStatus ?? outcome?.status) || 'pending',
    officialProfileUrl: stringValue(outcome?.officialProfileUrl),
    officialContactRouteType: stringValue(outcome?.officialContactRouteType),
    officialContactRouteValue: stringValue(outcome?.officialContactRouteValue),
    contactRouteSourceUrl: stringValue(outcome?.contactRouteSourceUrl),
    verifiedAt: stringValue(outcome?.verifiedAt),
    jurisdiction: stringValue(outcome?.jurisdiction),
    suppressionStatus: stringValue(outcome?.suppressionStatus) || 'unknown',
    sensitiveCategoryReviewStatus: stringValue(outcome?.sensitiveCategoryReviewStatus) || 'pending',
    reviewerNotes: stringValue(outcome?.reviewerNotes),
  };
}

function validateOutcome(outcome, candidate, prefix) {
  const errors = [];

  if (!outcomeStatuses.has(outcome.outcomeStatus)) {
    errors.push(`${prefix}.outcomeStatus must be one of ${Array.from(outcomeStatuses).join(', ')}.`);
  }

  if (!suppressionStatuses.has(outcome.suppressionStatus)) {
    errors.push(`${prefix}.suppressionStatus must be one of ${Array.from(suppressionStatuses).join(', ')}.`);
  }

  if (!sensitiveReviewStatuses.has(outcome.sensitiveCategoryReviewStatus)) {
    errors.push(`${prefix}.sensitiveCategoryReviewStatus must be one of ${Array.from(sensitiveReviewStatuses).join(', ')}.`);
  }

  if (['pending', 'needs-more-review', 'rejected'].includes(outcome.outcomeStatus)) {
    return errors;
  }

  if (outcome.outcomeStatus === 'do-not-contact') {
    if (!['do-not-contact', 'opted-out', 'not-allowed'].includes(outcome.suppressionStatus)) {
      errors.push(`${prefix}.suppressionStatus must be do-not-contact, opted-out, or not-allowed for do-not-contact outcomes.`);
    }
    return errors;
  }

  if (!isValidUrl(outcome.officialProfileUrl)) {
    errors.push(`${prefix}.officialProfileUrl must be a valid official profile URL.`);
  }

  if (!isIsoDate(outcome.verifiedAt)) {
    errors.push(`${prefix}.verifiedAt must be an ISO date string like 2026-06-15.`);
  }

  if (outcome.jurisdiction.length < 2) {
    errors.push(`${prefix}.jurisdiction is required.`);
  }

  if (outcome.suppressionStatus !== 'clear') {
    errors.push(`${prefix}.suppressionStatus must be clear before adding official profile or contact evidence.`);
  }

  if (isSensitive(candidate) && outcome.sensitiveCategoryReviewStatus === 'rejected') {
    errors.push(`${prefix}.sensitiveCategoryReviewStatus cannot be rejected for an applied update.`);
  }

  if (outcome.outcomeStatus === 'profile-only') {
    return errors;
  }

  if (!allowedRouteTypes.has(outcome.officialContactRouteType)) {
    errors.push(`${prefix}.officialContactRouteType must be one of ${Array.from(allowedRouteTypes).join(', ')}.`);
  }

  if (!isValidUrl(outcome.contactRouteSourceUrl)) {
    errors.push(`${prefix}.contactRouteSourceUrl must be a valid official source URL.`);
  }

  if (outcome.officialContactRouteType === 'contact-form') {
    if (!isValidUrl(outcome.officialContactRouteValue)) {
      errors.push(`${prefix}.officialContactRouteValue must be a valid URL for contact-form routes.`);
    }
  } else if (!isValidEmail(outcome.officialContactRouteValue)) {
    errors.push(`${prefix}.officialContactRouteValue must be a valid email address for email routes.`);
  }

  if (looksGuessed(outcome.officialContactRouteValue)) {
    errors.push(`${prefix}.officialContactRouteValue looks like a guessed contact pattern.`);
  }

  return errors;
}

function applyOfficialProfile(candidate, outcome) {
  candidate.country = outcome.jurisdiction;
  candidate.status = candidate.status === 'researching' ? 'needs-review' : candidate.status;
  candidate.lastVerifiedAt = outcome.verifiedAt;
  candidate.sourceUrls = unique([...(candidate.sourceUrls ?? []), outcome.officialProfileUrl, outcome.contactRouteSourceUrl]);
  candidate.channels = upsertChannel(candidate.channels ?? [], {
    platform: 'website',
    label: 'Official profile',
    url: outcome.officialProfileUrl,
    verified: true,
  });
  candidate.rationale = appendRationale(candidate.rationale, outcome);
}

function applyContactRoute(candidate, outcome) {
  const existingRoutes = (candidate.contactRoutes ?? []).filter((route) => route.type !== 'none');
  const route = {
    type: outcome.officialContactRouteType,
    value: outcome.officialContactRouteValue,
    sourceUrl: outcome.contactRouteSourceUrl,
    verifiedAt: outcome.verifiedAt,
  };

  candidate.contactRoutes = upsertRoute(existingRoutes, route);
  candidate.consentStatus = consentStatusForRoute(outcome.officialContactRouteType);
}

function applySuppression(candidate, outcome) {
  candidate.status = 'do-not-contact';
  candidate.consentStatus = outcome.suppressionStatus === 'opted-out' ? 'opted-out' : 'not-allowed';
  candidate.lastVerifiedAt = outcome.verifiedAt || new Date().toISOString().slice(0, 10);
  candidate.contactRoutes = [
    {
      type: 'none',
      value: 'Suppression status verified by official-source review',
      sourceUrl: candidate.sourceUrls?.[0] ?? 'local-review',
      verifiedAt: candidate.lastVerifiedAt,
    },
  ];
  candidate.rationale = `${candidate.rationale} Official-source review marked suppression status: ${outcome.suppressionStatus}.`;
}

function upsertChannel(channels, nextChannel) {
  const withoutDuplicate = channels.filter((channel) => channel.url !== nextChannel.url);
  return [...withoutDuplicate, nextChannel];
}

function upsertRoute(routes, nextRoute) {
  const withoutDuplicate = routes.filter(
    (route) =>
      !(
        route.type === nextRoute.type &&
        route.value.toLowerCase() === nextRoute.value.toLowerCase() &&
        route.sourceUrl === nextRoute.sourceUrl
      ),
  );
  return [...withoutDuplicate, nextRoute];
}

function consentStatusForRoute(routeType) {
  if (routeType === 'representative-email') {
    return 'representative-contact';
  }

  if (routeType === 'contact-form') {
    return 'contact-form-only';
  }

  return 'public-business-contact';
}

function appendRationale(rationale, outcome) {
  const note = `Official-source review on ${outcome.verifiedAt} verified ${outcome.officialProfileUrl}.`;
  const reviewerNote = outcome.reviewerNotes ? ` Reviewer note: ${outcome.reviewerNotes}` : '';
  return `${rationale} ${note}${reviewerNote}`.trim();
}

function isSensitive(candidate) {
  return ['religion', 'psychology', 'therapy', 'medicine'].includes(candidate.primaryCategory) || candidate.riskLevel === 'high';
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function looksGuessed(value) {
  return /[{]|\bfirst[._-]?last\b|\blast[._-]?first\b|\bfname\b|\blname\b/i.test(value);
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function defaultOutputPath(input) {
  const slug = input
    .split('/')
    .pop()
    ?.replace(/\.json$/i, '')
    .replace(/\.local$/i, '');

  return `data/${slug ?? 'research-batch'}-official-source-updates.local.json`;
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
