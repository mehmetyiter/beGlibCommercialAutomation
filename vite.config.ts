import react from '@vitejs/plugin-react';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

interface DatasetOption {
  id: string;
  label: string;
  file: string;
  kind: 'global' | 'wave' | 'other';
  candidates: number;
  createdAt: string | null;
  mtime: string;
  sortKey: number;
}

interface DiscoveryPackageSummary {
  candidates?: number;
}

interface DiscoveryPackagePreview {
  createdAt?: string;
  summary?: DiscoveryPackageSummary;
  dossiers?: unknown[];
}

function localDashboardDataPlugin(): Plugin {
  return {
    name: 'beglib-local-dashboard-data',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/api/dashboard-data')) {
          next();
          return;
        }

        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');

        try {
          const url = new URL(request.url, 'http://localhost');
          const datasets = await discoverDatasets(server.config.root);

          if (datasets.length === 0) {
            response.statusCode = 404;
            response.end(
              JSON.stringify({
                ok: false,
                generatedAt: new Date().toISOString(),
                error: 'No local discovery dossier JSON files were found under exports/.',
                datasets: [],
              }),
            );
            return;
          }

          const requestedDataset = url.searchParams.get('dataset');
          const selectedDataset =
            datasets.find((dataset) => dataset.id === requestedDataset) ?? datasets[0];
          const packagePath = resolve(server.config.root, selectedDataset.file);
          const dossierPackage = JSON.parse(await readFile(packagePath, 'utf8')) as DiscoveryPackagePreview;

          response.end(
            JSON.stringify({
              ok: true,
              generatedAt: new Date().toISOString(),
              activeDatasetId: selectedDataset.id,
              datasets: datasets.map((dataset) => ({
                id: dataset.id,
                label: dataset.label,
                file: dataset.file,
                kind: dataset.kind,
                candidates:
                  dataset.id === selectedDataset.id
                    ? getCandidateCount(dossierPackage)
                    : dataset.candidates,
                createdAt:
                  dataset.id === selectedDataset.id
                    ? dossierPackage.createdAt ?? dataset.createdAt
                    : dataset.createdAt,
                mtime: dataset.mtime,
              })),
              package: dossierPackage,
            }),
          );
        } catch (error) {
          response.statusCode = 500;
          response.end(
            JSON.stringify({
              ok: false,
              generatedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : 'Dashboard data endpoint failed.',
              datasets: [],
            }),
          );
        }
      });
    },
  };
}

async function discoverDatasets(root: string): Promise<DatasetOption[]> {
  const exportsDir = resolve(root, 'exports');
  const files = await readdir(exportsDir);
  const dossierFiles = files.filter((file) => file.endsWith('-discovery-dossiers.local.json'));
  const datasets = await Promise.all(
    dossierFiles.map(async (file) => {
      const filePath = resolve(exportsDir, file);
      const fileStat = await stat(filePath);
      const relativeFile = `exports/${file}`;
      const kind = getDatasetKind(file);

      return {
        id: basename(file, '.local.json'),
        label: getDatasetLabel(file),
        file: relativeFile,
        kind,
        candidates: 0,
        createdAt: null,
        mtime: fileStat.mtime.toISOString(),
        sortKey: getDatasetSortKey(file, kind, fileStat.mtimeMs),
      };
    }),
  );

  return datasets.sort((left, right) => right.sortKey - left.sortKey || left.label.localeCompare(right.label));
}

function getDatasetKind(file: string): DatasetOption['kind'] {
  if (/^wikidata-all-waves-/.test(file)) {
    return 'global';
  }

  if (/^wikidata-wave-\d+-/.test(file)) {
    return 'wave';
  }

  return 'other';
}

function getDatasetLabel(file: string) {
  const globalMatch = file.match(/^wikidata-all-waves-expanded(\d+)-/);
  const waveMatch = file.match(/^wikidata-wave-(\d+)-/);

  if (globalMatch) {
    return `All waves expanded ${globalMatch[1]}`;
  }

  if (/^wikidata-all-waves-/.test(file)) {
    return 'All waves base';
  }

  if (waveMatch) {
    return `Wave ${waveMatch[1]}`;
  }

  return basename(file, '.local.json');
}

function getDatasetSortKey(file: string, kind: DatasetOption['kind'], mtimeMs: number) {
  const globalMatch = file.match(/^wikidata-all-waves-expanded(\d+)-/);
  const waveMatch = file.match(/^wikidata-wave-(\d+)-/);

  if (kind === 'global') {
    return 6_000_000_000_000_000 + Number(globalMatch?.[1] ?? 0);
  }

  if (kind === 'wave') {
    return 5_000_000_000_000_000 + Number(waveMatch?.[1] ?? 0);
  }

  return mtimeMs;
}

function getCandidateCount(preview: DiscoveryPackagePreview) {
  return preview.summary?.candidates ?? preview.dossiers?.length ?? 0;
}

export default defineConfig({
  plugins: [react(), localDashboardDataPlugin()],
});
