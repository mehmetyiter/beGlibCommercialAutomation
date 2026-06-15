# Source Roadmap

## Decision

OpenAlex is useful, but not sufficient by itself.

Use it as the first expert discovery layer for academics, scientists, psychologists, therapists, doctors, educators, technology researchers, and public scholars. Do not use it as the only candidate source and do not treat it as contact permission.

## Source Layers

1. Expert graph:
   OpenAlex, ORCID, Crossref, Semantic Scholar, university pages, lab pages, publisher pages.

2. Official identity and contact verification:
   Personal sites, institution profiles, speaker pages, press pages, booking agents, management pages, clinic or practice pages, publisher and media kit pages.

3. YouTube and video presence:
   YouTube Data API and public channel pages for channel identity, upload activity, public subscriber signals where available, video themes, and cross-linked official sites.

4. Podcast presence:
   PodcastIndex, public podcast directories, official podcast pages, and RSS feeds for show existence, host names, episode cadence, and official site links.

5. Public knowledge graph:
   Wikidata and Wikipedia for disambiguation, roles, professions, notable works, official websites, and multilingual aliases.

6. Social and newsletter presence:
   X, Instagram, TikTok, LinkedIn, Substack, Medium, Bluesky, Mastodon, and newsletter pages only when data is public and platform terms allow access. Login-only or technically restricted data is not allowed.

7. Representative and press routes:
   Agency pages, speaker bureaus, publicists, publishers, university media offices, and organization contact forms.

## What Each Layer Proves

OpenAlex proves:

- The person is connected to a topic through public scholarly metadata.
- There may be authority or expertise worth reviewing.
- ORCID, affiliation, works, and topic evidence can help disambiguate identity.

OpenAlex does not prove:

- Current social reach.
- YouTube or podcast activity.
- Public speaking availability.
- Permission or lawful basis for outreach.
- A usable professional contact route.
- Whether a health, mental-health, religious, or other sensitive category message is appropriate.

## Star Rating Implications

OpenAlex candidates start with discovery confidence, not creator strength.

Five-star host candidates should usually have multiple verified signals:

- Existing podcast, YouTube, newsletter, or public speaking activity.
- Active audience on X or another relevant public platform.
- Official professional contact or representative route.
- Topic fit with beGlib.
- Evidence that the person communicates well to a public audience.
- No unresolved suppression, consent, jurisdiction, privacy, or sensitive-category block.

## Next Workers

Build workers in this order:

1. Official-site verifier:
   Finds official pages and creates verification tasks for public professional contact routes.

2. YouTube and creator-signal review worker:
   Finds public channels, links them to candidates, and records public channel/video signals. Initial YouTube Data API discovery scaffolding is available through `npm run research:creator-sources`.

3. Podcast and newsletter review worker:
   Finds podcast pages, RSS feeds, show archives, and newsletter pages, then records host/show signals without auto-approving embedded emails. Initial PodcastIndex and RSS/Atom discovery scaffolding is available through `npm run research:creator-sources`.

4. Wikidata disambiguation worker:
   Adds aliases, professions, official website claims, and public identifier links. Initial public identity source discovery is available through `npm run research:identity-sources`.

5. Social signal verifier:
   Records public profile URLs and visible audience/activity signals through allowed APIs or manual review.

6. Representative route verifier:
   Prioritizes management, agent, speaker, press, clinic, university media, or organization routes over personal contact details.

## Guardrails

- Store operational results only in ignored local paths or a private database.
- Do not commit real candidate data, emails, verification exports, or suppression records.
- Do not guess emails.
- Do not scrape private, login-only, hidden, or technically restricted data.
- Do not auto-send outreach from discovery-only records.
- Require legal or specialist review for health, mental-health, religion, minors, privacy, contract, or complaint-related cases.

## Reference Docs

- OpenAlex API: https://developers.openalex.org/
- YouTube Data API: https://developers.google.com/youtube/v3/docs
- PodcastIndex API: https://podcastindex-org.github.io/docs-api/
- Wikidata Query Service: https://query.wikidata.org/
