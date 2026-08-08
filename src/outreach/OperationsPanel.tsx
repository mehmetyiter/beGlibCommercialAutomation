import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldOff,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  OutreachApiError,
  addSuppression,
  drainQueue,
  fetchOutbox,
  fetchOutreachConfig,
  fetchSuppressions,
  retryFailed,
  revokeSuppression,
} from './api';
import './outreach.css';
import type { OutboxPage, OutreachConfig, SuppressionPage } from './types';

const STATUS_FILTERS = [
  { value: '', label: 'Tum durumlar' },
  { value: 'pending', label: 'Kuyrukta' },
  { value: 'sent', label: 'Gonderildi' },
  { value: 'failed', label: 'Basarisiz' },
  { value: 'suppressed', label: 'Suppress edildi' },
];

const SUPPRESSION_REASONS = [
  { value: 'opt-out-request', label: 'Opt-out talebi' },
  { value: 'deletion-request', label: 'Silme talebi' },
  { value: 'complaint', label: 'Sikayet' },
  { value: 'hard-bounce', label: 'Hard bounce' },
  { value: 'spam-complaint', label: 'Spam sikayeti' },
  { value: 'do-not-contact', label: 'Iletisime gecilmeyecek' },
  { value: 'manual-review', label: 'Manuel inceleme' },
];

const modeLabels: Record<string, string> = { off: 'KAPALI', dry_run: 'DENEME', live: 'CANLI' };

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

/**
 * Campaign-wide view. Message history used to exist only per candidate, so "what went out
 * today" and "who is on the suppression list" had no answer anywhere in the dashboard.
 */
