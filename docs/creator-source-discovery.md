# Creator Source Discovery

## Purpose

Creator source discovery searches public creator/media sources for candidate channel or feed suggestions. It prepares review hints for YouTube channels, PodcastIndex podcast records, and RSS/Atom feeds.

This step does not verify identity, collect contact permission, or approve outreach.

## Sources

- YouTube Data API:
  Searches public channels with `search.list`, then enriches channel metadata with `channels.list` when `YOUTUBE_API_KEY` is set.
- PodcastIndex API:
  Searches public podcast records with `search/byterm` when `PODCASTINDEX_API_KEY` and `PODCASTINDEX_API_SECRET` are set.
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

Files under `exports/` are ignored by git.

## Environment

Use environment variables only in local shells or secret stores:

- `YOUTUBE_API_KEY`
- `PODCASTINDEX_API_KEY`
- `PODCASTINDEX_API_SECRET`
- `BEGLIB_RESEARCH_USER_AGENT`

Do not commit API keys or operational discovery outputs.

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
- Do not infer hidden subscriber, follower, or listener counts.
- Do not treat creator/media discovery as permission to contact.
- Keep generated outputs in ignored local files or a private database.

## Official References

- YouTube Data API `search.list`: https://developers.google.com/youtube/v3/docs/search/list
- YouTube Data API `channels.list`: https://developers.google.com/youtube/v3/docs/channels/list
- PodcastIndex OpenAPI: https://podcastindex-org.github.io/docs-api/pi_api.json
- RSS 2.0 specification: https://www.rssboard.org/rss-specification
