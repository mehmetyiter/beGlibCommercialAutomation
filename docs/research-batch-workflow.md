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

## Generate OpenAlex Discovery Batch

```bash
npm run research:openalex -- --query "AI tutoring education" --limit 10 --category academia
```

The OpenAlex worker:

- Searches public works metadata.
- Extracts person-like authorship records.
- Adds OpenAlex and ORCID source links when available.
- Does not collect email addresses.
- Sets contact route to `none`.
- Leaves consent as `unknown`.
- Produces a `.local.json` batch under `data/`.

That means generated candidates are discovery-only until a human verifies official contact routes.

The validator checks:

- Batch metadata
- Required candidate fields
- Scores between 0 and 100
- Optional influence and follower signals
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

Optional creator strength signals can be included under `influenceSignals`. Leave unknown follower counts blank instead of guessing.

## Privacy Rule

Never paste private, hidden, guessed, breached, or login-only contact information into a batch. Every contact route must have a source URL and verification date.
