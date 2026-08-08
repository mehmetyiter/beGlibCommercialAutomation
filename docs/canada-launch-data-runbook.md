# Canada launch: data collection runbook

Written 2026-08-08, after the first Canada-targeted collection run. The first production
opening is Canada, so this records what the pipeline does, what was wrong with it for a
country-targeted launch, and the exact commands that produced the current pool.

## What was wrong

**The seed stage had no country filter.** `research-wikidata-people.mjs` selected people by
occupation and sitelink count only. That returns whoever is globally famous, so a 28,522
candidate pool contained **810 Canadians (2.8%)** while the launch market is Canada. Fixed:
`--country <QID>` (repeatable, comma-separated) filters on citizenship (P27) inside the inner
SELECT, so the per-occupation LIMIT counts matches instead of being filtered afterwards.
`--include-residence` widens it to residence (P551) and work location (P937) resolved through
P17, which picks up people who live and work in a country without holding its citizenship.

**Dual citizens were filed under the wrong country.** Wikidata returns one row per
citizenship, and the merge kept whichever arrived first. Pokimane (Morocco, Canada) and Cory
Doctorow (UK, US, Canada) were not Canadians as far as the dashboard was concerned. Fixed:
all citizenships are collected, `citizenships` is kept on the candidate, and
`--country-label Canada` makes a targeted wave file its people under the country it targeted.

**16 category slugs in the wave configs did not exist in `allowedCategories`**, so ~54
occupation groups were silently relabelled `thought-leadership` — including `digital-creator`,
`streaming`, `blogging`, `media`, `entertainment`, and `speaking`, which are exactly the
groups a creator-led launch wants to sort by. That is why 240 of the original 810 Canadians
were "thought-leadership". Fixed: the slugs were added, and an unknown slug now prints a
warning instead of collapsing quietly.

**The enrichment stages had never run against the merged pool.** 84,896 channel signals, zero
contact candidates, zero podcast channels, and no dossier above three stars — because stars
need contact and creator signals to exist. Nothing in the pool was sendable.

**No stage could be scoped to a country.** The expensive stages — YouTube search at 100 quota
units per call, page fetching at one page per second — could only be limited by category,
offset, and count. Fixed: `--countries` on the creator worker, the page-contact worker, and
the YouTube search selector. All three match the filed country *or* any recorded citizenship.

## The run

Seed two Canada waves (SPARQL, no API key needed):

```bash
node scripts/research-wikidata-people.mjs --config config/research-waves/wikidata-wave-004-digital-creators-social-video.json \
  --country Q16 --country-label Canada --limit 50 --min-sitelinks 0 --delay-ms 900 \
  --output data/canada-wave-004-digital-creators-social-video.local.json
node scripts/research-wikidata-people.mjs --config config/research-waves/wikidata-wave-005-media-entertainment-public-voices.json \
  --country Q16 --country-label Canada --limit 50 --min-sitelinks 0 --delay-ms 900 \
  --output data/canada-wave-005-media-entertainment-public-voices.local.json
```

Contact discovery over the Canadian subset (no API key; fetches public pages):

```bash
node scripts/research-public-page-contact-sources.mjs \
  --batch data/canada-wave-004-digital-creators-social-video.local.json,data/canada-wave-005-media-entertainment-public-voices.local.json \
  --countries Canada --limit 150 --delay-ms 700 --timeout-ms 12000 \
  --output exports/canada-creators-page-contact-sources.local.md \
  --json-output exports/canada-creators-page-contact-sources.local.json
```

Note: `--source-batch-id` is a *filter* on the input packages, not a label for the output.
Passing a new name there matches nothing and the run quietly reports zero page sources.

Resolve the YouTube channels the candidates already declare on Wikidata. This is the cheap
half of YouTube: `channels.list` batches 50 ids into one call at 1 quota unit, so 167 channels
cost 4 units.

```bash
node scripts/research-creator-sources.mjs --batch data/canada-wave-004-digital-creators-social-video.local.json \
  --countries Canada --sources youtube --youtube-mode known-only --youtube-search-limit 0 --max 3 \
  --output exports/canada-creators-004-youtube.local.md --json-output exports/canada-creators-004-youtube.local.json
```

Then the expensive half — search for candidates with no declared channel. The selector ranks
by discovery stars, skips anyone already resolved or already attempted, and now takes a
country filter. At 100 units per search against a 10,000/day default quota, 50 candidates is
half a day's budget:

