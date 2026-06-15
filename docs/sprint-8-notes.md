# Sprint 8 Notes

## Added

- Official-source review worker.
- Local Markdown and JSON review package generation.
- Candidate-level search queries for official identity and contact-route verification.
- Optional Wikidata suggestion mode for public identity disambiguation.
- Official-source review documentation.

## Rule

The official-source review worker does not approve outreach. It creates a review package so a human can verify official profiles, professional contact routes, jurisdiction, suppression status, and sensitive-category requirements.

## First Review Package

Command:

```bash
npm run review:official-sources -- data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --output exports/openalex-wave-001-official-source-review.local.md --json-output exports/openalex-wave-001-official-source-review.local.json
```

Result:

- 409 candidates selected from the first broad OpenAlex wave.
- 409 high-priority official-source review items.
- 158 candidates flagged for sensitive-category or high-risk review.
- Current blockers surfaced per candidate.
- Health, mental-health, religion, and high-risk candidates flagged.
- Outputs remain local and ignored by git.

## Next Step

The next automation layer should convert completed official-source review outcomes into private candidate updates. That importer should accept only verified source URLs and should still leave outreach approval to compliance gates.
