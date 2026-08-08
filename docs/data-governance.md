# Data Governance

## Storage Rule

Code can live in GitHub. Operational data should live outside GitHub.

Never commit:

- Real candidate lead lists
- Real email addresses from research
- Suppression lists
- Message bodies or replies
- API keys
- Provider exports
- Database dumps
- Browser cookies or session files

The repo ignores `data/`, `exports/`, and `logs/` by default while keeping empty `.gitkeep` files.

## Outreach State Retention

Outreach state lives under `data/` and never leaves the local machine: the suppression
list, contact-route verifications, message approvals, the outbox, provider-event
counters, the append-only audit log, and the local server token.

Message bodies are the most sensitive part of that state. `npm run outreach:redact` drops
the body text from terminal outbox records older than 90 days while keeping the audit
trail — actor, timestamp, body hash, and provider message id — so a send stays
reconstructible for compliance without retaining the copy indefinitely.

Suppression entries are never deleted. Revoking one records a revocation stamp, a named
actor, and a reason; the original entry stays for audit.

## Minimum Candidate Evidence

Before any outreach, each candidate must have:

- Official or reliable source URL
- Professional contact route or representative route
- Last verification date
- Jurisdiction
- Language
- Category and subcategory
- Outreach rationale
- Compliance status

## Suppression Handling

Suppression wins over every other signal. If a person opts out, asks for deletion, complains, or is marked do-not-contact, the system must:

- Stop all outbound communication.
- Add the person or route to the suppression list.
- Keep only the minimum record needed to avoid future contact.
- Require human approval for any future status change.

## Jurisdiction Notes

United States:

- Commercial email must use accurate identity, non-deceptive subject lines, a valid physical mailing address, and an opt-out route.

Canada:

- CASL generally requires consent, identification information, and an unsubscribe mechanism for commercial electronic messages.

European Union and United Kingdom:

- GDPR and ePrivacy rules require a valid processing basis, objection handling, minimization, and special care for direct marketing.

Turkey:

- KVKK and electronic commercial communication rules require careful consent, disclosure, and opt-out handling. Do not bundle unrelated consents.

## Automation Guardrails

- No guessed emails.
- No bypassing platform restrictions.
- No buying unverified mass lists.
- No automated sends to unknown-consent contacts.
- No AI auto-send for legal, privacy, payment, contract, or sensitive-category replies.
