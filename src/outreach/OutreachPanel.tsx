import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Stamp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  OutreachApiError,
  addSuppression,
  drainQueue,
  fetchCandidateContext,
  fetchOutreachConfig,
  fetchPreview,
  fetchTemplates,
  recordApproval,
  recordVerification,
  retryFailed,
  stageMessage,
} from './api';
import './outreach.css';
import type {
  CandidateContext,
  OutreachConfig,
  OutreachStatus,
  PreviewResult,
  TemplateSummary,
} from './types';

// Only the operator's own reference is cached locally. Candidate data, message bodies,
// and the server token never touch browser storage.
const OPERATOR_STORAGE_KEY = 'beglib.outreach.operator';

const VERIFICATION_METHODS = [
  { value: 'official-site-contact-page', label: 'Resmi site iletisim sayfasi' },
  { value: 'official-site-imprint', label: 'Resmi site kunye/imprint' },
  { value: 'institution-directory', label: 'Kurum rehberi' },
  { value: 'press-or-media-kit', label: 'Basin/medya kiti' },
  { value: 'public-booking-page', label: 'Halka acik booking sayfasi' },
  { value: 'public-profile-listing', label: 'Halka acik profil listesi' },
];

const SUPPRESSION_REASONS = [
  { value: 'opt-out-request', label: 'Opt-out talebi' },
  { value: 'deletion-request', label: 'Silme talebi' },
  { value: 'complaint', label: 'Sikayet' },
  { value: 'do-not-contact', label: 'Iletisime gecilmeyecek' },
  { value: 'manual-review', label: 'Manuel inceleme' },
];

const modeLabels: Record<string, string> = {
  off: 'KAPALI',
  dry_run: 'DENEME',
  live: 'CANLI',
};

