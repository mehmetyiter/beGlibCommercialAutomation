# Star Rating System

## Purpose

Stars identify candidates with the strongest host-readiness and distribution signals. This is separate from compliance. A 5-star candidate can still be blocked if consent, source, sensitivity, or suppression checks fail.

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

## Compliance Rule

Stars do not override:

- Do-not-contact status
- Opt-out status
- Unknown consent
- Missing professional contact route
- Sensitive category review
- Jurisdiction review

High-star candidates are priority research targets, not automatically sendable contacts.
