# Sprint 13 Notes

## Added

- Creator source discovery worker for YouTube Data API, PodcastIndex, and RSS/Atom feeds.
- Synthetic RSS feed and source config for local smoke testing.
- Graceful skipped-source reporting when API credentials are not configured.
- Ignored `.env.local` credential loading for local research runs.
- Default medium-confidence filtering for noisy creator source suggestions.
- Offset-based chunking for large creator source discovery waves.
- Retention of low-confidence creator suggestions as deprioritized discovery records.
- Candidate delay and retry/backoff controls for API limit pressure.
- Local creator source discovery summary command for continuous wave tracking.
- PodcastIndex public search fallback when authenticated API secret is unavailable.
- Public identity source discovery worker for official-site and social/profile hints.
- ORCID source discovery worker for public researcher URLs, affiliations, external identifiers, and public email candidates.
- Public page contact discovery worker for contact, press, booking, mailto, social, and feed links from discovered websites.
- Feed source signal discovery worker for RSS/Atom podcast, newsletter, blog, activity, and public feed email candidate signals.
- Wikidata people discovery worker for public-figure categories outside OpenAlex.
- Candidate discovery dossier builder for merging source packages into one review record per candidate.
- Creator source discovery documentation with environment and review rules.

## Rule

Creator source discovery produces suggestions only. It does not:

- Verify channel ownership.
- Add contact routes.
- Change consent status.
- Approve outreach.
- Infer hidden audience counts.
- Delete low-star or no-star candidates.
- Convert ORCID public email candidates into contact routes without human verification.
- Store raw HTML or convert page-level mailto links into contact routes without human verification.
- Infer private listener, subscriber, or audience counts from feed metadata.
- Treat Wikidata occupation or social claims as verified identity ownership.
- Treat discovery stars as compliance approval or delete low-star candidates.

## Verification

Required checks:

- Script syntax check.
- Synthetic RSS smoke test.
- Lint.
- TypeScript build.
