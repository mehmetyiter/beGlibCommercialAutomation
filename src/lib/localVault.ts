import type {
  AuditEvent,
  Candidate,
  CandidateDiscoveryDossierPackage,
  ResearchBatch,
  VaultState,
} from '../types';

const vaultKey = 'beglib.host-intelligence.vault.v1';
const maxAuditEvents = 80;

export interface BatchValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  batch?: ResearchBatch;
}

export interface DiscoveryDossierValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  package?: CandidateDiscoveryDossierPackage;
}

export interface ImportResult {
  state: VaultState;
  imported: number;
  replaced: number;
  warnings: string[];
}

export interface DiscoveryDossierImportResult {
  state: VaultState;
  dossiers: number;
  warnings: string[];
}

export function createAuditEvent(
  type: AuditEvent['type'],
  summary: string,
  metadata: AuditEvent['metadata'] = {},
): AuditEvent {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    createdAt: new Date().toISOString(),
    actor: type === 'candidate_selected' ? 'human' : 'system',
    summary,
    metadata,
  };
}

export function createVaultState(candidates: Candidate[]): VaultState {
  return {
    candidates,
    auditEvents: [
      createAuditEvent('vault_initialized', 'Local candidate vault initialized from demo seed.', {
        candidates: candidates.length,
      }),
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function loadVaultState(seedCandidates: Candidate[]): VaultState {
  if (!canUseLocalStorage()) {
    return createVaultState(seedCandidates);
  }

  const rawState = window.localStorage.getItem(vaultKey);
  if (!rawState) {
    const seeded = createVaultState(seedCandidates);
    saveVaultState(seeded);
    return seeded;
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<VaultState>;

    if (!Array.isArray(parsedState.candidates) || parsedState.candidates.length === 0) {
      return createVaultState(seedCandidates);
    }

    return {
      candidates: mergeSeedDefaults(parsedState.candidates as Candidate[], seedCandidates),
      discoveryDossierPackage: isDiscoveryDossierPackage(parsedState.discoveryDossierPackage)
        ? parsedState.discoveryDossierPackage
        : undefined,
      auditEvents: Array.isArray(parsedState.auditEvents)
        ? (parsedState.auditEvents as AuditEvent[])
        : [],
      updatedAt: typeof parsedState.updatedAt === 'string' ? parsedState.updatedAt : new Date().toISOString(),
    };
  } catch {
    const seeded = createVaultState(seedCandidates);
    saveVaultState(seeded);
    return seeded;
  }
}

export function saveVaultState(state: VaultState) {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(vaultKey, JSON.stringify(state));
}

export function resetVaultState(seedCandidates: Candidate[]): VaultState {
  const state = {
    ...createVaultState(seedCandidates),
    auditEvents: [
      createAuditEvent('vault_reset', 'Local vault reset to synthetic demo candidates.', {
        candidates: seedCandidates.length,
      }),
    ],
  };

  saveVaultState(state);
  return state;
}

export function validateResearchBatch(raw: unknown): BatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: ['Batch must be a JSON object.'],
      warnings,
    };
  }

  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];

  if (typeof raw.batchId !== 'string' || raw.batchId.trim().length < 3) {
    errors.push('batchId is required.');
  }

  if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) {
    errors.push('createdAt must be an ISO date string.');
  }

  if (typeof raw.sourceLabel !== 'string' || raw.sourceLabel.trim().length < 2) {
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
    batch: errors.length === 0 ? (raw as unknown as ResearchBatch) : undefined,
  };
}

export function importResearchBatch(state: VaultState, batch: ResearchBatch): ImportResult {
  const existingById = new Map(state.candidates.map((candidate) => [candidate.id, candidate]));
  let imported = 0;
  let replaced = 0;

  batch.candidates.forEach((candidate) => {
    if (existingById.has(candidate.id)) {
      replaced += 1;
    } else {
      imported += 1;
    }

    existingById.set(candidate.id, candidate);
  });

  const nextState: VaultState = {
    candidates: Array.from(existingById.values()),
    auditEvents: compactAudit([
      createAuditEvent('batch_imported', `Imported research batch ${batch.batchId}.`, {
        imported,
        replaced,
        sourceLabel: batch.sourceLabel,
      }),
      ...state.auditEvents,
    ]),
    updatedAt: new Date().toISOString(),
  };

  saveVaultState(nextState);

  return {
    state: nextState,
    imported,
    replaced,
    warnings: [],
  };
}

