import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const filePath = resolve(process.argv[2] ?? 'examples/research-batch.synthetic.json');
const raw = JSON.parse(await readFile(filePath, 'utf8'));
const result = validateResearchBatch(raw);

if (!result.ok) {
  console.error(`Batch validation failed for ${filePath}`);
  result.errors.forEach((error) => console.error(`- ${error}`));
  if (result.warnings.length > 0) {
    console.error('Warnings:');
    result.warnings.forEach((warning) => console.error(`- ${warning}`));
  }
  process.exitCode = 1;
} else {
  console.log(`Batch validation passed for ${filePath}`);
  console.log(`Candidates: ${raw.candidates.length}`);
  if (result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
}

function validateResearchBatch(batch) {
  const errors = [];
  const warnings = [];

  if (!isRecord(batch)) {
    return { ok: false, errors: ['Batch must be a JSON object.'], warnings };
  }

  const candidates = Array.isArray(batch.candidates) ? batch.candidates : [];

  if (typeof batch.batchId !== 'string' || batch.batchId.trim().length < 3) {
    errors.push('batchId is required.');
  }

  if (typeof batch.createdAt !== 'string' || Number.isNaN(Date.parse(batch.createdAt))) {
    errors.push('createdAt must be an ISO date string.');
  }

  if (typeof batch.sourceLabel !== 'string' || batch.sourceLabel.trim().length < 2) {
    errors.push('sourceLabel is required.');
  }

  if (candidates.length === 0) {
    errors.push('At least one candidate is required.');
  }

  candidates.forEach((candidate, index) => {
    validateCandidate(candidate, index, errors, warnings);
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function validateCandidate(candidate, index, errors, warnings) {
  const prefix = `candidates[${index}]`;

  if (!isRecord(candidate)) {
    errors.push(`${prefix} must be an object.`);
    return;
  }

  [
    'id',
    'name',
    'title',
    'country',
    'primaryCategory',
    'status',
    'consentStatus',
    'riskLevel',
    'lastVerifiedAt',
    'rationale',
  ].forEach((field) => {
    if (typeof candidate[field] !== 'string' || candidate[field].trim().length === 0) {
      errors.push(`${prefix}.${field} is required.`);
    }
  });

  if (!Array.isArray(candidate.languages) || candidate.languages.length === 0) {
    errors.push(`${prefix}.languages must contain at least one language.`);
  }

  if (!Array.isArray(candidate.subcategories) || candidate.subcategories.length === 0) {
    errors.push(`${prefix}.subcategories must contain at least one subcategory.`);
  }

  if (!Number.isFinite(candidate.fitScore) || candidate.fitScore < 0 || candidate.fitScore > 100) {
    errors.push(`${prefix}.fitScore must be a number between 0 and 100.`);
  }

  if (!Number.isFinite(candidate.reachScore) || candidate.reachScore < 0 || candidate.reachScore > 100) {
    errors.push(`${prefix}.reachScore must be a number between 0 and 100.`);
  }

  if (!Array.isArray(candidate.channels)) {
    errors.push(`${prefix}.channels must be an array.`);
  }

  if (!Array.isArray(candidate.contactRoutes) || candidate.contactRoutes.length === 0) {
    errors.push(`${prefix}.contactRoutes must contain at least one route.`);
  }

  if (!Array.isArray(candidate.sourceUrls) || candidate.sourceUrls.length === 0) {
    errors.push(`${prefix}.sourceUrls must contain at least one source URL.`);
  }

  const routes = Array.isArray(candidate.contactRoutes) ? candidate.contactRoutes : [];
  routes.forEach((route, routeIndex) => {
    if (!isRecord(route)) {
      errors.push(`${prefix}.contactRoutes[${routeIndex}] must be an object.`);
      return;
    }

    if (route.type === 'none') {
      warnings.push(`${prefix} has no usable contact route and will be blocked by compliance.`);
    }

    if (
      route.type === 'public-business-email' &&
      typeof route.value === 'string' &&
      (route.value.includes('{') || route.value.includes('first.last'))
    ) {
      errors.push(`${prefix}.contactRoutes[${routeIndex}] looks like a guessed email pattern.`);
    }
  });

  validateInfluenceSignals(candidate.influenceSignals, prefix, errors);
}

function validateInfluenceSignals(signals, prefix, errors) {
  if (typeof signals === 'undefined') {
    return;
  }

  if (!isRecord(signals)) {
    errors.push(`${prefix}.influenceSignals must be an object when provided.`);
    return;
  }

  [
    'xFollowers',
    'instagramFollowers',
    'linkedinFollowers',
    'tiktokFollowers',
    'youtubeSubscribers',
    'newsletterSubscribers',
  ].forEach((field) => {
    if (typeof signals[field] !== 'undefined' && (typeof signals[field] !== 'number' || signals[field] < 0)) {
      errors.push(`${prefix}.influenceSignals.${field} must be a non-negative number.`);
    }
  });

  if (
    typeof signals.activePlatforms !== 'undefined' &&
    (!Array.isArray(signals.activePlatforms) ||
      signals.activePlatforms.some((platform) => typeof platform !== 'string'))
  ) {
    errors.push(`${prefix}.influenceSignals.activePlatforms must be an array of platform names.`);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