```bash
node scripts/select-youtube-search-candidates.mjs --batch data/canada-wave-004-digital-creators-social-video.local.json \
  --dossier exports/all-waves-discovery-dossiers.local.json --input-dir exports \
  --countries Canada --limit 50 --min-stars 0 --output data/canada-youtube-search-candidates.local.json
node scripts/research-creator-sources.mjs --batch data/canada-youtube-search-candidates.local.json \
  --sources youtube --youtube-mode search-only --youtube-search-limit 50 --max 3 --delay-ms 250 \
  --output exports/canada-youtube-search.local.md --json-output exports/canada-youtube-search.local.json
```

Rebuild the dossier export from every pool (repeatable `--batch`, merged by candidate id):

```bash
node scripts/build-candidate-discovery-dossiers.mjs \
  --batch data/wikidata-all-waves-public-figures-combined.local.json \
  --batch data/openalex-wave-001-broad-experts.local/_merged-wave.local.json \
  --batch data/canada-wave-004-digital-creators-social-video.local.json \
  --batch data/canada-wave-005-media-entertainment-public-voices.local.json \
  --review-id all-pools --input-dir exports --filename-excludes discovery-dossiers,smoke,summary \
  --output exports/all-waves-discovery-dossiers.local.json \
  --markdown-output exports/all-waves-discovery-dossiers.local.md
```

## Where the pool stands

| | Before | After |
| --- | --- | --- |
| Candidates | 28,522 | 29,069 |
| Canadians | 810 | **1,399** |
| Canadians with a YouTube channel | 98 | **230** |
| Canadians with a podcast channel | 0 | 7 |
| Canadians with a newsletter/feed | 0 | 37 |
| Contact candidates (whole pool) | **0** | 84 |
| Public email candidates | 0 | 21 |
| Contact page candidates | 0 | 63 |
| Canadians with any contact candidate | 0 | 66 |
| Five-star dossiers | 0 | 10 |

Canadian stars: 5★ 10, 4★ 39, 3★ 175, 2★ 99, 1★ 1,076. Canadian categories now separate
properly: film 112, entertainment 96, media 94, activism 94, digital-creator 79, speaking 71,
blogging 66, youtube 56, streaming 52, podcast 43.

### Podcast and feed pass

With the PodcastIndex credentials in place, `--sources podcastindex` over both Canada waves
returned 191 suggestions (91 above the confidence floor), and parsing the feeds discovered by
the page scan added 60 parsed feeds and 4 more public email candidates:

```bash
node scripts/research-creator-sources.mjs --batch data/canada-wave-004-digital-creators-social-video.local.json \
  --countries Canada --sources podcastindex --max 3 --delay-ms 350 \
  --output exports/canada-creators-004-podcast.local.md --json-output exports/canada-creators-004-podcast.local.json

node scripts/research-feed-source-signals.mjs --input-dir exports \
  --filename-includes canada- --filename-excludes discovery-dossiers,summary \
  --limit 150 --delay-ms 600 --timeout-ms 12000 \
  --output exports/canada-feed-source-signals.local.md --json-output exports/canada-feed-source-signals.local.json
```

### Pilot short list

49 Canadians now sit at four or five stars, and 66 have at least one contact candidate. The
addresses discovered are real published business routes — `partnerships@azzyland.com`,
`ItsFunneh.Business@outlook.com`, `hello@corrieblock.com` — mostly from YouTube channel
metadata and official site contact pages.

Two things for whoever works this list:

- Several are consumer-domain addresses (gmail, hotmail, outlook) published as the business
  contact. That is still a published professional route, but the source page has to be opened
  and the evidence note has to say so; the verification gate will not accept it otherwise.
- Agency addresses such as `teampokimane@wmeagency.com` are representative routes. The
  verification gate only accepts `public-business-email` with a `public-business-contact`
  basis, so a representative route cannot be verified or emailed through this system as it
  stands. Treat those as manual, human-initiated contact.

## Still open

- **Contact discovery covered 150 pages of a possible 427 Canadian website channels.** Re-run
  with `--offset 150` to continue; the worker records what it attempted. This is the highest
  value remaining run: it is where email addresses come from.
- **The YouTube search pass covered 50 of 142 eligible Canadians.** Re-run the selector; it
  excludes anyone already attempted, so it picks up where it left off. Budget 100 quota units
  per candidate.
- Podcast discovery has only run against the two Canada waves. The other 27,600 candidates
  have never been searched.
- One SPARQL query (`political activist`) timed out on the public endpoint. Re-run that
  occupation alone with a smaller `--limit`.
- The remaining pool outside Canada has no contact data at all. That is correct for now:
  contact discovery should follow the launch market, not precede it.
