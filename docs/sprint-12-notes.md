# Sprint 12 Notes

## Added

- Browser-side creator-signal outcome apply logic.
- Cockpit panel for importing completed creator/media signal outcomes.
- Shared review apply panel component for official-source and creator-signal workflows.
- Creator-signal apply counters for outcomes, updates, channels, signal fields, and skipped records.

## Rule

Creator-signal apply in the cockpit updates local prioritization evidence only. It does not:

- Add contact routes.
- Change consent status.
- Approve outreach.
- Override compliance gates.

## Verification

Required checks:

- TypeScript build.
- Lint.
- In-app browser smoke test for both review apply panels.
- Mobile layout check.
