# Email Sending

Outreach mail is sent through AWS SES from a **deliberately separate sending identity**
from Conversio's transactional mail. This document covers why, how to set the identity
up, and the local runtime.

## Why outreach does not share the Conversio sender

Conversio sends transactional mail (OTP, receipts, Host enrollment) from
`no-reply@beglib.com` through the `beglib-prod` configuration set. Commercial outreach
must not ride on that identity for three reasons:

1. **Reputation is enforced at the account level.** SES evaluates bounce and complaint
   rates per account per region and can pause sending for the whole account. Cold
   outreach to discovered public addresses has structurally higher bounce and complaint
   rates than transactional mail. A pause caused by outreach would take down Conversio's
   OTP and receipt delivery.
2. **The sender identity is different in kind.** Commercial messages need an accurate
   sender, a monitored reply mailbox, and a working opt-out. `no-reply@` satisfies none
   of those.
3. **Blast radius.** A separate identity, configuration set, and IAM principal means a
   credential or reputation problem on one side cannot reach the other.

The two systems share no code. Conversio's email module is bound to Prisma, Postgres,
and BullMQ; this repository has none of those. What is reused is the *pattern*: an
outbox with dedupe keys, an `off | dry_run | live` mode switch, a claim-then-send worker,
and an append-only audit trail.

## One-time AWS setup

All of this lives in the same AWS account as Conversio unless you later promote outreach
to its own account. Region should match Conversio's (`ca-central-1`) only for
convenience; nothing requires it.

### 1. Verify a dedicated subdomain identity

Create a domain identity for a subdomain that is used for nothing else, for example
`outreach.beglib.com`. Do **not** reuse the root domain.

- Enable Easy DKIM and publish the three `CNAME` records.
- Set a custom MAIL FROM domain (`mail.outreach.beglib.com`) and publish its `MX` and
  SPF `TXT` records. This aligns SPF with the visible from address.
- Publish DMARC for the subdomain, starting at `p=none` while you observe reports:
  `_dmarc.outreach.beglib.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@beglib.com"`

Wait for the identity to reach `Verified` and for DKIM to show `Success` before sending.

### 2. Create a dedicated configuration set

Create `beglib-outreach`. Keeping outreach in its own configuration set is what lets you
read outreach reputation metrics separately, and it is a prerequisite for moving outreach
to a dedicated IP pool if volume ever justifies one.

Leave open and click tracking **off**. The message templates contain no tracking pixel by
design; enabling SES tracking would rewrite links and add one.

### 3. Wire the feedback loop through SNS to SQS

Bounces and complaints must reach the local suppression list. A public webhook is not
needed:

1. Create an SNS topic, e.g. `beglib-outreach-events`.
2. On the `beglib-outreach` configuration set, add an event destination publishing
   `Bounce`, `Complaint`, `Delivery`, and `Reject` to that topic.
3. Create an SQS queue, e.g. `beglib-outreach-events`, and subscribe it to the topic.
4. Put the queue URL in `OUTREACH_SES_EVENT_QUEUE_URL`.

`npm run outreach:pull-events` polls the queue, suppresses permanent bounces and
complaints, and deletes queue messages only after the events are durably recorded.

### 4. Create a restricted IAM user

