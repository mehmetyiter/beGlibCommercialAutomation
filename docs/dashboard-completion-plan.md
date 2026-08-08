# Dashboard completion plan

Written 2026-08-07. Everything under "Current state" is verified against the code, not assumed.

The goal: turn the dashboard from a read-only viewer with one working action (outreach)
into the full operating surface for a one- or two-person outreach operation.

Scope note from the operator: **this platform will be used by one person initially, at most
two later.** Do not build role systems, permission matrices, or multi-tenant safeguards.
The existing "operator reference" field on every record already records who did what, and
that is the correct level of attribution for this scale.

---

## The data incident that motivated this plan

An operator found `Mayada Elsabbagh` in the dashboard, opened her profile through a link the
automation itself produced, verified her by hand in about two minutes, found an email
address — and had nowhere in the dashboard to record any of it. Then, after the dossier pool
was rebuilt, she vanished from the list entirely.

Both symptoms have the same root cause, and it is not data corruption.

### Two disjoint candidate pools

| Pool | File | Candidates | Has Elsabbagh |
| --- | --- | --- | --- |
| OpenAlex wave 001 | `data/openalex-wave-001-broad-experts.local/_merged-wave.local.json` | 409 | **yes** |
| Wikidata all waves | `data/wikidata-all-waves-public-figures-combined.local.json` | 28,113 | no |

`scripts/build-candidate-discovery-dossiers.mjs:36` reads **one** batch file and defaults to
the OpenAlex one:

```js
const batchPath = resolve(args.batch ?? args._[0] ?? 'data/openalex-wave-001-broad-experts.local/_merged-wave.local.json');
```

So the dashboard has never shown both pools at once. It showed 409 (OpenAlex only) until the
pool was rebuilt from Wikidata, at which point it showed 28,113 — and Elsabbagh, who exists
only in the OpenAlex pool, disappeared. Nothing was lost; the builder simply cannot merge.

Total across all 779 data files: **120,876 candidate records**. Only ever one file at a time
reaches the dashboard.

### Fix

Make `--batch` repeatable and merge by candidate id, newest wins. Rebuild both pools into a
single dossier export. This is task 0 below and blocks everything else, because until it
lands the operator cannot trust that "not in the list" means "not in our data".

### Related: zero contact candidates

The rebuilt 28,113-candidate pool contains **84,139 channel candidates and 0 contact
candidates**. The contact-discovery workers have not been run against it. Since a message
cannot be queued without a verified published contact route, **no candidate in the current
pool is sendable at all.** Running those workers is a prerequisite for the pilot wave and is
tracked separately from this plan.

---

## Current state: what the dashboard promises vs. what it does

### Works

- Candidate listing, search, and filters (category, status, risk, consent, star, country)
- Country filter — added 2026-08-07
- Dossier detail view with tabs: evidence, channels, contacts, outreach
- CSV and JSON export of the filtered set
- **The entire outreach chain**: route verification, preview, approval, queueing, drain to
  SES, suppression, retry of failed messages, per-candidate send history

The outreach path is genuinely complete and was proven against production on 2026-08-07.
Everything below is about the *research and review* half of the workflow, which is not.

### Missing

| Promised / expected | Reality |
| --- | --- |
| Manual email entry | **Shipped 2026-08-07.** A text field beside the suggestion list; the address still goes through the verification gate. |
| Manual candidate entry | **Shipped 2026-08-07.** Sidebar form writing to the operator overlay. |
| Recording a review outcome | **Shipped 2026-08-07.** Approve / reject / defer with a note, operator reference, and timestamp. |
| Star / risk / consent editing | **Shipped 2026-08-07.** Part of the review outcome form. |
| Free-text notes | **Shipped 2026-08-07.** On both the review outcome and the manual candidate record. |
| Channel verification (`verified` flag) | **Shipped 2026-08-07.** Per-channel confirm/revoke with an evidence note, in the dossier detail. |
| Suppression list view | **Shipped 2026-08-07.** Operations screen, with add and revoke. |
| Campaign-wide outbox view | **Shipped 2026-08-07.** Operations screen, with a status filter and the daily quota. |
| `src/lib/*` — `localVault`, `verificationQueue`, `starRating`, `officialSourceReview`, `creatorSignalReview`, `compliance` | **Entirely dead code.** Nothing outside `src/lib/` imports any of it. Six modules, zero call sites. |

---

## Plan

