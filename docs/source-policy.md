# Source Policy

## Allowed Sources

The system may use public, professional, and source-attributed information from:

- Official personal, lab, studio, organization, or university pages
- OpenAlex, ORCID, Crossref, Semantic Scholar, Wikidata, and similar public metadata sources
- Public podcast pages and RSS feeds
- Public YouTube channel pages where allowed by platform terms
- Public agency, booking, press, or representative pages

## Disallowed Sources

Do not use:

- Breached, leaked, or purchased contact lists
- Guessed email patterns
- Login-only or private platform data
- Scraping that bypasses paywalls, CAPTCHAs, robots restrictions, or technical access controls
- Hidden endpoints or obfuscated contact extraction
- Data from anyone already marked do-not-contact

## Worker Rule

Automated research workers may discover candidate profiles and source URLs. They must not mark a contact route as usable unless the source is public, professional, and directly attributable.

The current OpenAlex worker intentionally sets `contactRoutes[0].type` to `none`, because OpenAlex is a discovery source rather than an outreach permission source.

ORCID public email candidates may be retained as discovery records in ignored local exports, but they are not verified contact routes until a human confirms identity match, professional context, current source URL, jurisdiction, suppression status, and sensitive-category review.

Public page contact discovery may inspect already-discovered public website URLs for contact links, explicit `mailto:` links, social links, and feed links. It must not store raw HTML, guess emails, decode obfuscated addresses, or fetch private, login-only, hidden, or technically restricted data.

Feed source signal discovery may parse public RSS and Atom feeds for creator/media signals and public feed email candidates. It must not infer private audience counts, guess emails, or treat feed owner or author emails as verified contact routes without human review.

Wikidata people discovery may use public occupation metadata to expand the candidate pool. Wikidata claims are discovery hints only and must not be treated as identity verification, source ownership, contact permission, or outreach approval.

## Source Coverage Rule

No single source is enough for this project.

OpenAlex is strong for academic, science, health, education, and public-scholarship discovery. It is weak for YouTubers, podcasters, artists, social-first creators, current audience metrics, and official outreach routes. Those signals must come from separate source layers such as official sites, representative pages, platform APIs, podcast directories, RSS feeds, Wikidata, and manual verification.

## Human Review Rule

A human must verify:

- Identity match
- Official source URL
- Professional contact route
- Jurisdiction
- Consent or lawful outreach basis
- Suppression list status
- Sensitive category risk
- Health or mental-health claim risk

before any candidate can enter an outbound campaign.

## Verification Queue

Discovery candidates with missing contact route, unknown consent, unverified channels, high-risk categories, or suppression status should be routed to the verification queue before campaign staging.
