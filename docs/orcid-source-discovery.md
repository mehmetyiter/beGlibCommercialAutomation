# ORCID Source Discovery

## Purpose

ORCID source discovery expands OpenAlex candidates into public researcher-profile signals. It collects ORCID public record hints such as researcher URLs, affiliation summaries, external identifiers, keywords, and public email candidates when the record exposes them.

This step does not approve outreach and does not create usable contact routes.

## Generate A Discovery Package

```bash
npm run research:orcid-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --offset 0 --limit 25 --delay-ms 1000 --output exports/openalex-wave-001-orcid-000-024.local.md --json-output exports/openalex-wave-001-orcid-000-024.local.json
```

Chunk a larger wave with `--offset`:

```bash
npm run research:orcid-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --offset 25 --limit 25 --delay-ms 1500 --retries 2 --retry-delay-ms 5000 --output exports/openalex-wave-001-orcid-025-049.local.md --json-output exports/openalex-wave-001-orcid-025-049.local.json
```

Files under `exports/` are ignored by git.

## Summarize Chunks

After running chunked discovery, generate a local rollup:

```bash
npm run research:orcid-summary -- --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-includes openalex-wave-001-orcid- --filename-excludes smoke --output exports/openalex-wave-001-orcid-summary.local.json --markdown-output exports/openalex-wave-001-orcid-summary.local.md
```

The summary reports package count, candidate rows, unique candidates, ORCID coverage, researcher URL count, public email candidate count, affiliation count, and failures. It does not print email values.

## Sources

The worker uses ORCID public records already linked from the candidate batch. It does not search for guessed ORCID identifiers.

Collected fields:

- ORCID profile URL and public display name
- Researcher URLs
- Public email candidates, when explicitly exposed by the ORCID public record
- Employment, education, membership, qualification, and invited-position affiliation hints
- External identifiers
- Keywords
- Review search targets for official sites, public profiles, press routes, booking routes, and institution pages

## Public Email Handling

Public email candidates are retained separately from verified contact routes.

Before any email can be used, a human reviewer must confirm:

- The ORCID record belongs to the same person.
- The email is public, professional, current, and attributable to the candidate or their representative.
- The jurisdiction and campaign context allow contact.
- The candidate is not suppressed, opted out, or otherwise blocked.
- Sensitive-category review is complete where required.

## Rules

- Keep all candidates, including candidates without ORCID records.
- Keep researcher URLs and public email candidates as discovery records.
- Do not guess emails or derive address patterns.
- Do not use private, login-only, hidden, breached, or technically restricted data.
- Convert a public email or page into a contact route only after human verification from a professional or representative source.
