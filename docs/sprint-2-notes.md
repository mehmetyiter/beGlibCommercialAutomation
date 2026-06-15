# Sprint 2 Notes

## Added

- Selected-candidate dossier panel.
- Category-aware outreach draft rendering.
- Compliance gates inside the dossier.
- Source evidence list for each candidate.
- Reply triage queue using synthetic examples.
- Owner routing for AI draft, human review, and legal review.

## Important Constraint

The application still uses synthetic data. Real lead research should not start until a local or encrypted database is in place.

## Next Technical Step

Add a local persistence layer:

1. PostgreSQL or SQLite for local development.
2. Migration files for candidate, source evidence, contact route, campaign, reply, FAQ, and suppression tables.
3. Import workflow for manually reviewed CSV/JSON research batches.
4. Audit log for every status, consent, and suppression change.
5. Human approval queue before any email provider integration.

## Next Product Step

Choose the first pilot segment. Recommended:

- English-speaking AI/education researchers
- English-speaking science YouTubers
- Developer educators with public partnerships contacts

Start with one segment and 10 to 25 candidates.