function OperationsPanel({ operator }: { operator: string }) {
  const [config, setConfig] = useState<OutreachConfig | null>(null);
  const [outbox, setOutbox] = useState<OutboxPage | null>(null);
  const [suppressions, setSuppressions] = useState<SuppressionPage | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmLive, setConfirmLive] = useState(false);
  const [suppressionForm, setSuppressionForm] = useState({
    kind: 'email' as 'email' | 'domain',
    value: '',
    reason: SUPPRESSION_REASONS[0].value,
    note: '',
  });

  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const operatorMissing = operator.trim().length === 0;

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
        const [configResult, outboxResult, suppressionResult] = await Promise.all([
          fetchOutreachConfig(),
          fetchOutbox({ status: statusFilter || undefined, limit: 200 }),
          fetchSuppressions(),
        ]);

        if (cancelled) {
          return;
        }

        setConfig(configResult.config);
        setOutbox(outboxResult);
        setSuppressions(suppressionResult);
      } catch (error) {
        if (!cancelled) {
          setErrors(toErrors(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken, statusFilter]);

  function handleDrain() {
    void run('send', async () => {
      const result = await drainQueue({ confirmLive });

      setNotice(`${result.processed} mesaj islendi.`);
      setConfirmLive(false);
    });
  }

  function handleRetry(messageId?: string) {
    void run('retry', async () => {
      const result = await retryFailed(messageId ? { id: messageId, actor: operator } : { all: true, actor: operator });
      const blocked = result.results.filter((entry) => entry.outcome !== 'requeued');

      setNotice(
        blocked.length > 0
          ? `${result.requeued} mesaj kuyruga alindi, ${blocked.length} tanesi engellendi: ${blocked[0].reasons?.join('; ') ?? ''}`
          : `${result.requeued} mesaj yeniden kuyruga alindi.`,
      );
    });
  }

  function handleAddSuppression() {
    void run('suppress', async () => {
      await addSuppression({
        kind: suppressionForm.kind,
        value: suppressionForm.value,
        reason: suppressionForm.reason,
        note: suppressionForm.note,
        actor: operator,
      });

      setSuppressionForm((form) => ({ ...form, value: '', note: '' }));
      setNotice('Suppression kaydi eklendi.');
    });
  }

  function handleRevokeSuppression(id: string, value: string) {
    const note = window.prompt(`${value} suppression kaydi neden geri aliniyor?`);

    if (note === null) {
      return;
    }

    void run('revoke', async () => {
      await revokeSuppression({ id, actor: operator, note });
      setNotice(`${value} suppression listesinden cikarildi.`);
    });
  }

  const mode = config?.mode ?? 'off';
  const sentToday = outbox?.summary.sentToday ?? 0;
  const dailyLimit = outbox?.dailyLimit ?? config?.dailySendLimit ?? 0;
  const quotaPercent = dailyLimit > 0 ? Math.min(100, Math.round((sentToday / dailyLimit) * 100)) : 0;

  return (
    <div className="outreach-panel">
      <div className={`outreach-mode ${mode}`}>
        <strong>{modeLabels[mode] ?? mode}</strong>
        <span>
          Bugun {sentToday}/{dailyLimit} · kuyrukta {outbox?.summary.byStatus.pending ?? 0} · basarisiz{' '}
          {outbox?.summary.byStatus.failed ?? 0} · suppression {suppressions?.summary.active ?? 0}
        </span>
        <button
          className="outreach-button ghost"
          disabled={Boolean(busy)}
          onClick={() => setReloadToken((current) => current + 1)}
          type="button"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Yenile
        </button>
      </div>

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

      <section className="outreach-step">
        <header>
          <span className="outreach-step-index">1</span>
          <h4>Gunluk kota</h4>
        </header>
        <div className="outreach-step-body">
          <div className="ops-quota">
            <div className="ops-quota-bar">
              <span style={{ width: `${quotaPercent}%` }} />
            </div>
            <strong>
              {sentToday}/{dailyLimit}
            </strong>
            <small>bugun gonderilen · kalan {Math.max(0, dailyLimit - sentToday)}</small>
          </div>

          <div className="ops-counters">
            {STATUS_FILTERS.filter((entry) => entry.value).map((entry) => (
              <button
                className={statusFilter === entry.value ? 'ops-counter active' : 'ops-counter'}
                key={entry.value}
                onClick={() => setStatusFilter(statusFilter === entry.value ? '' : entry.value)}
                type="button"
              >
                <strong>{outbox?.summary.byStatus[entry.value] ?? 0}</strong>
                <span>{entry.label}</span>
              </button>
            ))}
          </div>

          <div className="outreach-actions">
            <button
              className={mode === 'live' ? 'outreach-button danger' : 'outreach-button'}
              disabled={busy === 'send' || (mode === 'live' && !confirmLive)}
              onClick={handleDrain}
              type="button"
            >
              {busy === 'send' ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
              Kuyrugu isle ({modeLabels[mode] ?? mode})
            </button>
            <button
              className="outreach-button"
              disabled={operatorMissing || busy === 'retry' || (outbox?.summary.byStatus.failed ?? 0) === 0}
              onClick={() => handleRetry()}
              type="button"
            >
              <RotateCcw size={15} aria-hidden="true" />
              Basarisizlari tekrar dene
            </button>
          </div>

          {mode === 'live' && (
            <label className="outreach-confirm">
              <input checked={confirmLive} onChange={(event) => setConfirmLive(event.target.checked)} type="checkbox" />
              <span>Gercek e-posta gonderilecegini onayliyorum.</span>
            </label>
          )}

          {operatorMissing && <p className="outreach-hint warn">Operator referansi olmadan tekrar deneme yapilamaz.</p>}
        </div>
      </section>

      <section className="outreach-step">
        <header>
          <span className="outreach-step-index">2</span>
          <h4>Kampanya outbox</h4>
        </header>
        <div className="outreach-step-body">
          <label className="outreach-field">
            <span>Durum filtresi</span>
            <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
              {STATUS_FILTERS.map((entry) => (
                <option key={entry.value || 'all'} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          {(outbox?.messages.length ?? 0) === 0 ? (
            <p className="outreach-hint">Bu filtrede kayit yok.</p>
          ) : (
            <table className="outreach-table">
              <thead>
                <tr>
                  <th>Durum</th>
                  <th>Aday</th>
                  <th>Adres</th>
                  <th>Zaman</th>
                  <th>Not</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {outbox?.messages.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <span className={`outreach-status ${record.status}`}>{record.status}</span>
                    </td>
                    <td>{record.candidateName}</td>
                    <td>{record.to}</td>
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
        </div>
      </section>

      <section className="outreach-step">
        <header>
          <span className="outreach-step-index">3</span>
          <h4>Suppression listesi</h4>
        </header>
        <div className="outreach-step-body">
          <p className="outreach-hint">
            Suppression her sinyalin onunde gelir: listedeki bir adres ya da alan adi, onayli bir mesaji bile durdurur.
            Geri alma kayitli kalir, silinmez.
          </p>

          <div className="outreach-form-grid">
            <label className="outreach-field">
              <span>Tur</span>
              <select
                onChange={(event) =>
                  setSuppressionForm((form) => ({ ...form, kind: event.target.value as 'email' | 'domain' }))
                }
                value={suppressionForm.kind}
              >
                <option value="email">E-posta</option>
                <option value="domain">Alan adi</option>
              </select>
            </label>
            <label className="outreach-field">
              <span>{suppressionForm.kind === 'domain' ? 'Alan adi' : 'E-posta'}</span>
              <input
                onChange={(event) => setSuppressionForm((form) => ({ ...form, value: event.target.value }))}
                placeholder={suppressionForm.kind === 'domain' ? 'ornek.com' : 'ad@ornek.com'}
                value={suppressionForm.value}
              />
            </label>
            <label className="outreach-field">
              <span>Neden</span>
              <select
                onChange={(event) => setSuppressionForm((form) => ({ ...form, reason: event.target.value }))}
                value={suppressionForm.reason}
              >
                {SUPPRESSION_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="outreach-field wide">
              <span>Not</span>
              <input
                onChange={(event) => setSuppressionForm((form) => ({ ...form, note: event.target.value }))}
                value={suppressionForm.note}
              />
            </label>
            <button
              className="outreach-button primary"
              disabled={operatorMissing || busy === 'suppress' || !suppressionForm.value.trim()}
              onClick={handleAddSuppression}
              type="button"
            >
              {busy === 'suppress' ? <Loader2 className="spin" size={15} /> : <ShieldAlert size={15} />}
              Listeye ekle
            </button>
          </div>

          {(suppressions?.entries.length ?? 0) === 0 ? (
            <p className="outreach-hint">Suppression kaydi yok.</p>
          ) : (
            <table className="outreach-table">
              <thead>
                <tr>
                  <th>Deger</th>
                  <th>Tur</th>
                  <th>Neden</th>
                  <th>Ekleyen</th>
                  <th>Zaman</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {suppressions?.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.value}</td>
                    <td>{entry.kind}</td>
                    <td>{entry.reason}</td>
                    <td>{entry.addedBy}</td>
                    <td>{formatDate(entry.addedAt)}</td>
                    <td>
                      {entry.revokedAt ? (
                        <span className="outreach-tag">geri alindi · {entry.revokedBy}</span>
                      ) : (
                        <button
                          className="outreach-button ghost"
                          disabled={operatorMissing || busy === 'revoke'}
                          onClick={() => handleRevokeSuppression(entry.id, entry.value)}
                          type="button"
                        >
                          <ShieldOff size={13} aria-hidden="true" />
                          Geri al
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

export default OperationsPanel;
