# Candidate Discovery Dossiers

## Purpose

Candidate discovery dossiers merge local discovery packages into one candidate-level record. They help review every candidate with all currently known channel candidates, contact candidates, affiliations, search targets, and provisional discovery-star prioritization.

This step does not approve outreach and does not create usable contact routes.

## Build Dossiers

```bash
npm run build:dossiers -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-excludes smoke,summary --output exports/openalex-wave-001-discovery-dossiers.local.json --markdown-output exports/openalex-wave-001-discovery-dossiers.local.md
```

Files under `exports/` are ignored by git.

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
