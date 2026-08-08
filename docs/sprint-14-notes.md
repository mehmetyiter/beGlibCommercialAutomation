# Sprint 14 Notes

## Added

- AWS SES outreach sending on a sending identity deliberately separate from Conversio's
  transactional sender, so cold-outreach reputation cannot pause transactional Host mail.
- Local outreach server (`server/outreach-server.mjs`) bound to loopback, holding the SES
  credentials. The Vite dev proxy injects its token server-side; the browser never holds
  a credential.
- Outreach tab in the dashboard candidate detail panel: contact-route verification,
  template selection, exact message preview, preflight results, approval, staging, queue
  drain, suppression, and per-candidate send history.
- Message renderer that appends a compliance footer no template can drop: sender legal
  name, physical mailing address, why the person was contacted with the source URL, and
  an opt-out route. `List-Unsubscribe` header included; no tracking pixel, no remote
  assets.
- Human contact-route verification store. Discovery contact candidates stay suggestions
  until a reviewer records the source URL, method, evidence note, and freshness date.
  Freshness is capped by `OUTREACH_VERIFICATION_MAX_AGE_DAYS` regardless of reviewer input.
- Message approvals bound to the rendered body hash. Editing the copy, the topics, or the
  sender footer invalidates an existing approval. One approval authorises one message and
  is consumed at staging.
- File-backed outbox with dedupe keys, atomic writes, cross-process locking, attempt
  claiming, retry/terminal error classification, and a daily send limit.
- Suppression list enforced at staging and re-checked immediately before delivery, so an
  opt-out recorded while a message sits in the queue still stops it. Domain-level entries
  block every address under them.
- Bounce and complaint ingestion through an SES configuration set to SNS to SQS, polled
  locally. Permanent bounces and complaints suppress automatically; transient bounces are
  counted only. No public webhook is exposed.
- Append-only audit log covering verification, approval, enqueue, send, suppression, and
  every revocation, each with a named actor.
- `npm run outreach -- <command>` CLI covering the same operations as the dashboard, plus
  `status`, `pull-events`, `retry`, and `redact`.
- `outreach retry` returns a provider-failed message to the queue without a fresh
  approval, since the approval is bound to the body hash and a transport failure changes
  no bytes. It refuses when the stored message no longer validates against current
  configuration, when the address has been suppressed, or when the contact verification
  has lapsed.
- `docs/email-sending.md` with the SES identity, DKIM/MAIL FROM/DMARC, configuration set,
  SQS event pipeline, scoped IAM policy, and pre-launch checklist.

## Removed

- `src/lib/outreach.ts` and `src/data/outreachTemplates.ts`, along with the now-unused
  `OutreachTemplate` type. They were dead code from the synthetic cockpit and held a
  second copy of the outreach templates; the two copies drifting apart would eventually
  have sent a stale message to a real candidate. `scripts/lib/outreach-mail.mjs` is now
  the single source, and the dashboard renders through the local outreach server.

## Rule

The dashboard cannot send a message on its own authority. A send requires all of:

- `OUTREACH_EMAIL_MODE` set to `live` in the local environment
- Complete sender identity configuration, including a physical mailing address
- A current human verification of that exact published contact route
- An unused approval matching the rendered body hash
- A named sensitive-category reviewer for sensitive candidates, and a senior approval
  reference for high-risk candidates
- A clear suppression check, no duplicate in the campaign, and remaining daily budget
- An explicit live confirmation on the send action itself

The system fails closed. Missing configuration blocks staging in every mode, and the
queue drain re-evaluates suppression, message validity, and the daily limit before
handing any bytes to SES.

## Verification

Required checks:

- `npm test` (36 outreach tests plus the existing suites).
- Lint.
- TypeScript build.
- Dry-run smoke through the local server: verify, preview, approve, stage, drain.

## Production handover follow-up (2026-08-07)

Applied from `docs/host-prospect-integration-prod-handover.md`:

- **Fixed a blocking production defect.** `HOST_PROSPECT_ALLOWED_CTA_ORIGINS` was
  `https://beglib.com`, but Conversio mints production CTAs on `https://app.beglib.com`
  and the allowlist is an exact origin match. Every production CTA would have been
  rejected as `response.ctaUrl origin is not allowlisted`.
- **Implemented the invitation email.** Conversio owns no invitation template, so nothing
  was sending the claim link. `tmpl-host-invite` now carries it, resolved from the private
  Host prospect state and gated on the prospect being issued, unexpired, un-redacted, and
  non-terminal.
- **Protected the claim link end to end.** Validated against the v1 CTA pattern reused from
  the contract snapshot, required verbatim in both bodies at render and again before
  delivery, rendered as the single anchor with no rewriting, and confirmed that the SES
  configuration set has open/click tracking disabled so nothing strips the fragment.
- **Kept the bearer token out of the browser.** The dashboard receives a masked twin of the
  invitation whose body hash is the real one, so approving what is displayed still
  authorises the exact bytes sent. Outbox redaction now drops the CTA along with the body.

Verified as already contract-correct, no change needed: contract version `1.0`, the
six-line canonical request, HMAC headers plus `Idempotency-Key`, hashing the exact bytes
sent, the 43-character fragment CTA pattern, strict unknown-key rejection, and all three
cross-field date rules.

Still blocked on Conversio: the production flow is disabled, and the flags plus the CTA
token secret must be provisioned before a single prospect can be issued.
