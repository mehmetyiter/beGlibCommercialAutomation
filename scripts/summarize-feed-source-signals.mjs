import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputDir = resolve(args['input-dir'] ?? 'exports');
const sourceBatchId = args['source-batch-id'];
const filenameIncludes = listArg(args['filename-includes']);
const filenameExcludes = listArg(args['filename-excludes']);
const outputPath = resolve(args.output ?? 'exports/feed-source-signal-summary.local.json');
const markdownPath = resolve(args['markdown-output'] ?? 'exports/feed-source-signal-summary.local.md');
const files = await findJsonFiles(inputDir);
const packages = [];
const parseFailures = [];

for (const file of files) {
  try {
    const fileName = basename(file);
    if (!matchesFilenameFilters(fileName)) {
      continue;
    }

    const payload = JSON.parse(await readFile(file, 'utf8'));
    if (payload.mode !== 'feed-source-signal-discovery') {
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

const summary = buildSummary(packages, parseFailures);

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(markdownPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(summary), 'utf8');

console.log(`Feed source summary JSON written to ${outputPath}`);
console.log(`Feed source summary markdown written to ${markdownPath}`);
console.log(`Packages: ${summary.packages}`);
console.log(`Feed source rows: ${summary.feedSourceRows}`);
console.log(`Unique candidates: ${summary.uniqueCandidates}`);
console.log(`Parsed feeds: ${summary.parsedFeeds}`);
console.log(`Podcast feeds: ${summary.podcastFeeds}`);
console.log(`Newsletter feeds: ${summary.newsletterFeeds}`);
console.log(`Blog feeds: ${summary.blogFeeds}`);
console.log(`Public email candidates: ${summary.publicEmailCandidates}`);
console.log(`Scan failures: ${summary.scanFailures}`);

async function findJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(dir, entry.name))
    .sort();
}

function buildSummary(packages, failures) {
  const uniqueCandidateIds = new Set();
  const candidatesWithParsedFeeds = new Set();
  const candidatesWithPublicEmail = new Set();
  const byFile = [];
  const totals = {
    discoveredFeedSources: 0,
    selectedFeedSources: 0,
    parsedFeeds: 0,
    skippedFeeds: 0,
    failedFeeds: 0,
    podcastFeeds: 0,
    newsletterFeeds: 0,
    blogFeeds: 0,
    activeFeeds: 0,
    staleFeeds: 0,
    feedItems: 0,
    publicEmailCandidates: 0,
    scanFailures: 0,
  };

  for (const entry of packages) {
    const payload = entry.payload;
    const items = payload.items ?? [];
    const fileSummary = {
      file: entry.file,
      reviewId: payload.reviewId,
      sourceBatchId: payload.sourceBatchId,
      createdAt: payload.createdAt,
      offset: payload.summary?.offset ?? 0,
      discoveredFeedSources: payload.summary?.discoveredFeedSources ?? 0,
      selectedFeedSources: payload.summary?.selectedFeedSources ?? items.length,
      parsedFeeds: payload.summary?.parsedFeeds ?? countItems(items, (item) => item.feedStatus === 'parsed'),
      skippedFeeds:
        payload.summary?.skippedFeeds ?? countItems(items, (item) => item.feedStatus?.startsWith('skipped')),
      failedFeeds: payload.summary?.failedFeeds ?? countItems(items, (item) => item.feedStatus === 'error'),
      podcastFeeds: payload.summary?.podcastFeeds ?? countItems(items, (item) => item.feedType === 'podcast'),
      newsletterFeeds: payload.summary?.newsletterFeeds ?? countItems(items, (item) => item.feedType === 'newsletter'),
      blogFeeds: payload.summary?.blogFeeds ?? countItems(items, (item) => item.feedType === 'blog'),
      activeFeeds: payload.summary?.activeFeeds ?? countItems(items, (item) => item.activityStatus === 'active'),
      staleFeeds: payload.summary?.staleFeeds ?? countItems(items, (item) => item.activityStatus === 'stale'),
      feedItems: payload.summary?.feedItems ?? countNested(items, 'recentItems'),
      publicEmailCandidates: payload.summary?.publicEmailCandidates ?? countNested(items, 'publicEmailCandidates'),
      scanFailures: payload.summary?.scanFailures ?? 0,
    };

    byFile.push(fileSummary);
    totals.discoveredFeedSources = Math.max(totals.discoveredFeedSources, fileSummary.discoveredFeedSources);
    totals.selectedFeedSources += fileSummary.selectedFeedSources;
    totals.parsedFeeds += fileSummary.parsedFeeds;
    totals.skippedFeeds += fileSummary.skippedFeeds;
    totals.failedFeeds += fileSummary.failedFeeds;
    totals.podcastFeeds += fileSummary.podcastFeeds;
    totals.newsletterFeeds += fileSummary.newsletterFeeds;
    totals.blogFeeds += fileSummary.blogFeeds;
    totals.activeFeeds += fileSummary.activeFeeds;
    totals.staleFeeds += fileSummary.staleFeeds;
    totals.feedItems += fileSummary.feedItems;
    totals.publicEmailCandidates += fileSummary.publicEmailCandidates;
    totals.scanFailures += fileSummary.scanFailures;

    for (const item of items) {
      uniqueCandidateIds.add(item.candidateId);

      if (item.feedStatus === 'parsed') {
        candidatesWithParsedFeeds.add(item.candidateId);
      }

      if ((item.publicEmailCandidates?.length ?? 0) > 0) {
        candidatesWithPublicEmail.add(item.candidateId);
      }
    }
  }

  byFile.sort((left, right) => {
    const offsetDelta = left.offset - right.offset;
    return offsetDelta || left.file.localeCompare(right.file);
  });

  return {
    createdAt: new Date().toISOString(),
    sourceBatchId: sourceBatchId ?? null,
    inputDir,
    filenameIncludes,
    filenameExcludes,
    packages: packages.length,
    discoveredFeedSources: totals.discoveredFeedSources,
    feedSourceRows: totals.selectedFeedSources,
    uniqueCandidates: uniqueCandidateIds.size,
    candidatesWithParsedFeeds: candidatesWithParsedFeeds.size,
    parsedFeeds: totals.parsedFeeds,
    skippedFeeds: totals.skippedFeeds,
    failedFeeds: totals.failedFeeds,
    podcastFeeds: totals.podcastFeeds,
    newsletterFeeds: totals.newsletterFeeds,
    blogFeeds: totals.blogFeeds,
    activeFeeds: totals.activeFeeds,
    staleFeeds: totals.staleFeeds,
    feedItems: totals.feedItems,
    publicEmailCandidates: totals.publicEmailCandidates,
    candidatesWithPublicEmail: candidatesWithPublicEmail.size,
    scanFailures: totals.scanFailures,
    parseFailures: failures,
    byFile,
  };
}

function countItems(items, predicate) {
  return items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

function countNested(items, key) {
  return items.reduce((count, item) => count + (item[key]?.length ?? 0), 0);
}

function renderMarkdown(summary) {
  const lines = [
    '# Feed Source Signal Discovery Summary',
    '',
    `Generated: ${summary.createdAt}`,
    `Source batch: ${summary.sourceBatchId ?? 'All'}`,
    `Filename includes: ${summary.filenameIncludes.join(', ') || 'None'}`,
    `Filename excludes: ${summary.filenameExcludes.join(', ') || 'None'}`,
    `Packages: ${summary.packages}`,
    `Discovered feed sources: ${summary.discoveredFeedSources}`,
    `Feed source rows: ${summary.feedSourceRows}`,
    `Unique candidates: ${summary.uniqueCandidates}`,
    '',
    '## Totals',
    '',
    `- Parsed feeds: ${summary.parsedFeeds}`,
    `- Skipped feeds: ${summary.skippedFeeds}`,
    `- Failed feeds: ${summary.failedFeeds}`,
    `- Podcast feeds: ${summary.podcastFeeds}`,
    `- Newsletter feeds: ${summary.newsletterFeeds}`,
    `- Blog feeds: ${summary.blogFeeds}`,
    `- Active feeds: ${summary.activeFeeds}`,
    `- Stale feeds: ${summary.staleFeeds}`,
    `- Feed items: ${summary.feedItems}`,
    `- Public email candidates: ${summary.publicEmailCandidates}`,
    `- Candidates with public email candidates: ${summary.candidatesWithPublicEmail}`,
    `- Scan failures: ${summary.scanFailures}`,
    '',
    '## Packages',
    '',
  ];

  summary.byFile.forEach((file) => {
    lines.push(
      `- Offset ${file.offset}: ${file.selectedFeedSources} sources, ${file.parsedFeeds} parsed, ${file.skippedFeeds} skipped, ${file.podcastFeeds} podcasts, ${file.newsletterFeeds} newsletters, ${file.blogFeeds} blogs, ${file.publicEmailCandidates} email candidates, ${file.scanFailures} failures`,
    );
  });

  if (summary.parseFailures.length > 0) {
    lines.push('', '## Parse Failures', '');
    summary.parseFailures.forEach((failure) => {
      lines.push(`- ${failure.file}: ${failure.message}`);
    });
  }

  return `${lines.join('\n')}\n`;
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
