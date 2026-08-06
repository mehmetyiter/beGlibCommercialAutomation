import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const batchPath = resolve(args.batch ?? 'data/wikidata-all-waves-public-figures-combined.local.json');
const dossierPath = resolve(args.dossier ?? 'exports/wikidata-all-waves-expanded351-discovery-dossiers.local.json');
const inputDir = resolve(args['input-dir'] ?? 'exports');
const outputPath = resolve(args.output ?? 'data/youtube-search-candidates.local.json');
const limit = boundedNumber(args.limit, 20, 1, 100);
const minStars = boundedNumber(args['min-stars'], 1, 0, 5);

const [batch, dossierPackage, attemptedCandidateIds] = await Promise.all([
  readJson(batchPath),
  readJson(dossierPath),
  collectAttemptedCandidateIds(inputDir),
]);

if (!Array.isArray(batch.candidates)) {
  throw new Error(`${batchPath} is not a research batch with a candidates array.`);
}
if (!Array.isArray(dossierPackage.dossiers)) {
  throw new Error(`${dossierPath} is not a discovery dossier package.`);
}

const candidatesById = new Map(batch.candidates.map((candidate) => [candidate.id, candidate]));
const eligibleDossiers = dossierPackage.dossiers
  .filter((dossier) => candidatesById.has(dossier.candidateId))
  .filter((dossier) => !attemptedCandidateIds.has(dossier.candidateId))
  .filter((dossier) => !hasYoutubeChannel(dossier))
  .filter((dossier) => Number(dossier.discoveryStar?.stars ?? 0) >= minStars)
  .sort(compareDossiers);
const selectedDossiers = eligibleDossiers.slice(0, limit);
const selectedCandidates = selectedDossiers.map((dossier) => candidatesById.get(dossier.candidateId));

const output = {
  batchId: args['batch-id'] ?? `${batch.batchId ?? 'research'}-youtube-search-candidates`,
  createdAt: new Date().toISOString(),
  sourceLabel: args['source-label'] ?? `${batch.sourceLabel ?? 'Research batch'}: unresolved YouTube search candidates`,
  researcher: 'beGlib YouTube search candidate selector',
  notes:
    'Candidates have no accepted YouTube channel and no prior search-only attempt. Search results remain discovery-only and require strict identity review.',
  candidates: selectedCandidates,
  diagnostics: {
    source: 'youtube-search-candidate-selector',
    batchFile: batchPath,
    dossierFile: dossierPath,
    discoveryInputDir: inputDir,
    inputCandidates: batch.candidates.length,
    dossierCandidates: dossierPackage.dossiers.length,
    priorSearchAttemptCandidates: attemptedCandidateIds.size,
    eligibleCandidates: eligibleDossiers.length,
    selectedCandidates: selectedCandidates.length,
    limit,
    minStars,
    ranking: ['discovery-stars-desc', 'reach-score-desc', 'fit-score-desc', 'discovery-channel-count-desc'],
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`YouTube search candidate batch written to ${outputPath}`);
console.log(`Prior search attempts excluded: ${attemptedCandidateIds.size}`);
console.log(`Eligible unresolved candidates: ${eligibleDossiers.length}`);
console.log(`Selected candidates: ${selectedCandidates.length}`);
selectedDossiers.forEach((dossier, index) => {
  console.log(
    `${index + 1}. ${dossier.name} (${dossier.discoveryStar?.stars ?? 0} stars, reach ${dossier.reachScore ?? 0}, fit ${dossier.fitScore ?? 0})`,
  );
});

async function collectAttemptedCandidateIds(directory) {
  const attempted = new Set();
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    try {
      const payload = await readJson(resolve(directory, entry.name));
      if (payload.mode !== 'creator-source-discovery' || payload.summary?.youtubeMode !== 'search-only') {
        continue;
      }

      for (const item of payload.items ?? []) {
        if (item.candidateId) {
          attempted.add(item.candidateId);
        }
      }
    } catch {
      // Other local JSON artifacts are outside this selector's discovery contract.
    }
  }

  return attempted;
}

function hasYoutubeChannel(dossier) {
  return (dossier.discoveryChannels ?? []).some((channel) => channel.platform === 'youtube');
}

function compareDossiers(left, right) {
  return (
    Number(right.discoveryStar?.stars ?? 0) - Number(left.discoveryStar?.stars ?? 0) ||
    Number(right.reachScore ?? 0) - Number(left.reachScore ?? 0) ||
    Number(right.fitScore ?? 0) - Number(left.fitScore ?? 0) ||
    Number(right.counts?.discoveryChannels ?? 0) - Number(left.counts?.discoveryChannels ?? 0) ||
    String(left.name ?? '').localeCompare(String(right.name ?? ''))
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (!value.startsWith('--')) {
      continue;
    }
    const key = value.slice(2);
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
