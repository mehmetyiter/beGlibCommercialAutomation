# Sprint 11 Notes

## Added

- Creator-signal review package generator.
- Creator-signal outcome importer.
- Synthetic creator-signal outcome example.
- Documentation for YouTube, podcast, newsletter, and social signal review.

## Rule

Creator/media signals update prioritization only. They do not:

- Add contact routes.
- Change consent status.
- Approve outreach.
- Override suppression or sensitive-category review.

## Safety Checks

Applied signal outcomes require:

- Valid `verifiedAt` date.
- Supported creator platform.
- Valid public URLs.
- `verified: true` for applied channels.
- Non-negative follower/subscriber counts.
- No inferred or guessed audience numbers.

## Smoke Test

Command:

```bash
npm run review:apply-creator-signals -- --batch examples/research-batch.synthetic.json --review examples/creator-signal-review-outcomes.synthetic.json --output data/synthetic-creator-signal-updates.local.json
```

Expected result:

- 1 synthetic outcome read.
- 1 synthetic candidate update written.
- Creator channels and `influenceSignals` updated.
- Output stays under ignored `data/`.

## First Broad Creator-Signal Review

Command:

```bash
npm run review:creator-signals -- data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --output exports/openalex-wave-001-creator-signal-review.local.md --json-output exports/openalex-wave-001-creator-signal-review.local.json
```

Result:

- 409 candidates selected.
- 409 high signal gaps.
- Outputs remain local and ignored by git.

Interpretation:

OpenAlex produced expert discovery candidates, but it did not prove YouTube, podcast, newsletter, or social reach. These records now need creator/media source review before the star system can prioritize them confidently.