Give outreach its own IAM user with only what it needs. Scope `ses:SendEmail` by both
from address and configuration set so a leaked key cannot send as the transactional
identity:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": "hosts@outreach.beglib.com",
          "ses:ConfigurationSet": "beglib-outreach"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:DeleteMessageBatch"],
      "Resource": "arn:aws:sqs:ca-central-1:<account-id>:beglib-outreach-events"
    }
  ]
}
```

Put the key pair in `OUTREACH_AWS_ACCESS_KEY_ID` / `OUTREACH_AWS_SECRET_ACCESS_KEY` in
`.env.local`. Leave both empty to fall back to the ambient AWS credential chain instead.

### 5. Confirm production access

A sandbox account can only send to verified addresses. Check whether the account already
has production access; if not, request it and describe the outreach use case honestly:
opt-out handling, suppression list, bounce/complaint processing, and the small pilot
volume. Cold outreach is permitted by SES but is reviewed on exactly those controls.

### 6. Set up the reply mailbox

`OUTREACH_REPLY_TO_ADDRESS` and `OUTREACH_UNSUBSCRIBE_MAILTO` must be real mailboxes a
human reads. Opt-out requests arriving there have to be entered into the suppression list
promptly — see the runtime section below.

## Configuration

Copy `.env.example` to `.env.local` and fill the outreach block. The system fails closed:
until every identity field is present, `npm run outreach:config` reports blocking issues
and no message can be staged in any mode.

| Variable | Purpose |
| --- | --- |
| `OUTREACH_EMAIL_MODE` | `off` (default), `dry_run`, or `live`. |
| `OUTREACH_CAMPAIGN_ID` | Dedupe scope. One first-touch per candidate per campaign. |
| `OUTREACH_FROM_ADDRESS` / `OUTREACH_FROM_NAME` | Visible sender. |
| `OUTREACH_REPLY_TO_ADDRESS` | Monitored human mailbox. Must differ from the from address. |
| `OUTREACH_UNSUBSCRIBE_MAILTO` | Opt-out mailbox, used in the footer and `List-Unsubscribe`. |
| `OUTREACH_SENDER_LEGAL_NAME` | Legal entity in the footer. |
| `PHYSICAL_MAILING_ADDRESS` | Postal address in the footer. Required by CAN-SPAM. |
| `OUTREACH_SES_CONFIGURATION_SET` | Required in live mode. |
| `OUTREACH_SES_EVENT_QUEUE_URL` | SQS queue for bounces and complaints. |
| `OUTREACH_DAILY_SEND_LIMIT` | Hard daily cap on real sends (default 25). |
| `OUTREACH_REQUIRE_HUMAN_APPROVAL` | Leave `true`. |
| `OUTREACH_VERIFICATION_MAX_AGE_DAYS` | Ceiling on contact-route freshness (default 90). |

## Running it

Two processes:

```bash
npm run outreach:server   # local send API on 127.0.0.1:5174
npm run dev               # dashboard; proxies /api/outreach to the server
```

The dashboard reaches the send API only through the Vite dev proxy, which injects the
server token server-side. The browser never holds a credential, and the outreach server
rejects any request without that token. If the server is not running, the dashboard's
Outreach tab says so and every other feature keeps working.

Select a candidate, open the **Outreach** tab, and work down the steps. Everything the UI
does is also available from the CLI:

```bash
npm run outreach -- config
npm run outreach -- datasets
npm run outreach -- candidate --dataset <dataset-id> --candidate-id <id>
npm run outreach -- verify --dataset <dataset-id> --candidate-id <id> \
  --email name@example.org --source-url https://example.org/contact \
  --method official-site-contact-page --fresh-until 2026-11-01T00:00:00Z \
  --reviewer reviewer:you --note "Listed under Contact."
npm run outreach -- preview --dataset <dataset-id> --candidate-id <id> --email name@example.org
npm run outreach -- approve --dataset <dataset-id> --candidate-id <id> \
  --email name@example.org --approved-by reviewer:you --note "Pilot wave 1"
