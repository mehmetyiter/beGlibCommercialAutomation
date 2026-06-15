# Sprint 4 Notes

## Added

- OpenAlex works-based public metadata research worker.
- `npm run research:openalex` command.
- Local `.local.json` output under `data/`.
- Quality filter for person-like authorship names.
- Discovery-only contact handling: generated candidates have no usable contact route.
- Source policy document.
- Star rating model for identifying strong host prospects.
- Influence signal validation for imported batches.

## Example

```bash
npm run research:openalex -- --query "AI tutoring education" --limit 5 --category academia --output data/openalex-ai-tutoring-education.local.json
npm run validate:batch -- data/openalex-ai-tutoring-education.local.json
```

Expected validation warnings:

- Generated candidates have `contactRoutes.type = none`.
- Compliance blocks outreach until official professional contact routes are manually verified.

## Star Rating

The cockpit now ranks candidates from 1 to 5 stars using:

- Existing podcast/interview activity
- Existing YouTube/video publishing
- X, YouTube, Instagram, TikTok, LinkedIn, and newsletter audience sizes
- Multi-platform activity
- Verified active media channels

Stars measure distribution strength, not legal permission to contact.

## Current Local Output

A local ignored batch was generated during verification:

```bash
data/openalex-ai-tutoring-education.local.json
```

This file is ignored by git and should stay local.

## Next Step

Add an official-source enrichment queue:

1. Take OpenAlex discovery candidates.
2. Ask a human or future browser worker to verify official profile pages.
3. Attach source evidence.
4. Keep contact routes blocked until a professional route is verified.