function defaultFreshUntil() {
  const date = new Date();
  date.setDate(date.getDate() + 60);
  return date.toISOString().slice(0, 10);
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function toErrors(error: unknown) {
  return error instanceof OutreachApiError ? error.errors : [(error as Error).message];
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

interface OutreachPanelProps {
  datasetId: string;
  candidateId: string;
  candidateName: string;
}

function OutreachPanel({ datasetId, candidateId, candidateName }: OutreachPanelProps) {
  const [config, setConfig] = useState<OutreachConfig | null>(null);
  const [status, setStatus] = useState<OutreachStatus | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [context, setContext] = useState<CandidateContext | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const [emailChoice, setEmailChoice] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [operator, setOperator] = useState(() => localStorage.getItem(OPERATOR_STORAGE_KEY) ?? '');

  const [verificationForm, setVerificationForm] = useState({
    sourceUrl: '',
    verificationMethod: VERIFICATION_METHODS[0].value,
    verificationFreshUntil: defaultFreshUntil(),
    evidenceNote: '',
  });
  const [approvalForm, setApprovalForm] = useState({
    note: '',
    sensitiveCategoryApprovedBy: '',
    seniorApprovalRef: '',
  });
  const [suppressionReason, setSuppressionReason] = useState(SUPPRESSION_REASONS[0].value);
  const [confirmLive, setConfirmLive] = useState(false);

  const [busy, setBusy] = useState<string>('');
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');

  // Bumped after any mutation to re-run the loader effects against fresh server state.
  const [reloadToken, setReloadToken] = useState(0);

  const canUseServer = Boolean(datasetId) && datasetId !== 'manual-import';

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setErrors([]);
    setNotice('');

    try {
      await action();
      setReloadToken((current) => current + 1);
    } catch (error) {
      setErrors(toErrors(error));
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [configResult, templateResult] = await Promise.all([fetchOutreachConfig(), fetchTemplates()]);

        if (cancelled) {
          return;
        }

        setConfig(configResult.config);
        setStatus(configResult.status);
        setTemplates(templateResult.templates);
      } catch (error) {
        if (!cancelled) {
          setErrors(toErrors(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!canUseServer || !candidateId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const result = await fetchCandidateContext(datasetId, candidateId);

        if (!cancelled) {
          setContext(result);
        }
      } catch (error) {
        if (!cancelled) {
          setErrors(toErrors(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canUseServer, candidateId, datasetId, reloadToken]);

  // Derived rather than stored: the active verification is the authoritative route, so it
  // wins until the operator explicitly picks a different discovery suggestion. The parent
  // remounts this panel per candidate, so `emailChoice` never leaks across candidates.
  const selectedEmail =
    emailChoice ||
    context?.verifications.find((verification) => !verification.revokedAt)?.email ||
    context?.emailCandidates[0]?.email ||
    '';

  useEffect(() => {
    if (!canUseServer || !candidateId || !selectedEmail) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const result = await fetchPreview({
          dataset: datasetId,
          candidateId,
          email: selectedEmail,
          templateId: templateId || undefined,
        });

        if (!cancelled) {
          setPreview(result);
        }
      } catch (error) {
        if (!cancelled) {
          setErrors(toErrors(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canUseServer, candidateId, datasetId, selectedEmail, templateId, reloadToken]);

  function updateOperator(value: string) {
    setOperator(value);
    localStorage.setItem(OPERATOR_STORAGE_KEY, value);
  }

  const activeVerification = useMemo(
    () => context?.verifications.find((verification) => !verification.revokedAt && verification.email === selectedEmail),
    [context, selectedEmail],
  );

  const selectedSuggestion = useMemo(
    () => context?.emailCandidates.find((candidate) => candidate.email === selectedEmail),
    [context, selectedEmail],
  );

  const normalizedManualEmail = manualEmail.trim().toLowerCase();

  function applyManualEmail() {
    setEmailChoice(normalizedManualEmail);
    setNotice('Adres secildi. Kaynak URL ve kanit notunu doldurup rotayi dogrulayin.');
  }

  function handleVerify() {
    void run('verify', async () => {
      await recordVerification({
        dataset: datasetId,
        candidateId,
        email: selectedEmail,
        sourceUrl: verificationForm.sourceUrl || selectedSuggestion?.sourceUrl || '',
        verificationMethod: verificationForm.verificationMethod,
        verificationFreshUntil: new Date(`${verificationForm.verificationFreshUntil}T12:00:00Z`).toISOString(),
        reviewerRef: operator,
        evidenceNote: verificationForm.evidenceNote,
      });

      setNotice('Iletisim rotasi dogrulandi.');
    });
  }

  function handleApprove() {
    void run('approve', async () => {
      if (!preview) {
        return;
      }

      await recordApproval({
        dataset: datasetId,
        candidateId,
        email: selectedEmail,
        templateId: preview.message.templateId,
        bodyHash: preview.message.bodyHash,
        approvedBy: operator,
        note: approvalForm.note,
        sensitiveCategoryApprovedBy: approvalForm.sensitiveCategoryApprovedBy || undefined,
        seniorApprovalRef: approvalForm.seniorApprovalRef || undefined,
      });

      setNotice('Mesaj onaylandi. Metni degistirirseniz onay gecersiz olur.');
    });
  }

  function handleStage() {
    void run('stage', async () => {
      if (!preview) {
        return;
      }

      await stageMessage({
        dataset: datasetId,
        candidateId,
        email: selectedEmail,
        templateId: preview.message.templateId,
        actor: operator,
      });

      setNotice('Mesaj kuyruga alindi.');
    });
  }

  function handleSend() {
    void run('send', async () => {
      const result = await drainQueue({ confirmLive });

      setStatus(result.status);
      setNotice(
        `${result.processed} mesaj islendi: ${result.results.map((entry) => entry.outcome).join(', ') || 'kuyruk bos'}.`,
      );
      setConfirmLive(false);
    });
  }

  function handleRetry(messageId: string) {
    void run('retry', async () => {
      const result = await retryFailed({ id: messageId, actor: operator });
      const blocked = result.results.filter((entry) => entry.outcome !== 'requeued');

      setNotice(
        blocked.length > 0
          ? `Tekrar deneme engellendi: ${blocked[0].reasons?.join('; ')}`
          : 'Mesaj yeniden kuyruga alindi. "Kuyrugu isle" ile gonderin.',
      );
    });
  }

  function handleSuppress() {
    void run('suppress', async () => {
      await addSuppression({
        kind: 'email',
        value: selectedEmail,
        reason: suppressionReason,
        actor: operator,
        candidateId,
      });

      setNotice(`${selectedEmail} suppression listesine eklendi.`);
    });
  }

  if (!canUseServer) {
    return (
      <div className="outreach-empty">
        <ShieldAlert size={20} aria-hidden="true" />
        <span>
          Outreach sadece <code>exports/</code> altindaki bir dossier dataset'i icin calisir. Manuel import edilen
          paketlerde gonderim yapilamaz.
        </span>
      </div>
    );
  }

  const mode = config?.mode ?? 'off';
  const operatorMissing = operator.trim().length === 0;

  return (
    <div className="outreach-panel">
      <ModeBanner
        busy={busy}
        config={config}
        onRefresh={() => setReloadToken((current) => current + 1)}
        status={status}
      />

      {errors.length > 0 && (
        <div className="outreach-alert error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            {errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        </div>
      )}

      {notice && (
        <div className="outreach-alert success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      <Step index={1} title="Operator kimligi">
        <label className="outreach-field">
          <span>Sizin referansiniz (her kayda islenir)</span>
          <input
            onChange={(event) => updateOperator(event.target.value)}
            placeholder="reviewer:mehmet"
            value={operator}
          />
        </label>
        {operatorMissing && <p className="outreach-hint warn">Dogrulama, onay ve gonderim icin bu alan zorunlu.</p>}
      </Step>

      <Step index={2} title="Iletisim rotasi dogrulama">
        <p className="outreach-hint">
          Kesif kayitlari <strong>oneridir</strong>. Kaynak sayfayi acip adresi gordugunuzde asagidaki formu doldurun.
        </p>

        {(context?.emailCandidates.length ?? 0) === 0 ? (
          <p className="outreach-hint warn">
            Bu aday icin public e-posta onerisi yok. Kaynagi elinizle bulduysaniz adresi asagiya girin.
          </p>
        ) : (
          <div className="outreach-radio-list">
            {context?.emailCandidates.map((candidate) => {
              const verified = context.verifications.some(
                (verification) => !verification.revokedAt && verification.email === candidate.email,
              );

              return (
                <label className="outreach-radio" key={candidate.email}>
                  <input
                    checked={selectedEmail === candidate.email}
                    name="outreach-email"
                    onChange={() => setEmailChoice(candidate.email)}
                    type="radio"
                  />
                  <span>
                    <strong>{candidate.email}</strong>
                    <small>
                      {candidate.role ?? candidate.type ?? 'contact'}
                      {candidate.sourceUrl ? ` · ${candidate.sourceUrl}` : ''}
                    </small>
                  </span>
                  {verified && (
                    <em className="outreach-tag ok">
                      <ShieldCheck size={12} aria-hidden="true" /> dogrulandi
                    </em>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {/*
          The discovery pass finds nothing for a large share of the pool, and an operator who
          has just read an address off the official page needs somewhere to put it. This is
          not a bypass: a hand-typed address goes through the same verification gate below,
          with the same required source URL, method, and evidence note.
        */}
        <div className="outreach-manual-email">
          <label className="outreach-field wide">
            <span>Elle e-posta girisi (kaynak sayfada gordugunuz adres)</span>
            <input
              onChange={(event) => setManualEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && looksLikeEmail(manualEmail)) {
                  event.preventDefault();
                  applyManualEmail();
                }
              }}
              placeholder="ad.soyad@kurum.edu"
              type="email"
              value={manualEmail}
            />
          </label>
          <button
            className="outreach-button"
            disabled={!looksLikeEmail(manualEmail) || normalizedManualEmail === selectedEmail}
            onClick={applyManualEmail}
            type="button"
          >
            <Mail size={15} aria-hidden="true" />
            Bu adresi kullan
          </button>
        </div>

        {emailChoice && !selectedSuggestion && (
          <p className="outreach-hint">
            Secili adres <strong>{selectedEmail}</strong> — elle girildi, dogrulama formu bu adres icin acik.
          </p>
        )}

        {activeVerification ? (
          <div className="outreach-callout ok">
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <strong>{activeVerification.email} dogrulanmis rota.</strong>
              <span>
                {activeVerification.verificationMethod} · {activeVerification.reviewerRef} · gecerlilik{' '}
                {formatDate(activeVerification.verificationFreshUntil)}
              </span>
            </div>
          </div>
        ) : (
          selectedEmail && (
            <div className="outreach-form-grid">
              <label className="outreach-field wide">
                <span>Kaynak URL (adresin yayinlandigi sayfa)</span>
                <input
                  onChange={(event) => setVerificationForm((form) => ({ ...form, sourceUrl: event.target.value }))}
                  placeholder={selectedSuggestion?.sourceUrl ?? 'https://...'}
                  value={verificationForm.sourceUrl}
                />
              </label>
              <label className="outreach-field">
                <span>Dogrulama yontemi</span>
                <select
                  onChange={(event) =>
                    setVerificationForm((form) => ({ ...form, verificationMethod: event.target.value }))
                  }
                  value={verificationForm.verificationMethod}
                >
                  {VERIFICATION_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="outreach-field">
                <span>Gecerlilik bitisi</span>
                <input
                  onChange={(event) =>
                    setVerificationForm((form) => ({ ...form, verificationFreshUntil: event.target.value }))
                  }
                  type="date"
                  value={verificationForm.verificationFreshUntil}
                />
              </label>
              <label className="outreach-field wide">
                <span>Kanit notu (sayfada ne gordunuz?)</span>
                <textarea
                  onChange={(event) => setVerificationForm((form) => ({ ...form, evidenceNote: event.target.value }))}
                  rows={2}
                  value={verificationForm.evidenceNote}
                />
              </label>
              <button
                className="outreach-button primary"
                disabled={operatorMissing || busy === 'verify' || !verificationForm.evidenceNote}
                onClick={handleVerify}
                type="button"
              >
                {busy === 'verify' ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                Rotayi dogrula
              </button>
            </div>
          )
        )}
      </Step>

      <Step index={3} title="Mesaj ve onizleme">
        <label className="outreach-field">
          <span>Sablon</span>
          <select
            disabled={!selectedEmail}
            onChange={(event) => setTemplateId(event.target.value)}
            value={templateId || preview?.template.id || ''}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} ({template.category})
              </option>
            ))}
          </select>
        </label>

        {preview ? (
          <div className="outreach-preview">
            <dl>
              <div>
                <dt>Kimden</dt>
                <dd>{preview.message.fromDisplay}</dd>
              </div>
              <div>
                <dt>Yanit adresi</dt>
                <dd>{preview.message.replyTo}</dd>
              </div>
              <div>
                <dt>Kime</dt>
                <dd>{preview.message.to}</dd>
              </div>
              <div>
                <dt>Konu</dt>
                <dd>{preview.message.subject}</dd>
              </div>
              <div>
                <dt>Inceleme</dt>
                <dd>{preview.template.requiredReview.join(', ')}</dd>
              </div>
              <div>
                <dt>Icerik ozeti</dt>
                <dd className="mono">{preview.message.bodyHash.slice(0, 16)}…</dd>
              </div>
            </dl>
            <pre>{preview.message.bodyText}</pre>
          </div>
        ) : (
          <p className="outreach-hint">Onizleme icin once bir iletisim rotasi secin.</p>
        )}
      </Step>

      <Step index={4} title="Preflight kontrolleri">
        {preview ? (
          <PreflightView preview={preview} />
        ) : (
          <p className="outreach-hint">Onizleme olusturuldugunda tum kapilar burada listelenir.</p>
        )}
      </Step>

      <Step index={5} title="Onay">
        {preview?.preflight.approval ? (
          <div className="outreach-callout ok">
            <Stamp size={16} aria-hidden="true" />
            <div>
              <strong>Bu metin icin onay mevcut.</strong>
              <span>
                {preview.preflight.approval.approvedBy} · {formatDate(preview.preflight.approval.approvedAt)}
              </span>
            </div>
          </div>
        ) : (
          <div className="outreach-form-grid">
            <label className="outreach-field wide">
              <span>Onay notu</span>
              <input
                onChange={(event) => setApprovalForm((form) => ({ ...form, note: event.target.value }))}
                placeholder="Pilot dalga 1"
                value={approvalForm.note}
              />
            </label>

            {context?.requirements.sensitiveCategoryApproval && (
              <label className="outreach-field">
                <span>Hassas kategori onayi veren</span>
                <input
                  onChange={(event) =>
                    setApprovalForm((form) => ({ ...form, sensitiveCategoryApprovedBy: event.target.value }))
                  }
                  placeholder="legal:counsel"
                  value={approvalForm.sensitiveCategoryApprovedBy}
                />
              </label>
            )}

            {context?.requirements.seniorApproval && (
              <label className="outreach-field">
                <span>Kidemli onay referansi</span>
                <input
                  onChange={(event) => setApprovalForm((form) => ({ ...form, seniorApprovalRef: event.target.value }))}
                  placeholder="approval-ticket-123"
                  value={approvalForm.seniorApprovalRef}
                />
              </label>
            )}

            <button
              className="outreach-button primary"
              disabled={!preview || operatorMissing || busy === 'approve'}
              onClick={handleApprove}
              type="button"
            >
              {busy === 'approve' ? <Loader2 className="spin" size={15} /> : <Stamp size={15} />}
              Bu metni onayla
            </button>
          </div>
        )}
      </Step>

      <Step index={6} title="Kuyruk ve gonderim">
        <div className="outreach-actions">
          <button
            className="outreach-button primary"
            disabled={!preview?.preflight.ok || operatorMissing || busy === 'stage'}
            onClick={handleStage}
            type="button"
          >
            {busy === 'stage' ? <Loader2 className="spin" size={15} /> : <Mail size={15} />}
            Kuyruga al
          </button>

          <button
            className={mode === 'live' ? 'outreach-button danger' : 'outreach-button'}
            disabled={busy === 'send' || (mode === 'live' && !confirmLive)}
            onClick={handleSend}
            type="button"
          >
            {busy === 'send' ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
            Kuyrugu isle ({modeLabels[mode]})
          </button>
        </div>

        {mode === 'live' && (
          <label className="outreach-confirm">
            <input checked={confirmLive} onChange={(event) => setConfirmLive(event.target.checked)} type="checkbox" />
            <span>Gercek e-posta gonderilecegini onayliyorum.</span>
          </label>
        )}

        <div className="outreach-suppress">
          <select onChange={(event) => setSuppressionReason(event.target.value)} value={suppressionReason}>
            {SUPPRESSION_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
          <button
            className="outreach-button"
            disabled={!selectedEmail || operatorMissing || busy === 'suppress'}
            onClick={handleSuppress}
            type="button"
          >
            <ShieldAlert size={15} />
            Suppression listesine ekle
          </button>
        </div>
      </Step>

      <Step index={7} title="Bu adayin gonderim gecmisi">
        {(context?.outbox.length ?? 0) === 0 ? (
          <p className="outreach-hint">Henuz kayit yok.</p>
        ) : (
          <table className="outreach-table">
            <thead>
              <tr>
                <th>Durum</th>
                <th>Adres</th>
                <th>Mod</th>
                <th>Zaman</th>
                <th>Not</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {context?.outbox.map((record) => (
                <tr key={record.id}>
                  <td>
                    <span className={`outreach-status ${record.status}`}>{record.status}</span>
                  </td>
                  <td>{record.to}</td>
                  <td>{modeLabels[record.mode] ?? record.mode}</td>
                  <td>{formatDate(record.sentAt ?? record.enqueuedAt)}</td>
                  <td>{record.suppressedReason ?? record.lastError ?? record.providerMessageId ?? '-'}</td>
                  <td>
                    {record.status === 'failed' && (
                      <button
                        className="outreach-button ghost"
                        disabled={operatorMissing || busy === 'retry'}
                        onClick={() => handleRetry(record.id)}
                        type="button"
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                        Tekrar dene
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Step>

      <p className="outreach-footnote">
        Aday: {candidateName} · {candidateId}
      </p>
    </div>
  );
}

function ModeBanner({
  config,
  status,
  onRefresh,
  busy,
}: {
  config: OutreachConfig | null;
  status: OutreachStatus | null;
  onRefresh: () => void;
  busy: string;
}) {
  if (!config) {
    return (
      <div className="outreach-mode loading">
        <Loader2 className="spin" size={16} aria-hidden="true" />
        <span>Outreach sunucusuna baglaniliyor…</span>
      </div>
    );
  }

  return (
    <div className={`outreach-mode ${config.mode}`}>
      <strong>{modeLabels[config.mode]}</strong>
      <span>
        {config.fromName} &lt;{config.fromAddress || 'ayarlanmadi'}&gt; · gunluk {status?.outbox.sentToday ?? 0}/
        {config.dailySendLimit} · suppression {status?.suppression.active ?? 0}
      </span>
      <button className="outreach-button ghost" disabled={Boolean(busy)} onClick={onRefresh} type="button">
        <RefreshCw size={14} aria-hidden="true" />
        Yenile
      </button>

      {config.issues.length > 0 && (
        <ul className="outreach-issues">
          {config.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PreflightView({ preview }: { preview: PreviewResult }) {
  const { preflight } = preview;

  return (
    <div className="outreach-preflight">
      <div className={preflight.ok ? 'outreach-callout ok' : 'outreach-callout block'}>
        {preflight.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
        <div>
          <strong>{preflight.ok ? 'Tum kapilar acik.' : `${preflight.blockers.length} engel var.`}</strong>
          <span>
            Gunluk kota: {preflight.quota.sentToday}/{preflight.quota.dailyLimit} · kalan {preflight.quota.remaining}
          </span>
        </div>
      </div>

      {preflight.blockers.map((blocker) => (
        <p className="outreach-check block" key={blocker.code + blocker.message}>
          <ShieldAlert size={14} aria-hidden="true" />
          <span>
            <code>{blocker.code}</code> {blocker.message}
          </span>
        </p>
      ))}

      {preflight.warnings.map((warning) => (
        <p className="outreach-check warn" key={warning.code + warning.message}>
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            <code>{warning.code}</code> {warning.message}
          </span>
        </p>
      ))}
    </div>
  );
}

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="outreach-step">
      <header>
        <span className="outreach-step-index">{index}</span>
        <h4>{title}</h4>
      </header>
      <div className="outreach-step-body">{children}</div>
    </section>
  );
}

export default OutreachPanel;
