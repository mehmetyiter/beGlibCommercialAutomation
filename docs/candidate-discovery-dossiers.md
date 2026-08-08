# Candidate Discovery Dossiers

## Purpose

Candidate discovery dossiers merge local discovery packages into one candidate-level record. They help review every candidate with all currently known channel candidates, contact candidates, affiliations, search targets, and provisional discovery-star prioritization.

This step does not approve outreach and does not create usable contact routes.

## Build Dossiers

```bash
npm run build:dossiers -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-excludes smoke,summary --output exports/openalex-wave-001-discovery-dossiers.local.json --markdown-output exports/openalex-wave-001-discovery-dossiers.local.md
```

Files under `exports/` are ignored by git.

## Merging More Than One Candidate Pool

`--batch` is repeatable. Every batch is merged into one pool keyed by candidate id; on a
collision the record from the batch with the newer `createdAt` wins, and batches without a
`createdAt` fall back to command-line order. The merged file records each input under
`sources`, and the summary reports `sourceBatches` and `duplicateCandidateIds`.

```bash
npm run build:dossiers -- \
  --batch data/wikidata-all-waves-public-figures-combined.local.json \
  --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json \
  --review-id all-pools \
  --input-dir exports --filename-excludes discovery-dossiers,smoke,summary \
  --output exports/all-waves-discovery-dossiers.local.json \
  --markdown-output exports/all-waves-discovery-dossiers.local.md
```

Build every pool the dashboard should see into a single export. A candidate that is only in
a batch you did not pass is simply absent from the dashboard, which reads as "not in our
data" — the failure documented in `docs/dashboard-completion-plan.md`.

## The Operator Overlay

Hand-entered candidates, review outcomes, and channel identity verifications live in
`data/candidate-overlay.local.json` (`CANDIDATE_OVERLAY_PATH`), not in the generated export,
and are merged over the export at read time by both the dashboard and the outreach server.
Rebuilding dossiers overwrites `exports/` and never touches operator work.

A verified channel is marked `verified: true` with `confidence: "verified"` and carries an
`operatorVerification` block naming who confirmed it, when, and on what evidence. Verifying a
channel that the builder had quarantined moves it into `discoveryChannels`. This is identity
attribution only: contact routes still require a separate human verification through the
outreach gate before anything can be sent.

## Merged Sources

The dossier builder reads local packages with these modes:

- `creator-source-discovery`
- `feed-source-signal-discovery`
- `orcid-source-discovery`
- `public-identity-source-discovery`
- `public-page-contact-source-discovery`

It keeps every candidate from the source batch, even when no extra discovery has been found.

## Discovery Stars

Discovery stars are provisional review-priority signals. They are based on discovered YouTube, podcast, public social, contact-page, public-email, creator-source, and reach signals.

Discovery stars are not:

- Outreach permission
- Compliance approval
- Consent status
- A reason to delete low-star candidates

## Rules

- Keep every candidate, including low-star and no-star records.
- Keep public email candidates and contact-page candidates as discovery records until human verification.
- Do not guess emails or derive address patterns.
- Do not use private, login-only, hidden, breached, or technically restricted data.
- Complete identity, professional context, source URL, jurisdiction, suppression, and sensitive-category review before campaign use.
