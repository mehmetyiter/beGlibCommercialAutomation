# Sprint 9 Notes

## Added

- Official-source review outcome importer.
- Synthetic official-source outcome example.
- Review outcome template in generated review packages.
- Documentation for applying completed review outcomes.

## Importer Rule

The importer only applies completed human-review outcomes:

- `verified-route`
- `profile-only`
- `do-not-contact`

It skips:

- `pending`
- `needs-more-review`
- `rejected`

## Safety Checks

Applied route updates require:

- Valid official profile URL.
- Valid contact route source URL for `verified-route`.
- Valid ISO verification date.
- Jurisdiction.
- `suppressionStatus: clear`.
- Approved route type: `public-business-email`, `representative-email`, or `contact-form`.
- No guessed email patterns.

The output is a normal local research batch, so it must still pass `npm run validate:batch` before cockpit import.

## Smoke Test

Command:

```bash
npm run review:apply-official-sources -- --batch examples/research-batch.synthetic.json --review examples/official-source-review-outcomes.synthetic.json --output data/synthetic-official-source-updates.local.json
```

Expected result:

- 1 synthetic outcome read.
- 1 synthetic candidate update written.
- 1 verified route applied.
- Output stays under ignored `data/`.
