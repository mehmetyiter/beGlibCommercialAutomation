# Star Rating System

> **Implementation note, 2026-08-08.** These rules have one implementation:
> `assessDiscoveryStar` in `scripts/build-candidate-discovery-dossiers.mjs`. The second copy
> (`src/lib/starRating.ts`) was deleted — two copies of the same rules is how they drift. An
> operator can override the star for a single candidate through the review outcome; the
> override is stored in the overlay and the computed discovery score is kept beside it as
> `discoveredStars`.

## Purpose

Stars identify candidates with the strongest host-readiness and distribution signals. This is separate from compliance. A 5-star candidate can still be blocked if consent, source, sensitivity, or suppression checks fail.

Stars are never an inclusion filter. Low-star, 1-star, and no-star candidates remain in the candidate database and can still receive lawful outreach after contact-route verification and compliance review.

## Rating Scale

5 stars:

- Already hosts or appears regularly in podcast/interview/video formats.
- Has strong YouTube and/or X audience.
- Active across several social/media platforms.
- Has verified official or public media channels.
- Best first-wave host target after compliance approval.

4 stars:

- Strong creator or public intellectual signal.
- Meaningful audience on one or more channels.
- Likely good candidate after manual source review.

3 stars:

- Promising but missing one major signal, such as video presence, podcast history, or audience size.

2 stars:

- Topic fit exists but distribution strength is unclear.

1 star:

- Discovery-only candidate. Keep researching before prioritizing.

No star:

- Insufficient creator/media evidence has been verified yet.
- Keep the candidate and every public source trail discovered so the record can be enriched later.
- Do not treat missing stars as a reason to delete, suppress, or exclude the candidate from broad campaign planning.

## Signals

The app computes stars from:

- `hasPodcast`
- `hasYoutubeShow`
- `xFollowers`
- `youtubeSubscribers`
- `instagramFollowers`
- `tiktokFollowers`
- `linkedinFollowers`
- `newsletterSubscribers`
- `activePlatforms`
- verified active media channels
- existing `reachScore`

## Data Rule

Do not guess follower counts. If a number is unknown, leave it blank. The app will show that signal as missing.

Use creator-signal review outcomes to update `influenceSignals` only after a human verifies public source evidence.

## Compliance Rule

Stars do not override:

- Do-not-contact status
- Opt-out status
- Unknown consent
- Missing professional contact route
- Sensitive category review
- Jurisdiction review

High-star candidates are priority research targets, not automatically sendable contacts.

Low-star or no-star candidates are lower priority for manual review, not excluded from the database or eventual compliant campaign coverage.

## Health and Mental-Health Note

Doctors, psychologists, and therapists can be 5-star candidates when they already publish podcasts, YouTube shows, newsletters, or social education. This only means they are strong research targets. It never bypasses health-sensitive review.