export function validateDiscoveryDossierPackage(raw: unknown): DiscoveryDossierValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: ['Discovery dossier package must be a JSON object.'],
      warnings,
    };
  }

  if (raw.mode !== 'candidate-discovery-dossiers') {
    errors.push('mode must be candidate-discovery-dossiers.');
  }

  if (typeof raw.reviewId !== 'string' || raw.reviewId.trim().length < 3) {
    errors.push('reviewId is required.');
  }

  if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) {
    errors.push('createdAt must be an ISO date string.');
  }

  if (!isRecord(raw.summary)) {
    errors.push('summary is required.');
  }

  const dossiers = Array.isArray(raw.dossiers) ? raw.dossiers : [];
  if (dossiers.length === 0) {
    errors.push('dossiers must contain at least one candidate dossier.');
  }

  dossiers.forEach((dossier, index) => {
    const prefix = `dossiers[${index}]`;
    if (!isRecord(dossier)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    ['candidateId', 'name', 'title', 'category'].forEach((field) => {
      if (typeof dossier[field] !== 'string' || dossier[field].trim().length === 0) {
        errors.push(`${prefix}.${field} is required.`);
      }
    });

    if (!isRecord(dossier.discoveryStar)) {
      errors.push(`${prefix}.discoveryStar is required.`);
    }

    if (!isRecord(dossier.counts)) {
      errors.push(`${prefix}.counts is required.`);
    }

    if (!Array.isArray(dossier.discoveryChannels)) {
      errors.push(`${prefix}.discoveryChannels must be an array.`);
    }

    if (!Array.isArray(dossier.contactCandidates)) {
      errors.push(`${prefix}.contactCandidates must be an array.`);
    }
  });

  if (isRecord(raw.summary) && typeof raw.summary.candidates === 'number' && raw.summary.candidates !== dossiers.length) {
    warnings.push('summary.candidates does not match dossier count.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    package: errors.length === 0 ? (raw as unknown as CandidateDiscoveryDossierPackage) : undefined,
  };
}

export function importDiscoveryDossierPackage(
  state: VaultState,
  dossierPackage: CandidateDiscoveryDossierPackage,
): DiscoveryDossierImportResult {
  const nextState: VaultState = {
    ...state,
    discoveryDossierPackage: dossierPackage,
    auditEvents: compactAudit([
      createAuditEvent('discovery_dossier_imported', `Imported discovery dossiers ${dossierPackage.reviewId}.`, {
        dossiers: dossierPackage.dossiers.length,
        contactCandidates: dossierPackage.summary.contactCandidates,
        publicEmailCandidates: dossierPackage.summary.publicEmailCandidates,
      }),
      ...state.auditEvents,
    ]),
    updatedAt: new Date().toISOString(),
  };

  saveVaultState(nextState);

  return {
    state: nextState,
    dossiers: dossierPackage.dossiers.length,
    warnings: [],
  };
}

export function appendAuditEvent(state: VaultState, event: AuditEvent): VaultState {
  const nextState = {
    ...state,
    auditEvents: compactAudit([event, ...state.auditEvents]),
    updatedAt: new Date().toISOString(),
  };

  saveVaultState(nextState);
  return nextState;
}

function validateCandidate(
  rawCandidate: unknown,
  index: number,
  errors: string[],
  warnings: string[],
) {
  const prefix = `candidates[${index}]`;

  if (!isRecord(rawCandidate)) {
    errors.push(`${prefix} must be an object.`);
    return;
  }

  const requiredStrings = ['id', 'name', 'title', 'country', 'primaryCategory', 'status', 'consentStatus', 'riskLevel', 'lastVerifiedAt', 'rationale'];

  requiredStrings.forEach((field) => {
    if (typeof rawCandidate[field] !== 'string' || rawCandidate[field].trim().length === 0) {
      errors.push(`${prefix}.${field} is required.`);
    }
  });

  if (!Array.isArray(rawCandidate.languages) || rawCandidate.languages.length === 0) {
    errors.push(`${prefix}.languages must contain at least one language.`);
  }

  if (!Array.isArray(rawCandidate.subcategories) || rawCandidate.subcategories.length === 0) {
    errors.push(`${prefix}.subcategories must contain at least one subcategory.`);
  }

  const fitScore = rawCandidate.fitScore;
  const reachScore = rawCandidate.reachScore;

  if (typeof fitScore !== 'number' || !Number.isFinite(fitScore) || fitScore < 0 || fitScore > 100) {
    errors.push(`${prefix}.fitScore must be a number between 0 and 100.`);
  }

  if (typeof reachScore !== 'number' || !Number.isFinite(reachScore) || reachScore < 0 || reachScore > 100) {
    errors.push(`${prefix}.reachScore must be a number between 0 and 100.`);
  }

  if (!Array.isArray(rawCandidate.channels)) {
    errors.push(`${prefix}.channels must be an array.`);
  }

  if (!Array.isArray(rawCandidate.contactRoutes) || rawCandidate.contactRoutes.length === 0) {
    errors.push(`${prefix}.contactRoutes must contain at least one route.`);
  }

  if (!Array.isArray(rawCandidate.sourceUrls) || rawCandidate.sourceUrls.length === 0) {
    errors.push(`${prefix}.sourceUrls must contain at least one source URL.`);
  }

  const contactRoutes = Array.isArray(rawCandidate.contactRoutes) ? rawCandidate.contactRoutes : [];
  contactRoutes.forEach((route, routeIndex) => {
    if (!isRecord(route)) {
      errors.push(`${prefix}.contactRoutes[${routeIndex}] must be an object.`);
      return;
    }

    if (route.type === 'public-business-email' && typeof route.value === 'string') {
      const looksGuessed = route.value.includes('{') || route.value.includes('first.last');
      if (looksGuessed) {
        errors.push(`${prefix}.contactRoutes[${routeIndex}] looks like a guessed email pattern.`);
      }
    }

    if (route.type === 'none') {
      warnings.push(`${prefix} has no usable contact route and will be blocked by compliance.`);
    }
  });

  validateInfluenceSignals(rawCandidate.influenceSignals, prefix, errors);
}

function validateInfluenceSignals(
  rawSignals: unknown,
  prefix: string,
  errors: string[],
) {
  if (typeof rawSignals === 'undefined') {
    return;
  }

  if (!isRecord(rawSignals)) {
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
    const value = rawSignals[field];
    if (typeof value !== 'undefined' && (typeof value !== 'number' || value < 0)) {
      errors.push(`${prefix}.influenceSignals.${field} must be a non-negative number.`);
    }
  });

  if (
    typeof rawSignals.activePlatforms !== 'undefined' &&
    (!Array.isArray(rawSignals.activePlatforms) ||
      rawSignals.activePlatforms.some((platform) => typeof platform !== 'string'))
  ) {
    errors.push(`${prefix}.influenceSignals.activePlatforms must be an array of platform names.`);
  }
}

function compactAudit(events: AuditEvent[]) {
  return events.slice(0, maxAuditEvents);
}

function mergeSeedDefaults(storedCandidates: Candidate[], seedCandidates: Candidate[]) {
  const seedById = new Map(seedCandidates.map((candidate) => [candidate.id, candidate]));
  const storedIds = new Set(storedCandidates.map((candidate) => candidate.id));
  const missingSeedCandidates = seedCandidates.filter((candidate) => !storedIds.has(candidate.id));

  return storedCandidates.map((candidate) => {
    const seedCandidate = seedById.get(candidate.id);

    if (!seedCandidate) {
      return candidate;
    }

    return {
      ...seedCandidate,
      ...candidate,
      influenceSignals: candidate.influenceSignals ?? seedCandidate.influenceSignals,
    };
  }).concat(missingSeedCandidates);
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDiscoveryDossierPackage(value: unknown): value is CandidateDiscoveryDossierPackage {
  return isRecord(value) && value.mode === 'candidate-discovery-dossiers' && Array.isArray(value.dossiers);
}
