# Sprint 7 Notes

## Added

- Shared OpenAlex research module for single-query and multi-query workers.
- Multi-query research wave runner.
- Config-driven broad OpenAlex expert discovery wave.
- Source roadmap explaining why OpenAlex is only one source layer.
- First broad local OpenAlex discovery wave.

## First Broad Wave

Command:

```bash
npm run research:wave -- --config config/research-waves/openalex-wave-001.json --limit-per-query 12 --output-dir data/openalex-wave-001-broad-experts.local
```

Result:

- 11 categories
- 409 unique discovery candidates
- 0 query failures
- 976 verification tasks exported

Category counts:

- Psychology: 48
- Therapy: 47
- Medicine: 48
- Science: 45
- Academia: 48
- Education: 48
- Technology: 48
- Thought leadership: 36
- Journalism: 30
- Arts: 35
- Religion: 35

## Important Interpretation

These records are not outreach-ready. Every OpenAlex candidate has `contactRoutes[0].type` set to `none`, so compliance blocks them until official contact routes, jurisdiction, suppression status, and sensitive-category review are completed.

## Next Source Layers

- Official-site verifier
- YouTube discovery worker
- Podcast and RSS discovery worker
- Wikidata disambiguation worker
- Social signal verifier
- Representative route verifier
