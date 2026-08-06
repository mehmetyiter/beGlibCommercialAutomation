# Host Prospect Contract v1

This directory is the canonical boundary between Conversio and
beGlibCommercialAutomation. Conversio owns this copy. The automation repository
keeps a byte-for-byte consumer snapshot and verifies its fixtures independently.

## Versioning

Version 1 is intentionally closed: requests, responses, and events reject
unknown fields. Any wire-field, required-field, enum, state-pair, endpoint, or
HMAC canonicalization change therefore requires a new contract version and an
overlap period in which both versions are supported. Documentation corrections
that do not change wire behavior may remain in v1. Conversio publishes first;
Automation updates its snapshot and consumer before v1 can be retired.

## Pilot Boundary

Version `1.0` accepts only email endpoints whose association with the candidate
has been human verified. Representative, team, shared-office, contact-form, and
unknown associations are discovery data only and cannot create a pilot Host
prospect.

OTP eligibility is derived from the association evidence. It is not a caller
controlled boolean:

```text
associationType = candidate_owned
AND recipientKind = candidate
AND evidenceStatus = human_verified
AND suppressionStatus = clear
AND verificationFreshUntil > now
AND verificationFreshUntil >= prospect expiresAt
AND complianceDecision = approved
AND contactPurpose = host_invitation
```

The contact email is Host-invitation data only. It does not grant marketing
consent, replace an SSO provider email, or become an account-recovery address.

Create responses carry a canonical private CTA on a lowercase public DNS
hostname. Explicit ports, IP literals, userinfo, query parameters, and
non-canonical host casing are rejected. The bearer remains exclusively in the
`#t=` fragment.

## HMAC Authentication

All internal requests use these headers:

- `X-BeGlib-Key-Id`
- `X-BeGlib-Timestamp` as Unix seconds
- `X-BeGlib-Nonce` as a unique opaque value
- `X-BeGlib-Signature` as lowercase hexadecimal HMAC-SHA256
- `Idempotency-Key` for every mutation

The signed bytes are UTF-8 and use this exact canonical form:

```text
v1\n{timestamp}\n{nonce}\n{UPPERCASE_METHOD}\n{path_with_sorted_query}\n{sha256_hex_of_raw_body}
```

Query names and values are first percent encoded with RFC 3986 rules, then
sorted by encoded name and encoded value using ascending Unicode code-unit
order. Locale-aware comparison is forbidden. An empty query is omitted from
the path. The body hash is the SHA-256 of the exact bytes received, including an
empty body. Implementations reject a clock skew greater than 300 seconds and
retain each accepted `(keyId, nonce)` for at least 600 seconds. Key IDs permit
overlap during secret rotation. Credential key IDs authenticate one stable,
server-configured integration principal; rotation never changes data ownership
or event-feed scope.

An idempotency key is scoped to the stable integration principal, method, and
path. Reuse with the same
body returns the original result; reuse with a different body returns
`409 idempotency_conflict`.

Idempotency keys and nonces must be cryptographically random opaque values with
at least 128 bits of entropy. They must not contain candidate names, email
addresses, campaign titles, or other business data.

## Event Feed

Automation pulls the event feed from a local CLI or another trusted server
process. Browser JavaScript and `localStorage` must never receive HMAC secrets.
Only events marked `authoritative: true` may advance campaign state. Landing
page observations are deliberately non-authoritative because link scanners and
email security products can open links.

Events contain integration identifiers and state, never email addresses, OTPs,
OAuth identities, tokens, or provider metadata.

Authoritative event state pairs are fixed:

| Event | Prospect status | Enrollment status |
| --- | --- | --- |
| `host_prospect.interest_confirmed` | `interest_confirmed` | `claim_started` |
| `host_prospect.revoked` | `revoked` | absent or `revoked` |
| `host_prospect.expired` | `expired` | absent or `expired` |
| `host_enrollment.email_challenge_sent` | `enrollment_started` | `email_verification_pending` |
| `host_enrollment.email_verified` | `enrollment_started` | `email_verified` |
| `host_enrollment.sso_verified` | `enrollment_started` | `sso_verified` |
| `host_enrollment.manual_review_required` | `enrollment_started` | `manual_review` |
| `host_onboarding.started` | `enrollment_started` | `onboarding` |
| `host_onboarding.completed` | `enrollment_started` | `accepted` |
| `host_enrollment.accepted` | `enrollment_started` | `accepted` |
| `host_enrollment.rejected` | `rejected` | `rejected` |
| `host_enrollment.active` | `converted` | `active` |
| `host_enrollment.already_active` | `converted` | `already_active` |
| `host_enrollment.revoked` | `revoked` | `revoked` |

`host_prospect.landing_observed` is non-authoritative, carries the current
prospect status, and has no enrollment status. Event pages use a stable,
server-assigned append order and contain unique event IDs; `occurredAt` remains
the business timestamp and may move backwards across a page. Cursors are opaque
and must not be parsed by Automation. Delivery is at least once: Automation persists the cursor
only after applying the whole page transactionally and deduplicates globally by
event ID.

Host activation consumes exactly one valid `accepted` entitlement in the same
transaction that grants the Host role. A first-time Host transitions to
`active`; an existing Host transitions to `already_active` without status
downgrade. Both outcomes convert the prospect and emit the matching event.
