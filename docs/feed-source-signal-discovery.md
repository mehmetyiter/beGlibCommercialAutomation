# Feed Source Signal Discovery

## Purpose

Feed source signal discovery parses RSS and Atom links found by public page contact discovery. It detects podcast, newsletter, blog, and generic feed signals, recent items, activity status, author hints, and public feed email candidates.

This step does not approve outreach and does not create usable contact routes.

## Generate A Discovery Package

```bash
npm run research:feed-signals -- --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-includes openalex-wave-001-page-contact- --filename-excludes smoke,summary --offset 0 --limit 50 --delay-ms 750 --output exports/openalex-wave-001-feed-signals-000-049.local.md --json-output exports/openalex-wave-001-feed-signals-000-049.local.json
```

Continue in chunks with `--offset`:

```bash
npm run research:feed-signals -- --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-includes openalex-wave-001-page-contact- --filename-excludes smoke,summary --offset 50 --limit 50 --delay-ms 750 --timeout-ms 15000 --output exports/openalex-wave-001-feed-signals-050-099.local.md --json-output exports/openalex-wave-001-feed-signals-050-099.local.json
```

Files under `exports/` are ignored by git.

## Summarize Chunks

```bash
npm run research:feed-summary -- --input-dir exports --source-batch-id openalex-wave-001-broad-experts --filename-includes openalex-wave-001-feed-signals- --filename-excludes smoke --output exports/openalex-wave-001-feed-signals-summary.local.json --markdown-output exports/openalex-wave-001-feed-signals-summary.local.md
```

The summary reports parsed feeds, podcast/newsletter/blog classifications, active/stale status, feed items, public email candidates, and failures. It does not print email values.

## What It Collects

- Feed title, site URL, description, language, and final URL
- Podcast, newsletter, blog, or generic feed classification
- Recent item titles and publication dates
- Activity status based on latest public item date
- Public feed owner or author email candidates, when exposed in the feed

## Rules

- Keep every feed source as a discovery record.
- Treat feed owner and author emails as public email candidates, not verified contact routes.
- Do not infer private audience, listener, subscriber, or download counts.
- Do not guess emails or derive address patterns.
- Human review must confirm identity, source URL, professional context, jurisdiction, suppression status, and sensitive-category status before campaign use.
