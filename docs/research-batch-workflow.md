# Research Batch Workflow

## Purpose

Research batches let us move candidate discovery from hardcoded demo data into a private local workflow. A batch can be validated in the terminal and then imported into the cockpit from the browser.

## File Location

Use the committed synthetic example for structure:

```bash
examples/research-batch.synthetic.json
```

Put real research files under `data/` with a `.local.json` suffix:

```bash
data/ai-education-wave-001.local.json
```

The `data/` directory is ignored by git, so real lead data stays local.

## Validate Before Import

```bash
npm run validate:batch -- data/ai-education-wave-001.local.json
```

The validator checks:

- Batch metadata
- Required candidate fields
- Scores between 0 and 100
- At least one language, subcategory, source URL, and contact route
- Guessed email-pattern red flags
- Contact-route gaps that compliance will block

## Import Into Cockpit

1. Start the local app.
2. Open `http://127.0.0.1:5173/`.
3. Click `Import batch`.
4. Select the validated `.local.json` file.
5. Review the vault status band and selected candidate dossier.

The browser stores imported records in localStorage. This is good enough for the current prototype, but production should move to encrypted local database storage.

## Batch Contract

Required top-level fields:

- `batchId`
- `createdAt`
- `sourceLabel`
- `researcher`
- `notes`
- `candidates`

Each candidate must match the schema in `src/types.ts`.

## Privacy Rule

Never paste private, hidden, guessed, breached, or login-only contact information into a batch. Every contact route must have a source URL and verification date.
