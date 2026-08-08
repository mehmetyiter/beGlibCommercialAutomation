# Host prospect integration — production handover

- Written: 2026-08-07
- Audience: whoever adapts `beGlibCommercialAutomation` to the production
  Conversio deployment
- Companion: `production-cutover-handover-2026-08-06.md`

This is the contract between the outbound campaign system and Conversio. It is
written to be handed to someone with no context on the Conversio side.

## What each side owns

The invite is a two-system flow, and the split is not the obvious one.

**`beGlibCommercialAutomation` owns:**
- deciding who gets invited, and the campaign records behind that decision
- proving it holds a candidate-owned, verified email contact
- calling Conversio to issue a prospect
- **sending the invitation email**, including the CTA link Conversio returns
- consuming the event feed to learn what happened afterwards

**Conversio owns:**
- issuing the prospect and **minting the CTA URL and its bearer token**
- the entire claim journey the candidate sees: `/host/invite`, SSO start and
  recovery, email challenge, confirmation
- host enrolment, manual review, and the resulting host account

The CTA URL is **returned by Conversio**, not supplied by the caller. Do not
construct it. Its host follows Conversio's own `PUBLIC_WEB_BASE_URL`, which in
production is `https://app.beglib.com`, so the automation needs no URL
configuration for it.

Conversio has **no invitation email template**. If the automation does not send
the email, nobody does. The only host-related template Conversio owns is the
email verification code used later inside the claim flow.

## Endpoints

Base URL in production: `https://api.beglib.com`

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/internal/v1/host-prospects` | Issue a prospect, returns the CTA URL |
| POST | `/internal/v1/host-prospects/:prospectId/revoke` | Withdraw an issued prospect |
| GET | `/internal/v1/host-prospect-events` | Outcome feed, cursor paginated |

Beta used the beta API host. The only endpoint change for production is the
base URL; paths and the contract are unchanged.

## Authentication

Every internal request carries four headers plus an idempotency key:

| Header | Value |
| --- | --- |
| `X-BeGlib-Key-Id` | The HMAC key id agreed with Conversio |
| `X-BeGlib-Timestamp` | Unix seconds; rejected beyond 300s of skew |
| `X-BeGlib-Nonce` | Unique per request; replay window is 600s |
| `X-BeGlib-Signature` | Lowercase hex HMAC-SHA256, 64 characters |
| `Idempotency-Key` | Required on writes |

The signature covers a canonical request built as six newline-joined lines:

```
v1
<timestamp>
<nonce>
<HTTP METHOD, uppercase>
<path with canonicalised query>
<hex sha256 of the exact raw request body>
```

Signed with `HMAC-SHA256(secret, canonicalRequest)`, hex encoded. The body hash
must be computed over the **exact bytes sent** — serialise once, hash that
buffer, and send that same buffer. Re-serialising after signing will produce a
different body and fail verification.

Reference implementations live in `apps/api/src/hostProspects/contract.ts`:
`buildHostProspectCanonicalRequest` and `signHostProspectCanonicalRequest`.

## Create request

`contractVersion` is the literal `"1.0"`. The schema is `.strict()`: any
unknown field is rejected, so do not send extra keys.

```jsonc
{
  "contractVersion": "1.0",
  "externalCandidateId": "…",   // your id, [A-Za-z0-9][A-Za-z0-9._:-]*
  "campaignId": "…",
  "campaignMemberId": "…",
  "contact": {
    "endpoint": { "type": "email", "value": "host@example.com" },
    "association": {
      "verifiedAt": "…",              // ISO 8601 with offset
      "verificationFreshUntil": "…"
    }
    // see candidateOwnedEmailContactSchema for the remaining fields
  },
  "candidate": {
    "displayName": "…",               // 1-200 chars
    "preferredLocale": "en-CA",
    "countryCode": "CA",              // optional, exactly two uppercase letters
    "topics": ["…"]                   // max 20, must be unique
  },
  "requestedAt": "…",
  "expiresAt": "…"
}
```

Three cross-field rules are enforced and each returns `invalid_contract`:

- `contact.association.verifiedAt` must not be later than `requestedAt`
- `expiresAt` must be later than `requestedAt`
- `expiresAt` must not exceed `contact.association.verificationFreshUntil`

The last one is the one that bites: an invite may not outlive the freshness of
the contact verification it rests on.

## Create response

```jsonc
{
  "contractVersion": "1.0",
  "prospectId": "<uuid>",
  "status": "issued",
  "ctaUrl": "https://app.beglib.com/host/invite#t=<43-character token>",
  "contactPolicy": { "otpEligibility": "eligible", "evaluatedAt": "…" },
  "expiresAt": "…"
}
```

Put `ctaUrl` in the email verbatim. The token lives in the URL **fragment**, so
it never reaches a server log — do not move it into the query string, and do not
wrap it in a click tracker that rewrites or drops the fragment. A tracker that
strips `#t=…` silently produces an invite that cannot be claimed.

