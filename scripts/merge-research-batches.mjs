import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { mergeBatches } from './lib/openalex-research.mjs';

const args = parseArgs(process.argv.slice(2));
const inputPaths = listArg(args.input ?? args.inputs).map((file) => resolve(file));
const positionalPaths = args._.map((file) => resolve(file));
const batchPaths = unique([...inputPaths, ...positionalPaths]);
const outputPath = resolve(args.output ?? 'data/merged-research-batch.local.json');

if (batchPaths.length === 0) {
  throw new Error('At least one research batch path is required.');
}

const batches = await Promise.all(batchPaths.map((path) => readBatch(path)));
const firstBatch = batches[0];
const mergedBatch = mergeBatches({
  batchId: args['batch-id'] ?? firstBatch.batchId ?? `merged-research-batch-${new Date().toISOString().slice(0, 10)}`,
  sourceLabel: args['source-label'] ?? firstBatch.sourceLabel ?? 'Merged research batches',
  notes:
    args.notes ??
    'Merged local research batches. Contact routes remain blocked until human verification from official or representative sources.',
  batches,
});

const candidateRows = batches.reduce((count, batch) => count + (batch.candidates?.length ?? 0), 0);
mergedBatch.diagnostics = {
  source: 'merge-research-batches',
  inputFiles: batchPaths,
  inputBatches: batches.length,
  candidateRows,
  mergedCandidates: mergedBatch.candidates.length,
  duplicateRowsMerged: candidateRows - mergedBatch.candidates.length,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(mergedBatch, null, 2)}\n`, 'utf8');

console.log(`Merged research batch written to ${outputPath}`);
console.log(`Input batches: ${batches.length}`);
console.log(`Candidate rows: ${candidateRows}`);
console.log(`Merged candidates: ${mergedBatch.candidates.length}`);
console.log(`Duplicate rows merged: ${mergedBatch.diagnostics.duplicateRowsMerged}`);

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

function listArg(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
