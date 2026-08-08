import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Database,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Globe2,
  ListChecks,
  Mail,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Star,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import './DashboardApp.css';
import {
  OutreachApiError,
  createManualCandidate,
  recordBulkReviewOutcome,
  recordReviewOutcome,
  revokeChannelVerification,
  verifyChannel,
} from './outreach/api';
import OperationsPanel from './outreach/OperationsPanel';
import OutreachPanel from './outreach/OutreachPanel';
import type { ReviewOutcomeStatus } from './outreach/types';

type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error';
type WorkspaceView = 'candidates' | 'operations';
type DetailTab = 'dossier' | 'outreach';
type ContactFilter = 'all' | 'with-contact' | 'email' | 'contact-page' | 'no-contact';
type StarFilter = 'all' | '5' | '4+' | '3+' | '0-2';
type RiskFilter = 'all' | 'low' | 'medium' | 'high' | 'sensitive';
type SortMode = 'priority' | 'emails' | 'contacts' | 'platforms' | 'reach' | 'fit' | 'name';

interface DatasetOption {
  id: string;
  label: string;
  file: string;
  kind: 'global' | 'wave' | 'other';
  candidates: number;
  createdAt: string | null;
  mtime: string;
}

interface DossierSummary {
  candidates?: number;
  discoveryPackages?: number;
  dossiersWithAnyDiscovery?: number;
  channelCandidates?: number;
  contactCandidates?: number;
  publicEmailCandidates?: number;
  contactPageCandidates?: number;
  candidatesWithPublicEmail?: number;
  candidatesWithContactCandidate?: number;
  quarantinedChannelCandidates?: number;
  quarantinedContactCandidates?: number;
  creatorSuggestions?: number;
  sensitiveReviewRequired?: number;
  discoveryStars?: Record<string, number>;
  parseFailures?: number;
}

interface DiscoveryStar {
  stars?: number;
  score?: number;
  label?: string;
  reasons?: string[];
  missingSignals?: string[];
  note?: string;
}

interface DossierCounts {
  discoveryChannels?: number;
  contactCandidates?: number;
  publicEmailCandidates?: number;
  contactPageCandidates?: number;
  creatorSuggestions?: number;
  affiliations?: number;
  searchTargets?: number;
  sourcePackages?: number;
  quarantinedChannels?: number;
  quarantinedContactCandidates?: number;
}

interface DiscoveryChannel {
  source?: string;
  platform?: string;
  label?: string;
  url?: string;
  verified?: boolean;
  confidence?: string;
  evidence?: string[];
  role?: string;
  identityAttribution?: string;
  identityScore?: number;
  identityConfidence?: string;
  identityEvidence?: string[];
  eligibleForReview?: boolean;
  /** Present when an operator confirmed this channel really belongs to the candidate. */
  operatorVerification?: {
    url?: string;
    platform?: string;
    label?: string;
    evidenceNote?: string;
    verifiedBy?: string;
    verifiedAt?: string;
  };
}

interface ContactCandidate {
  source?: string;
  type?: string;
  value?: string;
  sourceUrl?: string;
  sourceApiUrl?: string;
  label?: string;
  reason?: string;
  role?: string;
  linkText?: string;
  contextText?: string;
  identityAttribution?: string;
  identityScore?: number;
  identityConfidence?: string;
  identityEvidence?: string[];
  eligibleForReview?: boolean;
  verified?: boolean;
  reviewerNote?: string;
}

interface ReviewOutcome {
  candidateId?: string;
  outcomeStatus?: string;
  verifiedChannels?: unknown[];
  verifiedContactRoutes?: unknown[];
  verifiedSourceUrls?: unknown[];
  reviewerNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  source?: string;
}

/** Written by the operator overlay when a hand-entered record is merged in at read time. */
interface OverlayMarker {
  recordId?: string;
  manual?: boolean;
  updatedAt?: string;
  review?: {
    outcomeStatus?: string;
    note?: string;
    consentStatus?: string | null;
    riskLevel?: string | null;
    star?: number | null;
    reviewedBy?: string;
    reviewedAt?: string;
  } | null;
}

interface CandidateDossier {
  candidateId: string;
  name: string;
  title?: string;
  category?: string;
  subcategories?: string[];
  country?: string;
  fitScore?: number;
  reachScore?: number;
  status?: string;
  consentStatus?: string;
  riskLevel?: string;
  sensitiveFlags?: string[];
  discoveryStar?: DiscoveryStar;
  counts?: DossierCounts;
  discoveryChannels?: DiscoveryChannel[];
  contactCandidates?: ContactCandidate[];
  quarantinedChannels?: DiscoveryChannel[];
  quarantinedContactCandidates?: ContactCandidate[];
  sourceUrls?: string[];
  searchTargets?: string[];
  reviewChecks?: string[];
  reviewOutcome?: ReviewOutcome;
  origin?: string;
  overlay?: OverlayMarker;
}

interface DossierPackage {
  reviewId?: string;
  createdAt?: string;
  sourceBatchId?: string | null;
  sourceLabel?: string | null;
  sourceFile?: string;
  mode?: string;
  qualityVersion?: string;
  inputDir?: string;
  discoveryPackageFiles?: string[];
  summary?: DossierSummary;
  dossiers?: CandidateDossier[];
}

interface DashboardSuccess {
  ok: true;
  generatedAt: string;
  activeDatasetId: string;
  datasets: DatasetOption[];
  package: DossierPackage;
}

interface DashboardFailure {
  ok: false;
  generatedAt: string;
  error: string;
  datasets: DatasetOption[];
}

type DashboardResponse = DashboardSuccess | DashboardFailure;

interface DashboardStats {
  candidates: number;
  channelCandidates: number;
  contactCandidates: number;
  publicEmailCandidates: number;
  contactPageCandidates: number;
  candidatesWithContact: number;
  candidatesWithEmail: number;
  creatorSuggestions: number;
  sensitiveReviewRequired: number;
  fourAndFiveStar: number;
  fiveStar: number;
  lowOrNoStar: number;
}

const initialVisibleRows = 250;
const visibleRowsStep = 250;
const numberFormatter = new Intl.NumberFormat('en-US');

// The same key the outreach panel uses: one operator reference per browser, written onto
// every record either surface creates.
const OPERATOR_STORAGE_KEY = 'beglib.outreach.operator';

const reviewOutcomeLabels: Record<ReviewOutcomeStatus, string> = {
  pending: 'Beklemede',
  approved: 'Onaylandi',
  rejected: 'Reddedildi (gonderim engellenir)',
  deferred: 'Ertelendi',
};

const consentStatusOptions = [
  { value: '', label: 'Degistirme' },
  { value: 'unknown', label: 'Bilinmiyor' },
  { value: 'public-business-contact', label: 'Public business contact' },
  { value: 'representative-contact', label: 'Temsilci uzerinden' },
  { value: 'contact-form-only', label: 'Sadece iletisim formu' },
  { value: 'opted-out', label: 'Opt-out' },
  { value: 'not-allowed', label: 'Izin yok' },
];

