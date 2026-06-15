# Sprint 5 Notes

## Added

- Verification task model.
- Prioritization helper for official-source review.
- Dashboard verification metric.
- Selected-candidate verification task panel.
- Global official-source queue.
- Markdown checklist export script.

## Commands

```bash
npm run export:verification -- data/openalex-ai-tutoring-education.local.json --output exports/openalex-ai-tutoring-verification.local.md
npm run build
npm run lint
```

## Local Output

During verification, this ignored local checklist was generated:

```bash
exports/openalex-ai-tutoring-verification.local.md
```

## Next Step

Add a controlled official-source enrichment workflow:

1. Pick a candidate from the verification queue.
2. Search only official or high-reliability public pages.
3. Attach source evidence.
4. Update `contactRoutes` only when a professional route is visible and source-linked.
5. Keep human approval required before outreach staging.
