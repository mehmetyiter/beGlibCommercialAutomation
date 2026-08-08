# Host Prospect Integration

The consumer contract lives at `contracts/host-prospect/v1`. Conversio owns the
canonical copy; this repository keeps a byte-for-byte snapshot and an
independent validator in `scripts/lib/host-prospect-contract.mjs`. The signed
create/revoke/event boundary and Conversio's private claim, OTP, isolated SSO,
invite-only onboarding, and unverified Host activation are implemented but
remain disabled by default through server-side feature flags.

## System Ownership

Commercial Automation remains authoritative for:

- Candidate research and evidence
- Contact endpoints and candidate associations
- Human verification, compliance, and suppression
- Campaign membership and marketing delivery
- Replies, FAQ routing, and AI-assisted drafts

Conversio remains authoritative for:

- Prospect and claim tokens
- OTP and SSO verification
- Accounts and conflict recovery
- Host onboarding, activation, and authorization
- Transactional enrollment email

The systems do not share a database. Automation sends only the minimal v1
request for a selected campaign member. It does not copy a dossier, unrelated
channels, source HTML, notes, social handles, or inferred contact data into
Conversio.

## Pilot Eligibility

The first 10-25 person pilot uses only email endpoints with a human-verified
`candidate_owned` association. Representative, team, shared-office,
contact-form, and unknown routes stay in the research database but cannot enter
Host onboarding.

`eligibleForHostOtp` is not stored as an operator-editable field. The local CLI
must derive it from association type, recipient kind, evidence status,
freshness, suppression, compliance, and contact purpose. Conversio repeats that
policy check at ingestion.

## Runtime Shape

The local, non-browser integration process:

1. Selects an approved campaign member and exact contact association.
2. Validates the v1 request locally.
3. Signs the exact request bytes with the HMAC contract.
4. Stores only the returned prospect ID, CTA URL, expiry, and contract version
   in a private server-side campaign record. CTA origin must match an explicit
   environment allowlist, and the entire URL must satisfy the canonical
   fragment-only pattern loaded from the v1 OpenAPI snapshot.
5. Sends marketing through the Automation campaign approval path.
6. Pulls authoritative events by cursor and applies them idempotently.

The event cursor represents Conversio's stable append order, not `occurredAt`.
Business timestamps may move backwards. The local process commits a complete
page, deduplicates globally by `eventId`, and only then stores `nextCursor`.

The Vite dashboard may ask a local backend to perform these actions, but it must
never contain the HMAC secret. HMAC secrets, CTA URLs/tokens, and signed-request
logic are forbidden in browser bundles, `localStorage`, exports, and dossier
JSON. A CTA is revealed only to the approved mail-render/send step and is
removed from operational storage under the terminal-record retention policy.

HMAC key IDs are rotating credentials, not ownership identifiers. Conversio
maps every active rotation key to one stable server-side integration principal,
so a key change cannot split campaign idempotency, contact locks, revocation, or
event cursors.

Landing observations do not change campaign state. Only explicit,
`authoritative: true` events such as interest confirmation, email verification,
acceptance, rejection, expiry, or revocation can do so.

## Local Preparation Gate

`npm run host-prospect:prepare` converts one private, human-approved campaign
member JSON file into a v1 Host Prospect create request. It does not call
Conversio, create a prospect, send mail, or stage outreach. The command fails
closed unless the input includes:

- `approvalStatus: "approved"` for the campaign member
- A candidate-owned `public-business-email` route
- Human-verified association metadata with clear suppression and approved
  compliance
- `contactPurpose: "host_invitation"`
- Sensitive-category and senior approvals when required

The generated request is still validated by the v1 contract validator before it
is written. This lets the marketing approval path prepare a minimal request
without exposing the HMAC secret, CTA token, or signed-request logic to the
browser dashboard.

`npm run host-prospect:create` signs that request with the HMAC contract.
It is dry-run by default and prints only a redacted signed-request summary. A
real internal API call requires `--live` plus
`HOST_PROSPECT_API_BASE_URL`, `HOST_PROSPECT_HMAC_KEY_ID`, and
`HOST_PROSPECT_HMAC_SECRET` in the local trusted process environment.

After a trusted non-browser caller receives a Conversio create response,
`npm run host-prospect:record-response` reduces it to private campaign state:
prospect ID, campaign IDs, CTA URL, expiry, and status metadata. It validates
CTA origin against `HOST_PROSPECT_ALLOWED_CTA_ORIGINS` or `--allowed-origin`
and does not copy the candidate email, display name, dossier notes, or social
profiles into the state file.

