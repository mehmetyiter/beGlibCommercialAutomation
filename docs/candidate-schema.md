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

## Star Assessment

The app computes `StarAssessment` from `influenceSignals`, channels, and reach score.

Computed fields:

- `stars`
- `score`
- `label`
- `reasons`
- `missingSignals`

## Audit Event

The local vault records lightweight audit events with:

- `id`
- `type`
- `createdAt`
- `actor`
- `summary`
- `metadata`

Audit events currently live in browser localStorage. Production storage should keep a server-side append-only audit log.

## Verification Task

The verification queue uses `VerificationTask` records.

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
