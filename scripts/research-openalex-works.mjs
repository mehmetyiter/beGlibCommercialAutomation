import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildOpenAlexBatch, slugify } from './lib/openalex-research.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.query) {
  console.error('Usage: npm run research:openalex -- --query "AI tutoring education" --limit 10 --category academia');
  process.exitCode = 1;
} else {
  const batch = await buildOpenAlexBatch(args);
  const outputPath = resolve(args.output ?? defaultOutputPath(args.query));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(batch, null, 2)}\n`, 'utf8');

  console.log(`OpenAlex research batch written to ${outputPath}`);
  console.log(`Candidates: ${batch.candidates.length}`);
  console.log('Validate with:');
  console.log(`npm run validate:batch -- ${outputPath}`);
}

function parseArgs(argv) {
  const parsed = {
    category: 'academia',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === '--query' || value === '-q') {
      parsed.query = next;
      index += 1;
    } else if (value === '--limit' || value === '-l') {
      parsed.limit = Number(next);
      index += 1;
    } else if (value === '--category' || value === '-c') {
      parsed.category = next;
      index += 1;
    } else if (value === '--output' || value === '-o') {
      parsed.output = next;
      index += 1;
    } else if (value === '--source-label') {
      parsed.sourceLabel = next;
      index += 1;
    } else if (!parsed.query) {
      parsed.query = value;
    }
  }

  return parsed;
}

function defaultOutputPath(query) {
  return `data/openalex-${slugify(query)}-${Date.now()}.local.json`;
}
