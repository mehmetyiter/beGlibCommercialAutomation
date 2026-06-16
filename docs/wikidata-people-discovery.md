# Wikidata People Discovery

## Purpose

Wikidata people discovery expands the candidate pool beyond OpenAlex by using public occupation metadata. It is useful for social-first and public-figure categories such as YouTubers, podcasters, artists, musicians, journalists, psychologists, doctors, therapists, and religious leaders.

This step does not approve outreach and does not create usable contact routes.

## Generate A Discovery Batch

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-001.json --limit 8 --delay-ms 2000 --output data/wikidata-wave-001-broad-public-figures.local.json
```

Files under `data/` are ignored by git.

## Merge Offset Batches

When you run multiple offsets, merge them before building dossiers:

```bash
npm run research:merge-batches -- --batch-id wikidata-wave-001-broad-public-figures --output data/wikidata-wave-001-broad-public-figures-combined.local.json data/wikidata-wave-001-broad-public-figures.local.json data/wikidata-wave-001-broad-public-figures-offset-008.local.json
```

## Current Occupation Seeds

The first config uses verified Wikidata occupation IDs for:

- YouTuber
- Podcaster
- Artist
- Visual artist
- Musician
- Journalist
- Psychologist
- Physician
- Therapist
- Religious leader
- Clergy

Each result remains discovery-only until a human confirms identity and source ownership.

## What It Collects

- Wikidata profile
- English Wikipedia profile when available
- Official website claim when available
- Public social/profile claims for YouTube, X, Instagram, Facebook, LinkedIn, TikTok, and ORCID when available
- No contact routes

## Rules

- Keep every discovered candidate, including low-star and no-star records.
- Treat Wikidata claims as discovery hints, not verified ownership.
- Do not use Wikidata occupation metadata as outreach permission.
- Do not guess emails or derive contact routes from names or domains.
- Human review must confirm identity, official source URL, professional context, jurisdiction, suppression status, and sensitive-category status before campaign use.
