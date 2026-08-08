# Candidate Schema

The first TypeScript schema lives in `src/types.ts`.

## Candidate

Required fields:

- `id`
- `name`
- `title`
- `country`
- `languages`
- `primaryCategory`
- `subcategories`
- `fitScore`
- `reachScore`
- `status`
- `consentStatus`
- `riskLevel`
- `channels`
- `contactRoutes`
- `sourceUrls`
- `lastVerifiedAt`
- `rationale`

Optional fields:

- `influenceSignals`

## Status Values

- `researching`
- `needs-review`
- `approved`
- `contacted`
- `responded`
- `do-not-contact`

## Category Values

- `science`
- `arts`
- `youtube`
- `podcast`
- `thought-leadership`
- `religion`
- `psychology`
- `therapy`
- `medicine`
- `academia`
- `journalism`
- `education`
- `technology`

## Consent Values

- `unknown`
- `public-business-contact`
- `representative-contact`
- `contact-form-only`
- `opted-out`
- `not-allowed`

## Future Database Tables

- `candidates`
- `candidate_channels`
- `candidate_channel_discovery`
- `contact_routes`
- `source_evidence`
- `taxonomy_nodes`
- `campaigns`
- `campaign_messages`
- `outreach_events`
- `inbound_replies`
- `faq_items`
- `ai_reply_drafts`
- `suppression_entries`
- `audit_log`

## Outreach Template

The first template schema lives in `src/types.ts` as `OutreachTemplate`.

Required fields:

- `id`
- `category`
- `name`
- `subject`
- `previewText`
- `body`
- `requiredReview`

Templates are rendered locally for human review. Rendering a template does not send a message.

## Reply Example

The first reply triage schema lives in `src/types.ts` as `ReplyExample`.

Required fields:

- `id`
- `candidateId`
- `fromLabel`
- `receivedAt`
- `excerpt`
- `replyClass`
- `confidence`
- `recommendedOwner`
- `recommendedAction`

## Research Batch

Research batches live outside git when they contain real lead data. The schema lives in `src/types.ts` as `ResearchBatch`.

Required fields:

- `batchId`
- `createdAt`
- `sourceLabel`
- `researcher`
- `notes`
- `candidates`

Use `examples/research-batch.synthetic.json` as a synthetic shape reference.

## Official Source Review Outcome

Official-source review outcomes are local operational records used to create candidate update batches. See `examples/official-source-review-outcomes.synthetic.json` for a committed synthetic example.

Important fields:

- `candidateId`
- `outcomeStatus`
- `officialProfileUrl`
- `officialContactRouteType`
- `officialContactRouteValue`
- `contactRouteSourceUrl`
- `verifiedAt`
- `jurisdiction`
- `suppressionStatus`
- `sensitiveCategoryReviewStatus`
- `reviewerNotes`

Only `verified-route`, `profile-only`, and `do-not-contact` outcomes are applied by the importer. Pending, rejected, or incomplete outcomes are skipped.

## Creator Signal Review Outcome

Creator-signal review outcomes are local operational records used to update host-readiness signals. See `examples/creator-signal-review-outcomes.synthetic.json` for a committed synthetic example.

Important fields:

- `candidateId`
- `outcomeStatus`
- `verifiedAt`
- `channels`
- `influenceSignals`
- `sourceUrls`
- `reviewerNotes`

Only `verified-signals` and `profile-only` outcomes are applied by the importer. These outcomes update `channels`, `sourceUrls`, and `influenceSignals`; they do not add contact routes or approve outreach.

## Influence Signals

`influenceSignals` stores creator/media strength signals used by the star rating system:

- `hasPodcast`
- `hasYoutubeShow`
- `xFollowers`
- `instagramFollowers`
- `linkedinFollowers`
- `tiktokFollowers`
- `youtubeSubscribers`
- `newsletterSubscribers`
- `activePlatforms`
- `notableSignals`

Follower and subscriber values are optional. Unknown is better than guessed.

## Discovery Retention

Candidate storage is inclusive by default:

- Keep every discovered candidate, including low-star and no-star records.
- Keep public communication, creator, social, podcast, video, newsletter, representative, and official-page trails as discovery records.
- Mark unverified routes as unverified or discovery-only instead of deleting them.
- Do not convert a discovered creator/social channel into a contact route unless a public professional or representative contact path is verified.
- Do not store guessed emails, private/login-only data, or technically restricted data.
- Suppression and opt-out status block outreach, but the audit record should remain so the person is not re-added accidentally.

## Star Assessment

Superseded 2026-08-08. `StarAssessment` and the browser-side rating module were deleted; the
only star rules now are the discovery stars computed by
`scripts/build-candidate-discovery-dossiers.mjs` (`DiscoveryStarAssessment`), which an
operator can override per candidate through the review outcome in the overlay.

## Audit Event

Superseded 2026-08-08. The browser localStorage vault and its `AuditEvent` records were
deleted. Every mutation — verification, approval, enqueue, send, suppression, manual candidate,
review outcome, channel verification — is appended server-side to
`data/outreach-audit.local.jsonl` (`OUTREACH_AUDIT_PATH`), which is the append-only log this
section used to ask for.

## Verification Task

Superseded 2026-08-08. `VerificationTask` and the queue that synthesised those records were
deleted. The dashboard derives the review queue from real overlay state instead: a candidate
is outstanding until it has a recorded review outcome. See
[Dashboard completion plan](./dashboard-completion-plan.md).

## Candidate Discovery Dossier

Candidate discovery dossiers are local operational records produced by `npm run build:dossiers`.

They merge discovery-only source packages into one record per candidate:

- Candidate identity and category fields
- Provisional discovery stars
- Discovery channel candidates
- Public email candidates
- Contact-page candidates
- Affiliation hints
- Search targets
- Source URLs
- Review checks and empty review outcome fields

Discovery dossiers are not outreach approval and do not create verified contact routes.

Required fields:

- `id`
- `candidateId`
- `candidateName`
- `priority`
- `type`
- `summary`
- `sourceHints`
- `blockers`

Verification tasks are generated from candidate state and are not outreach approvals.
