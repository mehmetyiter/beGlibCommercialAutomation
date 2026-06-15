import { assessCandidate } from './compliance';
import { assessStarRating } from './starRating';
import type { Candidate, VerificationPriority, VerificationTask } from '../types';

const priorityWeight: Record<VerificationPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function buildVerificationTasks(candidates: Candidate[]): VerificationTask[] {
  return candidates
    .flatMap((candidate) => createCandidateTasks(candidate))
    .sort((left, right) => priorityWeight[right.priority] - priorityWeight[left.priority]);
}

export function createCandidateTasks(candidate: Candidate): VerificationTask[] {
  const compliance = assessCandidate(candidate);
  const starAssessment = assessStarRating(candidate);
  const sourceHints = candidate.sourceUrls.slice(0, 4);
  const hasUsableRoute = candidate.contactRoutes.some((route) =>
    ['public-business-email', 'representative-email', 'contact-form'].includes(route.type),
  );
  const tasks: VerificationTask[] = [];

  if (candidate.status === 'do-not-contact' || candidate.consentStatus === 'opted-out') {
    tasks.push({
      id: `${candidate.id}-suppression`,
      candidateId: candidate.id,
      candidateName: candidate.name,
      priority: 'urgent',
      type: 'suppression',
      summary: 'Confirm suppression record and retain only minimum do-not-contact data.',
      sourceHints,
      blockers: compliance.blockers,
    });
    return tasks;
  }

  if (candidate.channels.some((channel) => !channel.verified)) {
    tasks.push({
      id: `${candidate.id}-identity-match`,
      candidateId: candidate.id,
      candidateName: candidate.name,
      priority: starAssessment.stars >= 4 ? 'high' : 'medium',
      type: 'identity-match',
      summary: 'Verify that all social/media channels belong to the same person.',
      sourceHints,
      blockers: compliance.blockers,
    });
  }

  if (!hasUsableRoute) {
    tasks.push({
      id: `${candidate.id}-contact-route`,
      candidateId: candidate.id,
      candidateName: candidate.name,
      priority: starAssessment.stars >= 4 ? 'high' : 'medium',
      type: 'contact-route',
      summary: 'Find an official professional contact, representative page, or approved contact form.',
      sourceHints,
      blockers: compliance.blockers,
    });
  }

  if (candidate.consentStatus === 'unknown' || compliance.requiredActions.length > 0) {
    tasks.push({
      id: `${candidate.id}-jurisdiction`,
      candidateId: candidate.id,
      candidateName: candidate.name,
      priority: candidate.riskLevel === 'high' ? 'high' : 'medium',
      type: 'jurisdiction',
      summary: 'Confirm jurisdiction, lawful outreach basis, and required opt-out language.',
      sourceHints,
      blockers: compliance.blockers,
    });
  }

  if (
    ['religion', 'psychology', 'therapy', 'medicine'].includes(candidate.primaryCategory) ||
    candidate.riskLevel === 'high'
  ) {
    tasks.push({
      id: `${candidate.id}-sensitive-category`,
      candidateId: candidate.id,
      candidateName: candidate.name,
      priority: 'high',
      type: 'sensitive-category',
      summary: 'Run sensitive-category review before any draft is approved.',
      sourceHints,
      blockers: compliance.blockers,
    });
  }

  if (sourceHints.length === 0) {
    tasks.push({
      id: `${candidate.id}-official-profile`,
      candidateId: candidate.id,
      candidateName: candidate.name,
      priority: 'medium',
      type: 'official-profile',
      summary: 'Attach at least one official or highly reliable profile source.',
      sourceHints,
      blockers: compliance.blockers,
    });
  }

  return tasks;
}
