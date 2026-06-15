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

## Status Values

- `researching`
- `needs-review`
- `approved`
- `contacted`
- `responded`
- `do-not-contact`

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
