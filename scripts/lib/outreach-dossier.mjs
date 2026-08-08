import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { applyOverlay, loadOverlayState, resolveOverlayPath } from './candidate-overlay.mjs';
import { normalizeCandidateInput } from './outreach-service.mjs';
import { normalizeEmail } from './outreach-store.mjs';

const DOSSIER_SUFFIX = '-discovery-dossiers.local.json';

export async function listDossierDatasets(root = process.cwd()) {
  const exportsDir = resolve(root, 'exports');

  let files;
  try {
    files = await readdir(exportsDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const datasets = await Promise.all(
    files
      .filter((file) => file.endsWith(DOSSIER_SUFFIX))
      .map(async (file) => {
        const fileStat = await stat(resolve(exportsDir, file));

        return {
          id: basename(file, '.local.json'),
          file: `exports/${file}`,
          mtime: fileStat.mtime.toISOString(),
        };
      }),
  );

  return datasets.sort((left, right) => right.mtime.localeCompare(left.mtime));
}

/**
 * The generated export is only half the record: hand-entered candidates and operator review
 * outcomes live in the overlay and are merged in here, so every consumer of this function
 * sees the same candidate the dashboard shows.
 */
export async function loadDossierPackage(datasetId, { root = process.cwd(), overlayPath = resolveOverlayPath() } = {}) {
  const datasets = await listDossierDatasets(root);
  const dataset = datasets.find((entry) => entry.id === datasetId);

  if (!dataset) {
    return { ok: false, errors: [`Unknown dataset "${datasetId}". Build dossiers into exports/ first.`] };
  }

  const parsed = JSON.parse(await readFile(resolve(root, dataset.file), 'utf8'));
  const overlay = await loadOverlayState(overlayPath);

  return { ok: true, dataset, package: applyOverlay(parsed, overlay, datasetId) };
}

function isEmailContact(contact) {
  const value = contact?.value ?? '';

  return String(contact?.type ?? '').includes('email') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Pulls one candidate out of a dossier package and reduces it to the send-path shape.
 * Contact candidates come back as *suggestions* only — they carry no authority until a
 * human records a verification against one of them.
 */
export function extractCandidate(dossierPackage, candidateId, datasetId) {
  const dossier = (dossierPackage?.dossiers ?? []).find((entry) => entry.candidateId === candidateId);

  if (!dossier) {
    return { ok: false, errors: [`Candidate "${candidateId}" is not in this dataset.`] };
  }

  const emailCandidates = (dossier.contactCandidates ?? [])
    .filter((contact) => isEmailContact(contact) && normalizeEmail(contact.value))
    .map((contact) => ({
      email: normalizeEmail(contact.value),
      type: contact.type ?? null,
      role: contact.role ?? null,
      label: contact.label ?? null,
      sourceUrl: contact.sourceUrl ?? null,
      identityAttribution: contact.identityAttribution ?? null,
      identityConfidence: contact.identityConfidence ?? null,
    }));

  return {
    ok: true,
    candidate: normalizeCandidateInput({
      id: dossier.candidateId,
      name: dossier.name,
      country: dossier.country,
      category: dossier.category,
      status: dossier.status,
      consentStatus: dossier.consentStatus,
      riskLevel: dossier.riskLevel,
      sensitiveFlags: dossier.sensitiveFlags,
      subcategories: dossier.subcategories,
      datasetId,
    }),
    emailCandidates,
    sourceUrls: dossier.sourceUrls ?? [],
    title: dossier.title ?? null,
    country: dossier.country ?? null,
  };
}

export async function loadCandidateFromDataset(datasetId, candidateId, options = {}) {
  const loaded = await loadDossierPackage(datasetId, options);

  if (!loaded.ok) {
    return loaded;
  }

  return extractCandidate(loaded.package, candidateId, datasetId);
}