npm run outreach -- stage --dataset <dataset-id> --candidate-id <id> --email name@example.org --actor operator:you
npm run outreach:send                 # dry-run unless mode is live
npm run outreach:send -- --live       # real delivery, requires mode=live too
npm run outreach:retry -- --all --actor operator:you
npm run outreach:status
npm run outreach:pull-events
```

## Retrying a failed message

A provider-side failure — throttling, an SES outage, a misconfigured IAM policy — leaves
the message `failed`. `outreach retry` returns it to the queue **without** asking for a
fresh approval, because the approval was bound to the message's body hash and a transport
failure does not change a single byte of what was approved.

It is deliberately narrow. Retry refuses when re-sending would no longer be the approved
message or would no longer be appropriate:

- the stored message no longer validates against current configuration (for example the
  postal address or sender name changed after approval, so the queued footer is stale)
- the address has since been suppressed
- the contact verification has expired or been revoked

In those cases the operator has to re-verify or re-approve, which is the point.

## The gates

Every send path runs one shared preflight, and the queue drain re-runs the
delivery-relevant part immediately before handing bytes to SES. A suppression added while
a message sits in the queue therefore still stops it.

1. **Mode** must not be `off`.
2. **Configuration** must be complete: sender identity, postal address, reply-to, opt-out.
3. **Candidate status** must not be `do-not-contact`; consent must not be `opted-out` or
   `not-allowed`.
4. **Suppression list** must not match the address or its domain.
5. **A current human verification** must exist for that exact address: a published
   professional route, the source URL, the method, the reviewer, an evidence note, and a
   freshness date. Guessed patterns are rejected. Freshness is capped at
   `OUTREACH_VERIFICATION_MAX_AGE_DAYS` regardless of what the reviewer entered.
6. **The rendered message** must contain the sender legal name, the postal address, and
   the opt-out mailbox, with no unresolved template placeholders.
7. **An unused approval** must match the message's body hash. Changing the template, the
   topics, or the sender footer changes the hash and invalidates the approval.
8. **Sensitive-category candidates** additionally need a named sensitive-category
   reviewer on the approval; **high-risk candidates** need a senior approval reference.
9. **Dedupe**: one first-touch per candidate per campaign. Only a previously failed
   message may be retried.
10. **Daily limit** must not be exhausted.

One approval authorises exactly one message. It is consumed at staging.

Live delivery needs three independent things to line up: `OUTREACH_EMAIL_MODE=live`, an
explicit confirmation on the send request (`--live` on the CLI, a checkbox in the
dashboard), and a passing preflight.

## Host invitations

`tmpl-host-invite` carries the Conversio claim link. It is the one template that reaches
into the Host prospect state, and the flow differs from a plain first-touch:

1. Issue a prospect with `host-prospect:prepare` → `host-prospect:create --live`.
2. Record the response with `host-prospect:record-response`, which stores the CTA URL in
   the private state file.
3. Preview with `--template tmpl-host-invite`. The renderer pulls the claim link for that
   candidate and refuses if no invitable prospect exists.
4. Approve and send as usual.

Extra gates apply to invitations on top of the normal ones:

- The claim link must match the v1 contract shape and sit on an allowlisted origin
  (`HOST_PROSPECT_ALLOWED_CTA_ORIGINS`, which in production is `https://app.beglib.com`).
- Both bodies must contain the link verbatim. Open and click tracking stay off on the SES
  configuration set: a tracker that rewrote the link would drop the `#t=` fragment and
  produce an invitation that reads correctly and cannot be claimed.
- A terminal, expired, or CTA-redacted prospect is not invitable.
- No other template may carry a claim link.

The claim token never reaches the browser. The dashboard is served a masked copy whose
body hash is the real one, so approving what is shown authorises the exact bytes sent.

## Handling replies and opt-outs

Replies go to `OUTREACH_REPLY_TO_ADDRESS`. When someone asks not to be contacted, asks
how their data was obtained, requests deletion, or complains:

```bash
npm run outreach -- suppress --value name@example.org --reason opt-out-request --actor operator:you
```

Suppression wins over everything else and takes effect immediately, including for
messages already sitting in the queue. Bounces and complaints reaching the SQS queue are
suppressed automatically by `npm run outreach:pull-events`; transient bounces are counted
but do not suppress.

## Local state and retention

All operational state lives under `data/` and is gitignored:

| File | Contents |
| --- | --- |
| `outreach-suppression.local.json` | Suppression list. |
| `outreach-contacts.local.json` | Human contact-route verifications. |
| `outreach-approvals.local.json` | Message approvals bound to body hashes. |
| `outreach-outbox.local.json` | Queued, sent, failed, and suppressed messages. |
| `outreach-ses-events.local.json` | Processed provider-event keys and counters. |
| `outreach-audit.local.jsonl` | Append-only audit trail. |
| `.outreach-server-token.local` | Local API token, mode `0600`. |

Message bodies are the most sensitive part. `npm run outreach:redact` drops the body text
from terminal records older than 90 days while keeping the audit trail — who, when, which
hash, which provider message id.

## Before the first real wave

- `npm test` passes.
- `npm run outreach:config` reports no blocking issues.
- The identity is verified, DKIM succeeds, and DMARC is published.
- Production access is granted (the account is out of the sandbox).
- The SQS event pipeline is wired and `npm run outreach:pull-events` returns cleanly.
- The reply mailbox is monitored by a person.
- One live message has been sent to your own address and inspected: the footer renders,
  `List-Unsubscribe` is present, DKIM and SPF pass in the received headers.
- The first wave stays inside the pilot size in `docs/outreach-playbook.md`.

## If volume grows

Promote outreach to its own AWS account under Organizations. That is the only way to make
an account-level sending pause structurally unable to affect Conversio's transactional
mail. It requires a fresh identity verification and a separate production-access request,
so it is worth doing before scaling past the pilot rather than after an incident.