## Event feed

`GET /internal/v1/host-prospect-events` is cursor paginated and reports:

`host_prospect.landing_observed`, `host_prospect.interest_confirmed`,
`host_prospect.revoked`, `host_prospect.expired`,
`host_enrollment.email_challenge_sent`, `host_enrollment.email_verified`,
`host_enrollment.sso_verified`, `host_enrollment.manual_review_required`,
`host_enrollment.accepted`, `host_enrollment.rejected`,
`host_onboarding.started`, `host_onboarding.completed`.

This is how the campaign side learns an invite succeeded. Conversio does not
call back.

## Production is not ready for this yet

**The flow is disabled in production.** `GET /host/invite/session` currently
answers `host_invite_unavailable`, and `infra/aws/prod-platform/locals.tf`
contains no `HOST_PROSPECT_*` variables at all, so every flag sits at its
default.

Before the automation can issue a single prospect, the Conversio side needs:

| Setting | Needed |
| --- | --- |
| `HOST_PROSPECT_INGRESS_ENABLED` | `true` (default `false`) |
| `HOST_PROSPECT_PUBLIC_FLOW_ENABLED` | `true` (default `false`) — without it the candidate cannot claim |
| `HOST_PROSPECT_INTEGRATION_ID` | the agreed integration id |
| `HOST_PROSPECT_HMAC_KEYS_JSON` | at least one key; ingress refuses to start otherwise |
| `HOST_PROSPECT_CTA_TOKEN_SECRET` | 32 characters minimum |

The last two are secrets. `HOST_PROSPECT_CTA_TOKEN_SECRET` is **not** in the
fifteen-secret production contract, so adding it means a new secret to
provision, an IAM grant to read it, and a Terraform change — see
`prod-secret-provisioning-inventory.md`. Treat that as its own piece of work
rather than something to squeeze into a release.

Note the startup guards in `apps/api/src/hostProspects/config.ts`: enabling
ingress without an HMAC key or without the CTA secret makes the API refuse to
boot. Enable the flags and provision the secrets in the same change.

## Verifying the integration once enabled

1. `GET https://api.beglib.com/host/invite/session` should stop answering
   `host_invite_unavailable`.
2. Issue one prospect to an address you control and confirm the response carries
   a `ctaUrl` on `app.beglib.com` with a 43-character fragment token.
3. Open the CTA in a browser that is not signed in and complete the claim.
4. Read the event feed and confirm `host_enrollment.accepted` appears.
5. Confirm the invitation email your side sent preserved the fragment.

## Things that will waste your time

- Sending an extra JSON field. The schemas are `.strict()`.
- Signing a serialisation different from the bytes on the wire.
- Reusing a nonce, or a clock more than 300 seconds out.
- Building the CTA URL yourself. Conversio mints the token; a self-built URL
  cannot validate.
- Any link rewriting that touches the URL fragment.
