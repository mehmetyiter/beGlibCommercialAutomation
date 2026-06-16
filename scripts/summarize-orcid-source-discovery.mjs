import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputDir = resolve(args['input-dir'] ?? 'exports');
const sourceBatchId = args['source-batch-id'];
const filenameIncludes = listArg(args['filename-includes']);
const filenameExcludes = listArg(args['filename-excludes']);
const outputPath = resolve(args.output ?? 'exports/orcid-source-discovery-summary.local.json');
const markdownPath = resolve(args['markdown-output'] ?? 'exports/orcid-source-discovery-summary.local.md');
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
    if (payload.mode !== 'orcid-source-discovery') {
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

console.log(`ORCID discovery summary JSON written to ${outputPath}`);
console.log(`ORCID discovery summary markdown written to ${markdownPath}`);
console.log(`Packages: ${summary.packages}`);
console.log(`Candidate rows: ${summary.candidateRows}`);
console.log(`Unique candidates: ${summary.uniqueCandidates}`);
console.log(`Candidates with ORCID: ${summary.candidatesWithOrcid}`);
console.log(`Researcher URLs: ${summary.researcherUrls}`);
console.log(`Public email candidates: ${summary.publicEmailCandidates}`);
console.log(`Affiliations: ${summary.affiliations}`);
console.log(`Failures: ${summary.failures}`);

async function findJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(dir, entry.name))
    .sort();
}

function buildSummary(packages, failures) {
  const uniqueCandidateIds = new Set();
  const candidatesWithOrcid = new Set();
  const candidatesWithDiscoveryLinks = new Set();
  const candidatesWithPublicEmail = new Set();
  const byFile = [];
  const totals = {
    fetchedRecords: 0,
    skippedNoOrcid: 0,
    researcherUrls: 0,
    publicEmailCandidates: 0,
    affiliations: 0,
    externalIdentifiers: 0,
    keywords: 0,
    failures: 0,
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
      candidatesWithOrcid: payload.summary?.candidatesWithOrcid ?? countItems(items, (item) => Boolean(item.orcidId)),
      fetchedRecords: payload.summary?.fetchedRecords ?? countItems(items, (item) => item.orcidStatus === 'fetched'),
      skippedNoOrcid:
        payload.summary?.skippedNoOrcid ?? countItems(items, (item) => item.orcidStatus === 'skipped-no-orcid'),
      researcherUrls: payload.summary?.researcherUrls ?? countNested(items, 'researcherUrls'),
      publicEmailCandidates: payload.summary?.publicEmailCandidates ?? countNested(items, 'publicEmails'),
      affiliations: payload.summary?.affiliations ?? countNested(items, 'affiliations'),
      externalIdentifiers: payload.summary?.externalIdentifiers ?? countNested(items, 'externalIdentifiers'),
      candidatesWithDiscoveryLinks:
        payload.summary?.candidatesWithDiscoveryLinks ??
        countItems(items, (item) => (item.researcherUrls?.length ?? 0) > 0 || (item.publicEmails?.length ?? 0) > 0),
      failures: payload.summary?.failures ?? 0,
    };

    byFile.push(fileSummary);
    totals.fetchedRecords += fileSummary.fetchedRecords;
    totals.skippedNoOrcid += fileSummary.skippedNoOrcid;
    totals.researcherUrls += fileSummary.researcherUrls;
    totals.publicEmailCandidates += fileSummary.publicEmailCandidates;
    totals.affiliations += fileSummary.affiliations;
    totals.externalIdentifiers += fileSummary.externalIdentifiers;
    totals.keywords += countNested(items, 'keywords');
    totals.failures += fileSummary.failures;

    for (const item of items) {
      uniqueCandidateIds.add(item.candidateId);

      if (item.orcidId) {
        candidatesWithOrcid.add(item.candidateId);
      }

      if ((item.researcherUrls?.length ?? 0) > 0 || (item.publicEmails?.length ?? 0) > 0) {
        candidatesWithDiscoveryLinks.add(item.candidateId);
      }

      if ((item.publicEmails?.length ?? 0) > 0) {
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
    candidateRows: byFile.reduce((count, file) => count + file.selectedCandidates, 0),
    uniqueCandidates: uniqueCandidateIds.size,
    candidatesWithOrcid: candidatesWithOrcid.size,
    fetchedRecords: totals.fetchedRecords,
    skippedNoOrcid: totals.skippedNoOrcid,
    researcherUrls: totals.researcherUrls,
    publicEmailCandidates: totals.publicEmailCandidates,
    candidatesWithPublicEmail: candidatesWithPublicEmail.size,
    affiliations: totals.affiliations,
    externalIdentifiers: totals.externalIdentifiers,
    keywords: totals.keywords,
    candidatesWithDiscoveryLinks: candidatesWithDiscoveryLinks.size,
    failures: totals.failures,
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
    '# ORCID Source Discovery Summary',
    '',
    `Generated: ${summary.createdAt}`,
    `Source batch: ${summary.sourceBatchId ?? 'All'}`,
    `Filename includes: ${summary.filenameIncludes.join(', ') || 'None'}`,
    `Filename excludes: ${summary.filenameExcludes.join(', ') || 'None'}`,
    `Packages: ${summary.packages}`,
    `Candidate rows: ${summary.candidateRows}`,
    `Unique candidates: ${summary.uniqueCandidates}`,
    '',
    '## Totals',
    '',
    `- Candidates with ORCID: ${summary.candidatesWithOrcid}`,
    `- Fetched records: ${summary.fetchedRecords}`,
    `- Skipped no ORCID: ${summary.skippedNoOrcid}`,
    `- Researcher URLs: ${summary.researcherUrls}`,
    `- Public email candidates: ${summary.publicEmailCandidates}`,
    `- Candidates with public email candidates: ${summary.candidatesWithPublicEmail}`,
    `- Affiliations: ${summary.affiliations}`,
    `- External identifiers: ${summary.externalIdentifiers}`,
    `- Keywords: ${summary.keywords}`,
    `- Candidates with discovery links: ${summary.candidatesWithDiscoveryLinks}`,
    `- Failures: ${summary.failures}`,
    '',
    '## Packages',
    '',
  ];

  summary.byFile.forEach((file) => {
    lines.push(
      `- Offset ${file.offset}: ${file.selectedCandidates} candidates, ${file.candidatesWithOrcid} ORCID, ${file.researcherUrls} researcher URLs, ${file.publicEmailCandidates} public email candidates, ${file.affiliations} affiliations, ${file.failures} failures`,
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
