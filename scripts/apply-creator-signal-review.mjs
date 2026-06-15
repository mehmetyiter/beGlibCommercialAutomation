import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const creatorPlatforms = new Set(['youtube', 'podcast', 'x', 'instagram', 'tiktok', 'linkedin', 'newsletter']);
const outcomeStatuses = new Set(['pending', 'verified-signals', 'profile-only', 'needs-more-review', 'rejected']);
const countFields = [
  'xFollowers',
  'instagramFollowers',
  'linkedinFollowers',
  'tiktokFollowers',
  'youtubeSubscribers',
  'newsletterSubscribers',
];

const args = parseArgs(process.argv.slice(2));
const batchPath = resolve(args.batch ?? args._[0] ?? 'examples/research-batch.synthetic.json');
const reviewPath = resolve(args.review ?? args._[1] ?? 'examples/creator-signal-review-outcomes.synthetic.json');
const outputPath = resolve(args.output ?? defaultOutputPath(batchPath));
const batch = JSON.parse(await readFile(batchPath, 'utf8'));
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
const result = applyCreatorSignalReview(batch, review);

if (result.errors.length > 0) {
  console.error('Creator-signal review import failed.');
  result.errors.forEach((error) => console.error(`- ${error}`));
  if (result.warnings.length > 0) {
    console.error('Warnings:');
    result.warnings.forEach((warning) => console.error(`- ${warning}`));
  }
  process.exitCode = 1;
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result.batch, null, 2)}\n`, 'utf8');

  console.log(`Creator-signal candidate update batch written to ${outputPath}`);
  console.log(`Candidates in source batch: ${result.sourceCandidates}`);
  console.log(`Outcomes read: ${result.outcomesRead}`);
  console.log(`Candidates updated: ${result.updated}`);
  console.log(`Channels added: ${result.channelsAdded}`);
  console.log(`Signal fields updated: ${result.signalFieldsUpdated}`);
  console.log(`Skipped outcomes: ${result.skipped}`);
  if (result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
  console.log('Validate with:');
  console.log(`npm run validate:batch -- ${outputPath}`);
}

function applyCreatorSignalReview(sourceBatch, reviewPackage) {
  const errors = [];
  const warnings = [];
  const candidates = Array.isArray(sourceBatch.candidates) ? sourceBatch.candidates : [];
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const outcomes = collectOutcomes(reviewPackage);
  const updatedCandidates = [];
  let channelsAdded = 0;
  let signalFieldsUpdated = 0;
  let skipped = 0;

  outcomes.forEach((rawOutcome, index) => {
    const prefix = `outcomes[${index}]`;
    const outcome = normalizeOutcome(rawOutcome);

    if (!outcome.candidateId) {
      errors.push(`${prefix}.candidateId is required.`);
      return;
    }

    const candidate = candidatesById.get(outcome.candidateId);
    if (!candidate) {
      errors.push(`${prefix}.candidateId does not match any candidate in source batch: ${outcome.candidateId}`);
      return;
    }

    const outcomeErrors = validateOutcome(outcome, prefix);
    if (outcomeErrors.length > 0) {
      errors.push(...outcomeErrors);
      return;
    }

    if (['pending', 'needs-more-review', 'rejected'].includes(outcome.outcomeStatus)) {
      skipped += 1;
      return;
    }

    const current = updatedCandidates.find((item) => item.id === candidate.id) ?? structuredClone(candidate);
    if (!updatedCandidates.some((item) => item.id === candidate.id)) {
      updatedCandidates.push(current);
    }

    const channelResult = applyChannels(current, outcome);
    const signalResult = applySignals(current, outcome);
    channelsAdded += channelResult.added;
    signalFieldsUpdated += signalResult.updated;
    current.lastVerifiedAt = outcome.verifiedAt;
    current.status = current.status === 'researching' ? 'needs-review' : current.status;
    current.sourceUrls = unique([...(current.sourceUrls ?? []), ...outcome.sourceUrls, ...outcome.channels.map((channel) => channel.url)]);
    current.rationale = appendRationale(current.rationale, outcome, channelResult.added, signalResult.updated);

    if (outcome.outcomeStatus === 'profile-only') {
      warnings.push(`${prefix} applied profile-only creator evidence; no audience counts were required.`);
    }
  });

  const outputBatch = {
    batchId: `${sourceBatch.batchId ?? 'research-batch'}-creator-signal-updates-${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    sourceLabel: `Creator-signal review updates for ${sourceBatch.sourceLabel ?? sourceBatch.batchId ?? 'research batch'}`,
    researcher: 'beGlib creator-signal review importer',
    notes:
      'Generated from human-reviewed creator/media outcomes. Importing this batch updates prioritization signals only and does not approve outreach.',
    candidates: updatedCandidates.sort((left, right) => left.name.localeCompare(right.name)),
  };

  if (updatedCandidates.length === 0 && errors.length === 0) {
    errors.push('No completed creator-signal outcomes were available to apply.');
  }

  return {
    batch: outputBatch,
    errors,
    warnings,
    sourceCandidates: candidates.length,
    outcomesRead: outcomes.length,
    updated: updatedCandidates.length,
    channelsAdded,
    signalFieldsUpdated,
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

function normalizeOutcome(rawOutcome) {
  const outcome = isRecord(rawOutcome) ? rawOutcome : {};
  const influenceSignals = isRecord(outcome.influenceSignals) ? outcome.influenceSignals : {};

  return {
    candidateId: stringValue(outcome.candidateId),
    outcomeStatus: stringValue(outcome.outcomeStatus ?? outcome.status) || 'pending',
    verifiedAt: stringValue(outcome.verifiedAt),
    channels: Array.isArray(outcome.channels) ? outcome.channels.map(normalizeChannel) : [],
    influenceSignals: {
      hasPodcast: Boolean(influenceSignals.hasPodcast),
      hasYoutubeShow: Boolean(influenceSignals.hasYoutubeShow),
      activePlatforms: Array.isArray(influenceSignals.activePlatforms)
        ? influenceSignals.activePlatforms.map(stringValue).filter(Boolean)
        : [],
      notableSignals: Array.isArray(influenceSignals.notableSignals)
        ? influenceSignals.notableSignals.map(stringValue).filter(Boolean)
        : [],
      ...Object.fromEntries(
        countFields
          .filter((field) => typeof influenceSignals[field] !== 'undefined' && influenceSignals[field] !== '')
          .map((field) => [field, Number(influenceSignals[field])]),
      ),
    },
    sourceUrls: Array.isArray(outcome.sourceUrls) ? outcome.sourceUrls.map(stringValue).filter(Boolean) : [],
    reviewerNotes: stringValue(outcome.reviewerNotes),
  };
}

function normalizeChannel(channel) {
  return {
    platform: stringValue(channel?.platform),
    label: stringValue(channel?.label),
    url: stringValue(channel?.url),
    verified: Boolean(channel?.verified),
  };
}

function validateOutcome(outcome, prefix) {
  const errors = [];

  if (!outcomeStatuses.has(outcome.outcomeStatus)) {
    errors.push(`${prefix}.outcomeStatus must be one of ${Array.from(outcomeStatuses).join(', ')}.`);
  }

  if (['pending', 'needs-more-review', 'rejected'].includes(outcome.outcomeStatus)) {
    return errors;
  }

  if (!isIsoDate(outcome.verifiedAt)) {
    errors.push(`${prefix}.verifiedAt must be an ISO date string like 2026-06-15.`);
  }

  outcome.channels.forEach((channel, channelIndex) => {
    const channelPrefix = `${prefix}.channels[${channelIndex}]`;

    if (!creatorPlatforms.has(channel.platform)) {
      errors.push(`${channelPrefix}.platform must be a supported creator platform.`);
    }

    if (channel.label.length < 2) {
      errors.push(`${channelPrefix}.label is required.`);
    }

    if (!isValidUrl(channel.url)) {
      errors.push(`${channelPrefix}.url must be a valid public URL.`);
    }

    if (!channel.verified) {
      errors.push(`${channelPrefix}.verified must be true before applying creator signals.`);
    }
  });

  outcome.sourceUrls.forEach((sourceUrl, sourceIndex) => {
    if (!isValidUrl(sourceUrl)) {
      errors.push(`${prefix}.sourceUrls[${sourceIndex}] must be a valid URL.`);
    }
  });

  countFields.forEach((field) => {
    const value = outcome.influenceSignals[field];
    if (typeof value !== 'undefined' && (!Number.isFinite(value) || value < 0)) {
      errors.push(`${prefix}.influenceSignals.${field} must be a non-negative number.`);
    }
  });

  outcome.influenceSignals.activePlatforms.forEach((platform) => {
    if (!creatorPlatforms.has(platform)) {
      errors.push(`${prefix}.influenceSignals.activePlatforms includes unsupported platform ${platform}.`);
    }
  });

  if (
    outcome.outcomeStatus === 'verified-signals' &&
    outcome.channels.length === 0 &&
    outcome.influenceSignals.activePlatforms.length === 0
  ) {
    errors.push(`${prefix} must include at least one verified channel or active platform.`);
  }

  return errors;
}

function applyChannels(candidate, outcome) {
  let added = 0;
  const nextChannelsByUrl = new Map((candidate.channels ?? []).map((channel) => [channel.url, channel]));

  outcome.channels.forEach((channel) => {
    if (!nextChannelsByUrl.has(channel.url)) {
      added += 1;
    }

    nextChannelsByUrl.set(channel.url, {
      ...nextChannelsByUrl.get(channel.url),
      ...channel,
      verified: true,
    });
  });

  candidate.channels = Array.from(nextChannelsByUrl.values());
  return { added };
}

function applySignals(candidate, outcome) {
  let updated = 0;
  const existing = candidate.influenceSignals ?? {};
  const activePlatforms = unique([
    ...(existing.activePlatforms ?? []),
    ...outcome.influenceSignals.activePlatforms,
    ...outcome.channels.map((channel) => channel.platform),
  ]).filter((platform) => creatorPlatforms.has(platform));
  const notableSignals = unique([
    ...(existing.notableSignals ?? []),
    ...outcome.influenceSignals.notableSignals,
    outcome.reviewerNotes,
  ]).slice(0, 12);
  const nextSignals = {
    ...existing,
    activePlatforms,
    notableSignals,
  };

  if (outcome.influenceSignals.hasPodcast) {
    nextSignals.hasPodcast = true;
    updated += 1;
  }

  if (outcome.influenceSignals.hasYoutubeShow) {
    nextSignals.hasYoutubeShow = true;
    updated += 1;
  }

  countFields.forEach((field) => {
    const value = outcome.influenceSignals[field];
    if (typeof value === 'number') {
      nextSignals[field] = value;
      updated += 1;
    }
  });

  if (activePlatforms.length > (existing.activePlatforms?.length ?? 0)) {
    updated += 1;
  }

  if (notableSignals.length > (existing.notableSignals?.length ?? 0)) {
    updated += 1;
  }

  candidate.influenceSignals = nextSignals;
  return { updated };
}

function appendRationale(rationale, outcome, channelsAdded, signalsUpdated) {
  const note = `Creator-signal review on ${outcome.verifiedAt} added ${channelsAdded} channels and ${signalsUpdated} signal fields.`;
  const reviewerNote = outcome.reviewerNotes ? ` Reviewer note: ${outcome.reviewerNotes}` : '';
  return `${rationale} ${note}${reviewerNote}`.trim();
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function defaultOutputPath(input) {
  const slug = input
    .split('/')
    .pop()
    ?.replace(/\.json$/i, '')
    .replace(/\.local$/i, '');

  return `data/${slug ?? 'research-batch'}-creator-signal-updates.local.json`;
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
