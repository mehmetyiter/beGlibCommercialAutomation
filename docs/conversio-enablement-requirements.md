# Conversio enablement requirements — Host prospect invitations

- Written: 2026-08-07
- Audience: whoever enables the Host prospect flow in the production Conversio deployment
- Companion: `host-prospect-integration-prod-handover.md` (the contract, written from the
  Conversio side) and `host-prospect-integration.md` (this repository's own integration doc)

This is the reply to that handover: what the outbound side is ready for, and what
production Conversio still has to do before a single prospect can be issued.

Every flag name, default, and guard below was read from the Conversio source rather than
inferred. Where this contradicts or extends the original handover, the discrepancy is
called out.

## Current state — Conversio side complete

Verified against production on 2026-08-07. **All three flags are on, all three secrets are
injected, and the service is running the new revision. Nothing further is needed here.**

| Surface | State | How it was checked |
| --- | --- | --- |
| Internal ingress | enabled | Task definition `beglib-prod-api:7`, service 2/2. |
| Event feed | enabled | A live signed `GET /internal/v1/host-prospect-events` returned a valid page, which also confirms the HMAC key id and secret match on both sides. |
| Public claim flow | enabled | `POST /host/invite/confirm`, `/host/invite/email/resend`, and `/host/invite/sso/google/start` all answer `403 invalid_origin`. |

All three secrets were created through Terraform, not out of band, and
`HOST_CLAIM_OTP_PEPPER` is injected — the API could not have booted otherwise. Terraform
updated the service along with the task definition, so no separate ECS redeploy was needed.

### `GET /host/invite/session` is not a usable probe

This is worth recording because it cost a round of misdiagnosis.

`GET /host/invite/session` and `GET /host/invite` answer `404 host_invite_unavailable`
whether the feature gate is open or closed. Without an invite cookie or token,
`getHostClaimSession` and `getLanding` throw that same error on their own, so the response
is identical in both states and says nothing about the flag.

That is deliberate: a request carrying no token and a request carrying an invalid token must
be indistinguishable, or someone guessing tokens could learn which ones exist.

The discriminating probe is any **POST** under `/host/invite`. In `publicRoutes.ts` the
`enabled` middleware is registered before `trustedOrigin`, so a `403 invalid_origin` proves
the request already passed the feature gate. A closed gate would answer
`404 host_invite_unavailable` instead.

The real completion criterion is neither probe: it is opening a genuine CTA in a browser and
completing the claim.

## Status of the outbound side

Ready. No further work is expected here before enablement.

- v1 contract implemented and validated locally: `contractVersion` `"1.0"`, the six-line
  canonical request, HMAC headers plus `Idempotency-Key`, body hash taken over the exact
  bytes sent, strict unknown-key rejection, and all three cross-field date rules.
- `HOST_PROSPECT_ALLOWED_CTA_ORIGINS` corrected to `https://app.beglib.com`. It had been
  set to the bare apex, which would have rejected every production CTA as
  `response.ctaUrl origin is not allowlisted`.
- The invitation email is implemented and sends the CTA verbatim, fragment intact, with
  no link rewriting and with open/click tracking disabled on the sending configuration set.
- The event feed consumer applies pages idempotently by `eventId` and advances the cursor
  only after a complete page is written.

The outbound side needs **no schema or endpoint change** for production. Only the base URL
differs from beta, and it is already `https://api.beglib.com`.

## What Conversio enabled

All applied on 2026-08-07. Kept as the record of what the settings are and why.

| Variable | Default | Needed | Notes |
| --- | --- | --- | --- |
| `HOST_PROSPECT_INGRESS_ENABLED` | `false` | `true` | Without it no prospect can be issued. |
| `HOST_PROSPECT_EVENT_FEED_ENABLED` | `false` | `true` | **Missing from the original handover.** See below. |
| `HOST_PROSPECT_PUBLIC_FLOW_ENABLED` | `false` | `true` | Without it the candidate cannot claim. |
| `HOST_PROSPECT_INTEGRATION_ID` | `commercial-automation` | confirm | Already defaults to the right value; confirm rather than assume. |
| `HOST_PROSPECT_HMAC_KEYS_JSON` | `"{}"` | ≥ 1 key | Ingress refuses to start with none. Max 10 rotation keys. |
| `HOST_PROSPECT_CTA_TOKEN_SECRET` | unset | ≥ 32 chars | Secret. Ingress refuses to start without it. |
| `HOST_CLAIM_OTP_PEPPER` | unset | ≥ 32 chars | Secret. **Missing from the original handover.** See below. |
| `HOST_PROSPECT_MAX_INVITE_DAYS` | `30` | confirm | Caps how far ahead `expiresAt` may sit. |
| `HOST_PROSPECT_HMAC_MAX_SKEW_SEC` | `300` | default fine | Matches the documented 300s skew window. |
| `HOST_PROSPECT_NONCE_TTL_SEC` | `600` | default fine | Matches the documented 600s replay window. |
| `HOST_PROSPECT_IDEMPOTENCY_TTL_DAYS` | `45` | default fine | |

These were all at their defaults before the change; `infra/aws/prod-platform/locals.tf`
carried no `HOST_PROSPECT_*` variables at all.

### Two gaps in the original handover

Both were caught before the rollout and are now applied.

**`HOST_PROSPECT_EVENT_FEED_ENABLED` was not listed, and defaults to `false`.**
Enabling ingress and the public flow alone produces a system that can issue prospects and
let candidates claim, while the outbound side never learns that any of it happened.
Conversio does not call back; the event feed is the only channel. Campaign state would
silently stall at "invited" for every candidate. Enable it in the same change as the other
two flags.

**`HOST_CLAIM_OTP_PEPPER` is a second required secret, not one.**
`apps/api/src/hostProspects/claimConfig.ts` refuses to start when the public claim flow is
enabled without it, and requires at least 32 characters. The handover named only
`HOST_PROSPECT_CTA_TOKEN_SECRET` as the new secret to provision. Neither appears in
`docs/operations/prod-secret-provisioning-inventory.md`, so **both** need provisioning, an
IAM grant to read them, and a Terraform change.

## Secret ownership

Three secrets are involved and only one of them crosses the boundary. Getting this wrong
in the safe direction costs nothing; getting it wrong the other way hands out a signing key
that never needed to leave Conversio.

| Secret | Generated by | Held by Conversio | Held by the outbound side |
| --- | --- | --- | --- |
| HMAC key id + secret | Conversio | `HOST_PROSPECT_HMAC_KEYS_JSON` | `HOST_PROSPECT_HMAC_KEY_ID`, `HOST_PROSPECT_HMAC_SECRET` |
| `HOST_PROSPECT_CTA_TOKEN_SECRET` | Conversio | yes | **never** |
| `HOST_CLAIM_OTP_PEPPER` | Conversio | yes | **never** |

The CTA token secret signs and verifies claim tokens, and the OTP pepper protects the email
challenge. Both live entirely inside the claim journey, which Conversio owns end to end.
The outbound side receives finished CTA URLs and never mints, verifies, or inspects a
token, so neither secret has any function there.

Conversio issues the HMAC key because it operates the verification side. On the outbound
side the secret lives only in an uncommitted local `.env.local` (mode `0600`), never in a
browser bundle, an export, a dossier, or the dashboard.

Generate all three with a CSPRNG, for example `openssl rand -base64 48`. The CTA token
secret and the OTP pepper must each be at least 32 characters or the API refuses to boot.

## What changed in `infra/aws/prod-platform`

Applied on 2026-08-07. Recorded here so the same path is repeatable for another
environment.

### Step 1 — register the three secrets

`var.runtime_secret_names` in `variables.tf` creates the Secrets Manager entries. It
currently lists nineteen names and **none of the Host prospect ones**. Add:

```hcl
"HOST_PROSPECT_HMAC_KEYS_JSON",
"HOST_PROSPECT_CTA_TOKEN_SECRET",
"HOST_CLAIM_OTP_PEPPER",
```

**Done as of 2026-08-07.** All three secrets were created through Terraform and their
values set separately; Terraform manages only the metadata, never the value, as the variable
description states. Each value is at least 32 characters.

Registering the name in Terraform is what makes the secret reach the container. A secret
that exists in Secrets Manager but is absent from `runtime_secret_names` is never injected,
so the running API sees the default (`"{}"` for the HMAC keys) and refuses to start the
moment ingress is enabled.

### Step 2 — inject them into the API task

`var.api_injected_secret_names` in `variables.tf` is the subset delivered to the API
container under the same environment-variable name. Add the same three names there.

Optionally add them to `local.required_api_injected_secret_names` in `locals.tf` so a
future change cannot silently drop them.

### Step 3 — set the three flags

The booleans are plain environment variables, not secrets. They belong in
`local.api_base_environment` in `locals.tf`, which is the reviewed base contract:

```hcl
HOST_PROSPECT_INGRESS_ENABLED    = "true"
HOST_PROSPECT_EVENT_FEED_ENABLED = "true"
HOST_PROSPECT_PUBLIC_FLOW_ENABLED = "true"
```

Note that `var.api_environment_overrides` cannot replace a key already present in
`api_base_environment` — `compute.tf` fails the plan with "api_environment_overrides cannot
replace guarded production defaults". So put them in the base contract deliberately rather
than trying to override them later.

### Ordering

Steps 1 and 2 can ship on their own with the flags still `false`: the secrets are then in
place and injected, and nothing changes behaviourally. Step 3 flips the feature on.

Doing it the other way round takes production down. The guards below are startup guards, so
a flag without its secret does not disable a feature — it stops the API from booting.

In this rollout Terraform updated the ECS service together with the task definition, so a
separate redeploy was not required. Confirm the service is running the new revision before
concluding a change had no effect.

## Boot guards — land flags and secrets together

The API refuses to start, not merely to serve, when the configuration is half-applied.
From `apps/api/src/hostProspects/config.ts` and `claimConfig.ts`:

- `Host prospect internal surfaces require at least one HMAC key.`
- `HOST_PROSPECT_CTA_TOKEN_SECRET is required when Host prospect ingress is enabled.`
- `HOST_PROSPECT_CTA_TOKEN_SECRET must contain at least 32 characters.`
- `HOST_CLAIM_OTP_PEPPER is required when the public Host claim flow is enabled.`
- `HOST_CLAIM_OTP_PEPPER must contain at least 32 characters.`
- `HOST_PROSPECT_NONCE_TTL_SEC must be at least twice the maximum clock skew.`
- `Host prospect CTA URLs must use HTTPS when ingress is enabled.`

Enabling a flag in one release and provisioning its secret in the next takes production
down rather than leaving the feature off. Treat the secrets as the prerequisite and ship
them in the same change as the flags, or ship the secrets first with the flags still
`false`.

## Coordination with the outbound side

**HMAC key exchange.** Conversio generates the key id and secret; they are set here as
`HOST_PROSPECT_HMAC_KEY_ID` and `HOST_PROSPECT_HMAC_SECRET` in a local `.env.local` that is
never committed. Rotation keys map to one stable integration principal, so a key change
must not split campaign idempotency, contact locks, revocation, or event cursors.

**CTA origin.** Conversio mints the CTA on its own `PUBLIC_WEB_BASE_URL`. Production is
expected to be `https://app.beglib.com`, and this side allowlists exactly that origin. If
production ever serves the claim page from a different host, tell the outbound side before
the change ships — every CTA from an unlisted origin is rejected here rather than emailed.

**Invite lifetime.** `HOST_PROSPECT_MAX_INVITE_DAYS` defaults to 30. The outbound side
already keeps `expiresAt` at or below the contact verification's freshness date; confirm
the Conversio cap so the two limits do not surprise each other. If the cap is lowered
below what a campaign uses, requests start failing `invalid_contract`.

**Nothing else is shared.** No database, no dossiers, no source HTML, no notes, no social
handles, no inferred contact data. The outbound side sends only the minimal v1 request.

## What Conversio does not need to build

**The invitation email.** Conversio owns no invitation template and does not need one. The
outbound side sends the invitation, including the CTA link Conversio returns. The only
host-related template Conversio owns is the email verification code used later inside the
claim flow.

This split is worth restating because it is easy to assume the system that mints the token
also mails it. It does not, and if the outbound side is idle nobody sends anything.

## Verification once enabled

Run in this order. Steps 1 and 2 are Conversio-side; the outbound side runs 5.

1. `GET https://api.beglib.com/host/invite/session` stops answering
   `host_invite_unavailable`.
2. `GET /internal/v1/host-prospect-events` answers rather than reporting the feed disabled.
   This is the step most likely to be skipped, and its absence is invisible until campaign
   state never advances.
3. Issue one prospect to an address the operator controls. The response carries a `ctaUrl`
   on `app.beglib.com` with a 43-character fragment token.
4. Open the CTA in a signed-out browser and complete the claim.
5. Read the event feed and confirm `host_enrollment.accepted` appears, and confirm the
   invitation email preserved the fragment.

## Things that will waste time

- Enabling ingress without both secrets — the API will not boot.
- Enabling ingress and the public flow but leaving the event feed disabled — everything
  appears to work and no outcome is ever reported.
- Sending an extra JSON field; the schemas are `.strict()`.
- Signing a serialisation different from the bytes on the wire.
- Reusing a nonce, or a clock more than 300 seconds out.
- Serving the claim page from an origin the outbound side has not allowlisted.
- Any link rewriting that touches the URL fragment. A tracker that strips `#t=…` produces
  an invitation that reads perfectly and cannot be claimed.
