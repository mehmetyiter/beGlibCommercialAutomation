# Session handover — 2026-08-07

Written to carry context into a new session. Everything below is verified, not planned.

## What exists now

An outreach send path that did not exist before this session. The repository previously had
no email sending code at all — every script printed "no outreach was sent". It now sends,
end to end, through AWS SES, and it did so against production today.

### Architecture

- **Local outreach server** `server/outreach-server.mjs`, loopback only, holds the SES
  credentials. Started with `npm run outreach:server`.
- **Dashboard** reaches it only through the Vite dev proxy, which injects the server token
  server-side. The browser never holds a credential.
- **CLI** `npm run outreach -- <command>` covers everything the dashboard does.
- **State** lives in `data/` (gitignored): suppression, contact verifications, approvals,
  outbox, provider events, append-only audit log.

### The gates a message passes

`OUTREACH_EMAIL_MODE=live` + complete sender identity + a current human verification of that
exact published contact route + an unused approval bound to the rendered body hash +
sensitive/senior approvals where required + clear suppression + no campaign duplicate +
remaining daily budget + an explicit live confirmation. Fails closed. The drain re-runs
suppression, message validity, and the limit immediately before handing bytes to SES.

## AWS state

| Item | Value |
| --- | --- |
| Outreach account | `488834260491` (beGlib Outreach), separate from Conversio's `591631301542` |
| Identity | `outreach.beglib.com`, DKIM verified, MAIL FROM `mail.outreach.beglib.com`, DMARC published |
| Configuration set | `beglib-outreach`, open/click tracking **off** |
| Bounce pipeline | SES → SNS → SQS, polled by `npm run outreach:pull-events`, proven with the mailbox simulator |
| Sender IAM user | `beglib-outreach-sender`, restricted to one From address through one configuration set |
| Console user | `beglib-console` (AdministratorAccess), sign in at `https://488834260491.signin.aws.amazon.com/console` |
| CLI profiles | `beglib-outreach` (scoped user in mgmt account), `beglib-child` (assumes `OrganizationAccountAccessRole` into the outreach account) |
| Working dir | `~/beglib-aws/` — bootstrap scripts, Cloudflare token, case reply draft |

**Blocking: SES production access is still pending.** The account is in sandbox (200/day,
verified recipients only). AWS asked for more detail; the reply is drafted at
`~/beglib-aws/case-178608684600985-reply.txt` and must be pasted into
[case 178608684600985](https://console.aws.amazon.com/support/home#/case/?displayId=178608684600985)
by hand — the Support API needs a paid support plan. **No real candidate can be emailed
until this is granted.**

## Conversio integration

Complete on the Conversio side. All three flags on, all three secrets injected, service
running `beglib-prod-api:7`.

Do not probe with `GET /host/invite/session` — it answers `host_invite_unavailable` whether
the flow is on or off, because a request without an invite token throws that error on its
own. The discriminating probe is any **POST** under `/host/invite`: `403 invalid_origin`
means the feature gate was passed.

The invitation email is sent by **this** system, not Conversio. Conversio owns only the
email verification code inside the claim flow.

## Proven end to end today

A real invitation to `info@crencyber.com`:

```
11:29:31  prospect issued          CTA on app.beglib.com, 43-char fragment token
11:30:0x  invitation sent          SES Delivery event, no bounce
11:32:36  landing_observed         link clicked, fragment survived the email
11:36:08  host_enrollment.active   enrollment completed
```

Final state: `prospectStatus: converted`, `enrollmentStatus: active`. The CTA token has
since been redacted from local state under the terminal retention policy.

## Configuration right now

```
OUTREACH_EMAIL_MODE   = dry_run          (deliberately; flip to live for the real wave)
OUTREACH_CAMPAIGN_ID  = host-pilot-001
From                  = beGlib Host Team <hosts@outreach.beglib.com>
Reply-To              = hosts@beglib.com          -> byfener2@yahoo.com
Opt-out               = unsubscribe@beglib.com    -> byfener2@yahoo.com
Postal address        = 60, 45e ave, Montreal, Quebec, Canada, H8T 2L7
Daily limit           = 25
Blocking issues       = none
```

`OUTREACH_CAMPAIGN_ID` scopes deduplication. Changing it lets the same candidate be
contacted again, so change it only when deliberately starting a new wave.

## Mistakes made and corrected today

Recorded so they are not repeated.

- `HOST_PROSPECT_ALLOWED_CTA_ORIGINS` was set to the bare apex; production CTAs are on
  `app.beglib.com` and every one would have been rejected.
- An IAM policy used `ses:ConfigurationSet`, which is not a real SES condition key, so the
  Allow never applied. Config-set restriction belongs in the resource ARN.
- The SES event poller never deleted non-event SNS notices, so they recycled forever.
- The bootstrap script created an IAM user with no console login profile, then switch-role
  was recommended on top of it — and root cannot switch roles anyway.
- `GET /host/invite/session` was used as a feature-flag probe. It cannot distinguish.

## Dashboard completion work

The research/review half of the dashboard is largely placeholder. The inventory of what
works, what does not, and the staged plan to finish it is in
[docs/dashboard-completion-plan.md](dashboard-completion-plan.md). Start there.

It also documents the candidate-pool merge bug: the dossier builder reads one batch file at
a time, which is why the list showed 409 candidates, then 28,113, and why a candidate
present in one pool vanished when the other was built.

## Next up (the user's stated plan)

1. Reply to the AWS support case so production access is granted.
2. Examine the candidate database and prioritise **Canada-origin** host candidates.
3. Add a **country filter** to the dashboard UI to make that triage fast.
4. Confirm the send flow is ready in the UI, then start the pilot wave.

Candidate data lives in `data/*.local.json` (778 files) and carries a `country` field.
`exports/` currently holds only the Host prospect state — dossiers must be rebuilt with
`npm run build:dossiers` before the dashboard shows anything.

For the first real wave, consider lowering `OUTREACH_DAILY_SEND_LIMIT` to 5–10. The first
days on a new sending domain set its reputation.

## Running it

```bash
npm run outreach:server   # terminal 1
npm run dev               # terminal 2, dashboard on :5173
npm run outreach:config   # effective config and any blocking issues
npm run outreach:status   # outbox, suppression, provider events
npm test                  # 135 tests
```
