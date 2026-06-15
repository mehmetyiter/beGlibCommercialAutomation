# Public Identity Source Discovery

## Purpose

Public identity source discovery collects official-site, knowledge-graph, and public social identifier hints for each candidate. It is a bridge between broad candidate discovery and contact-route verification.

This step does not approve outreach and does not create usable contact routes.

## Generate A Discovery Package

```bash
npm run research:identity-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --offset 0 --limit 25 --wikidata-limit 3 --output exports/openalex-wave-001-identity-000-024.local.md --json-output exports/openalex-wave-001-identity-000-024.local.json
```

Chunk a larger wave with `--offset`:

```bash
npm run research:identity-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --offset 25 --limit 25 --delay-ms 1000 --retries 3 --retry-delay-ms 5000 --output exports/openalex-wave-001-identity-025-049.local.md --json-output exports/openalex-wave-001-identity-025-049.local.json
```

Files under `exports/` are ignored by git.

## Sources

The first worker uses Wikidata API suggestions and entity claims for:

- Official website
- Wikipedia profile
- ORCID
- X/Twitter
- Instagram
- YouTube
- Facebook
- LinkedIn
- TikTok
- Mastodon

Each source remains unverified until a human confirms identity match.

## Search Targets

For every candidate, the worker also writes search targets for:

- Official website
- Public contact page
- Public professional email
- Speaker or booking route
- Press or media-office route
- X, Instagram, LinkedIn, Substack, newsletter, blog, and Medium pages

These are review prompts, not scraped contact data.

## Rules

- Keep all candidates, including low-star and no-star candidates.
- Keep low-confidence identity links as discovery records.
- Do not guess emails or infer address patterns.
- Do not use private, login-only, hidden, breached, or technically restricted data.
- Convert a source into a contact route only after human verification from an official professional or representative page.
