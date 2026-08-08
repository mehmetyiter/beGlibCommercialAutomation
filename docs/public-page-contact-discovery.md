# Public Page Contact Discovery

## Purpose

Public page contact discovery scans public website URLs already found by ORCID or public identity workers. It extracts visible contact-page links, explicit `mailto:` links, social links, and RSS/feed links for human review.

This step does not approve outreach and does not create usable contact routes.

It can also scan public page-like channels from a candidate batch, including Wikidata-generated official website claims. A second pass can scan contact, press, booking, representative, or media page candidates found by an earlier public page contact package.

## Generate A Discovery Package

Run against ORCID source discovery chunks:

```bash
npm run research:page-contact-sources -- --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-includes openalex-wave-001-orcid- --filename-excludes smoke,summary --offset 0 --limit 50 --delay-ms 1000 --output exports/openalex-wave-001-page-contact-000-049.local.md --json-output exports/openalex-wave-001-page-contact-000-049.local.json
```

Continue in chunks with `--offset`:

```bash
npm run research:page-contact-sources -- --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-includes openalex-wave-001-orcid- --filename-excludes smoke,summary --offset 50 --limit 50 --delay-ms 1000 --retries 1 --retry-delay-ms 3000 --output exports/openalex-wave-001-page-contact-050-099.local.md --json-output exports/openalex-wave-001-page-contact-050-099.local.json
```

Files under `exports/` are ignored by git.

Use `--timeout-ms` to cap slow website requests. The default is 15000 milliseconds.

Run against a Wikidata candidate batch:

```bash
npm run research:page-contact-sources -- --source-package data/wikidata-wave-001-broad-public-figures.local.json --limit 50 --delay-ms 1000 --source-batch-id wikidata-wave-001-broad-public-figures --output exports/wikidata-wave-001-page-contact-000-049.local.md --json-output exports/wikidata-wave-001-page-contact-000-049.local.json
```

Run a second pass against contact-page candidates from previous chunks:

```bash
npm run research:page-contact-sources -- --input-dir exports --source-batch-id wikidata-wave-001-broad-public-figures --filename-includes wikidata-wave-001-expanded2-page-contact- --filename-excludes smoke,summary --offset 0 --limit 50 --delay-ms 1000 --output exports/wikidata-wave-001-expanded2-route-contact-000-049.local.md --json-output exports/wikidata-wave-001-expanded2-route-contact-000-049.local.json
```

## Summarize Chunks

After running chunked discovery, generate a local rollup:

```bash
npm run research:page-contact-summary -- --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-includes openalex-wave-001-page-contact- --filename-excludes smoke --output exports/openalex-wave-001-page-contact-summary.local.json --markdown-output exports/openalex-wave-001-page-contact-summary.local.md
```

The summary reports package count, page source rows, unique candidates, fetched/skipped/failed pages, contact page candidates, mailto email candidates, social links, feed links, and scan failures. It does not print email values.

## What It Collects

- Contact, about, bio, profile, people, media, press, booking, speaker, management, agent, representative, office, and consulting links
- Explicit `mailto:` links only
- Public social links found on scanned pages
- RSS, Atom, podcast, and feed links
- Page title, canonical URL, final URL, and lightweight metadata
- Review search targets

The worker does not store raw HTML.

## Default Skips

Known social, DOI, ORCID, OpenAlex, Wikipedia, Wikidata, academic-index, and large platform hosts are skipped by default instead of fetched. Their URLs can still be retained as discovery links from upstream workers.

Use `--include-platform-pages` only for deliberate manual tests.

## Rules

- Keep every candidate and every discovered page source, even when no contact data is found.
- Treat `mailto:` links as public email candidates, not verified contact routes.
- Do not guess emails or decode obfuscated address patterns.
- Do not scrape private, login-only, hidden, breached, or technically restricted data.
- Human review must confirm identity, professional context, source URL, jurisdiction, suppression status, and sensitive-category status before campaign use.

## Country scoping

`--countries <name>[,<name>]` restricts the scan to page sources whose candidate is filed
under one of those countries. This stage fetches one real website at a time behind a delay, so
it is the slowest thing in the pipeline; scoping it to the launch market is the difference
between contact routes for the people about to be emailed and a thin spread across the whole
pool.

```bash
node scripts/research-public-page-contact-sources.mjs \
  --batch data/canada-wave-004-digital-creators-social-video.local.json \
  --countries Canada --limit 150 --delay-ms 700
```

`--source-batch-id` is a **filter** on the input packages, not a label for the output. Passing
a new name matches nothing and the run reports zero page sources without failing.
