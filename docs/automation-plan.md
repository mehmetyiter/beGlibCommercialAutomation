# Automation Plan

## Objective

Build a private host candidate discovery and outreach system that helps identify qualified public figures, verify compliant professional contact routes, prepare tailored outreach, and triage responses with AI assistance.

## Workstreams

### 1. Candidate Discovery

Sources, in priority order:

- Official personal, studio, lab, or organization websites
- University and institute profiles
- YouTube channel pages
- Podcast pages and RSS feeds
- ORCID, OpenAlex, Crossref, Semantic Scholar, Wikidata, and Wikipedia
- Public newsletter pages
- Agency, booking, management, and press pages

Do not scrape private platforms, login-only data, hidden email endpoints, or pages that prohibit automated collection.

### 2. Taxonomy

Top-level groups:

- Scientists
- Academia
- Artists
- YouTubers
- Podcasters
- Thought leaders
- Faith leaders
- Journalists
- Educators
- Technology voices

Each candidate can have many subcategories. Scoring should support topic fit, audience fit, geography, language, reach, credibility, brand risk, and contact confidence.

### 3. Contact Verification

Every contact route needs:

- Route type
- Public source URL
- Verification date
- Confidence level
- Jurisdiction notes
- Consent or lawful basis status

Allowed route types:

- Public business email
- Representative email
- Contact form
- Public booking page
- Approved social DM path

Blocked route types:

- Personal email guessed from patterns
- Emails from breached data
- Login-only data
- Hidden or obfuscated endpoint extraction
- Previously opted-out contacts

### 4. Outreach Campaigns

Pilot waves should stay small until reply quality, deliverability, and compliance handling are proven.

Required workflow:

1. Research candidate.
2. Verify source URLs.
3. Assess compliance.
4. Generate message draft.
5. Human review.
6. Send through approved provider.
7. Record delivery and reply status.
8. Honor opt-outs immediately.

### 5. AI Reply Automation

AI can:

- Classify incoming replies.
- Match questions to FAQ entries.
- Draft answers for low-risk questions.
- Summarize candidate interest and next steps.
- Flag sensitive or legal issues.

AI cannot auto-send:

- Pricing or compensation terms
- Contract or rights language
- Privacy/deletion responses
- Sensitive category replies
- Any reply to an angry, legal, or reputationally risky message

### 6. Human Decision Points

Human approval is required before:

- Any first send in a new jurisdiction
- Any large campaign wave
- Any high-risk or sensitive category contact
- Any message involving compensation, contracts, rights, privacy, or deletion
- Any reply where the candidate asks why they were contacted

## Proposed Architecture

Phase 1:

- React/Vite cockpit
- TypeScript domain model
- Static synthetic data
- Compliance assessment module
- Local data folders excluded from git
- Category-specific outreach draft previews
- AI reply triage simulation
- Selected-candidate dossier and approval gates

Phase 2:

- PostgreSQL schema
- Import queue
- Research worker
- Source evidence table
- Suppression list table

Phase 3:

- Email provider integration
- Inbox webhook
- AI classifier
- Human approval queue
- Audit log

Phase 4:

- Source connectors
- Deduplication
- Enrichment
- Analytics
- Campaign scheduling
