# Official Source Review

## Purpose

Official-source review turns discovery candidates into concrete verification work. It does not approve outreach and it does not mark contact routes usable by itself.

Use this step after a discovery batch, especially OpenAlex waves where candidates have authority signals but no verified professional contact route.

## Generate A Review Package

```bash
npm run review:official-sources -- data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --output exports/openalex-wave-001-official-source-review.local.md --json-output exports/openalex-wave-001-official-source-review.local.json
```

The script writes:

- A Markdown checklist for human review.
- A JSON review package for future UI/database import.
- Candidate-level search queries.
- Official source targets.
- Approved and disallowed contact-route rules.
- Current blockers and sensitive-category flags.
- A blank `reviewOutcome` object that can be filled after human verification.

Files under `exports/` are ignored by git.

## Optional Wikidata Suggestions

Use Wikidata suggestions only as identity-disambiguation hints:

```bash
npm run review:official-sources -- data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --limit 25 --wikidata --output exports/openalex-wave-001-wikidata-sample.local.md --json-output exports/openalex-wave-001-wikidata-sample.local.json
```

Wikidata matches are not verified. A human must confirm identity, official website claims, category fit, and source reliability before any contact route is added.

## Approved Source Types

- Official personal site
- Institution, employer, lab, studio, publisher, practice, clinic, or organization profile
- Representative, agent, speaker, booking, press, or media-office page
- Official contact form
- Public business profile route where platform terms allow professional inquiry

## Disallowed Collection

- Guessed email patterns
- Private personal emails not published for professional contact
- Breached, purchased, scraped, or hidden contact data
- Login-only data or data behind technical restrictions
- Social DMs unless the profile explicitly invites professional contact

## Review Outcome

A completed review should produce structured fields under `reviewOutcome` or an `outcomes` array:

- `candidateId`
- `outcomeStatus`
- `officialProfileUrl`
- `officialContactRouteType`
- `officialContactRouteValue`
- `contactRouteSourceUrl`
- `verifiedAt`
- `jurisdiction`
- `suppressionStatus`
- `sensitiveCategoryReviewStatus`
- `reviewerNotes`

Those fields should later flow into the private candidate database or a local import batch, not into the public repository.

Allowed `outcomeStatus` values:

- `pending`: not reviewed yet.
- `verified-route`: official profile and usable professional route were verified.
- `profile-only`: official profile was verified, but no usable contact route was approved.
- `needs-more-review`: reviewer could not complete verification.
- `rejected`: source match was not reliable enough.
- `do-not-contact`: suppression, opt-out, or not-allowed status was confirmed.

Only `verified-route`, `profile-only`, and `do-not-contact` produce candidate updates.

## Apply Completed Outcomes

Use the importer after a reviewer fills the local JSON review outcomes:

```bash
npm run review:apply-official-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --review exports/openalex-wave-001-official-source-review.local.json --output data/openalex-wave-001-official-source-updates.local.json
```

The importer:

- Rejects guessed email patterns.
- Requires official URLs for applied profile and route updates.
- Requires `suppressionStatus: clear` before adding profile or route evidence.
- Maps route types into conservative consent statuses.
- Keeps health, mental-health, religion, and high-risk candidates in review-first territory.
- Produces a normal research batch that can be validated and imported into the cockpit.

Validate the update batch before importing:

```bash
npm run validate:batch -- data/openalex-wave-001-official-source-updates.local.json
```

## Apply In The Cockpit

The local web cockpit can also apply completed review outcomes:

1. Run the app with `npm run dev`.
2. Use `Apply review` in the official review panel.
3. Select the local JSON review package or outcomes file.
4. Review the updated counts and vault status.

The cockpit uses the same conservative checks as the CLI importer. It updates the local browser vault only; it does not send outreach and does not write operational data into git.

Synthetic importer smoke test:

```bash
npm run review:apply-official-sources -- --batch examples/research-batch.synthetic.json --review examples/official-source-review-outcomes.synthetic.json --output data/synthetic-official-source-updates.local.json
```
