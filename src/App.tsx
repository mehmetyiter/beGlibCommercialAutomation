import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Globe2,
  Inbox,
  LockKeyhole,
  Mail,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  UploadCloud,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './App.css';
import { candidates } from './data/candidates';
import { faqItems } from './data/faq';
import { replyExamples } from './data/replies';
import { taxonomy } from './data/taxonomy';
import { assessCandidate } from './lib/compliance';
import {
  appendAuditEvent,
  createAuditEvent,
  importResearchBatch,
  loadVaultState,
  resetVaultState,
  validateResearchBatch,
} from './lib/localVault';
import { getTemplateForCandidate, renderOutreachDraft } from './lib/outreach';
import { assessStarRating } from './lib/starRating';
import { buildVerificationTasks, createCandidateTasks } from './lib/verificationQueue';
import type {
  AuditEvent,
  Candidate,
  CandidateCategory,
  CandidateStatus,
  ComplianceAssessment,
  ReplyExample,
  RiskLevel,
  StarAssessment,
  VerificationTask,
} from './types';

type AssessedCandidate = Candidate & {
  assessment: ComplianceAssessment;
  starAssessment: StarAssessment;
};

const statusLabels: Record<CandidateStatus, string> = {
  researching: 'Researching',
  'needs-review': 'Needs review',
  approved: 'Approved',
  contacted: 'Contacted',
  responded: 'Responded',
  'do-not-contact': 'Do not contact',
};

const riskLabels: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const replyClassLabels: Record<ReplyExample['replyClass'], string> = {
  interested: 'Interested',
  'more-info': 'More info',
  compensation: 'Compensation',
  rights: 'Rights',
  privacy: 'Privacy',
  meeting: 'Meeting',
  representative: 'Representative',
  'not-interested': 'Not interested',
  unsubscribe: 'Unsubscribe',
  complaint: 'Complaint',
};

const tabs = ['Command', 'Discovery', 'Outreach', 'AI replies', 'Governance'];

