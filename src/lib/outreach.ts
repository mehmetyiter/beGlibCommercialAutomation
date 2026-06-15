import { outreachTemplates } from '../data/outreachTemplates';
import type { Candidate, OutreachTemplate } from '../types';

export function getTemplateForCandidate(candidate: Candidate): OutreachTemplate {
  return (
    outreachTemplates.find((template) => template.category === candidate.primaryCategory) ??
    outreachTemplates.find((template) => template.category === 'default') ??
    outreachTemplates[0]
  );
}

export function renderOutreachDraft(candidate: Candidate, template: OutreachTemplate): string {
  const topics = candidate.subcategories.slice(0, 3).join(', ');

  return template.body
    .replaceAll('{{name}}', candidate.name)
    .replaceAll('{{topics}}', topics.toLowerCase());
}
