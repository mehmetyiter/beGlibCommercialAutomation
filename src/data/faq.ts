import type { FaqItem } from '../types';

export const faqItems: FaqItem[] = [
  {
    id: 'faq-001',
    topic: 'Host role',
    likelyQuestion: 'What exactly would I do as a host?',
    answerDraft:
      'Hosts lead high-quality conversations for their community. The first step is a short discovery call, then we define format, cadence, language, and promotion support together.',
    owner: 'ai-draft',
  },
  {
    id: 'faq-002',
    topic: 'Time commitment',
    likelyQuestion: 'How much time does this require?',
    answerDraft:
      'The pilot can start small: one planning call, one recorded or live session, and a review loop. We can adapt cadence to the host schedule.',
    owner: 'ai-draft',
  },
  {
    id: 'faq-003',
    topic: 'Compensation',
    likelyQuestion: 'Is this paid, revenue share, or promotional?',
    answerDraft:
      'Commercial terms depend on the host profile and campaign scope. Any compensation or revenue-share conversation should be reviewed by the human decision owner before sending.',
    owner: 'human-review',
  },
  {
    id: 'faq-004',
    topic: 'Rights',
    likelyQuestion: 'Who owns the content and audience relationship?',
    answerDraft:
      'Content rights, reuse permissions, attribution, and removal paths must be documented before launch. Route this answer through legal review for final wording.',
    owner: 'legal-review',
  },
  {
    id: 'faq-005',
    topic: 'Privacy',
    likelyQuestion: 'How did you find my contact information?',
    answerDraft:
      'We only use public professional contact routes or representative channels, store source URLs, and honor deletion or opt-out requests immediately.',
    owner: 'human-review',
  },
];
