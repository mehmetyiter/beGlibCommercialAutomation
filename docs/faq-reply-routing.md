# FAQ and Reply Routing

## Reply Classes

- Interested
- Wants more information
- Asks about compensation
- Asks about rights
- Asks about privacy or data source
- Requests meeting
- Routes to manager or representative
- Not interested
- Unsubscribe or deletion request
- Complaint or legal risk

## AI Draft Allowed

AI can draft replies for:

- General product explanation
- Host role overview
- Scheduling logistics
- Basic pilot format
- Public FAQ answers

## Human Review Required

Human review is required for:

- Compensation
- Revenue share
- Contracts
- Content rights
- Privacy or deletion
- Sensitive religious, political, health, or legal contexts
- Complaints
- Any angry or reputation-risk reply

## Default FAQ Seed

Initial FAQ items are stored in `src/data/faq.ts`. The production version should move these to a database table with owner, approval state, jurisdiction notes, and version history.
