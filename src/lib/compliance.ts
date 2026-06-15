import type { Candidate, ComplianceAssessment } from '../types';

const sensitiveCategories = new Set(['religion', 'psychology', 'therapy', 'medicine']);
const consentBlockers = new Set(['opted-out', 'not-allowed']);

export function assessCandidate(candidate: Candidate): ComplianceAssessment {
  const blockers: string[] = [];
  const requiredActions: string[] = [];

  const hasProfessionalRoute = candidate.contactRoutes.some((route) =>
    ['public-business-email', 'representative-email', 'contact-form'].includes(route.type),
  );

  if (candidate.status === 'do-not-contact' || consentBlockers.has(candidate.consentStatus)) {
    blockers.push('Suppression or do-not-contact status is active.');
  }

  if (!hasProfessionalRoute) {
    blockers.push('No verified public professional contact route is available.');
  }

  if (candidate.consentStatus === 'unknown') {
    blockers.push('Consent and lawful outreach basis are unknown.');
  }

  if (sensitiveCategories.has(candidate.primaryCategory)) {
    requiredActions.push('Human review required for sensitive category outreach.');
  }

  if (['psychology', 'therapy', 'medicine'].includes(candidate.primaryCategory)) {
    requiredActions.push('Health or mental-health claims must receive legal/clinical review.');
  }

  if (candidate.riskLevel === 'high') {
    requiredActions.push('Senior approval required before any message leaves the system.');
  }

  if (candidate.country.match(/Canada/i)) {
    requiredActions.push('Confirm CASL consent basis and unsubscribe language.');
  }

  if (candidate.country.match(/Germany|France|Spain|Italy|Netherlands|Belgium|Sweden|Ireland/i)) {
    requiredActions.push('Confirm GDPR/ePrivacy basis before direct marketing.');
  }

  if (candidate.contactRoutes.some((route) => route.type === 'public-business-email')) {
    requiredActions.push('Include identity, physical mailing address, and one-click opt-out.');
  }

  if (candidate.contactRoutes.some((route) => route.type === 'contact-form')) {
    requiredActions.push('Use the contact form manually or through an approved integration only.');
  }

  const sendable = blockers.length === 0 && candidate.riskLevel !== 'high';

  if (!sendable) {
    return {
      sendable,
      label: 'Blocked',
      severity: 'high',
      blockers,
      requiredActions,
    };
  }

  if (requiredActions.length > 2 || candidate.riskLevel === 'medium') {
    return {
      sendable,
      label: 'Review first',
      severity: 'medium',
      blockers,
      requiredActions,
    };
  }

  return {
    sendable,
    label: 'Ready',
    severity: 'low',
    blockers,
    requiredActions,
  };
}
