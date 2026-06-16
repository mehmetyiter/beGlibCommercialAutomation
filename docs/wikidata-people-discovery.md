# Wikidata People Discovery

## Purpose

Wikidata people discovery expands the candidate pool beyond OpenAlex by using public occupation metadata. It is useful for social-first and public-figure categories such as YouTubers, podcasters, artists, musicians, journalists, psychologists, doctors, therapists, and religious leaders.

This step does not approve outreach and does not create usable contact routes.

## Generate A Discovery Batch

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-001.json --limit 8 --delay-ms 2000 --output data/wikidata-wave-001-broad-public-figures.local.json
```

Files under `data/` are ignored by git.

Run the second broad wave for science, academia, education, writers, philosophers, social scientists, technology figures, and added specialist categories:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-002-science-academia-thought-leaders.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-002-science-academia-thought-leaders.local.json
```

Run the third specialist wave for health, medicine, psychology, therapy, public health, and adjacent health practitioners:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-003-health-mental-health-professionals.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-003-health-mental-health-professionals.local.json
```

Run the fourth specialist wave for digital creators, social video, streaming, blogging, YouTubers, and podcasters:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-004-digital-creators-social-video.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-004-digital-creators-social-video.local.json
```

Run the fifth specialist wave for media personalities, entertainment figures, speakers, and public voices:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-005-media-entertainment-public-voices.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-005-media-entertainment-public-voices.local.json
```

Run the sixth specialist wave for religious leaders, spiritual teachers, religious scholars, community organizers, social entrepreneurs, and philanthropists:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-006-religious-community-leaders.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-006-religious-community-leaders.local.json
```

Run the seventh specialist wave for business leaders, finance professionals, consultants, marketers, real estate developers, economists, accountants, and sales professionals:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-007-business-finance-leadership.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-007-business-finance-leadership.local.json
```

Run the eighth specialist wave for education, publishing, science communication, and community/public voice figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-008-education-publishing-community.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-008-education-publishing-community.local.json
```

## Merge Offset Batches

When you run multiple offsets, merge them before building dossiers:

```bash
npm run research:merge-batches -- --batch-id wikidata-wave-001-broad-public-figures --output data/wikidata-wave-001-broad-public-figures-combined.local.json data/wikidata-wave-001-broad-public-figures.local.json data/wikidata-wave-001-broad-public-figures-offset-008.local.json
```

## Current Occupation Seeds

The first config uses verified Wikidata occupation IDs for:

- YouTuber
- Podcaster
- Artist
- Visual artist
- Musician
- Journalist
- Psychologist
- Physician
- Therapist
- Religious leader
- Clergy

The second config uses verified Wikidata occupation IDs for:

- Scientist
- Researcher
- Mathematician
- Physicist
- Biologist
- Chemist
- Academic
- University teacher
- Professor
- Educator
- Teacher
- Writer
- Author
- Philosopher
- Economist
- Historian
- Sociologist
- Anthropologist
- Computer scientist
- Engineer
- Entrepreneur
- Psychiatrist
- Psychotherapist
- Theologian

The third config uses verified Wikidata occupation IDs for:

- Psychologist
- Clinical psychologist
- Mental health counselor
- Psychotherapist
- Therapist
- Mental health professional
- Social worker
- Physician
- Psychiatrist
- Surgeon
- Pediatrician
- Neurologist
- Dentist
- Pharmacist
- Nurse
- Epidemiologist
- Dietitian
- Nutritionist
- Neuroscientist

The fourth config uses verified Wikidata occupation IDs for:

- Influencer
- Internet celebrity
- Content creator
- Digital creator
- Online streamer
- Twitch streamer
- TikToker
- Blogger
- Vlogger
- YouTuber
- Podcaster

The fifth config uses verified Wikidata occupation IDs for:

- Television presenter
- Radio personality
- Actor
- Comedian
- Film director
- Screenwriter
- Film producer
- Orator
- Motivational speaker
- Activist
- Human rights defender
- Political activist

The sixth config uses verified Wikidata occupation IDs for:

- Religious leader
- Clergy
- Imam
- Ulema
- Rabbi
- Priest
- Pastor
- Preacher
- Bishop
- Cardinal
- Chaplain
- Missionary
- Monk
- Buddhist monk
- Nun
- Guru
- Spiritual teacher
- Yoga instructor
- Theologian
- Religious studies scholar
- Community organizer
- Social entrepreneur
- Philanthropist

The seventh config uses verified Wikidata occupation IDs for:

- Businessperson
- Business executive
- Chief executive officer
- Chief operating officer
- Chairperson
- Company founder
- Entrepreneur
- Investor
- Venture capitalist
- Angel investor
- Financier
- Banker
- Financial analyst
- Investment banker
- Fund manager
- Hedge fund manager
- Consultant
- Business consultant
- Management consultant
- Marketing consultant
- Marketer
- Advertising person
- Salesperson
- Real estate developer
- Economist
- Accountant

The eighth config uses verified Wikidata occupation IDs for:

- Pedagogue
- Educational theorist
- Lecturer
- School teacher
- Academic administrator
- Science communicator
- Science journalist
- Essayist
- Critic
- Editor
- Editor-in-chief
- Publisher
- Non-fiction writer
- Journalist
- Opinion journalist
- Community organizer
- Community leader
- Orator
- Conference speaker

Each result remains discovery-only until a human confirms identity and source ownership.

## What It Collects

- Wikidata profile
- English Wikipedia profile when available
- Official website claim when available
- Public social/profile claims for YouTube, X, Instagram, Facebook, LinkedIn, TikTok, and ORCID when available
- No contact routes

## Rules

- Keep every discovered candidate, including low-star and no-star records.
- Treat Wikidata claims as discovery hints, not verified ownership.
- Do not use Wikidata occupation metadata as outreach permission.
- Do not guess emails or derive contact routes from names or domains.
- Human review must confirm identity, official source URL, professional context, jurisdiction, suppression status, and sensitive-category status before campaign use.
