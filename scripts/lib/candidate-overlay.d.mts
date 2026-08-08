/**
 * Types for the JavaScript overlay module. Only the read path used by vite.config.ts is
 * declared here; the write path lives behind the outreach server, which is plain Node.
 */
export interface OverlayReview {
  outcomeStatus: string;
  note: string;
  consentStatus: string | null;
  riskLevel: string | null;
  star: number | null;
  reviewedBy: string;
  reviewedAt: string;
}

export interface OverlayManualCandidate {
  name: string;
  title: string;
  category: string;
  country: string;
  sourceUrl: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface OverlayVerifiedChannel {
  url: string;
  platform: string;
  label: string;
  evidenceNote: string;
  verifiedBy: string;
  verifiedAt: string;
}

export interface OverlayRecord {
  id: string;
  candidateId: string;
  datasetId: string;
  manualCandidate: OverlayManualCandidate | null;
  review: OverlayReview | null;
  verifiedChannels?: OverlayVerifiedChannel[];
  createdAt: string;
  updatedAt: string;
}

export interface OverlayState {
  version: number;
  records: OverlayRecord[];
  updatedAt: string | null;
}

export declare const DEFAULT_CANDIDATE_OVERLAY_PATH: string;

export declare function resolveOverlayPath(env?: Record<string, string | undefined>): string;

export declare function loadOverlayState(path?: string): Promise<OverlayState>;

export declare function listOverlayRecords(state: OverlayState, datasetId?: string): OverlayRecord[];

export declare function applyOverlay<TPackage>(
  dossierPackage: TPackage,
  state: OverlayState,
  datasetId: string,
): TPackage;
