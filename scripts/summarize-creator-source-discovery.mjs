import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputDir = resolve(args['input-dir'] ?? 'exports');
const sourceBatchId = args['source-batch-id'];
const filenameIncludes = listArg(args['filename-includes']);
const filenameExcludes = listArg(args['filename-excludes']);
const outputPath = resolve(args.output ?? 'exports/creator-source-discovery-summary.local.json');
const markdownPath = resolve(args['markdown-output'] ?? 'exports/creator-source-discovery-summary.local.md');
const files = await findJsonFiles(inputDir);
const packages = [];
const failures = [];

for (const file of files) {
  try {
    const fileName = basename(file);
    if (!matchesFilenameFilters(fileName)) {
      continue;
    }

    const payload = JSON.parse(await readFile(file, 'utf8'));
    if (payload.mode !== 'creator-source-discovery') {
      continue;
    }

    if (sourceBatchId && payload.sourceBatchId !== sourceBatchId) {
      continue;
    }

    packages.push({ file, payload });
  } catch (error) {
    failures.push({
      file,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const summary = buildSummary(packages, failures);

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(markdownPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(summary), 'utf8');

console.log(`Creator discovery summary JSON written to ${outputPath}`);
console.log(`Creator discovery summary markdown written to ${markdownPath}`);
console.log(`Packages: ${summary.packages}`);
console.log(`Candidate rows: ${summary.candidateRows}`);
console.log(`Unique candidates: ${summary.uniqueCandidates}`);
console.log(`Priority suggestions: ${summary.prioritySuggestions}`);
console.log(`Deprioritized suggestions: ${summary.deprioritizedSuggestions}`);
console.log(`Failures: ${summary.failures}`);

async function findJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(dir, entry.name))
    .sort();
}

function buildSummary(packages, parseFailures) {
  const uniqueCandidateIds = new Set();
  const candidatesWithAnySuggestion = new Set();
  const candidatesWithPrioritySuggestion = new Set();
  const byFile = [];
  const totals = {
    youtubeSuggestions: 0,
    podcastIndexSuggestions: 0,
    rssSuggestions: 0,
    prioritySuggestions: 0,
    deprioritizedSuggestions: 0,
    skippedSources: 0,
    fallbackSources: 0,
    sourceFailures: 0,
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
      selectedCandidates: payload.summary?.selectedCandidates ?? items.length,
      youtubeSuggestions: payload.summary?.youtubeSuggestions ?? 0,
      podcastIndexSuggestions: payload.summary?.podcastIndexSuggestions ?? 0,
      rssSuggestions: payload.summary?.rssSuggestions ?? 0,
      prioritySuggestions: payload.summary?.prioritySuggestions ?? countPrioritySuggestions(items),
      deprioritizedSuggestions:
        payload.summary?.deprioritizedSuggestions ?? countDeprioritizedSuggestions(items),
      skippedSources: payload.summary?.skippedSources ?? 0,
      fallbackSources: payload.summary?.fallbackSources ?? 0,
      failures: payload.summary?.failures ?? 0,
      minConfidence: payload.summary?.minConfidence ?? '',
    };

    byFile.push(fileSummary);
    totals.youtubeSuggestions += fileSummary.youtubeSuggestions;
    totals.podcastIndexSuggestions += fileSummary.podcastIndexSuggestions;
    totals.rssSuggestions += fileSummary.rssSuggestions;
    totals.prioritySuggestions += fileSummary.prioritySuggestions;
    totals.deprioritizedSuggestions += fileSummary.deprioritizedSuggestions;
    totals.skippedSources += fileSummary.skippedSources;
    totals.fallbackSources += fileSummary.fallbackSources;
    totals.sourceFailures += fileSummary.failures;

    for (const item of items) {
      uniqueCandidateIds.add(item.candidateId);
      const priorityCount = item.suggestions?.length ?? 0;
      const deprioritizedCount = item.deprioritizedSuggestions?.length ?? 0;

      if (priorityCount > 0) {
        candidatesWithPrioritySuggestion.add(item.candidateId);
      }

      if (priorityCount + deprioritizedCount > 0) {
        candidatesWithAnySuggestion.add(item.candidateId);
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
    candidateRows: byFile.reduce((count, file) => count + file.selectedCandidates, 0),
    uniqueCandidates: uniqueCandidateIds.size,
    candidatesWithAnySuggestion: candidatesWithAnySuggestion.size,
    candidatesWithPrioritySuggestion: candidatesWithPrioritySuggestion.size,
    youtubeSuggestions: totals.youtubeSuggestions,
    podcastIndexSuggestions: totals.podcastIndexSuggestions,
    rssSuggestions: totals.rssSuggestions,
    prioritySuggestions: totals.prioritySuggestions,
    deprioritizedSuggestions: totals.deprioritizedSuggestions,
    skippedSources: totals.skippedSources,
    fallbackSources: totals.fallbackSources,
    failures: totals.sourceFailures,
    parseFailures,
    byFile,
  };
}

function countPrioritySuggestions(items) {
  return items.reduce((count, item) => count + (item.suggestions?.length ?? 0), 0);
}

function countDeprioritizedSuggestions(items) {
  return items.reduce((count, item) => count + (item.deprioritizedSuggestions?.length ?? 0), 0);
}

function renderMarkdown(summary) {
  const lines = [
    `# Creator Source Discovery Summary`,
    '',
    `Generated: ${summary.createdAt}`,
    `Source batch: ${summary.sourceBatchId ?? 'All'}`,
    `Filename includes: ${summary.filenameIncludes.join(', ') || 'None'}`,
    `Filename excludes: ${summary.filenameExcludes.join(', ') || 'None'}`,
    `Packages: ${summary.packages}`,
    `Candidate rows: ${summary.candidateRows}`,
    `Unique candidates: ${summary.uniqueCandidates}`,
    `Candidates with any suggestion: ${summary.candidatesWithAnySuggestion}`,
    `Candidates with priority suggestion: ${summary.candidatesWithPrioritySuggestion}`,
    '',
    '## Totals',
    '',
    `- YouTube suggestions: ${summary.youtubeSuggestions}`,
    `- PodcastIndex suggestions: ${summary.podcastIndexSuggestions}`,
    `- RSS suggestions: ${summary.rssSuggestions}`,
    `- Priority suggestions: ${summary.prioritySuggestions}`,
    `- Deprioritized suggestions retained: ${summary.deprioritizedSuggestions}`,
    `- Skipped source attempts: ${summary.skippedSources}`,
    `- Fallback source attempts: ${summary.fallbackSources}`,
    `- Failures: ${summary.failures}`,
    '',
    '## Packages',
    '',
  ];

  summary.byFile.forEach((file) => {
    lines.push(`- Offset ${file.offset}: ${file.selectedCandidates} candidates, ${file.prioritySuggestions} priority, ${file.deprioritizedSuggestions} deprioritized, ${file.fallbackSources} fallback, ${file.failures} failures`);
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