function App() {
  const [vaultState, setVaultState] = useState(() => loadVaultState(candidates));
  const [selectedCategory, setSelectedCategory] = useState<CandidateCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState(() =>
    getDefaultSelectedCandidateId(vaultState.candidates),
  );
  const [vaultMessage, setVaultMessage] = useState('Local vault ready.');

  const assessedCandidates = useMemo<AssessedCandidate[]>(
    () =>
      vaultState.candidates.map((candidate) => ({
        ...candidate,
        assessment: assessCandidate(candidate),
        starAssessment: assessStarRating(candidate),
      })),
    [vaultState.candidates],
  );

  const filteredCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return assessedCandidates
      .filter((candidate) => {
        const matchesCategory =
          selectedCategory === 'all' || candidate.primaryCategory === selectedCategory;
        const matchesQuery =
          normalizedQuery.length === 0 ||
          [
            candidate.name,
            candidate.title,
            candidate.country,
            candidate.primaryCategory,
            candidate.subcategories.join(' '),
            candidate.languages.join(' '),
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery);

        return matchesCategory && matchesQuery;
      })
      .sort(
        (left, right) =>
          right.starAssessment.stars - left.starAssessment.stars ||
          right.fitScore - left.fitScore ||
          right.reachScore - left.reachScore,
      );
  }, [assessedCandidates, query, selectedCategory]);

  const selectedCandidate =
    assessedCandidates.find((candidate) => candidate.id === selectedCandidateId) ??
    filteredCandidates[0] ??
    assessedCandidates[0];

  const selectedTemplate = getTemplateForCandidate(selectedCandidate);
  const selectedDraft = renderOutreachDraft(selectedCandidate, selectedTemplate);
  const candidateReplies = replyExamples.filter(
    (reply) => reply.candidateId === selectedCandidate.id,
  );
  const verificationTasks = useMemo(
    () => buildVerificationTasks(vaultState.candidates),
    [vaultState.candidates],
  );
  const selectedVerificationTasks = useMemo(
    () => createCandidateTasks(selectedCandidate),
    [selectedCandidate],
  );

  const stats = useMemo(() => {
    const ready = assessedCandidates.filter((candidate) => candidate.assessment.label === 'Ready');
    const review = assessedCandidates.filter(
      (candidate) => candidate.assessment.label === 'Review first',
    );
    const blocked = assessedCandidates.filter(
      (candidate) => candidate.assessment.label === 'Blocked',
    );
    const publicRoutes = assessedCandidates.filter((candidate) =>
      candidate.contactRoutes.some((route) =>
        ['public-business-email', 'representative-email'].includes(route.type),
      ),
    );
    const topTier = assessedCandidates.filter((candidate) => candidate.starAssessment.stars >= 4);

    return {
      total: assessedCandidates.length,
      ready: ready.length,
      review: review.length,
      blocked: blocked.length,
      publicRoutes: publicRoutes.length,
      topTier: topTier.length,
      aiQueue: replyExamples.length,
      verificationQueue: verificationTasks.length,
      avgFit: Math.round(
        assessedCandidates.reduce((sum, candidate) => sum + candidate.fitScore, 0) /
          assessedCandidates.length,
      ),
    };
  }, [assessedCandidates, verificationTasks.length]);

  const categoryCoverage = useMemo(
    () =>
      taxonomy.map((node) => ({
        ...node,
        count: assessedCandidates.filter((candidate) => candidate.primaryCategory === node.slug)
          .length,
      })),
    [assessedCandidates],
  );

  function handleCandidateSelect(candidate: AssessedCandidate) {
    setSelectedCandidateId(candidate.id);
    setVaultState((currentState) =>
      appendAuditEvent(
        currentState,
        createAuditEvent('candidate_selected', `Selected ${candidate.name} for review.`, {
          candidateId: candidate.id,
        }),
      ),
    );
  }

  async function handleImportBatch(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const validation = validateResearchBatch(parsed);

      if (!validation.ok || !validation.batch) {
        setVaultMessage(`Import blocked: ${validation.errors.join(' ')}`);
        setVaultState((currentState) =>
          appendAuditEvent(
            currentState,
            createAuditEvent('validation_failed', 'Research batch validation failed.', {
              errors: validation.errors.length,
              file: file.name,
            }),
          ),
        );
        return;
      }

      const result = importResearchBatch(vaultState, validation.batch);
      setVaultState(result.state);
      setSelectedCandidateId(validation.batch.candidates[0]?.id ?? selectedCandidateId);
      setVaultMessage(
        `Imported ${result.imported} new and replaced ${result.replaced} candidate records.`,
      );
    } catch (error) {
      setVaultMessage(error instanceof Error ? error.message : 'Import failed.');
    }
  }

  function handleResetVault() {
    const resetState = resetVaultState(candidates);
    setVaultState(resetState);
    setSelectedCandidateId(getDefaultSelectedCandidateId(resetState.candidates));
    setVaultMessage('Local vault reset to synthetic demo candidates.');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            bG
          </div>
          <div>
            <p className="eyebrow">beGlib</p>
            <h1>Host Intelligence</h1>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Primary">
          {tabs.map((tab, index) => (
            <button className={index === 0 ? 'nav-item active' : 'nav-item'} key={tab} type="button">
              {index === 0 && <BarChart3 size={18} aria-hidden="true" />}
              {index === 1 && <Database size={18} aria-hidden="true" />}
              {index === 2 && <Mail size={18} aria-hidden="true" />}
              {index === 3 && <Bot size={18} aria-hidden="true" />}
              {index === 4 && <LockKeyhole size={18} aria-hidden="true" />}
              <span>{tab}</span>
            </button>
          ))}
        </nav>

        <div className="privacy-panel">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>Public repo mode</strong>
            <span>Code only. Lead data stays local or encrypted.</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <section className="topbar" aria-label="Workspace summary">
          <div>
            <p className="eyebrow">Sprint 3 cockpit</p>
            <h2>Local candidate vault, approval gates, and AI reply triage</h2>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" aria-label="Review inbox">
              <Inbox size={19} aria-hidden="true" />
            </button>
            <label className="secondary-action">
              <UploadCloud size={18} aria-hidden="true" />
              Import batch
              <input
                accept="application/json"
                aria-label="Import research batch JSON"
                onChange={(event) => {
                  void handleImportBatch(event.target.files?.[0]);
                  event.target.value = '';
                }}
                type="file"
              />
            </label>
            <button className="secondary-action" onClick={handleResetVault} type="button">
              <RotateCcw size={18} aria-hidden="true" />
              Reset demo
            </button>
            <button className="primary-action" type="button">
              <ClipboardCheck size={18} aria-hidden="true" />
              Stage wave
            </button>
          </div>
        </section>

        <section className="metric-grid" aria-label="Pipeline metrics">
          <Metric icon={<Users size={20} />} label="Candidates" value={stats.total.toString()} />
          <Metric icon={<CheckCircle2 size={20} />} label="Ready" value={stats.ready.toString()} />
          <Metric icon={<AlertTriangle size={20} />} label="Review" value={stats.review.toString()} />
          <Metric icon={<XCircle size={20} />} label="Blocked" value={stats.blocked.toString()} />
          <Metric icon={<Star size={20} />} label="4-5 star" value={stats.topTier.toString()} />
          <Metric icon={<ShieldCheck size={20} />} label="Verify" value={stats.verificationQueue.toString()} />
        </section>

        <section className="vault-band" aria-label="Local vault status">
          <div>
            <Database size={18} aria-hidden="true" />
            <strong>{vaultState.candidates.length} local records</strong>
            <span>{vaultMessage}</span>
          </div>
          <small>Updated {new Date(vaultState.updatedAt).toLocaleString()}</small>
        </section>

        <section className="control-band" aria-label="Candidate filters">
          <div className="search-box">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Search candidates"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people, topics, countries"
              type="search"
              value={query}
            />
          </div>

          <label className="select-box">
            <Filter size={18} aria-hidden="true" />
            <select
              aria-label="Filter by category"
              onChange={(event) =>
                setSelectedCategory(event.target.value as CandidateCategory | 'all')
              }
              value={selectedCategory}
            >
              <option value="all">All categories</option>
              {taxonomy.map((node) => (
                <option key={node.slug} value={node.slug}>
                  {node.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="content-grid">
          <div className="candidate-area">
            <SectionHeader
              eyebrow="Discovery"
              title={`${filteredCandidates.length} candidates in working set`}
              trailing={`${stats.topTier} strong candidates`}
            />
            <div className="candidate-list">
              {filteredCandidates.map((candidate) => (
                <CandidateRow
                  candidate={candidate}
                  isSelected={candidate.id === selectedCandidate.id}
                  key={candidate.id}
                  onSelect={() => handleCandidateSelect(candidate)}
                />
              ))}
            </div>
          </div>

          <aside className="detail-rail" aria-label="Selected candidate dossier">
            <CandidateDossier
              auditEvents={vaultState.auditEvents}
              candidate={selectedCandidate}
              draft={selectedDraft}
              replies={candidateReplies}
              templateName={selectedTemplate.name}
              templateSubject={selectedTemplate.subject}
              verificationTasks={selectedVerificationTasks}
            />

            <SectionHeader eyebrow="Taxonomy" title="Coverage map" />
            <div className="taxonomy-list">
              {categoryCoverage.map((node) => (
                <button
                  className={selectedCategory === node.slug ? 'taxonomy-item active' : 'taxonomy-item'}
                  key={node.slug}
                  onClick={() => setSelectedCategory(node.slug)}
                  type="button"
                >
                  <span>
                    <strong>{node.label}</strong>
                    <small>{node.subcategories.slice(0, 3).join(', ')}</small>
                  </span>
                  <b>{node.count}</b>
                </button>
              ))}
            </div>
          </aside>
        </section>

        <section className="lower-grid" aria-label="AI and outreach operations">
          <div>
            <SectionHeader eyebrow="Verification" title="Official source queue" />
            <div className="verification-list">
              {verificationTasks.slice(0, 8).map((task) => (
                <VerificationCard key={task.id} task={task} />
              ))}
            </div>
          </div>

          <div>
            <SectionHeader eyebrow="AI desk" title="Reply triage queue" />
            <div className="reply-grid">
              {replyExamples.map((reply) => (
                <ReplyCard key={reply.id} reply={reply} />
              ))}
            </div>
          </div>

          <div>
            <SectionHeader eyebrow="FAQ" title="Approved answer inventory" />
            <div className="faq-list wide">
              {faqItems.map((item) => (
                <article className="faq-item" key={item.id}>
                  <div>
                    <strong>{item.topic}</strong>
                    <span className={`owner-badge ${item.owner}`}>{item.owner.replace('-', ' ')}</span>
                  </div>
                  <p>{item.likelyQuestion}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <article className="metric-tile">
      <span aria-hidden="true">{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

function SectionHeader({
  eyebrow,
  title,
  trailing,
}: {
  eyebrow: string;
  title: string;
  trailing?: string;
}) {
  return (
    <header className="section-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      {trailing && <span>{trailing}</span>}
    </header>
  );
}

function CandidateRow({
  candidate,
  isSelected,
  onSelect,
}: {
  candidate: AssessedCandidate;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const primaryRoute = candidate.contactRoutes[0];
  const verifiedChannels = candidate.channels.filter((channel) => channel.verified).length;

  return (
    <article className={isSelected ? 'candidate-row selected' : 'candidate-row'}>
      <button className="candidate-select" onClick={onSelect} type="button">
        <div className="candidate-main">
          <div className="candidate-title-row">
            <div>
              <h4>{candidate.name}</h4>
              <p>{candidate.title}</p>
            </div>
            <div className="candidate-badges">
              <StarBadge assessment={candidate.starAssessment} />
              <span className={`assessment-badge ${candidate.assessment.severity}`}>
                {candidate.assessment.label}
              </span>
            </div>
          </div>

          <div className="tag-row" aria-label="Candidate tags">
            <span>{candidate.country}</span>
            <span>{candidate.languages.join(', ')}</span>
            <span>{statusLabels[candidate.status]}</span>
            <span>{riskLabels[candidate.riskLevel]} risk</span>
          </div>

          <p className="rationale">{candidate.rationale}</p>

          <div className="channel-row" aria-label="Verified channels">
            <span>
              {verifiedChannels}/{candidate.channels.length} verified channels
            </span>
            <span>{primaryRoute.type.replaceAll('-', ' ')}</span>
            <span>{candidate.starAssessment.label}</span>
          </div>
        </div>

        <div className="candidate-side">
          <ScoreRing label="Fit" value={candidate.fitScore} />
          <ScoreRing label="Reach" value={candidate.reachScore} />
          <div className="route-box">
            <small>Contact route</small>
            <strong>{primaryRoute.type.replaceAll('-', ' ')}</strong>
            <span>{primaryRoute.value}</span>
          </div>
        </div>
      </button>

      <div className="compliance-strip">
        {candidate.assessment.blockers.length > 0 ? (
          candidate.assessment.blockers.map((blocker) => <span key={blocker}>{blocker}</span>)
        ) : (
          <span>No blocking compliance issue detected.</span>
        )}
        {candidate.assessment.requiredActions.slice(0, 2).map((action) => (
          <span key={action}>{action}</span>
        ))}
      </div>
    </article>
  );
}

function CandidateDossier({
  auditEvents,
  candidate,
  draft,
  replies,
  templateName,
  templateSubject,
  verificationTasks,
}: {
  auditEvents: AuditEvent[];
  candidate: AssessedCandidate;
  draft: string;
  replies: ReplyExample[];
  templateName: string;
  templateSubject: string;
  verificationTasks: VerificationTask[];
}) {
  const canStage = candidate.assessment.sendable && candidate.assessment.severity !== 'high';

  return (
    <div className="dossier">
      <SectionHeader eyebrow="Dossier" title={candidate.name} trailing={candidate.country} />

      <div className="dossier-summary">
        <div>
          <strong>{candidate.title}</strong>
          <span>{candidate.subcategories.join(', ')}</span>
        </div>
        <span className={`assessment-badge ${candidate.assessment.severity}`}>
          {candidate.assessment.label}
        </span>
      </div>

      <div className="decision-grid">
        <DecisionTile
          icon={<ShieldCheck size={17} />}
          label="Compliance"
          value={candidate.assessment.sendable ? 'Pass' : 'Hold'}
        />
        <DecisionTile
          icon={<Star size={17} />}
          label="Strength"
          value={`${candidate.starAssessment.stars} stars`}
        />
        <DecisionTile icon={<UserCheck size={17} />} label="Status" value={statusLabels[candidate.status]} />
      </div>

      <PanelBlock icon={<Star size={17} />} title="Star signals">
        <StarScale assessment={candidate.starAssessment} />
        <div className="gate-list">
          {candidate.starAssessment.reasons.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
          {candidate.starAssessment.missingSignals.map((signal) => (
            <span className="missing" key={signal}>
              {signal}
            </span>
          ))}
        </div>
      </PanelBlock>

      <div className={canStage ? 'stage-box ready' : 'stage-box hold'}>
        <strong>{canStage ? 'Ready for human approval' : 'Do not stage yet'}</strong>
        <span>
          {canStage
            ? 'Draft can enter the approval queue after final review.'
            : 'Resolve blockers before any outreach action.'}
        </span>
      </div>

      <PanelBlock icon={<ShieldAlert size={17} />} title="Compliance gates">
        <div className="gate-list">
          {candidate.assessment.blockers.length === 0 && <span>No active blocker.</span>}
          {candidate.assessment.blockers.map((blocker) => (
            <span className="blocked" key={blocker}>
              {blocker}
            </span>
          ))}
          {candidate.assessment.requiredActions.map((action) => (
            <span key={action}>{action}</span>
          ))}
        </div>
      </PanelBlock>

      <PanelBlock icon={<ShieldCheck size={17} />} title="Verification tasks">
        <div className="mini-task-list">
          {verificationTasks.length === 0 && <span>No verification task open.</span>}
          {verificationTasks.slice(0, 4).map((task) => (
            <span className={`priority-${task.priority}`} key={task.id}>
              {task.summary}
            </span>
          ))}
        </div>
      </PanelBlock>

      <PanelBlock icon={<FileText size={17} />} title="Outreach draft">
        <div className="draft-meta">
          <span>{templateName}</span>
          <strong>{templateSubject}</strong>
        </div>
        <pre className="draft-preview">{draft}</pre>
      </PanelBlock>

      <PanelBlock icon={<Globe2 size={17} />} title="Source evidence">
        <div className="source-list">
          {candidate.channels.map((channel) => (
            <a href={channel.url} key={`${candidate.id}-${channel.platform}`} target="_blank">
              <span>{channel.label}</span>
              <small>{channel.verified ? 'verified' : 'needs check'}</small>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
        </div>
      </PanelBlock>

      <PanelBlock icon={<Sparkles size={17} />} title="Candidate replies">
        <div className="mini-replies">
          {replies.length === 0 && <span>No reply examples connected to this candidate.</span>}
          {replies.map((reply) => (
            <span key={reply.id}>{replyClassLabels[reply.replyClass]}</span>
          ))}
        </div>
      </PanelBlock>

      <PanelBlock icon={<Database size={17} />} title="Audit trail">
        <div className="audit-list">
          {auditEvents.slice(0, 5).map((event) => (
            <article key={event.id}>
              <strong>{event.summary}</strong>
              <span>{new Date(event.createdAt).toLocaleString()}</span>
            </article>
          ))}
        </div>
      </PanelBlock>
    </div>
  );
}

function StarBadge({ assessment }: { assessment: StarAssessment }) {
  return (
    <span className={`star-badge stars-${assessment.stars}`} aria-label={`${assessment.stars} star candidate`}>
      <Star size={13} aria-hidden="true" />
      {assessment.stars}
    </span>
  );
}

function StarScale({ assessment }: { assessment: StarAssessment }) {
  return (
    <div className="star-scale" aria-label={`${assessment.stars} out of 5 stars`}>
      <div>
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            aria-hidden="true"
            className={index < assessment.stars ? 'filled' : undefined}
            key={index}
            size={17}
          />
        ))}
      </div>
      <strong>{assessment.label}</strong>
      <span>{assessment.score}/100</span>
    </div>
  );
}

function DecisionTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="decision-tile">
      <span aria-hidden="true">{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function PanelBlock({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="panel-block">
      <header>
        <span aria-hidden="true">{icon}</span>
        <strong>{title}</strong>
      </header>
      {children}
    </section>
  );
}

function ReplyCard({ reply }: { reply: ReplyExample }) {
  return (
    <article className="reply-card">
      <div className="reply-card-top">
        <span className={`owner-badge ${reply.recommendedOwner}`}>
          {reply.recommendedOwner.replace('-', ' ')}
        </span>
        <strong>{reply.confidence}%</strong>
      </div>
      <h4>{replyClassLabels[reply.replyClass]}</h4>
      <p>{reply.excerpt}</p>
      <small>{reply.recommendedAction}</small>
    </article>
  );
}

function VerificationCard({ task }: { task: VerificationTask }) {
  return (
    <article className={`verification-card priority-${task.priority}`}>
      <div>
        <strong>{task.candidateName}</strong>
        <span>{task.priority}</span>
      </div>
      <p>{task.summary}</p>
      <small>{task.type.replaceAll('-', ' ')}</small>
    </article>
  );
}

function ScoreRing({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="score-ring"
      style={{ '--score': `${value * 3.6}deg` } as CSSProperties}
      aria-label={`${label} score ${value}`}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function getDefaultSelectedCandidateId(candidateList: Candidate[]) {
  return (
    [...candidateList].sort(
      (left, right) =>
        assessStarRating(right).stars - assessStarRating(left).stars ||
        right.fitScore - left.fitScore ||
        right.reachScore - left.reachScore,
    )[0]?.id ?? ''
  );
}

export default App;
