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

Run the ninth specialist wave for arts, culture, design, architecture, photography, and food-media figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-009-arts-culture-design-food.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-009-arts-culture-design-food.local.json
```

Run the tenth specialist wave for law, policy, government, diplomacy, and public-affairs figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-010-law-policy-government.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-010-law-policy-government.local.json
```

Run the eleventh specialist wave for sports, fitness, wellness, lifestyle, and sports-media figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-011-sports-fitness-wellness-lifestyle.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-011-sports-fitness-wellness-lifestyle.local.json
```

Run the twelfth specialist wave for technology, product, gaming, cybersecurity, open-source, and developer-relations figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-012-technology-product-gaming-security.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-012-technology-product-gaming-security.local.json
```

Run the thirteenth specialist wave for environment, climate, sustainability, humanitarian, and social-impact figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-013-environment-climate-humanitarian-social-impact.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-013-environment-climate-humanitarian-social-impact.local.json
```

Run the fourteenth specialist wave for humanities, social science, ethics, and public-intellectual figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-014-humanities-social-science-public-intellectuals.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-014-humanities-social-science-public-intellectuals.local.json
```

Run the fifteenth specialist wave for music, audio production, and live-performance figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-015-music-audio-live-performance.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-015-music-audio-live-performance.local.json
```

Run the sixteenth specialist wave for travel, outdoor, aviation, maritime, and hospitality figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-016-travel-outdoor-hospitality.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-016-travel-outdoor-hospitality.local.json
```

Run the seventeenth specialist wave for craft, maker, studio-art, textile, jewelry, and home-lifestyle figures:

```bash
npm run research:wikidata-people -- --config config/research-waves/wikidata-wave-017-craft-maker-home-lifestyle.json --limit 8 --delay-ms 2500 --output data/wikidata-wave-017-craft-maker-home-lifestyle.local.json
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

The ninth config uses verified Wikidata occupation IDs for:

- Architect
- Designer
- Graphic designer
- Fashion designer
- Interior designer
- Product designer
- Photographer
- Painter
- Sculptor
- Illustrator
- Cartoonist
- Comics artist
- Animator
- Dancer
- Choreographer
- Make-up artist
- Art director
- Creative director
- Film director
- Songwriter
- Composer
- Actor
- Screenwriter
- Chef
- Cookbook writer
- Culinary writer
- Food critic
- Curator
- Art historian

The tenth config uses verified Wikidata occupation IDs for:

- Lawyer
- Judge
- Prosecutor
- Barrister
- Solicitor
- Diplomat
- Minister
- Mayor
- Member of parliament
- Lobbyist
- Campaign manager
- Political pundit
- Internationalist
- Jurist
- Legal scholar
- Law professor
- Political scientist

The eleventh config uses verified Wikidata occupation IDs for:

- Athlete
- Athletics competitor
- Association football player
- Basketball player
- Tennis player
- Baseball player
- American football player
- Cricketer
- Boxer
- Mixed martial arts fighter
- Martial artist
- Coach
- Association football coach
- Basketball coach
- Track and field coach
- Personal trainer
- Fitness trainer
- Bodybuilder
- Yoga instructor
- Sports journalist
- Sports commentator
- Model
- Beauty pageant contestant
- Beauty YouTuber

The twelfth config uses verified Wikidata occupation IDs for:

- Programmer
- Software developer
- Software engineer
- Web developer
- Mobile app developer
- Systems engineer
- Data scientist
- Artificial intelligence researcher
- Roboticist
- Computer scientist
- Inventor
- Technologist
- Open-source developer
- Technology evangelist
- Developer advocate
- Product manager
- Product designer
- User experience designer
- Video game developer
- Video game designer
- Game programmer
- Professional gamer
- Cybersecurity specialist
- Security hacker
- Computer security specialist

The thirteenth config uses verified Wikidata occupation IDs for:

- Environmentalist
- Conservationist
- Ecologist
- Environmental scientist
- Environmental engineer
- Earth scientist
- Oceanographer
- Marine biologist
- Meteorologist
- Geographer
- Climate activist
- Climatologist
- Sustainability consultant
- Urban planner
- Landscape architect
- Humanitarian
- Development worker
- Social entrepreneur
- Philanthropist
- Peace activist
- Human rights defender
- Community organizer
- Nonprofit administrator
- Fundraiser

The fourteenth config uses verified Wikidata occupation IDs for:

- Philosopher
- Historian
- Archaeologist
- Classical scholar
- Philologist
- Linguist
- Lexicographer
- Translator
- Literary critic
- Cultural critic
- Social scientist
- Sociologist
- Anthropologist
- Economist
- Political scientist
- Demographer
- Statistician
- Criminologist
- Ethicist
- Bioethicist
- Cognitive scientist
- Neuroscientist
- Intellectual
- Futurist
- Pundit
- Columnist
- Geopolitical analyst

The fifteenth config uses verified Wikidata occupation IDs for:

- Musician
- Singer
- Singer-songwriter
- Rapper
- Disc jockey
- Record producer
- DJ producer
- Conductor
- Pianist
- Guitarist
- Drummer
- Violinist
- Composer
- Songwriter
- Music journalist
- Music teacher
- Audio engineer
- Audio technician
- Sound designer
- Entertainer
- Stage actor
- Voice actor
- Theatre director
- Magician
- Comedian
- Dancer
- Choreographer

The sixteenth config uses verified Wikidata occupation IDs for:

- Travel writer
- Travel journalist
- Travel blogger
- Travel influencer
- Tour guide
- Travel guide
- Travel agent
- Explorer
- Adventurer
- Mountaineer
- Rock climber
- Climber
- Aircraft pilot
- Sailor
- Sport sailor
- Hotel manager
- Hotel owner
- Restaurateur
- Restaurant owner

The seventeenth config uses verified Wikidata occupation IDs for:

- Artisan
- Tradesperson
- Woodworker
- Carpenter
- Cabinetmaker
- Furniture maker
- Furniture designer
- Potter
- Ceramicist
- Goldsmith
- Silversmith
- Blacksmith
- Metalworker
- Textile artist
- Weaver
- Knitter
- Embroiderer
- Quilter
- Seamstress
- Interior designer

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