`npm run host-prospect:apply-events` applies a validated event page
idempotently to that private state. Duplicate event IDs are skipped, unknown
prospect events are recorded as warnings, and the cursor advances only after
the page has been written.

`npm run host-prospect:events` signs and pulls the Conversio event feed. It is
also dry-run by default and applies a live page to private state only after the
event page passes the v1 validator. `npm run host-prospect:revoke` signs a
revoke request, validates the revoke response in live mode, and leaves local
campaign-state advancement to the authoritative event feed.

`npm run host-prospect:redact-state` enforces local CTA retention. Once a record
is terminal or past `expiresAt` for the configured retention window, the CTA URL
is replaced with `null` while prospect IDs, campaign IDs, cursor state, and
minimal event metadata remain for suppression, audit, and reconciliation.

`npm run host-prospect:summary` reports private state counters for operational
monitoring: records by prospect/enrollment status, active CTA count, redacted
CTA count, redaction-due count, terminal count, converted count, cursor, and
processed event count. It is read-only and can back a local alert before any
production campaign wave.

See `docs/host-prospect-cli-runbook.md` for the local command sequence,
environment variables, dry-run behavior, live-mode switch, and retention check.

## Production Configuration

Production Conversio is `https://api.beglib.com`. Paths and the v1 contract are unchanged
from beta; the base URL is the only endpoint difference.

The CTA is minted by Conversio on its own `PUBLIC_WEB_BASE_URL`, which in production is
`https://app.beglib.com`. `HOST_PROSPECT_ALLOWED_CTA_ORIGINS` is an **exact origin match**,
so it must read `https://app.beglib.com`. Listing the bare apex, as the pre-production
example did, rejects every production CTA with `response.ctaUrl origin is not allowlisted`.

Never construct the CTA. Conversio mints the token; a self-built URL cannot validate.

## Sending the Invitation

Conversio has no invitation email template. The only host-related template it owns is the
verification code used later inside the claim flow, so **if this system does not send the
invitation, nobody does.**

`tmpl-host-invite` in `scripts/lib/outreach-mail.mjs` carries the claim link. The send path
resolves the CTA from the private Host prospect state written by
`host-prospect:record-response`, and only for that template — no other template may carry a
claim link, and the invitation template refuses to render without one.

The claim token lives in the URL **fragment**, which is what keeps it out of server logs.
Everything that could reshape it is blocked:

- The rendered link is checked against the v1 CTA pattern (`/host/invite#t=` plus exactly
  43 characters) before it can enter a message, and again immediately before delivery.
- Both the text and HTML bodies must contain the link verbatim; a rewritten or truncated
  link fails validation rather than reaching the recipient.
- The SES configuration set has open and click tracking disabled. A tracker that rewrites
  links would strip the fragment and produce an invitation that looks correct and cannot
  be claimed.

A prospect that is terminal, expired, or whose CTA has been redacted under the retention
policy is not invitable, and the renderer refuses an expired prospect outright.

The claim token is a bearer credential. It never reaches the browser: the dashboard is
served a masked twin of the message whose body hash is the real one, so approving what is
displayed still authorises exactly the bytes that will be sent.

## Production Readiness on the Conversio Side

As of the 2026-08-07 handover the flow is **disabled in production**:
`GET /host/invite/session` answers `host_invite_unavailable`, and the production platform
Terraform carries no `HOST_PROSPECT_*` variables, so every flag sits at its default.

Before this system can issue a single prospect, Conversio needs
`HOST_PROSPECT_INGRESS_ENABLED` and `HOST_PROSPECT_PUBLIC_FLOW_ENABLED` set to `true`, an
integration id, at least one HMAC key, and a CTA token secret of 32 characters or more.
The last two are secrets; the CTA token secret is not part of the existing fifteen-secret
production contract, so it needs provisioning, an IAM grant, and a Terraform change.
Enabling ingress without the HMAC key or the CTA secret makes the Conversio API refuse to
boot, so the flags and secrets must land in the same change.

Verify in this order once it is enabled:

1. `GET https://api.beglib.com/host/invite/session` stops answering `host_invite_unavailable`.
2. Issue one prospect to an address you control; the response carries a `ctaUrl` on
   `app.beglib.com` with a 43-character fragment token.
3. Open the CTA in a signed-out browser and complete the claim.
4. Read the event feed and confirm `host_enrollment.accepted` appears.
5. Confirm the invitation email preserved the fragment.

## Outreach Boundary

Marketing consent is not created by Host enrollment. Campaign suppression and
legal sending controls remain in Automation. Transactional enrollment mail is
owned only by Conversio; the OTP template is implemented, while any approved
claim-completion, expiry, or security-notice templates must be added there
before use. OTPs, provider identifiers, and account details never return through
the event feed.
