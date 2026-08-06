import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Database,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Globe2,
  Mail,
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import './DashboardApp.css';

type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error';
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
  const [contactFilter, setContactFilter] = useState<ContactFilter>('all');
  const [starFilter, setStarFilter] = useState<StarFilter>('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('priority');
  const [visibleRows, setVisibleRows] = useState(initialVisibleRows);
  const [copyMessage, setCopyMessage] = useState('');

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

  const filteredDossiers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return dossiers
      .filter((dossier) => matchesQuery(dossier, normalizedQuery))
      .filter((dossier) => categoryFilter === 'all' || (dossier.category ?? 'unknown') === categoryFilter)
      .filter((dossier) => platformFilter === 'all' || hasPlatform(dossier, platformFilter))
      .filter((dossier) => matchesContactFilter(dossier, contactFilter))
      .filter((dossier) => matchesStarFilter(dossier, starFilter))
      .filter((dossier) => matchesRiskFilter(dossier, riskFilter))
      .sort((left, right) => compareDossiers(left, right, sortMode));
  }, [
    categoryFilter,
    contactFilter,
    dossiers,
    platformFilter,
    query,
    riskFilter,
    sortMode,
    starFilter,
  ]);

  const visibleDossiers = filteredDossiers.slice(0, visibleRows);
  const selectedDossier =
    filteredDossiers.find((dossier) => dossier.candidateId === selectedCandidateId) ??
    visibleDossiers[0] ??
    dossiers[0] ??
    null;

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
            <button className="secondary-button" onClick={exportCsv} type="button">
              <Download size={17} aria-hidden="true" />
              CSV
            </button>
            <button className="secondary-button" onClick={exportJson} type="button">
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

            {visibleDossiers.length === 0 ? (
              <EmptyState message="Bu filtrelerde aday bulunamadi." />
            ) : (
              <div className="candidate-list">
                {visibleDossiers.map((dossier) => (
                  <CandidateRow
                    dossier={dossier}
                    isSelected={dossier.candidateId === selectedDossier?.candidateId}
                    key={dossier.candidateId}
                    onSelect={() => setSelectedCandidateId(dossier.candidateId)}
                  />
                ))}
              </div>
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
            copyMessage={copyMessage}
            dossier={selectedDossier}
            onCopyContacts={copySelectedContacts}
          />
        </section>
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
  isSelected,
  onSelect,
}: {
  dossier: CandidateDossier;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const contacts = getContacts(dossier);
  const emailCount = contacts.filter((contact) => isEmailContact(contact)).length;
  const platforms = getPlatforms(dossier).slice(0, 5);

  return (
    <article className={isSelected ? 'candidate-row selected' : 'candidate-row'}>
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
  copyMessage,
  dossier,
  onCopyContacts,
}: {
  copyMessage: string;
  dossier: CandidateDossier | null;
  onCopyContacts: () => void;
}) {
  if (!dossier) {
    return (
      <aside className="detail-panel" aria-label="Candidate details">
        <EmptyState message="Aday secilmedi." />
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
            <SourceItem channel={channel} key={`${channel.url}-${channel.platform}-${index}`} />
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

function SourceItem({ channel }: { channel: DiscoveryChannel }) {
  const url = channel.url ?? '';

  if (!url) {
    return (
      <article className="source-item">
        <div>
          <strong>{channel.label ?? channel.platform ?? 'Source'}</strong>
          <span>{channel.platform ?? 'unknown'}</span>
        </div>
      </article>
    );
  }

  return (
    <a className="source-item link" href={url} rel="noreferrer" target="_blank">
      <div>
        <strong>{channel.label ?? channel.platform ?? 'Source'}</strong>
        <span>
          {channel.platform ?? 'unknown'} · {channel.confidence ?? 'unknown'}
        </span>
      </div>
      <ExternalLink size={14} aria-hidden="true" />
    </a>
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
