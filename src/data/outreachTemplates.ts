import type { OutreachTemplate } from '../types';

export const outreachTemplates: OutreachTemplate[] = [
  {
    id: 'tmpl-default',
    category: 'default',
    name: 'General host invitation',
    subject: 'A possible beGlib host collaboration',
    previewText: 'Short, respectful first-touch invitation for public professional contacts.',
    body: `Hi {{name}},

I am reaching out from beGlib because your work on {{topics}} feels aligned with the kind of thoughtful conversations we want to support.

We are exploring a small group of potential hosts for pilot conversations. The first step would simply be a short discovery call to understand whether the format, timing, and audience fit make sense for you.

If this is not relevant, you can reply "no thanks" and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy'],
  },
  {
    id: 'tmpl-academia',
    category: 'academia',
    name: 'Academic invitation',
    subject: 'Exploring a host-led knowledge conversation',
    previewText: 'For faculty, researchers, scholars, and institute profiles.',
    body: `Hi {{name}},

Your work across {{topics}} stood out while we were researching people who can host nuanced, high-trust knowledge sessions.

beGlib is preparing a limited pilot for expert-led conversations. We would like to understand whether a carefully scoped session with your audience and expertise could be useful.

Would you be open to a brief call or to having us send a one-page overview?

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'commercial'],
  },
  {
    id: 'tmpl-science',
    category: 'science',
    name: 'Science communicator invitation',
    subject: 'A science host pilot that may fit your audience',
    previewText: 'For scientists, labs, explainers, and public science voices.',
    body: `Hi {{name}},

We found your work around {{topics}} and think your communication style may fit a beGlib host pilot we are shaping.

The idea is to help credible experts lead accessible conversations without turning the format into a generic webinar. We would love to share the pilot outline and hear whether this could be useful for your community.

If you prefer not to receive this kind of note, reply and we will remove this contact route.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy'],
  },
  {
    id: 'tmpl-creator',
    category: 'youtube',
    name: 'Creator partnership invitation',
    subject: 'Potential host format for your community',
    previewText: 'For YouTube-first creators and video-native educators.',
    body: `Hi {{name}},

Your channel and work on {{topics}} made us think there may be a natural fit with a beGlib host pilot.

We are looking for creators who already have a trusted voice and may want a structured way to host deeper conversations with their audience. We can send a short overview first; no commitment needed.

Best,
beGlib team`,
    requiredReview: ['brand', 'commercial', 'privacy'],
  },
  {
    id: 'tmpl-faith',
    category: 'religion',
    name: 'Sensitive-category inquiry',
    subject: 'Carefully scoped conversation inquiry',
    previewText: 'Requires human approval before use for faith or sensitive community contexts.',
    body: `Hi {{name}},

We are researching trusted community voices for a carefully moderated conversation format. Your work around {{topics}} appears relevant, but we would want to approach any discussion with the right context and care.

If open, we can send a short overview for review. If this is not appropriate, reply and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'sensitive-category', 'legal'],
  },
  {
    id: 'tmpl-psychology',
    category: 'psychology',
    name: 'Psychology expert inquiry',
    subject: 'Carefully scoped psychology conversation inquiry',
    previewText: 'Requires human, privacy, and legal review before use for psychology voices.',
    body: `Hi {{name}},

We are researching qualified voices who can host careful, evidence-aware conversations around {{topics}}.

Because this area touches mental health and public trust, we would only proceed with clear scope, accurate positioning, and appropriate review. If open, we can send a short overview for consideration.

If this is not relevant, reply and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'sensitive-category', 'legal'],
  },
  {
    id: 'tmpl-therapy',
    category: 'therapy',
    name: 'Therapy educator inquiry',
    subject: 'Carefully scoped mental-health education inquiry',
    previewText: 'Requires extra review for therapists, counselors, and mental-health educators.',
    body: `Hi {{name}},

We are exploring expert-led conversation formats and found your public work around {{topics}}.

For therapy and mental-health education contexts, we would want the scope to be careful, non-clinical, and reviewed before anything is shared publicly. If appropriate, we can send a concise overview first.

If this is not relevant, reply and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'sensitive-category', 'legal'],
  },
  {
    id: 'tmpl-medicine',
    category: 'medicine',
    name: 'Medical expert inquiry',
    subject: 'Carefully scoped medical education conversation inquiry',
    previewText: 'Requires legal/clinical review before use for doctors and medical educators.',
    body: `Hi {{name}},

We are researching medical and public-health voices who may be a fit for carefully moderated educational conversations around {{topics}}.

We would treat this as an expert-led education format, not medical advice, and would only proceed after the scope and wording are reviewed. If open, we can send a short overview.

If this is not relevant, reply and we will not contact you again.

Best,
beGlib team`,
    requiredReview: ['brand', 'privacy', 'sensitive-category', 'legal'],
  },
];
