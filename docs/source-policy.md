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
