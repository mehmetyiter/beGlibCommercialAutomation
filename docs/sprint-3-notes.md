# Sprint 3 Notes

## Added

- Local browser vault backed by localStorage.
- JSON research batch import from the cockpit.
- Reset-to-demo control.
- Vault status band with update timestamp.
- Audit events for vault initialization, imports, validation failures, resets, and candidate selections.
- CLI batch validator.
- Synthetic research batch example.

## Validation Commands

```bash
npm run validate:batch
npm run build
npm run lint
```

## Current Limitations

- The vault is browser-local, not encrypted database storage yet.
- Imported data lives in the browser profile used for local testing.
- There is no automated web crawler yet.
- There is no email provider integration yet.
- Approval buttons are still UI-only.

## Next Technical Step

Add the first research assistant worker:

1. Accept a seed topic and source list.
2. Search only allowed public sources.
3. Produce a private `.local.json` batch.
4. Run validation.
5. Require human import/review in the cockpit.

## Next Research Step

Pick one pilot segment:

- AI and education researchers
- Science YouTubers
- Developer educators
- Long-form interview podcasters

Then collect 10 to 25 candidates with source URLs only, no guessed emails.
