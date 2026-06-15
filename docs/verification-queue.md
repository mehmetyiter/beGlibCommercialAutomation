# Verification Queue

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
