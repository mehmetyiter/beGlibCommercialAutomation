# beGlib Commercial Automation

Private lead intelligence and outreach control system for finding potential beGlib host candidates, validating safe contact routes, preparing campaign assets, and routing incoming replies through an AI-assisted review workflow.

## Current Sprint

The current cockpit uses synthetic candidate data only and now includes:

- Candidate taxonomy for scientists, artists, YouTubers, podcasters, academics, faith leaders, psychologists, therapists, doctors, journalists, educators, technology voices, and thought leaders.
- Compliance assessment rules that block do-not-contact, unknown consent, missing professional contact routes, and sensitive high-risk outreach.
- Dashboard for candidate filtering, pipeline metrics, taxonomy coverage, selected-candidate dossiers, FAQ review ownership, and pilot wave staging.
- Star rating system for ranking strong host candidates by creator/media distribution signals.
- Local browser vault for importing candidate research batches without committing lead data.
- CLI validator for checking a research batch before importing it into the cockpit.
- Outreach draft previews generated from category-specific templates.
- AI reply triage examples with routing to AI draft, human review, or legal review.
- Official-source review outcomes can be applied from the local cockpit or CLI.
- Creator-signal review outcomes can be applied from the local cockpit or CLI.
- Repository guardrails so real lead data, exports, logs, and secrets stay out of git.

## Run Locally

```bash
npm install --cache .npm-cache
npm run dev
```

Open the local Vite URL shown in the terminal, usually `http://localhost:5173`.

Validate a synthetic research batch:

```bash
npm run validate:batch
```

Validate a local private batch:

```bash
npm run validate:batch -- data/your-private-batch.local.json
```

Generate a local OpenAlex discovery batch:

```bash
npm run research:openalex -- --query "AI tutoring education" --limit 10 --category academia
```

Run a broad multi-query OpenAlex wave:

```bash
npm run research:wave -- --config config/research-waves/openalex-wave-001.json --output-dir data/openalex-wave-001-broad-experts.local
```

Prepare a local official-source review package:

```bash
npm run review:official-sources -- data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --output exports/openalex-wave-001-official-source-review.local.md --json-output exports/openalex-wave-001-official-source-review.local.json
```

Prepare a local creator-signal review package:

```bash
npm run review:creator-signals -- data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --output exports/openalex-wave-001-creator-signal-review.local.md --json-output exports/openalex-wave-001-creator-signal-review.local.json
```

Apply completed official-source review outcomes into a private candidate update batch:

```bash
npm run review:apply-official-sources -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --review exports/openalex-wave-001-official-source-review.local.json --output data/openalex-wave-001-official-source-updates.local.json
```

Apply completed creator-signal review outcomes into a private candidate update batch:

```bash
npm run review:apply-creator-signals -- --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json --review exports/openalex-wave-001-creator-signal-review.local.json --output data/openalex-wave-001-creator-signal-updates.local.json
```

Export a local verification checklist:

```bash
npm run export:verification -- data/your-private-batch.local.json
```

## Repository Privacy

The GitHub repository was detected as public during setup. This repo is safe for code only. Do not commit:

- Real people lists
- Email addresses collected during research
- Suppression lists
- Message logs
- API keys
- Exports
- Inbox transcripts

Before production outreach, change the GitHub repository to private or keep the operational database fully local.

## Core Documents

- [Automation plan](./docs/automation-plan.md)
- [Data governance](./docs/data-governance.md)
- [Candidate schema](./docs/candidate-schema.md)
- [FAQ and reply routing](./docs/faq-reply-routing.md)
- [Outreach playbook](./docs/outreach-playbook.md)
- [Research batch workflow](./docs/research-batch-workflow.md)
- [Official source review](./docs/official-source-review.md)
- [Creator signal review](./docs/creator-signal-review.md)
- [Source policy](./docs/source-policy.md)
- [Source roadmap](./docs/source-roadmap.md)
- [Star rating system](./docs/star-rating-system.md)
- [Verification queue](./docs/verification-queue.md)
- [Broad research taxonomy](./docs/broad-research-taxonomy.md)
- [Sprint 12 notes](./docs/sprint-12-notes.md)
- [Sprint 11 notes](./docs/sprint-11-notes.md)
- [Sprint 10 notes](./docs/sprint-10-notes.md)
- [Sprint 9 notes](./docs/sprint-9-notes.md)
- [Sprint 8 notes](./docs/sprint-8-notes.md)
- [Sprint 7 notes](./docs/sprint-7-notes.md)
- [Sprint 6 notes](./docs/sprint-6-notes.md)
- [Sprint 5 notes](./docs/sprint-5-notes.md)
- [Sprint 4 notes](./docs/sprint-4-notes.md)
- [Sprint 3 notes](./docs/sprint-3-notes.md)
- [Sprint 2 notes](./docs/sprint-2-notes.md)

## Compliance Baseline

The system is designed around conservative outreach controls:

- Use public professional or representative contact routes only.
- Store source URLs and verification timestamps for every contact route.
- Honor opt-out and deletion requests immediately.
- Require human approval for sensitive categories, high-risk candidates, commercial terms, rights, privacy, and legal questions.
- Include sender identity, valid contact information, and unsubscribe/opt-out language in commercial messages.

Official references to keep close:

- [FTC CAN-SPAM Rule](https://www.ftc.gov/legal-library/browse/rules/can-spam-rule)
- [European Commission GDPR direct marketing guidance](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/legal-grounds-processing-data/can-data-received-third-party-be-used-marketing_en)
- [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm)
- [KVKK public decisions](https://kvkk.gov.tr/)
