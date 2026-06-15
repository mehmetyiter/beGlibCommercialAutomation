# Creator Signal Review

## Purpose

Creator-signal review verifies public media and audience signals used by the star rating system. It is separate from official contact verification and does not approve outreach.

Use this layer to check whether a candidate already has:

- YouTube/video publishing
- Podcast or interview activity
- Newsletter activity
- Public X, LinkedIn, Instagram, TikTok, or other creator profile signals
- Visible public audience counts where source terms allow review

## Generate A Review Package

```bash
npm run review:creator-signals -- data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --output exports/openalex-wave-001-creator-signal-review.local.md --json-output exports/openalex-wave-001-creator-signal-review.local.json
```

Optional filter:

```bash
npm run review:creator-signals -- data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --categories psychology,medicine --limit 25 --output exports/openalex-health-creator-signal-review.local.md --json-output exports/openalex-health-creator-signal-review.local.json
```

The script writes:

- Candidate-level YouTube, podcast, newsletter, and social search queries.
- Platform-specific review targets.
- Guardrails for public-count verification.
- A blank `reviewOutcome` object for human review.

Files under `exports/` are ignored by git.

## Review Outcome

Completed outcomes can be stored under `reviewOutcome` or an `outcomes` array.

Important fields:

- `candidateId`
- `outcomeStatus`
- `verifiedAt`
- `channels`
- `influenceSignals`
- `sourceUrls`
- `reviewerNotes`

Allowed `outcomeStatus` values:

- `pending`: not reviewed yet.
- `verified-signals`: one or more creator/media signals were verified.
- `profile-only`: a creator/media profile was verified, but audience counts were not approved.
- `needs-more-review`: reviewer could not complete verification.
- `rejected`: source match was not reliable enough.

Only `verified-signals` and `profile-only` produce candidate updates.

## Apply Completed Outcomes

```bash
npm run review:apply-creator-signals -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --review exports/openalex-wave-001-creator-signal-review.local.json --output data/openalex-wave-001-creator-signal-updates.local.json
```

Validate before importing:

```bash
npm run validate:batch -- data/openalex-wave-001-creator-signal-updates.local.json
```

The importer:

- Adds verified creator/media channels.
- Updates `influenceSignals`.
- Updates local prioritization/star strength.
- Does not add contact routes.
- Does not change consent status.
- Does not approve outreach.

## Data Rules

- Do not guess follower or subscriber counts.
- Do not scrape hidden or login-only audience data.
- Do not collect private messages or private emails.
- Use public profile/channel/page evidence and source URLs.
- Date-stamp every verified signal.

Synthetic smoke test:

```bash
npm run review:apply-creator-signals -- --batch examples/research-batch.synthetic.json --review examples/creator-signal-review-outcomes.synthetic.json --output data/synthetic-creator-signal-updates.local.json
```
