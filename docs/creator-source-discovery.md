# Creator Source Discovery

## Purpose

Creator source discovery searches public creator/media sources for candidate channel or feed suggestions. It prepares review hints for YouTube channels, PodcastIndex podcast records, and RSS/Atom feeds.

This step does not verify identity, collect contact permission, or approve outreach.

## Sources

- YouTube Data API:
  Resolves canonical channel IDs already present in candidate records with batched `channels.list` calls. In `direct-first` mode it uses `search.list` only for candidates without a resolved known channel.
- PodcastIndex API:
  Searches public podcast records with authenticated `search/byterm` when `PODCASTINDEX_API_KEY` and `PODCASTINDEX_API_SECRET` are set. If only partial credentials are available, it falls back to the public Apple-replacement `/search` endpoint.
- RSS or Atom feeds:
  Parses configured public or local feed URLs and produces candidate-specific feed suggestions.

If an API key is missing, the worker records a skipped source attempt instead of failing the batch.

## Generate A Discovery Package

Synthetic smoke test:

```bash
npm run research:creator-sources -- --batch examples/research-batch.synthetic.json --config examples/creator-source-discovery.synthetic.json --sources youtube,podcastindex,rss --output exports/synthetic-creator-source-discovery.local.md --json-output exports/synthetic-creator-source-discovery.local.json
```

OpenAlex batch example:

```bash
npm run research:creator-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --limit 25 --sources youtube,podcastindex --output exports/openalex-wave-001-creator-source-discovery.local.md --json-output exports/openalex-wave-001-creator-source-discovery.local.json
```

Optional filters:

```bash
npm run research:creator-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --categories psychology,medicine --limit 50
```

Chunk a large batch with `--offset`:

```bash
npm run research:creator-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --sources youtube --offset 25 --limit 25 --max 2 --delay-ms 750 --retries 3 --retry-delay-ms 5000 --output exports/openalex-wave-001-youtube-025-049.local.md --json-output exports/openalex-wave-001-youtube-025-049.local.json
```

Files under `exports/` are ignored by git.

For continuous YouTube scanning, prefer small chunks, delay between candidates, and an explicit request timeout. If the API returns `429`, pause the wave or rerun later with a higher `--delay-ms` value.

```bash
npm run research:creator-sources -- --batch data/wikidata-wave-001-broad-public-figures-combined.local.json --sources youtube,podcastindex --offset 0 --limit 25 --max 3 --delay-ms 750 --timeout-ms 15000 --output exports/wikidata-wave-001-creator-sources-000-024.local.md --json-output exports/wikidata-wave-001-creator-sources-000-024.local.json
```

### YouTube quota modes

The worker defaults to `--youtube-mode direct-first`. Known canonical channel IDs use `channels.list` in batches of up to 50 IDs. Only unresolved candidates consume the separate `search.list` quota bucket.

Resolve known channels without using `search.list`:

```bash
npm run research:creator-sources -- --batch data/wikidata-all-waves-known-youtube-channels.local.json --sources youtube --youtube-mode known-only --max 10 --output exports/wikidata-all-waves-youtube-known.local.md --json-output exports/wikidata-all-waves-youtube-known.local.json
```

Run a bounded search-only wave after the daily quota resets:

```bash
npm run research:creator-sources -- --batch data/wikidata-all-waves-public-figures-combined.local.json --sources youtube --youtube-mode search-only --youtube-search-limit 100 --offset 0 --limit 100 --output exports/wikidata-all-waves-youtube-search-000-099.local.md --json-output exports/wikidata-all-waves-youtube-search-000-099.local.json
```

- `direct-first`: resolve known channel IDs, then search unresolved candidates.
- `known-only`: never call `search.list`.
- `search-only`: use only `search.list`, capped by `--youtube-search-limit`.

The default `search.list` allocation is limited per day and resets at midnight Pacific Time. Request a larger allocation through YouTube's compliance audit and quota extension form; do not rotate API projects or keys to evade quota controls.

Summarize local creator discovery packages:

```bash
npm run research:creator-summary -- --source-batch-id openalex-wave-001-broad-experts --filename-includes openalex-wave-001-youtube- --filename-excludes smoke,medium --output exports/openalex-wave-001-broad-experts-creator-source-summary.local.json --markdown-output exports/openalex-wave-001-broad-experts-creator-source-summary.local.md
```