### Task 0 — merge the candidate pools (blocker) — **done 2026-08-07**

Make the dossier builder accept `--batch` more than once and merge by candidate id. Rebuild
with both pools. Verify Elsabbagh is present and the total is ~28,500.

Shipped: `--batch` is repeatable (any repeated flag now collects instead of overwriting) and
`mergeBatchCandidates` merges by candidate id, newer `createdAt` winning. Rebuilt
`exports/all-waves-discovery-dossiers.local.json` from both pools: **28,522 candidates, no
duplicate ids, Elsabbagh present** as `openalex-A5011910615`. The package now carries a
`sources` array and the summary reports `sourceBatches` and `duplicateCandidateIds`.

Still true after the rebuild: **0 contact candidates.** No discovery packages remain under
`exports/`, so nothing in the pool is sendable until the contact-discovery workers are run
again. That is tracked separately, as noted above.

Also worth doing while in there: the 87 MB single-file export is loaded into browser memory
whole. If first paint is slow after the merge, split the export by country or add a summary
index the dashboard loads first.

Not done: the merge added 409 candidates to 28,113, so the export stayed the same size class
(~66 MB over the wire). Splitting it is still open, and belongs with stage 3 speed work
rather than here.

### Stage 1 — unblock the operator — **done 2026-08-07**

Nothing else matters until a human can record what they found by hand.

1. **Manual email entry in the outreach panel.** A text field beside the suggestion list.
   The address still goes through the existing verification gate — the operator supplies the
   source URL, method, and evidence note exactly as they would for a discovered route. This
   is not a bypass; it is the same gate with a hand-entered address.
2. **Manual candidate entry.** A form creating a minimal dossier: name, country, category,
   one source URL. Persisted alongside the generated pool so a rebuild does not erase it.
3. **Review outcome recording.** Approve / reject / defer, with a note, an operator
   reference, and a timestamp. Also editable here: consent status, risk level, star.

Storage: a local overlay file keyed by candidate id, merged over the generated dossier at
read time. This keeps hand-entered truth out of the regenerable export, so rebuilding the
pool never destroys operator work — the failure mode that produced this document.

As shipped:

- `scripts/lib/candidate-overlay.mjs` owns the overlay: validation, the write path, and the
  pure `applyOverlay` merge. State lives in `data/candidate-overlay.local.json`
  (`CANDIDATE_OVERLAY_PATH`); every write is audited into the existing outreach audit log.
- Both read paths merge it — the Vite `/api/dashboard-data` endpoint and
  `loadDossierPackage`, which the outreach server and the CLI both go through. There is one
  merge implementation, not two.
- Writes go through the local outreach server (`POST /candidates`, `POST /review`), so they
  reuse the token-gated loopback path rather than opening a second write surface.
- A **rejected** review sets the candidate's status to `do-not-contact`, which the existing
  send preflight already blocks on. A review outcome is therefore not just a label.
- A hand-typed email address is selected in the outreach panel and then verified through the
  unchanged gate: same source URL, method, freshness date, and evidence note.
- Manual candidates enter with no channels and no contact candidates, zero stars, and one
  source URL. Nothing about them shortens the send path.
- Overlay records are scoped to the dataset they were created against, so a manual candidate
  does not leak into an unrelated pool.

### Stage 2 — operational visibility — **done 2026-08-07**

4. Campaign-wide outbox screen: queued, sent, failed, suppressed, with the day's count
   against the daily limit.
5. Suppression list view, with the ability to add and to reverse an entry (reversal already
   requires a named actor and a reason in the backend).
6. Channel verification in the UI, replacing the CLI-only path.

As shipped:

- A workspace view switch in the header: **Adaylar** (the existing candidate surface) and
  **Operasyon**, a campaign-wide screen in `src/outreach/OperationsPanel.tsx`.
- The operations screen shows the daily quota as a bar, clickable status counters, the full
  outbox with a status filter, and both retry paths (one message, or every failed message).
  Draining the queue is here too, with the same live-mode confirmation as the candidate panel.
- Suppression list with add and revoke. Revoking prompts for a reason, because the backend
  requires a named actor and keeps the original entry with a revocation stamp rather than
  deleting it.
- Channel verification lives on each channel row in the dossier detail: confirm the URL
  belongs to this person, with an evidence note, or revoke an earlier confirmation. Verifying
  a quarantined channel promotes it into the discovery list carrying its evidence. This is
  identity attribution only — it is not a contact route and grants no permission to send.
