# Verification Queue

> **Superseded 2026-08-08.** The module that generated these tasks (`src/lib/verificationQueue.ts`)
> was deleted along with the rest of the dead browser-side library. It synthesised a task list
> from candidate records; the dashboard now derives the review queue from real operator state —
> a candidate is outstanding until it has a review outcome in the overlay — and the individual
> checks below have become gates that actually block: contact-route verification and
> suppression in `scripts/lib/outreach-policy.mjs`, identity match through per-channel
> verification in the dossier detail, jurisdiction as a preflight warning, and
> sensitive-category as a required named approver.
>
> The task taxonomy below is kept because it is still the right description of what a human
> has to check before outreach.

## Purpose

The verification queue turns discovery candidates into concrete human review tasks before any outreach is considered.

## Task Types

- `official-profile`: attach an official or highly reliable source.
- `contact-route`: find a public professional contact route, representative page, or approved contact form.
- `identity-match`: confirm social/media profiles belong to the same person.
- `jurisdiction`: confirm country, lawful outreach basis, and opt-out language.
- `suppression`: confirm do-not-contact handling.
- `sensitive-category`: run review for religion, politics, health, or other high-care contexts.

## Priority

- `urgent`: suppression or do-not-contact handling.
- `high`: strong candidate, missing contact route, high-risk category, or sensitive category.
- `medium`: unknown consent, jurisdiction, or identity confirmation.
- `low`: low-impact enrichment.

## Export

Generate a local Markdown checklist:

```bash
npm run export:verification -- data/your-private-batch.local.json
```

Use `--output` to control the destination:

```bash
npm run export:verification -- data/your-private-batch.local.json --output exports/wave-001-verification.local.md
```

Files under `exports/` are ignored by git.

## Official Source Review

Generate a richer official-source review package when a batch needs source and contact-route research:

```bash
npm run review:official-sources -- data/your-private-batch.local.json --output exports/wave-001-official-source-review.local.md --json-output exports/wave-001-official-source-review.local.json
```

This produces candidate-level official-source targets, search queries, current blockers, approved route rules, and disallowed collection reminders. Optional `--wikidata` mode can add public knowledge-graph suggestions, but those suggestions still require human identity confirmation.

## Rule

Completing verification does not automatically approve outreach. It only improves evidence quality. Compliance gates still decide whether a message can be staged.
