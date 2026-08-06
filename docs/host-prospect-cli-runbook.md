# Host Prospect CLI Runbook

Status: private local/server tooling; dry-run by default

## Environment

Copy `.env.example` to `.env.local` and fill only the trusted local/server
process values:

```text
HOST_PROSPECT_API_BASE_URL=https://api.beglib.com
HOST_PROSPECT_HMAC_KEY_ID=...
HOST_PROSPECT_HMAC_SECRET=...
HOST_PROSPECT_ALLOWED_CTA_ORIGINS=https://beglib.com
HOST_PROSPECT_SMOKE_ENV=beta
```

Never put the HMAC key ID or secret in Vite variables, browser storage,
dashboard exports, candidate dossiers, email templates, or logs.

## Dry-Run Flow

Prepare a contract-valid request from a private approved campaign-member file:

```bash
npm run host-prospect:prepare -- \
  --input examples/host-prospect-campaign-member.synthetic.json \
  --output exports/host-prospect-create-request.synthetic.local.json
```

Dry-run the signed create request:

```bash
npm run host-prospect:create -- \
  --request exports/host-prospect-create-request.synthetic.local.json
```

Dry-run the event-feed pull:

```bash
npm run host-prospect:events -- \
  --state exports/host-prospect-state.synthetic.local.json
```

Dry-run a revoke request:

```bash
npm run host-prospect:revoke -- \
  --prospect-id 8d7636a6-c4f3-4aa9-85eb-ff59a8cf12f4 \
  --reason-code operator_revoked
```

Dry-run commands do not call Conversio, create prospects, send mail, or stage
outreach. They print a redacted signed-request summary only.

## Live Flow

Use `--live` only from the trusted local/server process after human campaign
approval. Create responses are contract-validated and reduced into private
state:

```bash
npm run host-prospect:create -- \
  --request exports/host-prospect-create-request.local.json \
  --state exports/host-prospect-state.local.json \
  --live
```

Pull events after live creates or revokes:

```bash
npm run host-prospect:events -- \
  --state exports/host-prospect-state.local.json \
  --live
```

Apply local retention:

```bash
npm run host-prospect:redact-state -- \
  --state exports/host-prospect-state.local.json
```

Check counters:

```bash
npm run host-prospect:summary -- \
  --state exports/host-prospect-state.local.json
```

## Non-Production HMAC Smoke

Use a separate beta request, beta HMAC credential, and beta CTA origin. The
smoke command refuses `api.beglib.com` and `beglib.com` so it cannot be used
against production accidentally.

Create the prospect and a redacted evidence record:

```bash
npm run host-prospect:smoke -- \
  --phase create \
  --request exports/host-prospect-create-request.beta.local.json \
  --state exports/host-prospect-smoke-state.local.json \
  --record exports/host-prospect-smoke-record.local.json \
  --live
```

Open the CTA from the private state file. Complete the candidate-owned email
OTP and Google/Apple SSO, then stop on the onboarding screen before final Host
activation. Verify the authoritative event chain:

```bash
npm run host-prospect:smoke -- \
  --phase verify-onboarding \
  --state exports/host-prospect-smoke-state.local.json \
  --record exports/host-prospect-smoke-record.local.json \
  --live
```

Finally revoke the still-unactivated smoke enrollment and verify the revoke
event:

```bash
npm run host-prospect:smoke -- \
  --phase revoke \
  --state exports/host-prospect-smoke-state.local.json \
  --record exports/host-prospect-smoke-record.local.json \
  --live
```

The evidence file contains IDs, environment origin, timestamps, event types,
and pass/fail checks only. It never stores candidate email, OTP, CTA bearer,
OAuth token, or HMAC secret.

## Safety Notes

- The create request contains the candidate-owned OTP email because Conversio
  needs it for transactional enrollment verification.
- Private state intentionally stores only prospect IDs, campaign IDs, CTA URL,
  expiry, cursor, and minimal event metadata.
- Candidate display names, emails, dossiers, social profiles, provider
  identities, OTPs, and OAuth details must not be copied into private state.
- Revoke response does not authoritatively advance local state. Pull the event
  feed after revoke and let validated authoritative events update the record.