- New server routes: `GET /outbox`, `GET /suppressions`, `POST /channels/verify`,
  `POST /channels/revoke`. Channel verifications are stored in the same operator overlay as
  stage 1, so a dossier rebuild does not erase them.
- The `review:official-sources` / `review:apply-official-sources` CLI pair still exists; it
  applies whole review files back into a candidate batch, which is a different job from
  confirming one channel while looking at it.

### Stage 3 — speed — **done 2026-08-08**

7. Bulk selection and bulk review actions.
8. A resumable work queue: "continue where I left off" over the filtered set.
9. Keyboard shortcuts for the review loop.

As shipped:

- Row checkboxes, "select the visible rows", and a bulk bar that applies one outcome (with an
  optional star and a shared note) to the selection. `POST /review/bulk` writes all of them
  under a single lock, capped at 500 per request, running the same validation as a single
  review. Consent status and risk level are deliberately **not** bulk-editable: they carry
  legal weight per person and should not be set 500 at a time.
- The work queue is derived, not stored: a candidate is done when it has a review record in
  the overlay, so "continue where I left off" survives a reload, a restart, and a different
  filter without a cursor to go stale. The bar shows reviewed/total for the current filtered
  set and jumps to the first candidate with no decision yet.
- Keyboard loop: `j`/`k` (or arrows) to move, `n` to jump to the first undecided candidate,
  `a`/`r`/`d` to approve/reject/defer, `o` to open the source page, `x` to add to the
  selection, `?` for the shortcut list. Keys are ignored while a field has focus. Deciding
  auto-advances to the next undecided candidate.
- Recording a decision no longer refetches the dossier package. At 28k candidates a refetch
  per keystroke made the loop unusable, so a successful write is patched into local state with
  the same mapping the overlay applies server-side; the next load re-derives everything from
  the overlay, which stays authoritative.

### Not doing

- Role or permission systems. One to two operators.
- An approval workflow separate from the existing named-actor record.
- Reviving `src/lib/*`. Delete it, or port the useful logic into the server where the rest of
  the business rules already live. Two copies of the star-rating rules is how they drift.

  **Done 2026-08-08.** All six modules deleted. Before deleting, each was checked against the
  server for what would actually be lost:

  | Module | Disposition |
  | --- | --- |
  | `compliance.ts` | Rules already in `outreach-policy.mjs` — **except** the jurisdiction check, which existed nowhere else. Ported. |
  | `starRating.ts` | Duplicate of `assessDiscoveryStar` in the dossier builder. Deleted. |
  | `verificationQueue.ts` | Synthesised task lists; superseded by the derived review queue. Deleted. |
  | `localVault.ts` | Browser localStorage vault; superseded by the overlay and the server audit log. Deleted. |
  | `officialSourceReview.ts` | Duplicate of `scripts/apply-official-source-review.mjs`. Deleted. |
  | `creatorSignalReview.ts` | Duplicate of `scripts/apply-creator-signal-review.mjs`. Deleted. |

  The ported rule is `jurisdictionNotes` in `scripts/lib/outreach-policy.mjs`: the recipient's
  country raises a CASL, GDPR/ePrivacy, or KVKK **warning** on the send preflight. It is
  advisory by design — the lawful basis is recorded on the contact verification, and this is
  the reminder to confirm it says the right thing for where the recipient actually is.

  `src/types.ts` lost the types that existed only for those modules (`ComplianceAssessment`,
  `StarAssessment`, `VerificationTask` and friends, `AuditEvent`, `VaultState`), each replaced
  by a comment naming where the rule lives now. The review-outcome types stayed: the
  `review:apply-*` CLI scripts still implement exactly those file contracts.

  Still dead, not deleted because it is outside this plan's scope: `src/data/*`
  (`candidates.ts`, `faq.ts`, `replies.ts`, `taxonomy.ts`) is synthetic sample data that
  nothing imports. `docs/faq-reply-routing.md` still points at `faq.ts` as where FAQ items
  live, so removing it is a documentation decision as well as a code one.

---

## How to verify each stage

The gates that protect real sending are in `scripts/lib/outreach-service.mjs` and the server,
not in the UI. Anything added to the dashboard must go **through** them, never around them.
After each stage:

```bash
npm test                  # 143 tests after stage 1
npm run outreach:config   # must still report no blocking issues
```

And keep `OUTREACH_EMAIL_MODE=dry_run` until the AWS production-access case is granted.
