import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { buildOpenAlexBatch, mergeBatches, slugify } from './lib/openalex-research.mjs';

const args = parseArgs(process.argv.slice(2));
const configPath = resolve(args.config ?? 'config/research-waves/openalex-wave-001.json');
const outputDir = resolve(args.outputDir ?? `data/${new Date().toISOString().slice(0, 10)}-${slugify(basename(configPath))}.local`);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const limitPerQuery = Number(args.limitPerQuery ?? config.limitPerQuery ?? 10);
const categoryFilter = args.categories
  ? new Set(args.categories.split(',').map((item) => item.trim()).filter(Boolean))
  : null;
const selectedCategories = (config.categories ?? []).filter((entry) => !categoryFilter || categoryFilter.has(entry.category));

if (selectedCategories.length === 0) {
  console.error('No categories selected for research wave.');
  process.exitCode = 1;
} else {
  await mkdir(outputDir, { recursive: true });
  const categoryBatches = [];
  const failures = [];

  for (const entry of selectedCategories) {
    console.log(`\n[${entry.category}] ${entry.queries.length} queries`);
    const queryBatches = [];

    for (const query of entry.queries) {
      try {
        const batch = await buildOpenAlexBatch({
          category: entry.category,
          limit: limitPerQuery,
          query,
          sourceLabel: `${config.waveId}: ${query}`,
        });
        queryBatches.push(batch);
        console.log(`  ✓ ${query}: ${batch.candidates.length} candidates`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ category: entry.category, query, message });
        console.log(`  ! ${query}: ${message}`);
      }
    }

    if (queryBatches.length > 0) {
      const categoryBatch = mergeBatches({
        batchId: `${config.waveId}-${entry.category}`,
        sourceLabel: `${config.description} / ${entry.category}`,
        notes:
          'Merged category batch from public OpenAlex metadata. Discovery-only; no usable contact routes are produced by this wave.',
        batches: queryBatches,
      });
      const categoryPath = resolve(outputDir, `${entry.category}.local.json`);
      await writeFile(categoryPath, `${JSON.stringify(categoryBatch, null, 2)}\n`, 'utf8');
      categoryBatches.push(categoryBatch);
      console.log(`  → wrote ${categoryBatch.candidates.length} unique candidates to ${categoryPath}`);
    }
  }

  if (categoryBatches.length > 0) {
    const waveBatch = mergeBatches({
      batchId: config.waveId,
      sourceLabel: config.description,
      notes:
        'Merged broad research wave from public OpenAlex metadata. Discovery-only; no usable contact routes are produced by this wave.',
      batches: categoryBatches,
    });
    const wavePath = resolve(outputDir, '_merged-wave.local.json');
    const manifestPath = resolve(outputDir, '_manifest.local.json');
    await writeFile(wavePath, `${JSON.stringify(waveBatch, null, 2)}\n`, 'utf8');
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          waveId: config.waveId,
          source: config.source,
          outputDir,
          categories: categoryBatches.map((batch) => ({
            batchId: batch.batchId,
            candidates: batch.candidates.length,
          })),
          mergedCandidates: waveBatch.candidates.length,
          failures,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    console.log(`\nWave complete: ${waveBatch.candidates.length} unique candidates`);
    console.log(`Merged batch: ${wavePath}`);
    console.log(`Manifest: ${manifestPath}`);
  }

  if (failures.length > 0) {
    console.log(`\nFailures: ${failures.length}`);
    failures.forEach((failure) => console.log(`- ${failure.category}/${failure.query}: ${failure.message}`));
  }
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === '--config') {
      parsed.config = next;
      index += 1;
    } else if (value === '--output-dir') {
      parsed.outputDir = next;
      index += 1;
    } else if (value === '--limit-per-query') {
      parsed.limitPerQuery = Number(next);
      index += 1;
    } else if (value === '--categories') {
      parsed.categories = next;
      index += 1;
    }
  }

  return parsed;
}
