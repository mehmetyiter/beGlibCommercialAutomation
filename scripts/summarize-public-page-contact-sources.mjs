import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputDir = resolve(args['input-dir'] ?? 'exports');
const sourceBatchId = args['source-batch-id'];
const filenameIncludes = listArg(args['filename-includes']);
const filenameExcludes = listArg(args['filename-excludes']);
const outputPath = resolve(args.output ?? 'exports/page-contact-source-discovery-summary.local.json');
const markdownPath = resolve(args['markdown-output'] ?? 'exports/page-contact-source-discovery-summary.local.md');
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
    if (payload.mode !== 'public-page-contact-source-discovery') {
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

console.log(`Page contact summary JSON written to ${outputPath}`);
console.log(`Page contact summary markdown written to ${markdownPath}`);
console.log(`Packages: ${summary.packages}`);
console.log(`Page source rows: ${summary.pageSourceRows}`);
console.log(`Unique candidates: ${summary.uniqueCandidates}`);
console.log(`Fetched pages: ${summary.fetchedPages}`);
console.log(`Contact page candidates: ${summary.contactPageCandidates}`);
console.log(`Mailto email candidates: ${summary.mailtoEmailCandidates}`);
console.log(`Social links: ${summary.socialLinks}`);
console.log(`Feed links: ${summary.feedLinks}`);
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
  const candidatesWithMailto = new Set();
  const candidatesWithContactPages = new Set();
  const candidatesWithSocialLinks = new Set();
  const byFile = [];
  const totals = {
    discoveredPageSources: 0,
    selectedPageSources: 0,
    fetchedPages: 0,
    skippedPages: 0,
    failedPages: 0,
    contactPageCandidates: 0,
    mailtoEmailCandidates: 0,
    socialLinks: 0,
    feedLinks: 0,
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
      discoveredPageSources: payload.summary?.discoveredPageSources ?? 0,
      selectedPageSources: payload.summary?.selectedPageSources ?? items.length,
      fetchedPages: payload.summary?.fetchedPages ?? countItems(items, (item) => item.fetchStatus === 'fetched'),
      skippedPages:
        payload.summary?.skippedPages ?? countItems(items, (item) => item.fetchStatus?.startsWith('skipped')),
      failedPages: payload.summary?.failedPages ?? countItems(items, (item) => item.fetchStatus === 'error'),
      contactPageCandidates: payload.summary?.contactPageCandidates ?? countNested(items, 'contactPageCandidates'),
      mailtoEmailCandidates: payload.summary?.mailtoEmailCandidates ?? countNested(items, 'emailCandidates'),
      socialLinks: payload.summary?.socialLinks ?? countNested(items, 'socialLinks'),
      feedLinks: payload.summary?.feedLinks ?? countNested(items, 'feedLinks'),
      scanFailures: payload.summary?.scanFailures ?? 0,
    };

    byFile.push(fileSummary);
    totals.discoveredPageSources = Math.max(totals.discoveredPageSources, fileSummary.discoveredPageSources);
    totals.selectedPageSources += fileSummary.selectedPageSources;
    totals.fetchedPages += fileSummary.fetchedPages;
    totals.skippedPages += fileSummary.skippedPages;
    totals.failedPages += fileSummary.failedPages;
    totals.contactPageCandidates += fileSummary.contactPageCandidates;
    totals.mailtoEmailCandidates += fileSummary.mailtoEmailCandidates;
    totals.socialLinks += fileSummary.socialLinks;
    totals.feedLinks += fileSummary.feedLinks;
    totals.scanFailures += fileSummary.scanFailures;

    for (const item of items) {
      uniqueCandidateIds.add(item.candidateId);

      if ((item.emailCandidates?.length ?? 0) > 0) {
        candidatesWithMailto.add(item.candidateId);
      }

      if ((item.contactPageCandidates?.length ?? 0) > 0) {
        candidatesWithContactPages.add(item.candidateId);
      }

      if ((item.socialLinks?.length ?? 0) > 0) {
        candidatesWithSocialLinks.add(item.candidateId);
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
    discoveredPageSources: totals.discoveredPageSources,
    pageSourceRows: totals.selectedPageSources,
    uniqueCandidates: uniqueCandidateIds.size,
    fetchedPages: totals.fetchedPages,
    skippedPages: totals.skippedPages,
    failedPages: totals.failedPages,
    contactPageCandidates: totals.contactPageCandidates,
    mailtoEmailCandidates: totals.mailtoEmailCandidates,
    candidatesWithMailto: candidatesWithMailto.size,
    candidatesWithContactPages: candidatesWithContactPages.size,
    socialLinks: totals.socialLinks,
    candidatesWithSocialLinks: candidatesWithSocialLinks.size,
    feedLinks: totals.feedLinks,
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
    '# Public Page Contact Source Discovery Summary',
    '',
    `Generated: ${summary.createdAt}`,
    `Source batch: ${summary.sourceBatchId ?? 'All'}`,
    `Filename includes: ${summary.filenameIncludes.join(', ') || 'None'}`,
    `Filename excludes: ${summary.filenameExcludes.join(', ') || 'None'}`,
    `Packages: ${summary.packages}`,
    `Discovered page sources: ${summary.discoveredPageSources}`,
    `Page source rows: ${summary.pageSourceRows}`,
    `Unique candidates: ${summary.uniqueCandidates}`,
    '',
    '## Totals',
    '',
    `- Fetched pages: ${summary.fetchedPages}`,
    `- Skipped pages: ${summary.skippedPages}`,
    `- Failed pages: ${summary.failedPages}`,
    `- Contact page candidates: ${summary.contactPageCandidates}`,
    `- Mailto email candidates: ${summary.mailtoEmailCandidates}`,
    `- Candidates with mailto candidates: ${summary.candidatesWithMailto}`,
    `- Candidates with contact pages: ${summary.candidatesWithContactPages}`,
    `- Social links: ${summary.socialLinks}`,
    `- Candidates with social links: ${summary.candidatesWithSocialLinks}`,
    `- Feed links: ${summary.feedLinks}`,
    `- Scan failures: ${summary.scanFailures}`,
    '',
    '## Packages',
    '',
  ];

  summary.byFile.forEach((file) => {
    lines.push(
      `- Offset ${file.offset}: ${file.selectedPageSources} sources, ${file.fetchedPages} fetched, ${file.skippedPages} skipped, ${file.contactPageCandidates} contact pages, ${file.mailtoEmailCandidates} mailto candidates, ${file.socialLinks} social links, ${file.feedLinks} feeds, ${file.scanFailures} failures`,
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
