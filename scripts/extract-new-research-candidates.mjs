import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const batchPath = resolve(args.batch ?? args._[0] ?? '');
const againstPath = resolve(args.against ?? args._[1] ?? '');
const outputPath = resolve(args.output ?? 'data/new-research-candidates.local.json');

if (!args.batch && !args._[0]) {
  throw new Error('--batch is required.');
}
if (!args.against && !args._[1]) {
  throw new Error('--against is required.');
}

const [batch, against] = await Promise.all([readBatch(batchPath), readBatch(againstPath)]);
const existingIds = new Set(against.candidates.map((candidate) => candidate.id));
const seenInputIds = new Set();
const candidates = [];
let duplicateInputIds = 0;
let existingCandidatesExcluded = 0;

for (const candidate of batch.candidates) {
  if (!candidate.id) {
    throw new Error(`Candidate without an id found in ${batchPath}.`);
  }
  if (seenInputIds.has(candidate.id)) {
    duplicateInputIds += 1;
    continue;
  }
  seenInputIds.add(candidate.id);

  if (existingIds.has(candidate.id)) {
    existingCandidatesExcluded += 1;
    continue;
  }
  candidates.push(candidate);
}

const output = {
  batchId: args['batch-id'] ?? batch.batchId ?? 'new-research-candidates',
  createdAt: new Date().toISOString(),
  sourceLabel: args['source-label'] ?? `${batch.sourceLabel ?? 'Research batch'}: new candidates`,
  researcher: batch.researcher ?? 'beGlib research wave runner',
  notes:
    args.notes ??
    'Candidates absent from the comparison batch by exact candidate id. Discovery records remain subject to identity and contact attribution review.',
  candidates,
  diagnostics: {
    source: 'extract-new-research-candidates',
    inputFile: batchPath,
    againstFile: againstPath,
    inputCandidates: batch.candidates.length,
    againstCandidates: against.candidates.length,
    newCandidates: candidates.length,
    existingCandidatesExcluded,
    duplicateInputIds,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`New-candidate research batch written to ${outputPath}`);
console.log(`Input candidates: ${output.diagnostics.inputCandidates}`);
console.log(`Comparison candidates: ${output.diagnostics.againstCandidates}`);
console.log(`New candidates: ${output.diagnostics.newCandidates}`);
console.log(`Existing candidates excluded: ${output.diagnostics.existingCandidatesExcluded}`);
console.log(`Duplicate input ids excluded: ${output.diagnostics.duplicateInputIds}`);

async function readBatch(path) {
  const payload = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(payload.candidates)) {
    throw new Error(`${path} is not a research batch with a candidates array.`);
  }
  return payload;
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
