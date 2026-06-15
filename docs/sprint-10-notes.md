# Sprint 10 Notes

## Added

- Browser-side official-source review apply logic.
- Cockpit panel for importing completed official review outcomes.
- Local vault update flow for verified official profile and contact-route outcomes.
- Review apply summary counters and warning/error display.

## Rule

The cockpit uses the same conservative rules as the CLI importer:

- Pending, rejected, and needs-more-review outcomes are skipped.
- Verified routes require official URLs, jurisdiction, clear suppression status, and approved route type.
- Guessed contact patterns are blocked.
- Applying review outcomes updates local vault records only; it does not approve outreach.

## Verification

Required checks:

- TypeScript build.
- Lint.
- In-app browser smoke test for the review panel and existing cockpit layout.