const riskLevelOptions = [
  { value: '', label: 'Degistirme' },
  { value: 'low', label: 'Dusuk' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yuksek' },
];

const starOptions = [
  { value: '', label: 'Kesif puani kalsin' },
  { value: '1', label: '1 yildiz' },
  { value: '2', label: '2 yildiz' },
  { value: '3', label: '3 yildiz' },
  { value: '4', label: '4 yildiz' },
  { value: '5', label: '5 yildiz' },
];

const manualCategoryOptions = [
  'science',
  'arts',
  'youtube',
  'podcast',
  'thought-leadership',
  'religion',
  'psychology',
  'therapy',
  'medicine',
  'academia',
  'journalism',
  'education',
  'technology',
];

function toApiErrors(error: unknown) {
  return error instanceof OutreachApiError ? error.errors : [(error as Error).message];
}

interface ReviewInput {
  outcomeStatus: ReviewOutcomeStatus;
  note?: string;
  consentStatus?: string;
  riskLevel?: string;
  star?: number | '';
}

// Mirrors the overlay's own mapping in scripts/lib/candidate-overlay.mjs. A rejected review
// has to stop the send path, and the preflight already blocks on this status.
const statusByOutcome: Partial<Record<ReviewOutcomeStatus, string>> = {
  approved: 'approved',
  rejected: 'do-not-contact',
  deferred: 'needs-review',
};

function hasReview(dossier: CandidateDossier) {
  return Boolean(dossier.overlay?.review?.outcomeStatus);
}

/**
 * Optimistic local patch after a successful write, applied instead of re-fetching the whole
 * dossier package — at 28k candidates a refetch per decision would make the review loop
 * unusable. The server stays authoritative: the next load re-derives all of this from the
 * overlay, so this only has to agree with `applyReview` well enough to display.
 */
function mergeReviewIntoDossier(dossier: CandidateDossier, input: ReviewInput, operator: string): CandidateDossier {
  const star = input.star === '' || input.star === undefined ? null : Number(input.star);
  const riskLevel = input.riskLevel || dossier.riskLevel;
  const review = {
    outcomeStatus: input.outcomeStatus,
    note: input.note ?? '',
    consentStatus: input.consentStatus || null,
    riskLevel: input.riskLevel || null,
    star,
    reviewedBy: operator,
    reviewedAt: new Date().toISOString(),
  };

  return {
    ...dossier,
    status: statusByOutcome[input.outcomeStatus] ?? dossier.status,
    consentStatus: input.consentStatus || dossier.consentStatus,
    riskLevel,
    sensitiveFlags: Array.from(
      new Set([
        ...(dossier.sensitiveFlags ?? []).filter((flag) => flag !== 'high-risk'),
        ...(riskLevel === 'high' ? ['high-risk'] : []),
      ]),
    ),
    discoveryStar:
      star === null
        ? dossier.discoveryStar
        : { ...(dossier.discoveryStar ?? {}), stars: star, label: `Operator ${star} yildiz verdi` },
    reviewOutcome: {
      ...(dossier.reviewOutcome ?? {}),
      candidateId: dossier.candidateId,
      outcomeStatus: input.outcomeStatus,
      reviewerNotes: review.note,
      reviewedBy: operator,
      reviewedAt: review.reviewedAt,
      source: 'operator-overlay',
    },
    overlay: { ...(dossier.overlay ?? {}), review },
  };
}

const contactFilterLabels: Record<ContactFilter, string> = {
  all: 'Tum iletisim',
  'with-contact': 'Iletisim adayi var',
  email: 'E-posta var',
  'contact-page': 'Contact page var',
  'no-contact': 'Iletisim yok',
};

const starFilterLabels: Record<StarFilter, string> = {
  all: 'Tum yildizlar',
  '5': '5 yildiz',
  '4+': '4+ yildiz',
  '3+': '3+ yildiz',
  '0-2': '0-2 yildiz',
};

const riskFilterLabels: Record<RiskFilter, string> = {
  all: 'Tum riskler',
  low: 'Dusuk risk',
  medium: 'Orta risk',
  high: 'Yuksek risk',
  sensitive: 'Hassas inceleme',
};

const sortLabels: Record<SortMode, string> = {
  priority: 'Oncelik',
  emails: 'E-posta sayisi',
  contacts: 'Iletisim sayisi',
  platforms: 'Platform sayisi',
  reach: 'Reach skoru',
  fit: 'Fit skoru',
  name: 'Isim A-Z',
};

function DashboardApp() {
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [dashboard, setDashboard] = useState<DashboardSuccess | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [contactFilter, setContactFilter] = useState<ContactFilter>('all');
  const [starFilter, setStarFilter] = useState<StarFilter>('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('priority');
  const [visibleRows, setVisibleRows] = useState(initialVisibleRows);
  const [copyMessage, setCopyMessage] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('dossier');
  const [operator, setOperator] = useState(() => localStorage.getItem(OPERATOR_STORAGE_KEY) ?? '');
  const [showManualForm, setShowManualForm] = useState(false);
  const [view, setView] = useState<WorkspaceView>('candidates');
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [loopNotice, setLoopNotice] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setStatus('loading');
      setErrorMessage('');

      try {
        const params = selectedDatasetId
          ? `?dataset=${encodeURIComponent(selectedDatasetId)}`
          : '';
        const response = await fetch(`/api/dashboard-data${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        const parsed = (await response.json()) as DashboardResponse;

        if (!parsed.ok) {
          throw new Error(parsed.error);
        }

        setDashboard(parsed);
        setStatus('ready');
        setSelectedDatasetId(parsed.activeDatasetId);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Dashboard data could not be loaded.');
      }
    }

    void loadDashboard();

    return () => controller.abort();
  }, [selectedDatasetId]);

  const dossiers = useMemo(() => dashboard?.package.dossiers ?? [], [dashboard]);
  const stats = useMemo(() => buildStats(dossiers, dashboard?.package.summary), [dossiers, dashboard]);
  const categories = useMemo(() => buildCategoryOptions(dossiers), [dossiers]);
  const platforms = useMemo(() => buildPlatformOptions(dossiers), [dossiers]);
  const countries = useMemo(() => buildCountryOptions(dossiers), [dossiers]);

  const filteredDossiers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return dossiers
      .filter((dossier) => matchesQuery(dossier, normalizedQuery))
      .filter((dossier) => categoryFilter === 'all' || (dossier.category ?? 'unknown') === categoryFilter)
      .filter((dossier) => platformFilter === 'all' || hasPlatform(dossier, platformFilter))
      .filter((dossier) => countryFilter === 'all' || normalizeCountry(dossier) === countryFilter)
      .filter((dossier) => matchesContactFilter(dossier, contactFilter))
      .filter((dossier) => matchesStarFilter(dossier, starFilter))
      .filter((dossier) => matchesRiskFilter(dossier, riskFilter))
      .sort((left, right) => compareDossiers(left, right, sortMode));
  }, [
    categoryFilter,
    contactFilter,
    countryFilter,
    dossiers,
    platformFilter,
    query,
    riskFilter,
    sortMode,
    starFilter,
  ]);

  const activeDatasetId = dashboard?.activeDatasetId ?? '';
  // Overlay writes go through the local outreach server, which only knows the dossier
  // datasets under exports/; a browser-side import has no server-side identity.
  const canEditDataset = Boolean(activeDatasetId) && activeDatasetId !== 'manual-import';
  const visibleDossiers = filteredDossiers.slice(0, visibleRows);
  const selectedDossier =
    filteredDossiers.find((dossier) => dossier.candidateId === selectedCandidateId) ??
    visibleDossiers[0] ??
    dossiers[0] ??
    null;

  const reviewQueue = useMemo(() => {
    const pending = filteredDossiers.filter((dossier) => !hasReview(dossier));

    return { total: filteredDossiers.length, pending: pending.length, next: pending[0] ?? null };
  }, [filteredDossiers]);

  /**
   * The single write path for review outcomes, shared by the detail form, the bulk bar, and
   * the keyboard loop. One candidate goes through the single-record route; a selection goes
   * through the bulk route so N decisions are one locked write rather than N requests.
   */
  async function saveReview(candidateIds: string[], input: ReviewInput) {
    if (candidateIds.length === 0) {
      return;
    }

    if (candidateIds.length === 1) {
      await recordReviewOutcome({
        dataset: activeDatasetId,
        candidateId: candidateIds[0],
        outcomeStatus: input.outcomeStatus,
        note: input.note,
        consentStatus: input.consentStatus,
        riskLevel: input.riskLevel,
        star: input.star,
        actor: operator,
      });
    } else {
      await recordBulkReviewOutcome({
        dataset: activeDatasetId,
        candidateIds,
        outcomeStatus: input.outcomeStatus,
        note: input.note,
        consentStatus: input.consentStatus,
        riskLevel: input.riskLevel,
        star: input.star,
        actor: operator,
      });
    }

    const touched = new Set(candidateIds);

    setDashboard((current) =>
      current
        ? {
            ...current,
            package: {
              ...current.package,
              dossiers: (current.package.dossiers ?? []).map((dossier) =>
                touched.has(dossier.candidateId) ? mergeReviewIntoDossier(dossier, input, operator) : dossier,
              ),
            },
          }
        : current,
    );
  }

  function toggleSelection(candidateId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(candidateId)) {
        next.delete(candidateId);
      } else {
        next.add(candidateId);
      }

      return next;
    });
  }

  function goToCandidate(candidateId: string | undefined) {
    if (!candidateId) {
      setLoopNotice('Bu filtrede inceleme bekleyen aday kalmadi.');
      return;
    }

    setSelectedCandidateId(candidateId);
    setDetailTab('dossier');
  }

  function stepCandidate(offset: number) {
    if (filteredDossiers.length === 0) {
      return;
    }

    const current = filteredDossiers.findIndex((dossier) => dossier.candidateId === selectedDossier?.candidateId);
    const next = Math.min(filteredDossiers.length - 1, Math.max(0, current + offset));

    goToCandidate(filteredDossiers[next]?.candidateId);
  }

  // Advance before the patch lands: once the decision is recorded the candidate stops being
  // "pending", so the next target has to be chosen from the list as it is now.
  function reviewCurrent(outcomeStatus: ReviewOutcomeStatus) {
    const target = selectedDossier;

    if (!target || !canEditDataset || operator.trim().length === 0) {
      setLoopNotice('Karar icin operator referansi ve exports/ dataset gerekli.');
      return;
    }

    const following = filteredDossiers.find(
      (dossier) => dossier.candidateId !== target.candidateId && !hasReview(dossier),
    );

    void (async () => {
      try {
        await saveReview([target.candidateId], { outcomeStatus });
        setLoopNotice(`${target.name}: ${reviewOutcomeLabels[outcomeStatus]}`);

        if (following) {
          setSelectedCandidateId(following.candidateId);
        }
      } catch (error) {
        setLoopNotice(toApiErrors(error)[0]);
      }
    })();
  }

  // Keyboard review loop. Everything here is deliberately single-key and unconfirmed: at this
  // scale the operator is one person going through a list, and every outcome is revocable and
  // audited. Typing in a field must never trigger it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (view !== 'candidates' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) {
        return;
      }

      const handlers: Record<string, () => void> = {
        j: () => stepCandidate(1),
        ArrowDown: () => stepCandidate(1),
        k: () => stepCandidate(-1),
        ArrowUp: () => stepCandidate(-1),
        a: () => reviewCurrent('approved'),
        r: () => reviewCurrent('rejected'),
        d: () => reviewCurrent('deferred'),
        n: () => goToCandidate(reviewQueue.next?.candidateId),
        x: () => selectedDossier && toggleSelection(selectedDossier.candidateId),
        o: () => {
          const url = selectedDossier ? getPrimaryUrl(selectedDossier) : null;

          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        },
        '?': () => setShowShortcuts((current) => !current),
      };

      const handler = handlers[event.key];

      if (handler) {
        event.preventDefault();
        handler();
      }
    }

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Keyboard navigation is useless if the row it lands on is off screen.
  useEffect(() => {
    if (!selectedDossier) {
      return;
    }

    document
      .querySelector(`[data-candidate-id="${CSS.escape(selectedDossier.candidateId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedDossier]);

  async function refreshDashboard() {
    setStatus('loading');

    try {
      const params = selectedDatasetId ? `?dataset=${encodeURIComponent(selectedDatasetId)}` : '';
      const response = await fetch(`/api/dashboard-data${params}`, { cache: 'no-store' });
      const parsed = (await response.json()) as DashboardResponse;

      if (!parsed.ok) {
        throw new Error(parsed.error);
      }

      setDashboard(parsed);
      setSelectedDatasetId(parsed.activeDatasetId);
      setStatus('ready');
      setErrorMessage('');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Refresh failed.');
    }
  }

  function updateOperator(value: string) {
    setOperator(value);
    localStorage.setItem(OPERATOR_STORAGE_KEY, value);
  }

  function updateDataset(value: string) {
    setSelectedDatasetId(value);
    setVisibleRows(initialVisibleRows);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setVisibleRows(initialVisibleRows);
  }

  function updateCategory(value: string) {
    setCategoryFilter(value);
    setVisibleRows(initialVisibleRows);
  }

  function updatePlatform(value: string) {
    setPlatformFilter(value);
    setVisibleRows(initialVisibleRows);
  }

  function updateCountry(value: string) {
    setCountryFilter(value);
    setVisibleRows(initialVisibleRows);
  }

  function updateContact(value: ContactFilter) {
    setContactFilter(value);
    setVisibleRows(initialVisibleRows);
  }

  function updateStars(value: StarFilter) {
    setStarFilter(value);
    setVisibleRows(initialVisibleRows);
  }

  function updateRisk(value: RiskFilter) {
    setRiskFilter(value);
    setVisibleRows(initialVisibleRows);
  }

  function updateSort(value: SortMode) {
    setSortMode(value);
    setVisibleRows(initialVisibleRows);
  }

  async function handleManualImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as DossierPackage;

      if (!Array.isArray(parsed.dossiers)) {
        throw new Error('Imported JSON does not contain dossiers.');
      }

      const imported: DashboardSuccess = {
        ok: true,
        generatedAt: new Date().toISOString(),
        activeDatasetId: 'manual-import',
        datasets: [
          {
            id: 'manual-import',
            label: file.name,
            file: file.name,
            kind: 'other',
            candidates: parsed.dossiers.length,
            createdAt: parsed.createdAt ?? null,
            mtime: new Date().toISOString(),
          },
        ],
        package: parsed,
      };

      setDashboard(imported);
      setStatus('ready');
      setErrorMessage('');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Import failed.');
    }
  }

  function resetFilters() {
    setQuery('');
    setCategoryFilter('all');
    setPlatformFilter('all');
    setCountryFilter('all');
    setContactFilter('all');
    setStarFilter('all');
    setRiskFilter('all');
    setSortMode('priority');
    setVisibleRows(initialVisibleRows);
  }

  function exportJson() {
    if (!dashboard) {
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      source: {
        datasetId: dashboard.activeDatasetId,
        sourceFile: dashboard.package.sourceFile ?? dashboard.datasets[0]?.file ?? 'manual',
        reviewId: dashboard.package.reviewId ?? null,
      },
      filters: currentFilters({
        categoryFilter,
        contactFilter,
        countryFilter,
        platformFilter,
        query,
        riskFilter,
        sortMode,
        starFilter,
      }),
      count: filteredDossiers.length,
      candidates: filteredDossiers,
    };

    downloadFile(
      `beglib-candidates-${dateStamp()}-${filteredDossiers.length}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
  }

  function exportCsv() {
    const rows = filteredDossiers.map((dossier) => {
      const contacts = getContacts(dossier);
      const emails = contacts.filter((contact) => isEmailContact(contact));

      return {
        candidateId: dossier.candidateId,
        name: dossier.name,
        title: dossier.title ?? '',
        category: dossier.category ?? '',
        subcategories: (dossier.subcategories ?? []).join('; '),
        country: dossier.country ?? '',
        stars: getStars(dossier),
        starScore: dossier.discoveryStar?.score ?? '',
        riskLevel: dossier.riskLevel ?? '',
        sensitiveFlags: (dossier.sensitiveFlags ?? []).join('; '),
        fitScore: dossier.fitScore ?? '',
        reachScore: dossier.reachScore ?? '',
        channels: getCount(dossier, 'discoveryChannels'),
        contacts: contacts.length,
        publicEmails: emails.length,
        contactPages: getCount(dossier, 'contactPageCandidates'),
        creatorSuggestions: getCount(dossier, 'creatorSuggestions'),
        platforms: getPlatforms(dossier).join('; '),
        firstEmail: emails[0]?.value ?? '',
        firstContact: contacts[0]?.value ?? '',
        firstSource: getPrimaryUrl(dossier) ?? '',
      };
    });

    downloadFile(`beglib-candidates-${dateStamp()}-${rows.length}.csv`, toCsv(rows), 'text/csv');
  }

  async function copySelectedContacts() {
    if (!selectedDossier) {
      return;
    }

    const contacts = getContacts(selectedDossier);
    const lines =
      contacts.length > 0
        ? contacts.map((contact) =>
            [contact.role ?? contact.type ?? 'contact', contact.value ?? '', contact.sourceUrl ?? ''].join('\t'),
          )
        : (selectedDossier.sourceUrls ?? []).map((url) => `source\t${url}`);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyMessage(`${lines.length} satir kopyalandi.`);
    } catch {
      setCopyMessage('Kopyalama tarayici tarafindan engellendi.');
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar" aria-label="Dashboard controls">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            bG
          </div>
          <div>
            <p className="eyebrow">beGlib</p>
            <h1>Host Research</h1>
          </div>
        </div>

        <section className="side-panel" aria-label="Data source">
          <PanelTitle icon={<Database size={16} />} title="Veri kaynagi" />
          <label className="field-label" htmlFor="dataset">
            Dataset
          </label>
          <select
            className="full-select"
            disabled={!dashboard || dashboard.datasets.length === 0}
            id="dataset"
            onChange={(event) => updateDataset(event.target.value)}
            value={dashboard?.activeDatasetId ?? selectedDatasetId}
          >
            {(dashboard?.datasets ?? []).map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.label}
              </option>
            ))}
          </select>
          <div className="source-meta">
            <span>{dashboard?.package.reviewId ?? 'No review package'}</span>
            <span>{dashboard ? formatDate(dashboard.package.createdAt) : 'Waiting for data'}</span>
          </div>
          <div className="side-actions">
            <button className="icon-action" onClick={refreshDashboard} type="button">
              <RefreshCw size={16} aria-hidden="true" />
              Yenile
            </button>
            <label className="icon-action file-action">
              <FileText size={16} aria-hidden="true" />
              Import
              <input accept="application/json" onChange={handleManualImport} type="file" />
            </label>
          </div>
        </section>

        <section className="side-panel" aria-label="Operator">
          <PanelTitle icon={<ClipboardCheck size={16} />} title="Operator" />
          <label className="field-label" htmlFor="operator-ref">
            Referansiniz (her kayda islenir)
          </label>
          <input
            className="full-input"
            id="operator-ref"
            onChange={(event) => updateOperator(event.target.value)}
            placeholder="reviewer:mehmet"
            value={operator}
          />
          <button
            className="icon-action"
            disabled={!canEditDataset}
            onClick={() => setShowManualForm((current) => !current)}
            type="button"
          >
            <UserPlus size={16} aria-hidden="true" />
            {showManualForm ? 'Formu kapat' : 'Elle aday ekle'}
          </button>
          {!canEditDataset && (
            <p className="side-note">
              Elle giris sadece <code>exports/</code> altindaki bir dataset icin calisir.
            </p>
          )}
        </section>

        <section className="side-panel" aria-label="Top categories">
          <PanelTitle icon={<Filter size={16} />} title="Kategoriler" />
          <button
            className={categoryFilter === 'all' ? 'category-button active' : 'category-button'}
            onClick={() => updateCategory('all')}
            type="button"
          >
            <span>Tum kategoriler</span>
            <strong>{formatNumber(dossiers.length)}</strong>
          </button>
          {categories.slice(0, 12).map((category) => (
            <button
              className={categoryFilter === category.value ? 'category-button active' : 'category-button'}
              key={category.value}
              onClick={() => updateCategory(category.value)}
              type="button"
            >
              <span>{category.label}</span>
              <strong>{formatNumber(category.count)}</strong>
            </button>
          ))}
        </section>

        <section className="guardrail-panel" aria-label="Governance note">
          <ShieldAlert size={17} aria-hidden="true" />
          <div>
            <strong>Discovery-only vault</strong>
            <span>Kayitlar izin veya gonderim onayi degildir; hassas alanlar insan/legal inceleme ister.</span>
          </div>
        </section>
      </aside>

      <main className="dashboard-workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Private local dashboard</p>
            <h2>Aday havuzu ve iletisim kanallari</h2>
          </div>
          <div className="header-actions">
            <div className="view-switch" role="tablist">
              <button
                aria-selected={view === 'candidates'}
                className={view === 'candidates' ? 'view-tab active' : 'view-tab'}
                onClick={() => setView('candidates')}
                role="tab"
                type="button"
              >
                <Users size={16} aria-hidden="true" />
                Adaylar
              </button>
              <button
                aria-selected={view === 'operations'}
                className={view === 'operations' ? 'view-tab active' : 'view-tab'}
                onClick={() => setView('operations')}
                role="tab"
                type="button"
              >
                <Activity size={16} aria-hidden="true" />
                Operasyon
              </button>
            </div>
            <button className="secondary-button" disabled={view === 'operations'} onClick={exportCsv} type="button">
              <Download size={17} aria-hidden="true" />
              CSV
            </button>
            <button className="secondary-button" disabled={view === 'operations'} onClick={exportJson} type="button">
              <Download size={17} aria-hidden="true" />
              JSON
            </button>
          </div>
        </header>

        <StatusBanner
          dashboard={dashboard}
          errorMessage={errorMessage}
          status={status}
          total={dossiers.length}
        />

        {view === 'operations' ? (
          <OperationsPanel operator={operator} />
        ) : (
          <>
        {showManualForm && canEditDataset && (
          <ManualCandidateForm
            datasetId={activeDatasetId}
            onClose={() => setShowManualForm(false)}
            onSaved={(candidateId) => {
              setShowManualForm(false);
              setSelectedCandidateId(candidateId);
              void refreshDashboard();
            }}
            operator={operator}
          />
        )}

        <section className="metric-grid" aria-label="Research metrics">
          <MetricTile icon={<Users size={18} />} label="Adaylar" value={stats.candidates} />
          <MetricTile icon={<Globe2 size={18} />} label="Kanal sinyali" value={stats.channelCandidates} />
          <MetricTile icon={<Mail size={18} />} label="Iletisim adayi" value={stats.contactCandidates} />
          <MetricTile icon={<CheckCircle2 size={18} />} label="E-posta" value={stats.publicEmailCandidates} />
          <MetricTile icon={<Star size={18} />} label="4-5 yildiz" value={stats.fourAndFiveStar} />
          <MetricTile icon={<AlertTriangle size={18} />} label="Hassas inceleme" value={stats.sensitiveReviewRequired} />
        </section>

        <section className="filter-toolbar" aria-label="Filters">
          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Aday ara"
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="Aday, konu, ulke, link veya platform ara"
              type="search"
              value={query}
            />
          </label>

          <FilterSelect
            label="Kategori"
            onChange={updateCategory}
            options={[{ label: 'Tum kategoriler', value: 'all' }, ...categories]}
            value={categoryFilter}
          />
          <FilterSelect
            label="Platform"
            onChange={updatePlatform}
            options={[{ label: 'Tum platformlar', value: 'all' }, ...platforms]}
            value={platformFilter}
          />
          <FilterSelect
            label="Ulke"
            onChange={updateCountry}
            options={[{ label: 'Tum ulkeler', value: 'all' }, ...countries]}
            value={countryFilter}
          />
          <FilterSelect<ContactFilter>
            label="Iletisim"
            onChange={updateContact}
            options={objectOptions(contactFilterLabels)}
            value={contactFilter}
          />
          <FilterSelect<StarFilter>
            label="Yildiz"
            onChange={updateStars}
            options={objectOptions(starFilterLabels)}
            value={starFilter}
          />
          <FilterSelect<RiskFilter>
            label="Risk"
            onChange={updateRisk}
            options={objectOptions(riskFilterLabels)}
            value={riskFilter}
          />
          <FilterSelect<SortMode>
            label="Sirala"
            onChange={updateSort}
            options={objectOptions(sortLabels)}
            value={sortMode}
          />

          <button className="reset-button" onClick={resetFilters} type="button">
            Sifirla
          </button>
        </section>

        <section className="work-grid">
          <section className="candidate-panel" aria-label="Candidate list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Calisma seti</p>
                <h3>{formatNumber(filteredDossiers.length)} aday</h3>
              </div>
              <span>
                {formatNumber(Math.min(visibleRows, filteredDossiers.length))} /{' '}
                {formatNumber(filteredDossiers.length)}
              </span>
            </div>

            <div className="queue-bar">
              <div className="queue-progress" role="progressbar" aria-valuemax={reviewQueue.total} aria-valuenow={reviewQueue.total - reviewQueue.pending} aria-valuemin={0}>
                <span
                  style={{
                    width: `${reviewQueue.total === 0 ? 0 : Math.round(((reviewQueue.total - reviewQueue.pending) / reviewQueue.total) * 100)}%`,
                  }}
                />
              </div>
              <span className="queue-count">
                {formatNumber(reviewQueue.total - reviewQueue.pending)} / {formatNumber(reviewQueue.total)} incelendi
              </span>
              <button
                className="secondary-button"
                disabled={!reviewQueue.next}
                onClick={() => goToCandidate(reviewQueue.next?.candidateId)}
                type="button"
              >
                <ListChecks size={15} aria-hidden="true" />
                Kaldigim yerden devam
              </button>
              <button className="link-button" onClick={() => setShowShortcuts((current) => !current)} type="button">
                Kisayollar
              </button>
            </div>

            {showShortcuts && <ShortcutHelp />}
            {loopNotice && <p className="queue-notice">{loopNotice}</p>}

            {selectedIds.size > 0 && canEditDataset && (
              <BulkReviewBar
                count={selectedIds.size}
                onClear={() => setSelectedIds(new Set())}
                onSubmit={async (input) => {
                  const ids = [...selectedIds];

                  await saveReview(ids, input);
                  setSelectedIds(new Set());
                  setLoopNotice(`${ids.length} aday icin karar kaydedildi.`);
                }}
                operator={operator}
              />
            )}

            {visibleDossiers.length === 0 ? (
              <EmptyState message="Bu filtrelerde aday bulunamadi." />
            ) : (
              <>
                {canEditDataset && (
                  <div className="selection-actions">
                    <button
                      className="link-button"
                      onClick={() =>
                        setSelectedIds(new Set(visibleDossiers.slice(0, MAX_BULK_SELECTION).map((dossier) => dossier.candidateId)))
                      }
                      type="button"
                    >
                      Gorunenleri sec ({formatNumber(Math.min(visibleDossiers.length, MAX_BULK_SELECTION))})
                    </button>
                    {selectedIds.size > 0 && (
                      <button className="link-button" onClick={() => setSelectedIds(new Set())} type="button">
                        Secimi temizle
                      </button>
                    )}
                  </div>
                )}

                <div className="candidate-list">
                  {visibleDossiers.map((dossier) => (
                    <CandidateRow
                      dossier={dossier}
                      isChecked={selectedIds.has(dossier.candidateId)}
                      isSelected={dossier.candidateId === selectedDossier?.candidateId}
                      key={dossier.candidateId}
                      onSelect={() => setSelectedCandidateId(dossier.candidateId)}
                      onToggleCheck={canEditDataset ? () => toggleSelection(dossier.candidateId) : undefined}
                    />
                  ))}
                </div>
              </>
            )}

            {visibleRows < filteredDossiers.length && (
              <button
                className="load-more-button"
                onClick={() => setVisibleRows((current) => current + visibleRowsStep)}
                type="button"
              >
                {formatNumber(visibleRowsStep)} aday daha goster
              </button>
            )}
          </section>

          <CandidateDetail
            activeTab={detailTab}
            canEdit={canEditDataset}
            copyMessage={copyMessage}
            datasetId={activeDatasetId}
            dossier={selectedDossier}
            onCopyContacts={copySelectedContacts}
            onChannelChanged={() => void refreshDashboard()}
            onReviewSubmit={(input) => saveReview([selectedDossier?.candidateId ?? ''], input)}
            onTabChange={setDetailTab}
            operator={operator}
          />
        </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatusBanner({
  dashboard,
  errorMessage,
  status,
  total,
}: {
  dashboard: DashboardSuccess | null;
  errorMessage: string;
  status: DashboardStatus;
  total: number;
}) {
  if (status === 'error') {
    return (
      <section className="status-banner error" aria-live="polite">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>{errorMessage}</span>
      </section>
    );
  }

  if (status === 'loading') {
    return (
      <section className="status-banner" aria-live="polite">
        <RefreshCw size={18} aria-hidden="true" />
        <span>Local discovery dosyalari okunuyor.</span>
      </section>
    );
  }

  const activeDataset = dashboard?.datasets.find((dataset) => dataset.id === dashboard.activeDatasetId);
  const sourceLabel = activeDataset?.file ?? compactPath(dashboard?.package.sourceFile) ?? 'local import';

  return (
    <section className="status-banner" aria-live="polite">
      <Database size={18} aria-hidden="true" />
      <span>
        {formatNumber(total)} aday yuklendi. Kaynak: {sourceLabel}.
      </span>
    </section>
  );
}

function MetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <article className="metric-tile">
      <span aria-hidden="true">{icon}</span>
      <div>
        <strong>{formatNumber(value)}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

function FilterSelect<TValue extends string = string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: TValue) => void;
  options: Array<{ label: string; value: TValue; count?: number }>;
  value: TValue;
}) {
  return (
    <label className="filter-select">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value as TValue)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.count ? `${option.label} (${formatNumber(option.count)})` : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CandidateRow({
  dossier,
  isChecked,
  isSelected,
  onSelect,
  onToggleCheck,
}: {
  dossier: CandidateDossier;
  isChecked: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleCheck?: () => void;
}) {
  const contacts = getContacts(dossier);
  const emailCount = contacts.filter((contact) => isEmailContact(contact)).length;
  const platforms = getPlatforms(dossier).slice(0, 5);

  return (
    <article
      className={isSelected ? 'candidate-row selected' : 'candidate-row'}
      data-candidate-id={dossier.candidateId}
    >
      {onToggleCheck && (
        <label className="candidate-check">
          <input
            aria-label={`${dossier.name} secimi`}
            checked={isChecked}
            onChange={onToggleCheck}
            type="checkbox"
          />
        </label>
      )}
      <button onClick={onSelect} type="button">
        <div className="candidate-main">
          <div className="candidate-title">
            <h4>{dossier.name}</h4>
            <StarPill dossier={dossier} />
          </div>
          <p>{dossier.title || 'Title not available'}</p>
          <div className="tag-line">
            <span>{dossier.category ?? 'unknown'}</span>
            <span>{dossier.country ?? 'unknown country'}</span>
            <span>{normalizeRisk(dossier)}</span>
            {hasSensitiveFlag(dossier) && <span className="warning-tag">hassas</span>}
            {dossier.origin === 'manual-entry' && <span className="manual-tag">elle eklendi</span>}
            {dossier.overlay?.review?.outcomeStatus && (
              <span className={`outcome-tag ${dossier.overlay.review.outcomeStatus}`}>
                {dossier.overlay.review.outcomeStatus}
              </span>
            )}
          </div>
          <div className="platform-line">
            {platforms.map((platform) => (
              <span key={platform}>{platform}</span>
            ))}
            {getPlatforms(dossier).length > platforms.length && (
              <span>+{getPlatforms(dossier).length - platforms.length}</span>
            )}
          </div>
        </div>

        <div className="candidate-numbers" aria-label="Candidate counts">
          <MiniStat label="kanal" value={getCount(dossier, 'discoveryChannels')} />
          <MiniStat label="contact" value={contacts.length} />
          <MiniStat label="email" value={emailCount} />
          <MiniStat label="reach" value={dossier.reachScore ?? 0} />
        </div>
      </button>
    </article>
  );
}

function CandidateDetail({
  activeTab,
  canEdit,
  copyMessage,
  datasetId,
  dossier,
  onCopyContacts,
  onChannelChanged,
  onReviewSubmit,
  onTabChange,
  operator,
}: {
  activeTab: DetailTab;
  canEdit: boolean;
  copyMessage: string;
  datasetId: string;
  dossier: CandidateDossier | null;
  onCopyContacts: () => void;
  onChannelChanged: () => void;
  onReviewSubmit: (input: ReviewInput) => Promise<void>;
  onTabChange: (tab: DetailTab) => void;
  operator: string;
}) {
  if (!dossier) {
    return (
      <aside className="detail-panel" aria-label="Candidate details">
        <EmptyState message="Aday secilmedi." />
      </aside>
    );
  }

  if (activeTab === 'outreach') {
    return (
      <aside className="detail-panel" aria-label="Candidate outreach">
        <DetailTabs activeTab={activeTab} onTabChange={onTabChange} />
        {/* Remounting per candidate resets the route pick, forms, and preview together. */}
        <OutreachPanel
          candidateId={dossier.candidateId}
          candidateName={dossier.name}
          datasetId={datasetId}
          key={`${datasetId}:${dossier.candidateId}`}
        />
      </aside>
    );
  }

  const contacts = getContacts(dossier);
  const emails = contacts.filter((contact) => isEmailContact(contact));
  const contactPages = contacts.filter((contact) => !isEmailContact(contact));
  const quarantinedChannels =
    dossier.counts?.quarantinedChannels ?? dossier.quarantinedChannels?.length ?? 0;
  const quarantinedContacts =
    dossier.counts?.quarantinedContactCandidates ?? dossier.quarantinedContactCandidates?.length ?? 0;
  const primaryUrl = getPrimaryUrl(dossier);

  return (
    <aside className="detail-panel" aria-label="Candidate details">
      <DetailTabs activeTab={activeTab} onTabChange={onTabChange} />
      <div className="detail-header">
        <div>
          <p className="eyebrow">Aday dosyasi</p>
          <h3>{dossier.name}</h3>
          <span>{dossier.title || dossier.category || 'Discovery record'}</span>
        </div>
        <StarMeter dossier={dossier} />
      </div>

      <div className="detail-actions">
        <button className="secondary-button" onClick={onCopyContacts} type="button">
          <Clipboard size={16} aria-hidden="true" />
          Kopyala
        </button>
        {primaryUrl && (
          <a className="secondary-button" href={primaryUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={16} aria-hidden="true" />
            Kaynak
          </a>
        )}
      </div>
      {copyMessage && <span className="copy-message">{copyMessage}</span>}

      <div className="signal-grid">
        <MiniStat label="kanal" value={getCount(dossier, 'discoveryChannels')} />
        <MiniStat label="contact" value={contacts.length} />
        <MiniStat label="email" value={emails.length} />
        <MiniStat label="page" value={contactPages.length} />
      </div>

      {(hasSensitiveFlag(dossier) || normalizeRisk(dossier) === 'high') && (
        <div className="review-alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Bu aday kampanya oncesi insan/legal inceleme ister.</span>
        </div>
      )}

      <DetailSection icon={<Mail size={16} />} title="Iletisim adaylari">
        {contacts.length === 0 ? (
          <EmptyLine text="Henuz public e-posta veya contact page adayi yok." />
        ) : (
          <div className="contact-list">
            {contacts.map((contact, index) => (
              <ContactItem contact={contact} key={`${contact.value}-${contact.sourceUrl}-${index}`} />
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection icon={<Globe2 size={16} />} title="Kanal sinyalleri">
        <div className="source-list">
          {(dossier.discoveryChannels ?? []).map((channel, index) => (
            <SourceItem
              canEdit={canEdit}
              candidateId={dossier.candidateId}
              channel={channel}
              datasetId={datasetId}
              key={`${channel.url}-${channel.platform}-${index}`}
              onChanged={onChannelChanged}
              operator={operator}
            />
          ))}
          {(dossier.discoveryChannels ?? []).length === 0 && <EmptyLine text="Kanal sinyali yok." />}
        </div>
      </DetailSection>

      <DetailSection icon={<Star size={16} />} title="Yildiz gerekcesi">
        <div className="reason-list">
          {(dossier.discoveryStar?.reasons ?? []).map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
          {(dossier.discoveryStar?.missingSignals ?? []).map((signal) => (
            <span className="missing" key={signal}>
              {signal}
            </span>
          ))}
          {(dossier.discoveryStar?.reasons ?? []).length === 0 &&
            (dossier.discoveryStar?.missingSignals ?? []).length === 0 && (
              <EmptyLine text="Yildiz gerekcesi kaydi yok." />
            )}
        </div>
      </DetailSection>

      <DetailSection icon={<ClipboardCheck size={16} />} title="Inceleme karari">
        {canEdit ? (
          <ReviewOutcomeForm
            dossier={dossier}
            key={`${datasetId}:${dossier.candidateId}`}
            onSubmit={onReviewSubmit}
            operator={operator}
          />
        ) : (
          <EmptyLine text="Karar kaydi sadece exports/ altindaki bir dataset icin yazilabilir." />
        )}
      </DetailSection>

      <DetailSection icon={<ShieldAlert size={16} />} title="Inceleme">
        <div className="review-list">
          {(dossier.reviewChecks ?? []).map((check) => (
            <span key={check}>{check}</span>
          ))}
          {dossier.reviewOutcome?.outcomeStatus && (
            <span className="outcome">outcome: {dossier.reviewOutcome.outcomeStatus}</span>
          )}
          {(dossier.sensitiveFlags ?? []).map((flag) => (
            <span className="sensitive" key={flag}>
              {flag}
            </span>
          ))}
          {quarantinedChannels + quarantinedContacts > 0 && (
            <span>
              Karantina: {formatNumber(quarantinedChannels)} iliskilendirilmemis kanal,{' '}
              {formatNumber(quarantinedContacts)} iliskilendirilmemis iletisim kaydi. Ham kanit korunuyor;
              aday iletisim listesine ve yildiz puanina dahil edilmiyor.
            </span>
          )}
        </div>
      </DetailSection>
    </aside>
  );
}

const MAX_BULK_SELECTION = 500;

const SHORTCUTS = [
  { keys: 'j / ↓', description: 'Sonraki aday' },
  { keys: 'k / ↑', description: 'Onceki aday' },
  { keys: 'n', description: 'Incelenmemis ilk adaya atla' },
  { keys: 'a', description: 'Onayla' },
  { keys: 'r', description: 'Reddet (do-not-contact)' },
  { keys: 'd', description: 'Ertele' },
  { keys: 'o', description: 'Kaynak sayfayi yeni sekmede ac' },
  { keys: 'x', description: 'Toplu secime ekle / cikar' },
  { keys: '?', description: 'Bu listeyi ac / kapat' },
];

function ShortcutHelp() {
  return (
    <dl className="shortcut-help">
      {SHORTCUTS.map((shortcut) => (
        <div key={shortcut.keys}>
          <dt>{shortcut.keys}</dt>
          <dd>{shortcut.description}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One decision across a selection. Consent status and risk level are deliberately left out:
 * they carry legal weight per person and should not be set 500 at a time.
 */
function BulkReviewBar({
  count,
  onClear,
  onSubmit,
  operator,
}: {
  count: number;
  onClear: () => void;
  onSubmit: (input: ReviewInput) => Promise<void>;
  operator: string;
}) {
  const [outcomeStatus, setOutcomeStatus] = useState<ReviewOutcomeStatus>('deferred');
  const [star, setStar] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const operatorMissing = operator.trim().length === 0;
  const overLimit = count > MAX_BULK_SELECTION;

  async function submit() {
    setBusy(true);
    setErrors([]);

    try {
      await onSubmit({ outcomeStatus, note, star: star === '' ? '' : Number(star) });
      setNote('');
    } catch (error) {
      setErrors(toApiErrors(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bulk-bar" aria-label="Bulk review">
      <strong>{formatNumber(count)} aday secili</strong>

      <select onChange={(event) => setOutcomeStatus(event.target.value as ReviewOutcomeStatus)} value={outcomeStatus}>
        {Object.entries(reviewOutcomeLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select onChange={(event) => setStar(event.target.value)} value={star}>
        {starOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <input onChange={(event) => setNote(event.target.value)} placeholder="Ortak not" value={note} />

      <button
        className="primary-button"
        disabled={busy || operatorMissing || overLimit}
        onClick={() => void submit()}
        type="button"
      >
        <ClipboardCheck size={15} aria-hidden="true" />
        {busy ? 'Kaydediliyor…' : 'Secilenlere uygula'}
      </button>
      <button className="link-button" onClick={onClear} type="button">
        Temizle
      </button>

      {overLimit && (
        <span className="review-form-warn">Tek seferde en fazla {MAX_BULK_SELECTION} aday islenebilir.</span>
      )}
      {operatorMissing && <span className="review-form-warn">Operator referansi zorunlu.</span>}
      {errors.map((message) => (
        <span className="review-form-error" key={message}>
          {message}
        </span>
      ))}
    </section>
  );
}

/**
 * Records what a human decided about a candidate. The write lands in the operator overlay,
 * never in the generated export, so the next dossier rebuild cannot erase it.
 */
function ReviewOutcomeForm({
  dossier,
  onSubmit,
  operator,
}: {
  dossier: CandidateDossier;
  onSubmit: (input: ReviewInput) => Promise<void>;
  operator: string;
}) {
  const existing = dossier.overlay?.review ?? null;
  const [form, setForm] = useState({
    outcomeStatus: (existing?.outcomeStatus as ReviewOutcomeStatus) ?? 'pending',
    note: existing?.note ?? '',
    consentStatus: existing?.consentStatus ?? '',
    riskLevel: existing?.riskLevel ?? '',
    star: existing?.star ? String(existing.star) : '',
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');

  const operatorMissing = operator.trim().length === 0;

  async function save() {
    setBusy(true);
    setErrors([]);
    setNotice('');

    try {
      await onSubmit({
        outcomeStatus: form.outcomeStatus,
        note: form.note,
        consentStatus: form.consentStatus,
        riskLevel: form.riskLevel,
        star: form.star === '' ? '' : Number(form.star),
      });

      setNotice('Karar kaydedildi.');
    } catch (error) {
      setErrors(toApiErrors(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review-form">
      {existing && (
        <p className="review-form-meta">
          Son karar: {reviewOutcomeLabels[existing.outcomeStatus as ReviewOutcomeStatus] ?? existing.outcomeStatus} ·{' '}
          {existing.reviewedBy} · {formatDate(existing.reviewedAt)}
        </p>
      )}

      <div className="review-form-grid">
        <label className="review-field">
          <span>Karar</span>
          <select
            onChange={(event) =>
              setForm((current) => ({ ...current, outcomeStatus: event.target.value as ReviewOutcomeStatus }))
            }
            value={form.outcomeStatus}
          >
            {Object.entries(reviewOutcomeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="review-field">
          <span>Yildiz</span>
          <select
            onChange={(event) => setForm((current) => ({ ...current, star: event.target.value }))}
            value={form.star}
          >
            {starOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="review-field">
          <span>Risk</span>
          <select
            onChange={(event) => setForm((current) => ({ ...current, riskLevel: event.target.value }))}
            value={form.riskLevel}
          >
            {riskLevelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="review-field">
          <span>Consent</span>
          <select
            onChange={(event) => setForm((current) => ({ ...current, consentStatus: event.target.value }))}
            value={form.consentStatus}
          >
            {consentStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="review-field wide">
          <span>Not (ne gordunuz, neden bu karar?)</span>
          <textarea
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            rows={2}
            value={form.note}
          />
        </label>
      </div>

      {form.outcomeStatus === 'rejected' && (
        <p className="review-form-warn">
          Reddedilen aday <strong>do-not-contact</strong> olarak isaretlenir ve gonderim kapisi bu adayi engeller.
        </p>
      )}

      <div className="review-form-actions">
        <button className="primary-button" disabled={busy || operatorMissing} onClick={() => void save()} type="button">
          <ClipboardCheck size={15} aria-hidden="true" />
          {busy ? 'Kaydediliyor…' : 'Karari kaydet'}
        </button>
        {operatorMissing && <span className="review-form-warn">Once soldaki operator referansini doldurun.</span>}
        {notice && <span className="review-form-ok">{notice}</span>}
      </div>

      {errors.map((message) => (
        <p className="review-form-error" key={message}>
          {message}
        </p>
      ))}
    </div>
  );
}

/**
 * Adds a person the discovery pass never found. The record carries no evidence beyond the
 * source URL the operator typed, and no contact route: sending still requires the same
 * verification and approval gates as any generated candidate.
 */
function ManualCandidateForm({
  datasetId,
  onClose,
  onSaved,
  operator,
}: {
  datasetId: string;
  onClose: () => void;
  onSaved: (candidateId: string) => void;
  operator: string;
}) {
  const [form, setForm] = useState({
    name: '',
    title: '',
    category: manualCategoryOptions[0],
    country: '',
    sourceUrl: '',
    note: '',
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const operatorMissing = operator.trim().length === 0;

  async function save() {
    setBusy(true);
    setErrors([]);

    try {
      const result = await createManualCandidate({
        dataset: datasetId,
        name: form.name,
        title: form.title,
        category: form.category,
        country: form.country,
        sourceUrl: form.sourceUrl,
        note: form.note,
        actor: operator,
      });

      onSaved(result.record.candidateId);
    } catch (error) {
      setErrors(toApiErrors(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="manual-form" aria-label="Manual candidate entry">
      <header>
        <div>
          <p className="eyebrow">Elle giris</p>
          <h3>Havuzda olmayan bir aday ekleyin</h3>
        </div>
        <button className="secondary-button" onClick={onClose} type="button">
          Kapat
        </button>
      </header>

      <div className="manual-form-grid">
        <label className="review-field">
          <span>Isim *</span>
          <input
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            value={form.name}
          />
        </label>
        <label className="review-field">
          <span>Unvan</span>
          <input
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            value={form.title}
          />
        </label>
        <label className="review-field">
          <span>Kategori *</span>
          <select
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
            value={form.category}
          >
            {manualCategoryOptions.map((category) => (
              <option key={category} value={category}>
                {humanize(category)}
              </option>
            ))}
          </select>
        </label>
        <label className="review-field">
          <span>Ulke *</span>
          <input
            onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
            placeholder="Canada"
            value={form.country}
          />
        </label>
        <label className="review-field wide">
          <span>Kaynak URL * (bu kisiyi buldugunuz public sayfa)</span>
          <input
            onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))}
            placeholder="https://..."
            value={form.sourceUrl}
          />
        </label>
        <label className="review-field wide">
          <span>Not</span>
          <textarea
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            rows={2}
            value={form.note}
          />
        </label>
      </div>

      <div className="review-form-actions">
        <button className="primary-button" disabled={busy || operatorMissing} onClick={() => void save()} type="button">
          <UserPlus size={15} aria-hidden="true" />
          {busy ? 'Kaydediliyor…' : 'Adayi ekle'}
        </button>
        {operatorMissing && <span className="review-form-warn">Once soldaki operator referansini doldurun.</span>}
        <span className="review-form-meta">
          Kayit <code>data/candidate-overlay.local.json</code> dosyasina yazilir; dossier yeniden uretilince silinmez.
        </span>
      </div>

      {errors.map((message) => (
        <p className="review-form-error" key={message}>
          {message}
        </p>
      ))}
    </section>
  );
}

function DetailTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  return (
    <div className="detail-tabs" role="tablist">
      <button
        aria-selected={activeTab === 'dossier'}
        className={activeTab === 'dossier' ? 'detail-tab active' : 'detail-tab'}
        onClick={() => onTabChange('dossier')}
        role="tab"
        type="button"
      >
        <FileText size={15} aria-hidden="true" />
        Aday dosyasi
      </button>
      <button
        aria-selected={activeTab === 'outreach'}
        className={activeTab === 'outreach' ? 'detail-tab active' : 'detail-tab'}
        onClick={() => onTabChange('outreach')}
        role="tab"
        type="button"
      >
        <Mail size={15} aria-hidden="true" />
        Outreach
      </button>
    </div>
  );
}

function ContactItem({ contact }: { contact: ContactCandidate }) {
  const value = contact.value ?? '';
  const sourceUrl = contact.sourceUrl ?? '';

  return (
    <article className="contact-item">
      <div>
        <strong>{value || 'Unknown contact value'}</strong>
        <span>{contactLabel(contact)}</span>
      </div>
      {sourceUrl && (
        <a href={sourceUrl} rel="noreferrer" target="_blank" aria-label="Open contact source">
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
    </article>
  );
}

/**
 * A discovery channel plus the identity check that used to require the
 * `review:official-sources` CLI round-trip. Verifying records that a human opened the URL and
 * confirmed it belongs to this person; it is attribution only and grants no permission to send.
 */
function SourceItem({
  canEdit,
  candidateId,
  channel,
  datasetId,
  onChanged,
  operator,
}: {
  canEdit: boolean;
  candidateId: string;
  channel: DiscoveryChannel;
  datasetId: string;
  onChanged: () => void;
  operator: string;
}) {
  const url = channel.url ?? '';
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const verification = channel.operatorVerification;
  const operatorMissing = operator.trim().length === 0;

  async function submit(action: () => Promise<unknown>) {
    setBusy(true);
    setErrors([]);

    try {
      await action();
      setOpen(false);
      setNote('');
      onChanged();
    } catch (error) {
      setErrors(toApiErrors(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={channel.verified ? 'source-item verified' : 'source-item'}>
      <div className="source-item-main">
        <div>
          <strong>{channel.label ?? channel.platform ?? 'Source'}</strong>
          <span>
            {channel.platform ?? 'unknown'} · {channel.confidence ?? 'unknown'}
          </span>
        </div>
        {url && (
          <a aria-label="Kanali ac" href={url} rel="noreferrer" target="_blank">
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>

      {verification ? (
        <p className="source-verified">
          <ShieldCheck size={13} aria-hidden="true" />
          <span>
            {verification.verifiedBy} dogruladi · {formatDate(verification.verifiedAt)}
            {verification.evidenceNote ? ` · ${verification.evidenceNote}` : ''}
          </span>
          {canEdit && (
            <button
              className="link-button"
              disabled={busy || operatorMissing}
              onClick={() =>
                void submit(() =>
                  revokeChannelVerification({ dataset: datasetId, candidateId, url, actor: operator }),
                )
              }
              type="button"
            >
              Geri al
            </button>
          )}
        </p>
      ) : (
        canEdit &&
        url &&
        (open ? (
          <div className="source-verify-form">
            <input
              onChange={(event) => setNote(event.target.value)}
              placeholder="Bu kanali bu kisiye baglayan kanit nedir?"
              value={note}
            />
            <button
              className="primary-button"
              disabled={busy || operatorMissing || !note.trim()}
              onClick={() =>
                void submit(() =>
                  verifyChannel({
                    dataset: datasetId,
                    candidateId,
                    url,
                    platform: channel.platform,
                    label: channel.label,
                    evidenceNote: note,
                    actor: operator,
                  }),
                )
              }
              type="button"
            >
              <ShieldCheck size={14} aria-hidden="true" />
              Kaydet
            </button>
            <button className="link-button" onClick={() => setOpen(false)} type="button">
              Vazgec
            </button>
          </div>
        ) : (
          <button className="link-button" onClick={() => setOpen(true)} type="button">
            <ShieldCheck size={13} aria-hidden="true" />
            Kimligi dogrula
          </button>
        ))
      )}

      {errors.map((message) => (
        <p className="review-form-error" key={message}>
          {message}
        </p>
      ))}
    </article>
  );
}

function DetailSection({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="detail-section">
      <header>
        <span aria-hidden="true">{icon}</span>
        <strong>{title}</strong>
      </header>
      {children}
    </section>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <header className="panel-title">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
    </header>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="mini-stat">
      <strong>{formatNumber(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function StarPill({ dossier }: { dossier: CandidateDossier }) {
  const stars = getStars(dossier);

  return (
    <span className={`star-pill stars-${stars}`} aria-label={`${stars} star`}>
      <Star size={13} aria-hidden="true" />
      {stars}
    </span>
  );
}

function StarMeter({ dossier }: { dossier: CandidateDossier }) {
  const stars = getStars(dossier);

  return (
    <div className="star-meter" aria-label={`${stars} of 5 stars`}>
      <div>
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            className={index < stars ? 'filled' : undefined}
            key={index}
            size={15}
            aria-hidden="true"
          />
        ))}
      </div>
      <strong>{dossier.discoveryStar?.label ?? `${stars} star`}</strong>
      <span>{dossier.discoveryStar?.score ?? 0}/100</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <Database size={20} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <span className="empty-line">{text}</span>;
}

function buildStats(dossiers: CandidateDossier[], summary?: DossierSummary): DashboardStats {
  const starBuckets = summary?.discoveryStars ?? {};
  const fiveStar = Number(starBuckets.five ?? starBuckets['5'] ?? 0);
  const fourStar = Number(starBuckets.four ?? starBuckets['4'] ?? 0);

  return {
    candidates: summary?.candidates ?? dossiers.length,
    channelCandidates: summary?.channelCandidates ?? sumCounts(dossiers, 'discoveryChannels'),
    contactCandidates: summary?.contactCandidates ?? sumCounts(dossiers, 'contactCandidates'),
    publicEmailCandidates: summary?.publicEmailCandidates ?? sumCounts(dossiers, 'publicEmailCandidates'),
    contactPageCandidates: summary?.contactPageCandidates ?? sumCounts(dossiers, 'contactPageCandidates'),
    candidatesWithContact:
      summary?.candidatesWithContactCandidate ??
      dossiers.filter((dossier) => getCount(dossier, 'contactCandidates') > 0).length,
    candidatesWithEmail:
      summary?.candidatesWithPublicEmail ??
      dossiers.filter((dossier) => getCount(dossier, 'publicEmailCandidates') > 0).length,
    creatorSuggestions: summary?.creatorSuggestions ?? sumCounts(dossiers, 'creatorSuggestions'),
    sensitiveReviewRequired:
      summary?.sensitiveReviewRequired ?? dossiers.filter((dossier) => hasSensitiveFlag(dossier)).length,
    fourAndFiveStar:
      fourStar + fiveStar ||
      dossiers.filter((dossier) => getStars(dossier) >= 4).length,
    fiveStar: fiveStar || dossiers.filter((dossier) => getStars(dossier) === 5).length,
    lowOrNoStar: dossiers.filter((dossier) => getStars(dossier) <= 2).length,
  };
}

function buildCategoryOptions(dossiers: CandidateDossier[]) {
  const counts = new Map<string, number>();

  dossiers.forEach((dossier) => {
    const category = dossier.category ?? 'unknown';
    counts.set(category, (counts.get(category) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([value, count]) => ({ count, label: humanize(value), value }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function buildPlatformOptions(dossiers: CandidateDossier[]) {
  const counts = new Map<string, number>();

  dossiers.forEach((dossier) => {
    getPlatforms(dossier).forEach((platform) => {
      counts.set(platform, (counts.get(platform) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .map(([value, count]) => ({ count, label: humanize(value), value }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function normalizeCountry(dossier: CandidateDossier) {
  const country = (dossier.country ?? '').trim();

  return country.length > 0 ? country : 'Unknown';
}

/**
 * Countries sort by candidate count, not alphabetically: the point of this filter is to
 * find where a wave has enough reachable people to be worth running.
 */
function buildCountryOptions(dossiers: CandidateDossier[]) {
  const counts = new Map<string, number>();

  dossiers.forEach((dossier) => {
    const country = normalizeCountry(dossier);
    counts.set(country, (counts.get(country) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([value, count]) => ({ count, label: value, value }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function matchesQuery(dossier: CandidateDossier, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    dossier.name,
    dossier.title,
    dossier.country,
    dossier.category,
    ...(dossier.subcategories ?? []),
    ...(dossier.sensitiveFlags ?? []),
    ...(dossier.sourceUrls ?? []),
    ...getContacts(dossier).map(
      (contact) => `${contact.role ?? ''} ${contact.label ?? ''} ${contact.type ?? ''} ${contact.value ?? ''}`,
    ),
    ...(dossier.discoveryChannels ?? []).map(
      (channel) => `${channel.platform ?? ''} ${channel.label ?? ''} ${channel.url ?? ''}`,
    ),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function matchesContactFilter(dossier: CandidateDossier, filter: ContactFilter) {
  const contacts = getContacts(dossier);
  const emailCount = contacts.filter((contact) => isEmailContact(contact)).length;
  const contactPageCount = getCount(dossier, 'contactPageCandidates');

  if (filter === 'with-contact') {
    return contacts.length > 0;
  }

  if (filter === 'email') {
    return emailCount > 0;
  }

  if (filter === 'contact-page') {
    return contactPageCount > 0;
  }

  if (filter === 'no-contact') {
    return contacts.length === 0;
  }

  return true;
}

function matchesStarFilter(dossier: CandidateDossier, filter: StarFilter) {
  const stars = getStars(dossier);

  if (filter === '5') {
    return stars === 5;
  }

  if (filter === '4+') {
    return stars >= 4;
  }

  if (filter === '3+') {
    return stars >= 3;
  }

  if (filter === '0-2') {
    return stars <= 2;
  }

  return true;
}

function matchesRiskFilter(dossier: CandidateDossier, filter: RiskFilter) {
  if (filter === 'sensitive') {
    return hasSensitiveFlag(dossier);
  }

  if (filter === 'all') {
    return true;
  }

  return normalizeRisk(dossier) === filter;
}

function compareDossiers(left: CandidateDossier, right: CandidateDossier, mode: SortMode) {
  if (mode === 'name') {
    return left.name.localeCompare(right.name);
  }

  const score = (dossier: CandidateDossier) => {
    if (mode === 'emails') {
      return getCount(dossier, 'publicEmailCandidates');
    }

    if (mode === 'contacts') {
      return getCount(dossier, 'contactCandidates');
    }

    if (mode === 'platforms') {
      return getPlatforms(dossier).length;
    }

    if (mode === 'reach') {
      return dossier.reachScore ?? 0;
    }

    if (mode === 'fit') {
      return dossier.fitScore ?? 0;
    }

    return (
      getStars(dossier) * 10000 +
      getCount(dossier, 'publicEmailCandidates') * 500 +
      getCount(dossier, 'contactCandidates') * 50 +
      getPlatforms(dossier).length * 10 +
      (dossier.reachScore ?? 0)
    );
  };

  return score(right) - score(left) || right.name.localeCompare(left.name);
}

function getCount(dossier: CandidateDossier, key: keyof DossierCounts) {
  const value = dossier.counts?.[key];

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (key === 'discoveryChannels') {
    return dossier.discoveryChannels?.length ?? 0;
  }

  if (key === 'contactCandidates') {
    return dossier.contactCandidates?.length ?? 0;
  }

  if (key === 'publicEmailCandidates') {
    return getContacts(dossier).filter((contact) => isEmailContact(contact)).length;
  }

  return 0;
}

function getContacts(dossier: CandidateDossier) {
  const sortedContacts = (dossier.contactCandidates ?? [])
    .filter((contact) => (contact.value ?? '').trim().length > 0)
    .sort(compareContacts);

  const seen = new Set<string>();
  return sortedContacts.filter((contact) => {
    const key = contactDisplayKey(contact);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getStars(dossier: CandidateDossier) {
  const rawStars = dossier.discoveryStar?.stars;

  if (typeof rawStars !== 'number' || !Number.isFinite(rawStars)) {
    return 0;
  }

  return Math.max(0, Math.min(5, Math.round(rawStars)));
}

function getPlatforms(dossier: CandidateDossier) {
  return Array.from(
    new Set(
      (dossier.discoveryChannels ?? [])
        .map((channel) => (channel.platform ?? '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();
}

function getPrimaryUrl(dossier: CandidateDossier) {
  return (
    dossier.discoveryChannels?.find((channel) => channel.platform === 'website')?.url ??
    dossier.sourceUrls?.[0] ??
    dossier.discoveryChannels?.[0]?.url ??
    null
  );
}

function hasPlatform(dossier: CandidateDossier, platform: string) {
  return getPlatforms(dossier).includes(platform);
}

function hasSensitiveFlag(dossier: CandidateDossier) {
  return (dossier.sensitiveFlags ?? []).length > 0 || normalizeRisk(dossier) === 'high';
}

function isEmailContact(contact: ContactCandidate) {
  const value = contact.value ?? '';
  const type = contact.type ?? '';

  return type.includes('email') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function compareContacts(left: ContactCandidate, right: ContactCandidate) {
  return contactRank(left) - contactRank(right) || (left.value ?? '').localeCompare(right.value ?? '');
}

function contactDisplayKey(contact: ContactCandidate) {
  const value = contact.value ?? '';

  if (isEmailContact(contact)) {
    return `email|${value.toLowerCase()}`;
  }

  if (isPhoneContact(contact)) {
    return `phone|${value.replace(/\D/g, '')}`;
  }

  return `route|${normalizeContactValue(value)}`;
}

function contactRank(contact: ContactCandidate) {
  if (isPhoneContact(contact)) {
    const role = contact.role ?? '';
    if (role === 'direct-person') {
      return 4;
    }
    if (role === 'support-staff') {
      return 5;
    }
    return 6;
  }

  if (!isEmailContact(contact)) {
    return 20;
  }

  const role = contact.role ?? inferContactRole(contact.value ?? '');
  if (role === 'direct-person') {
    return 0;
  }
  if (role === 'listed-person') {
    return 1;
  }
  if (role === 'support-staff') {
    return 2;
  }
  if (role === 'generic-office') {
    return 7;
  }

  return 3;
}

function contactLabel(contact: ContactCandidate) {
  const role = contact.role ?? inferContactRole(contact.value ?? '');
  const typeLabel = (contact.type ?? 'contact').replaceAll('-', ' ');

  if (role === 'direct-person') {
    return isPhoneContact(contact) ? 'Direct public phone candidate' : 'Direct public email candidate';
  }
  if (role === 'listed-person' && isPhoneContact(contact)) {
    return contact.label ? `${contact.label} public phone candidate` : 'Listed person public phone candidate';
  }
  if (role === 'support-staff' && isPhoneContact(contact)) {
    return contact.label ? `${contact.label} support staff phone` : 'Support staff public phone candidate';
  }
  if (isPhoneContact(contact)) {
    return 'Public phone candidate';
  }

  if (role === 'listed-person') {
    return contact.label ? `${contact.label} public email candidate` : 'Listed person public email candidate';
  }
  if (role === 'support-staff') {
    return contact.label ? `${contact.label} support staff email` : 'Support staff public email candidate';
  }
  if (role === 'generic-office') {
    return 'Generic office public email candidate';
  }

  return typeLabel;
}

function inferContactRole(value: string) {
  const localPart = value.split('@')[0]?.toLowerCase() ?? '';
  const genericParts = new Set([
    'admin',
    'admissions',
    'contact',
    'events',
    'hello',
    'info',
    'media',
    'office',
    'press',
    'pr',
    'secretariat',
    'service',
    'speakers',
    'speakers_bureau',
    'studies',
    'support',
    'webmaster',
  ]);

  if (genericParts.has(localPart) || /^(contact|info|press|media|office|support|webmaster)[._-]/.test(localPart)) {
    return 'generic-office';
  }

  return 'public-email';
}

function isPhoneContact(contact: ContactCandidate) {
  return (contact.type ?? '').includes('phone');
}

function normalizeContactValue(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeRisk(dossier: CandidateDossier) {
  const risk = (dossier.riskLevel ?? '').toLowerCase();

  if (risk === 'low' || risk === 'medium' || risk === 'high') {
    return risk;
  }

  return 'unknown';
}

function sumCounts(dossiers: CandidateDossier[], key: keyof DossierCounts) {
  return dossiers.reduce((sum, dossier) => sum + getCount(dossier, key), 0);
}

function objectOptions<TValue extends string>(record: Record<TValue, string>) {
  return Object.entries(record).map(([value, label]) => ({
    label: label as string,
    value: value as TValue,
  }));
}

function currentFilters(filters: {
  categoryFilter: string;
  contactFilter: ContactFilter;
  countryFilter: string;
  platformFilter: string;
  query: string;
  riskFilter: RiskFilter;
  sortMode: SortMode;
  starFilter: StarFilter;
}) {
  return {
    query: filters.query,
    category: filters.categoryFilter,
    platform: filters.platformFilter,
    country: filters.countryFilter,
    contact: filters.contactFilter,
    stars: filters.starFilter,
    risk: filters.riskFilter,
    sort: filters.sortMode,
  };
}

function toCsv(rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(','));

  return [headers.join(','), ...body].join('\n');
}

function escapeCsv(value: string | number | undefined) {
  const text = String(value ?? '');

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function downloadFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function formatNumber(value: number | undefined) {
  return numberFormatter.format(value ?? 0);
}

function formatDate(value: string | undefined | null) {
  if (!value) {
    return 'No date';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function humanize(value: string) {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactPath(value: string | undefined) {
  if (!value) {
    return null;
  }

  return value.split('/').slice(-2).join('/');
}

export default DashboardApp;
