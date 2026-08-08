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

| | Start | After the first pass | Now |
| --- | --- | --- | --- |
| Candidates | 28,522 | 29,069 | **31,887** |
| Canadians | 810 | 1,399 | **4,254** |
| Canadians with a YouTube channel | 98 | 230 | **376** |
| Canadians with a podcast channel | 0 | 7 | **18** |
| Canadians with a newsletter/feed | 0 | 37 | **107** |
| Contact candidates (whole pool) | **0** | 84 | **369** |
| Public email candidates | 0 | 21 | **158** |
| Contact page candidates | 0 | 63 | **211** |
| Canadians with any contact candidate | 0 | 66 | **183** |
| Canadians with an email | 0 | 21 | **100** |
| Five-star dossiers | 0 | 10 | **31** |

Canadian stars: 5★ 31, 4★ 60, 3★ 313, 2★ 220, 1★ 3,630. Canadian categories now separate
properly: music 591, sports 450, medicine 323, thought-leadership 308, performance 287,
science 233, fitness 164, academia 133, technology 127, education 104, audio 98, therapy 90.

**49 Canadians are at four or five stars with a discovered email address** — the pilot list.

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

## Second collection block, 2026-08-08

Ten more rounds, in the order that mattered: finish contact discovery on the candidates we
already had, then widen the Canadian seed, then enrich the new people.

| Round | Run | Result |
| --- | --- | --- |
| 1 | Page contact, creators, `--offset 150` | 78 pages, 39 contact pages, 8 emails |
| 2 | Page contact, Canadians in the original pool | 117 pages, 57 contact pages, 20 emails |
| 3 | **Depth-2 over the discovered contact pages** | 132 pages, **90 emails** |
| 4 | YouTube search, next 50 | 50 searches, 73 priority suggestions |
| 5 | YouTube known channels, original pool | 98 channels for **3 quota units** |
| 6 | PodcastIndex, original pool (803) | 179 suggestions, 96 priority |
| 7 | Seed waves 002, 003 | 1,545 Canadians |
| 8 | Seed waves 011, 015, 019 | 1,758 Canadians |
| 9 | YouTube + PodcastIndex on the new waves | 168 channels, 561 podcast suggestions |
| 10 | Page contact + depth 2 + feeds on the new waves | 238 pages, **76 emails**, 189 feeds parsed |

**The depth-2 pass is where email addresses come from.** A first pass over a personal site
finds the *contact page*; only fetching that page finds the address on it. Rounds 3 and 10
produced 145 of the 158 public email candidates in the pool. Any future collection should
treat it as a required second step, not an optional extra.

Cheap versus expensive, measured: resolving 266 already-declared YouTube channels cost 7 quota
units in total, because `channels.list` batches 50 ids per call. The 100 searches for people
with no declared channel cost 10,000. Always run `known-only` first.

## Third collection block, 2026-08-08

Ten rounds aimed at Canada, PodcastIndex, and YouTube. Seeded every remaining wave config
against Canada (006-018), resolved declared YouTube channels for all of them, ran PodcastIndex
across 13 waves, and pushed contact discovery plus two depth-2 passes.

| | Round 20 | Round 30 |
| --- | --- | --- |
| Candidates | 31,887 | **35,528** |
| Canadians | 4,254 | **7,926** |
| Canadians with a YouTube channel | 376 | **473** |
| Canadians with a newsletter/feed | 107 | **141** |
| Canadians with a website | 1,005 | **1,691** |
| Contact candidates | 369 | **483** |
| Public email candidates | 158 | **205** |
| Canadians with an email | 100 | **128** |
| Five-star dossiers | 31 | **40** |
| Pilot list (Canada, 4-5 star, has an email) | 49 | **62** |

### The podcast finding

Canadian podcast *channels* barely moved: 18 to 21, against roughly 1,000 PodcastIndex
suggestions collected. The reason is not the search — it is attribution. For Canadians,
**759 podcast discoveries are quarantined against 20 accepted**, with these reasons:

- 423 `creator-discovery-low-confidence-requires-review` — mostly genuine name collisions.
  "Jam Crack - The Niall Grimes Climbing Podcast" is not the musician Grimes. Correctly held.
- 329 `creator-discovery-medium-confidence-requires-review` — this is where the real shows are.
  `identityConfidence` only reaches 'high' when the name *and* a topic keyword both appear, and
  a podcast title is normally just the show name plus the host. "Freedomain with Stefan
  Molyneux" carries no topic word, so it scores medium and is quarantined.

Promoting those automatically was tried and reverted: `creator-source-confidence.test.mjs`
contains a deliberate test that "OMG Hi! with George Lopez Podcast", published by a network
rather than by the person, must stay at medium and go to a human. That is a compliance
decision, not an oversight, and overturning it silently would be wrong.

What was missing instead was the human path: quarantined channels were counted in the
dashboard but never listed, so the review the quarantine assumes could not happen. The dossier
detail now shows them with their quarantine reason and the same verify control as any other
channel; confirming one promotes it into the discovery channels with the operator's evidence
note attached. **2,694 quarantined Canadian channels are now reviewable.**

If that review shows the medium tier is reliably right, the rule is worth revisiting with the
test rewritten deliberately rather than worked around.

### YouTube quota, measured

The daily 10,000-unit budget is real: after 140 searches the API returned
`429 rateLimitExceeded` and 20 of the last 40 candidates came back empty. They are recorded as
attempted, so the selector will skip them — re-run tomorrow to pick them up. Resolving
declared channels never hit the limit: 227 more channels across eleven waves cost 11 units.

## Fourth collection block, 2026-08-08

Every wave config had already been seeded against Canada, so this block went deeper rather
than wider, and it found two new seams.

**Offset paging.** The waves ran with `--limit 50` per occupation, which is the first 50
Canadians Wikidata returns for that occupation, not all of them. Re-running the creator, media,
and music waves with `--offset 50` produced 1,068 more Canadians from the same queries.

**Residence, not just citizenship.** `--include-residence` widens the match to residence and
work location resolved through P17. For the creator and media waves that added 663 Canadians
who live and work in Canada without holding citizenship — for a launch aimed at a market
rather than a passport, exactly the right people, and previously invisible.

| | Round 30 | Round 40 |
| --- | --- | --- |
| Candidates | 35,528 | **36,198** |
| Canadians | 7,926 | **8,576** |
| Canadians with a YouTube channel | 473 | **552** |
| Canadians with a newsletter/feed | 141 | **216** |
| Canadians with a website | 1,691 | **1,887** |
| Contact candidates | 483 | **707** |
| Public email candidates | 205 | **321** |
| Canadians with a contact candidate | 239 | **344** |
| Canadians with an email | 128 | **190** |
| Five-star dossiers | 40 | **63** |
| Pilot list (Canada, 4-5 star, has an email) | 62 | **98** |

### Depth is where the addresses are, again

Two more traversal passes produced 282 of the 116 new public email candidates in this block
(146 at depth 2, 136 at depth 3). A first fetch of a personal site finds the contact page; the
second finds the address; the third finds the addresses on the pages that contact page links
to. Depth 3 fetched 199 pages for 136 addresses — the best ratio of any run so far. The worker
caps traversal at `--max-depth 3`.

### YouTube search is out of quota until the daily reset

All 30 retry searches returned `429 rateLimitExceeded`; 170 searches have been spent against a
10,000-unit daily budget. The attempts are recorded, so the selector skips them and the next
run continues. Resolving declared channels stayed free of the limit — 306 more channels this
block for roughly 15 units. There are 225 eligible Canadians still queued for search.

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