## Environment

Use environment variables only in local shells or secret stores:

- `YOUTUBE_API_KEY`
- `PODCASTINDEX_API_KEY`
- `PODCASTINDEX_API_SECRET`
- `BEGLIB_RESEARCH_USER_AGENT`

PodcastIndex may label the secret as `API Secret`, `Secret Key`, or `apiSecret` in examples. If that value is not visible, the worker can still use PodcastIndex public search fallback, but authenticated search needs both key and secret.

For local use, copy `.env.example` to `.env.local` and fill the values there:

```bash
cp .env.example .env.local
```

The worker loads `.env.local` automatically. You can also point it at a different ignored file:

```bash
npm run research:creator-sources -- --local-env path/to/your.local.env --batch examples/research-batch.synthetic.json
```

Do not commit API keys or operational discovery outputs.

## Confidence And Retention

The worker defaults to `--min-confidence medium` for the priority review queue, but it still keeps low-confidence suggestions as `deprioritizedSuggestions` in the local JSON output.

Use exploratory mode when you want low-confidence suggestions promoted into the priority suggestion list:

```bash
npm run research:creator-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --sources youtube --limit 25 --min-confidence low
```

Confidence is based on public evidence only:

- `high`: exact name evidence plus topical overlap.
- `medium`: exact name evidence, or first and last name evidence with topical overlap.
- `low`: weak or partial identity evidence.

Retention rules:

- Low-confidence suggestions are retained, not discarded.
- Deprioritized suggestions are not verified channels.
- Deprioritized suggestions are not contact routes.
- Low-star and no-star candidates remain in the research database.

## RSS Config

RSS/Atom feeds are explicit because feed ownership and identity matching usually need human context.

```json
{
  "feeds": [
    {
      "candidateId": "cand-synth-101",
      "name": "Dr. Leyla Arman",
      "platform": "podcast",
      "label": "Synthetic learning interviews",
      "url": "examples/synthetic-learning-interviews.rss.xml"
    }
  ]
}
```

The worker matches feeds by `candidateId` or exact `name`.

## Review Rules

- Suggestions are discovery hints only.
- A human must confirm that the channel or feed belongs to the same person.
- Copy only verified suggestions into creator-signal review outcomes or candidate updates.
- Keep low-confidence suggestions as discovery-only records for later review.
- Do not infer hidden subscriber, follower, or listener counts.
- Do not treat creator/media discovery as permission to contact.
- Keep generated outputs in ignored local files or a private database.

## Official References

- YouTube Data API `search.list`: https://developers.google.com/youtube/v3/docs/search/list
- YouTube Data API `channels.list`: https://developers.google.com/youtube/v3/docs/channels/list
- YouTube quota and compliance audits: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- PodcastIndex OpenAPI: https://podcastindex-org.github.io/docs-api/pi_api.json
- RSS 2.0 specification: https://www.rssboard.org/rss-specification

## Country scoping and YouTube quota

`--countries <name>[,<name>]` restricts the run to candidates filed under one of those
countries, matching the filed country or any recorded citizenship. YouTube search costs 100
quota units per call against a 10,000/day default, so which candidates this stage runs against
is a spending decision — the launch market goes first.

Two halves, cheapest first:

- `--youtube-mode known-only --youtube-search-limit 0` resolves the channels candidates already
  declare on Wikidata. `channels.list` batches 50 ids per call at 1 unit, so 167 channels cost
  4 units.
- `--youtube-mode search-only` searches for candidates with no declared channel. Feed it the
  ranked list from `scripts/select-youtube-search-candidates.mjs`, which also takes
  `--countries`, skips anyone already resolved or already attempted, and orders by discovery
  stars.

## Coverage report

`npm run research:creator-coverage` reads a built dossier export and reports podcast, YouTube,
and newsletter signals by country and by category, counting accepted and awaiting-review
separately. Use it to tell a real gap from a real miss: a country with zeroes in both columns
has never been scanned, while one with a large review column has been scanned and is waiting
on human identity decisions.

```bash
npm run research:creator-coverage
npm run research:creator-coverage -- --countries Canada --top-categories 10
```
