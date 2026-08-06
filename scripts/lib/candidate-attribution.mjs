import { hasNonOwnedCreatorSignal } from './creator-source-confidence.mjs';

const blockedPageTitlePattern = /\b(?:access denied|authentication|browse|directory|log in|login|not found|search results|sign in)\b/i;
const blockedRoutePattern = /\/(?:auth|blob|browse|category|commits?|directory|intranet|issues?|login|pulls?|releases?|search|signin|tags?|tree)(?:\/|$)/i;
const highIntentContactReasons = new Set([
  'appearance',
  'booking',
  'contact',
  'invite',
  'management',
  'manager',
  'media',
  'press',
  'representative',
  'speaker',
  'speaking',
]);
const supportPattern = /\b(?:admin(?:istrative)?\.? support|assistant|chief of staff|coordinator|executive assistant|office manager|personal assistant|secretar(?:y|iat)|support staff)\b/i;
const representativePattern = /\b(?:agent|appearance|booking|management|manager|media contact|press contact|publicist|representative|speaker(?:s)? bureau)\b/i;
const genericSocialPattern = /\b(?:find us|follow us|share(?: on)?|visit us)\b/i;
const embeddedSocialContentPattern = /(?:\bRT\s+@|\bretweet(?:ed)?\b|\bshared by\b|\bview post\b|\/status\/)/i;
const creatorContactIntentPattern = /(?:\b(?:booking|business inquiries|collab(?:oration)?s?|contact|email me|management|media inquiries|press inquiries|write me)\b|\b(?:colaboraciones?|colaborar|contacto|contrataciones|escr[ií]beme)\b|\b(?:collaborazioni|contattami|contatti|prenotazioni)\b|\b(?:anfragen|buchung|geschäftlich|kontakt|zusammenarbeit)\b|\b(?:collaboration|contactez|réservation)\b|\b(?:bana yaz|iletişim|is birligi|iş birliği)\b|お問い合わせ|連絡|联系|聯絡|合作|商务|문의|연락|협업)/iu;
const operationalMailboxPattern = /^(?:abuse|billing|careers?|compliance|cs|customercare|customerservice|customersupport|cservice|donotreply|jobs?|legal|noreply|notifications?|orders?|privacy|product|returns?|sales|shop|store|support|techsupport|webmaster)$/;

export function assessPageIdentity({
  candidateName,
  pageTitle = '',
  pageHeading = '',
  metaDescription = '',
  sourceLabel = '',
  sourceUrl = '',
  finalUrl = '',
  canonicalUrl = '',
}) {
  const evidence = [];
  let score = 0;

  score += addTextEvidence(evidence, candidateName, pageHeading, 50, 'candidate-name-in-heading');
  score += addTextEvidence(evidence, candidateName, pageTitle, 45, 'candidate-name-in-title');
  score += addTextEvidence(evidence, candidateName, metaDescription, 25, 'candidate-name-in-description');
  score += addTextEvidence(evidence, candidateName, sourceLabel, 15, 'candidate-name-in-source-label');
  score += addUrlEvidence(evidence, candidateName, finalUrl, 35, 'candidate-name-in-final-url');
  score += addUrlEvidence(evidence, candidateName, canonicalUrl, 30, 'candidate-name-in-canonical-url');
  score += addUrlEvidence(evidence, candidateName, sourceUrl, 20, 'candidate-name-in-source-url');

  const blockedTitle = blockedPageTitlePattern.test(pageTitle);
  const blockedRoute = [finalUrl, canonicalUrl, sourceUrl].some((url) => isBlockedRoute(url));
  if (blockedTitle) {
    score -= 70;
    evidence.push('directory-login-or-search-title');
  }
  if (blockedRoute) {
    score -= 60;
    evidence.push('directory-login-or-search-url');
  }

  score = clampScore(score);
  const hasStrongIdentity = evidence.some((item) =>
    ['candidate-name-in-heading', 'candidate-name-in-title', 'candidate-name-in-final-url', 'candidate-name-in-canonical-url'].includes(item),
  );
  const level =
    (blockedTitle || blockedRoute) && !hasStrongIdentity
      ? 'mismatch'
      : score >= 60 && hasStrongIdentity
        ? 'direct'
        : score >= 25
          ? 'associated'
          : 'unresolved';

  return {
    level,
    score,
    evidence,
    eligible: level === 'direct',
  };
}

export function assessEmailAttribution({
  candidateName,
  email,
  role = '',
  label = '',
  linkText = '',
  contextText = '',
  pageIdentity,
}) {
  const explicitRole = String(role).toLowerCase();
  const context = [label, linkText, contextText].filter(Boolean).join(' ');
  const directEmailScore = scoreEmailNameMatch(candidateName, email);
  const candidateDomainScore = scoreEmailDomainNameMatch(candidateName, email);
  const pageScore = pageIdentity?.score ?? 0;
  const pageIsDirect = pageIdentity?.level === 'direct';
  const evidence = [...(pageIdentity?.evidence ?? [])];
  const operationalMailbox = isOperationalMailbox(email);

  if (
    operationalMailbox &&
    !['direct-person', 'support-staff', 'representative'].includes(explicitRole)
  ) {
    evidence.push('operational-mailbox-is-not-a-candidate-contact-route');
    return attributionResult(explicitRole || 'operational-mailbox', 'unresolved', 0, evidence, false);
  }

  if (explicitRole === 'direct-person' || directEmailScore >= 80) {
    evidence.push('email-local-part-matches-candidate');
    return attributionResult('direct-person', 'direct', Math.max(90, directEmailScore, pageScore), evidence, true);
  }

  if (explicitRole === 'support-staff' || (pageIsDirect && supportPattern.test(context))) {
    evidence.push('explicit-support-staff-context');
    return attributionResult('support-staff', 'representative', Math.max(82, pageScore), evidence, true);
  }

  if (explicitRole === 'representative' || (pageIsDirect && representativePattern.test(context))) {
    evidence.push('explicit-representative-context');
    return attributionResult('representative', 'representative', Math.max(80, pageScore), evidence, true);
  }

  if (directEmailScore >= 65 && pageIsDirect) {
    evidence.push('email-local-part-probably-matches-candidate');
    return attributionResult('direct-person', 'direct', Math.max(76, directEmailScore, pageScore), evidence, true);
  }

  if (candidateDomainScore >= 80 && pageIsDirect) {
    evidence.push('email-domain-matches-candidate-name');
    return attributionResult(
      'candidate-owned-contact',
      'representative',
      Math.max(82, candidateDomainScore, pageScore),
      evidence,
      true,
    );
  }

  const quarantineReason =
    explicitRole === 'listed-person'
      ? 'email-explicitly-belongs-to-another-listed-person'
      : pageIdentity?.level === 'mismatch'
        ? 'email-found-on-directory-or-unrelated-page'
        : pageIsDirect
          ? 'email-does-not-identify-candidate-or-representative'
          : 'email-source-page-lacks-candidate-identity';
  evidence.push(quarantineReason);
  return attributionResult(explicitRole || 'unresolved', 'unresolved', Math.min(49, Math.max(directEmailScore, pageScore)), evidence, false);
}

export function assessOrcidEmailAttribution({
  candidateName,
  orcidName = '',
  identityConfidence = 'low',
  email,
  orcidVerified = false,
}) {
  const abbreviatedNameMatch = orcidNameMatchesCandidate(candidateName, orcidName);
  const directIdentity =
    identityConfidence === 'high' ||
    (identityConfidence === 'medium' && abbreviatedNameMatch && orcidVerified);
  const pageIdentity = {
    level: directIdentity ? 'direct' : identityConfidence === 'medium' ? 'associated' : 'unresolved',
    score: directIdentity ? (identityConfidence === 'high' ? 90 : 80) : identityConfidence === 'medium' ? 50 : 0,
    evidence: [
      `orcid-record-${identityConfidence}-identity-confidence`,
      abbreviatedNameMatch ? 'orcid-name-matches-candidate-name-or-initial' : undefined,
      orcidVerified ? 'orcid-email-marked-verified' : undefined,
    ].filter(Boolean),
  };

  return assessEmailAttribution({ candidateName, email, pageIdentity });
}

export function extractExplicitPublicEmailCandidates(text, { contextRadius = 180, limit = 20 } = {}) {
  const value = String(text ?? '');
  const pattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;
  const candidates = [];

  for (const match of value.matchAll(pattern)) {
    const email = match[0].replace(/[.,;:!?]+$/, '');
    if (!isExplicitEmailAddress(email)) {
      continue;
    }

    const start = Math.max(0, (match.index ?? 0) - contextRadius);
    const end = Math.min(value.length, (match.index ?? 0) + match[0].length + contextRadius);
    candidates.push({
      value: email,
      contextText: value.slice(start, end),
      intentContextText: localEmailIntentContext(value, match.index ?? 0, match[0].length),
    });
  }

  const seen = new Set();
  return candidates
    .filter((candidate) => {
      const key = candidate.value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function assessCreatorDescriptionEmailAttribution({
  candidateName,
  email,
  contextText = '',
  channelAssessment = {},
}) {
  const channelIsDirect =
    channelAssessment.eligibleForReview === true &&
    channelAssessment.identityAttribution === 'direct' &&
    channelAssessment.identityConfidence === 'high';
  const channelEvidence = channelAssessment.identityEvidence ?? [];

  if (!channelIsDirect) {
    return attributionResult(
      'unresolved',
      'unresolved',
      0,
      [...channelEvidence, 'creator-channel-is-not-high-confidence-direct'],
      false,
    );
  }

  const intentText = String(contextText).replaceAll(String(email), ' ');
  const hasContactIntent = creatorContactIntentPattern.test(intentText);
  if (!hasContactIntent) {
    return attributionResult(
      'unresolved',
      'unresolved',
      Math.min(49, channelAssessment.identityScore ?? 0),
      [
        ...channelEvidence,
        'email-published-in-direct-creator-channel-description',
        'creator-email-lacks-explicit-professional-contact-intent',
      ],
      false,
    );
  }

  const assessment = assessEmailAttribution({
    candidateName,
    email,
    role: hasContactIntent ? 'representative' : '',
    contextText,
    pageIdentity: {
      level: 'direct',
      score: Math.max(85, channelAssessment.identityScore ?? 0),
      evidence: [...channelEvidence, 'email-published-in-direct-creator-channel-description'],
    },
  });

  return {
    ...assessment,
    identityEvidence: uniqueStrings([
      ...assessment.identityEvidence,
      hasContactIntent ? 'explicit-creator-contact-intent' : undefined,
    ]),
  };
}

function localEmailIntentContext(value, index, matchLength) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const lineEndIndex = value.indexOf('\n', index + matchLength);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const currentLine = value.slice(lineStart, lineEnd).trim();
  const priorLines = value.slice(0, lineStart).split('\n');
  const nearbyLines = [];
  let scannedLines = 0;

  for (
    let index = priorLines.length - 1;
    index >= 0 && nearbyLines.length < 2 && scannedLines < 4;
    index -= 1
  ) {
    scannedLines += 1;
    const line = priorLines[index].trim();
    if (line.includes('@')) {
      break;
    }
    if (line) {
      nearbyLines.unshift(line);
    }
  }

  return [...nearbyLines, currentLine].filter(Boolean).join(' ');
}

export function assessContactPageAttribution({
  candidateName,
  url,
  label = '',
  reason = '',
  contextText = '',
  sourceUrl = '',
  pageIdentity,
}) {
  const evidence = [...(pageIdentity?.evidence ?? [])];
  const normalizedReason = normalizeIdentityText(reason);
  const context = [label, contextText].filter(Boolean).join(' ');

  const routeShape = isContactRouteShape({ url, label, reason: normalizedReason, contextText });
  if (!highIntentContactReasons.has(normalizedReason) || isBlockedRoute(url) || isShareActionUrl(url) || !routeShape) {
    evidence.push(
      isBlockedRoute(url)
        ? 'blocked-directory-login-or-search-route'
        : isShareActionUrl(url)
          ? 'social-share-action-is-not-a-contact-route'
          : 'navigation-or-content-link-is-not-a-contact-route',
    );
    return attributionResult('unresolved-route', 'unresolved', 0, evidence, false);
  }

  if (urlHasCandidateName(url, candidateName) || textHasCandidateName(label, candidateName)) {
    evidence.push('contact-route-names-candidate');
    return attributionResult('direct-route', 'direct', 90, evidence, true);
  }

  if (pageIdentity?.level === 'direct' && representativePattern.test(context)) {
    evidence.push('contact-route-has-representative-context');
    return attributionResult('representative-route', 'representative', Math.max(80, pageIdentity.score), evidence, true);
  }

  if (
    pageIdentity?.level === 'direct' &&
    isLikelyPersonalSource(sourceUrl, candidateName) &&
    isSameSiteRoute(url, sourceUrl)
  ) {
    evidence.push('contact-route-on-candidate-owned-source');
    return attributionResult('direct-route', 'direct', Math.max(75, pageIdentity.score), evidence, true);
  }

  if (pageIdentity?.level === 'direct' && !isSameSiteRoute(url, sourceUrl)) {
    evidence.push('external-service-route-lacks-candidate-or-representative-identity');
  }

  evidence.push('contact-route-lacks-candidate-or-representative-identity');
  return attributionResult('unresolved-route', 'unresolved', Math.min(49, pageIdentity?.score ?? 0), evidence, false);
}

export function assessSocialAttribution({
  candidateName,
  url,
  label = '',
  contextText = '',
  sourceUrl = '',
  pageIdentity,
}) {
  const evidence = [...(pageIdentity?.evidence ?? [])];
  const context = [label, contextText].filter(Boolean).join(' ');
  const targetMatches = urlHasCandidateName(url, candidateName) || textHasCandidateName(label, candidateName);

  if (isShareActionUrl(url)) {
    evidence.push('social-share-action-url');
    return attributionResult('site-wide-social', 'unresolved', 0, evidence, false);
  }

  if (!isSocialProfileUrl(url)) {
    evidence.push('social-content-url-is-not-an-account-profile');
    return attributionResult('social-content', 'unresolved', 0, evidence, false);
  }

  if (targetMatches) {
    evidence.push('social-target-names-candidate');
    return attributionResult('direct-social', 'direct', 90, evidence, true);
  }

  if (embeddedSocialContentPattern.test(context)) {
    evidence.push('embedded-social-stream-target-does-not-name-candidate');
    return attributionResult('social-content', 'unresolved', 0, evidence, false);
  }

  if (genericSocialPattern.test(context)) {
    evidence.push('site-wide-share-or-follow-link');
    return attributionResult('site-wide-social', 'unresolved', 0, evidence, false);
  }

  if (pageIdentity?.level === 'direct' && isLikelyPersonalSource(sourceUrl, candidateName)) {
    evidence.push('associated-social-link-on-candidate-owned-source');
    return attributionResult('representative-social', 'representative', Math.max(75, pageIdentity.score), evidence, true);
  }

  evidence.push('social-target-lacks-candidate-identity');
  return attributionResult('unresolved-social', 'unresolved', Math.min(49, pageIdentity?.score ?? 0), evidence, false);
}

export function assessFeedEmailAttribution({
  candidateName,
  email,
  feedUrl = '',
  siteUrl = '',
  sourcePageUrl = '',
  sourcePageTitle = '',
  title = '',
  authorCandidates = [],
}) {
  const evidence = [];
  if (isAutomatedMailbox(email)) {
    evidence.push('automated-or-placeholder-mailbox');
    return attributionResult('automated-mailbox', 'unresolved', 0, evidence, false);
  }

  const authorMatches = authorCandidates.some((author) => textHasCandidateName(author, candidateName));
  let pageIdentity = assessPageIdentity({
    candidateName,
    pageTitle: [sourcePageTitle, title].filter(Boolean).join(' | '),
    sourceUrl: sourcePageUrl || siteUrl || feedUrl,
    finalUrl: siteUrl || sourcePageUrl || feedUrl,
  });
  if (authorMatches && pageIdentity.level !== 'direct') {
    pageIdentity = {
      level: 'direct',
      score: 90,
      evidence: uniqueStrings([...(pageIdentity.evidence ?? []), 'candidate-named-as-feed-author']),
      eligible: true,
    };
  }

  const directAssessment = assessEmailAttribution({ candidateName, email, pageIdentity });
  if (directAssessment.eligibleForReview) {
    return directAssessment;
  }

  const [localPart = '', domain = ''] = String(email).toLowerCase().split('@');
  const tokens = candidateTokens(candidateName);
  const domainMatchesCandidate = urlHasCandidateName(`https://${domain}`, candidateName);
  const localMatchesFirstOrLast = tokens.length > 0 && [tokens[0], tokens[tokens.length - 1]].includes(normalizeIdentityText(localPart));
  if (domainMatchesCandidate && localMatchesFirstOrLast) {
    evidence.push('candidate-name-in-email-domain', 'email-local-part-matches-candidate-name');
    return attributionResult('direct-person', 'direct', 88, evidence, true);
  }
  if (domainMatchesCandidate) {
    evidence.push('candidate-name-in-email-domain');
    return attributionResult('representative', 'representative', 80, evidence, true);
  }
  if (pageIdentity.level === 'direct' && localMatchesFirstOrLast) {
    evidence.push(...pageIdentity.evidence, 'feed-email-local-part-matches-candidate-name');
    return attributionResult('direct-person', 'direct', 78, evidence, true);
  }
  if (pageIdentity.level === 'direct' && representativePattern.test(`${localPart} ${domain}`)) {
    evidence.push(...pageIdentity.evidence, 'feed-email-has-representative-domain-or-mailbox');
    return attributionResult('representative', 'representative', 76, evidence, true);
  }

  evidence.push(...pageIdentity.evidence, 'feed-email-lacks-candidate-or-representative-identity');
  return attributionResult('unresolved-feed-email', 'unresolved', Math.min(49, pageIdentity.score), evidence, false);
}

export function assessCreatorSuggestionAttribution({
  url,
  label = '',
  evidence = [],
  confidence = 'low',
  knownSourceUrls = [],
}) {
  if (hasNonOwnedCreatorSignal([label, ...evidence])) {
    return attributionResult(
      'non-owned-creator-channel',
      'unresolved',
      0,
      ['fan-topic-tribute-or-aggregator-channel-is-not-candidate-owned'],
      false,
    );
  }

  const normalizedUrl = normalizeComparableUrl(url);
  const knownSourceMatch = knownSourceUrls.some(
    (knownUrl) => normalizedUrl && normalizeComparableUrl(knownUrl) === normalizedUrl,
  );
  if (knownSourceMatch) {
    return attributionResult(
      'known-creator-channel',
      'direct',
      100,
      ['creator-url-matches-candidate-source-record'],
      true,
    );
  }
  if (confidence === 'high') {
    return attributionResult(
      'probable-creator-channel',
      'direct',
      85,
      ['creator-discovery-has-high-name-and-topic-confidence'],
      true,
    );
  }
  return attributionResult(
    'unresolved-creator-channel',
    'unresolved',
    confidence === 'medium' ? 55 : 20,
    [`creator-discovery-${confidence}-confidence-requires-review`],
    false,
  );
}

export function assessFeedAttribution({ candidateName, url, label = '', sourceUrl = '', pageIdentity }) {
  const evidence = [...(pageIdentity?.evidence ?? [])];

  if (urlHasCandidateName(url, candidateName) || textHasCandidateName(label, candidateName)) {
    evidence.push('feed-target-names-candidate');
    return attributionResult('direct-feed', 'direct', 85, evidence, true);
  }

  if (pageIdentity?.level === 'direct' && isLikelyPersonalSource(sourceUrl, candidateName)) {
    evidence.push('feed-on-candidate-owned-source');
    return attributionResult('direct-feed', 'direct', Math.max(75, pageIdentity.score), evidence, true);
  }

  evidence.push('feed-target-lacks-candidate-identity');
  return attributionResult('unresolved-feed', 'unresolved', Math.min(49, pageIdentity?.score ?? 0), evidence, false);
}

export function inferAssociatedPersonLabel(contextText, email, role) {
  if (!['support-staff', 'representative'].includes(role)) {
    return '';
  }

  const emailIndex = String(contextText).toLowerCase().indexOf(String(email).toLowerCase());
  const prefix = emailIndex >= 0 ? String(contextText).slice(Math.max(0, emailIndex - 180), emailIndex) : String(contextText);
  const rolePattern =
    role === 'support-staff'
      ? /(?:admin(?:istrative)?\.? support|assistant|chief of staff|coordinator|executive assistant|office manager|personal assistant|secretar(?:y|iat)|support staff)\s+([\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+){1,3})/iu
      : /(?:agent|booking|management|manager|media contact|press contact|publicist|representative|speaker(?:s)? bureau)\s+([\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+){1,3})/iu;
  const match = prefix.match(rolePattern);
  return match?.[1]?.trim() ?? '';
}

export function isBlockedRoute(value) {
  try {
    const url = new URL(value);
    const hasPagination = ['p', 'page', 'ps'].some((key) => url.searchParams.has(key));
    return blockedRoutePattern.test(url.pathname) || hasPagination || /(?:print|printerprofile)/i.test(`${url.pathname}${url.search}`);
  } catch {
    return false;
  }
}

export function isHighIntentContactReason(value) {
  return highIntentContactReasons.has(normalizeIdentityText(value));
}

export function isSocialAccountProfileUrl(value) {
  return isSocialProfileUrl(value) && !isShareActionUrl(value);
}

export function isPublicResearcherUrl(value) {
  try {
    const url = new URL(value);
    const environmentLabels = new Set([
      'dev',
      'development',
      'preview',
      'qa',
      'sandbox',
      'stage',
      'staging',
      'test',
      'testing',
      'uat',
    ]);
    const hostnameLabels = url.hostname.toLowerCase().split('.').filter(Boolean);

    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !environmentLabels.has(hostnameLabels[0]) &&
      !hostnameLabels.some((label) => environmentLabels.has(label))
    );
  } catch {
    return false;
  }
}

export function normalizeIdentityText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function addTextEvidence(evidence, candidateName, value, weight, label) {
  if (!textHasCandidateName(value, candidateName)) {
    return 0;
  }
  evidence.push(label);
  return weight;
}

function addUrlEvidence(evidence, candidateName, value, weight, label) {
  if (!urlHasCandidateName(value, candidateName)) {
    return 0;
  }
  evidence.push(label);
  return weight;
}

function textHasCandidateName(value, candidateName) {
  const text = normalizeIdentityText(value);
  const tokens = candidateTokens(candidateName);
  if (!text || tokens.length === 0) {
    return false;
  }
  return tokens.every((token) => new RegExp(`(?:^| )${escapeRegExp(token)}(?: |$)`).test(text));
}

function urlHasCandidateName(value, candidateName) {
  if (!value) {
    return false;
  }
  const candidateCompact = candidateTokens(candidateName).join('');
  try {
    const url = new URL(value);
    const decoded = decodeURIComponent(`${url.hostname} ${url.pathname} ${url.search}`);
    return (
      textHasCandidateName(decoded, candidateName) ||
      (candidateCompact.length >= 6 && normalizeIdentityText(decoded).replace(/ /g, '').includes(candidateCompact))
    );
  } catch {
    return (
      textHasCandidateName(value, candidateName) ||
      (candidateCompact.length >= 6 && normalizeIdentityText(value).replace(/ /g, '').includes(candidateCompact))
    );
  }
}

function isLikelyPersonalSource(value, candidateName) {
  try {
    const url = new URL(value);
    if (textHasCandidateName(url.hostname, candidateName)) {
      return true;
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return path === '/' && !/(?:\.edu|\.gov|\.ac\.[a-z]{2})$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isSameSiteRoute(value, sourceValue) {
  try {
    const targetHost = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    const sourceHost = new URL(sourceValue).hostname.toLowerCase().replace(/^www\./, '');
    return (
      targetHost === sourceHost ||
      targetHost.endsWith(`.${sourceHost}`) ||
      sourceHost.endsWith(`.${targetHost}`)
    );
  } catch {
    return false;
  }
}

function isContactRouteShape({ url, label, reason, contextText }) {
  let pathSegments = [];
  try {
    const parsed = new URL(url);
    if (isSocialPlatformHost(parsed.hostname)) {
      return false;
    }
    if (/\.(?:css|gif|ico|jpe?g|js|map|png|svg|ttf|webp|woff2?)$/i.test(parsed.pathname)) {
      return false;
    }
    pathSegments = parsed.pathname
      .toLowerCase()
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-'));
  } catch {
    return false;
  }
  const lastSegment = pathSegments[pathSegments.length - 1] ?? '';
  const routeText = normalizeIdentityText(label);
  const context = normalizeIdentityText(contextText);
  const lastIs = (...values) => values.includes(lastSegment);

  if (lastIs('feed', 'rss', 'atom', 'comments') || /\b(?:comments )?feed\b/.test(routeText)) {
    return false;
  }

  if (reason === 'contact') {
    return (
      lastIs('contact', 'contact-us', 'contactme', 'contact-me', 'get-in-touch', 'inquiries', 'inquiry') ||
      /\b(?:contact(?: me| us)?|get in touch|inquir(?:y|ies))\b/.test(routeText)
    );
  }
  if (['booking', 'invite', 'appearance'].includes(reason)) {
    return (
      lastIs('book', 'booking', 'invite', 'appearance', 'appearances', 'speaking-inquiry') ||
      /\b(?:book now|check availability|invite|request booking|speaking inquiry)\b/.test(routeText)
    );
  }
  if (['management', 'manager', 'representative'].includes(reason)) {
    return (
      lastIs('management', 'manager', 'representation', 'representative', 'representatives') ||
      /\b(?:management contact|manager contact|representation|representative contact)\b/.test(routeText)
    );
  }
  if (['speaker', 'speaking'].includes(reason)) {
    if (/\b(?:academy|course|program|training)\b/.test(`${routeText} ${context}`)) {
      return false;
    }
    return (
      lastIs('speaker', 'speaking', 'keynote', 'keynotes', 'speaking-inquiry') ||
      /\b(?:book|invite|speaker booking|speaking inquiry)\b/.test(routeText)
    );
  }
  if (['media', 'press'].includes(reason)) {
    const routeSegments = new Set(['media', 'media-contact', 'media-inquiries', 'media-kit', 'press', 'press-contact', 'press-inquiries', 'press-kit']);
    return routeSegments.has(lastSegment) || /\b(?:media|press) (?:contact|inquiries|kit|office|relations|requests)\b/.test(routeText);
  }
  return false;
}

function isShareActionUrl(value) {
  try {
    const url = new URL(value);
    const route = `${url.hostname}${url.pathname}`.toLowerCase();
    if (
      (url.hostname === 'x.com' || url.hostname.endsWith('twitter.com')) &&
      /^\/(?:home|intent\/tweet)/i.test(url.pathname) &&
      ['status', 'text', 'url'].some((key) => url.searchParams.has(key))
    ) {
      return true;
    }
    return /(?:\/|\.)(?:dialog\/share|intent\/tweet|share|sharearticle|sharer|sharing\/share-offsite|cws\/share)(?:\/|\.|$)/i.test(route);
  } catch {
    return false;
  }
}

function isSocialPlatformHost(value) {
  const host = String(value).replace(/^www\./, '').toLowerCase();
  return [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'tiktok.com',
    'twitter.com',
    'x.com',
    'youtube.com',
    'youtu.be',
  ].some((platformHost) => host === platformHost || host.endsWith(`.${platformHost}`));
}

function isSocialProfileUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    const first = segments[0]?.toLowerCase() ?? '';
    const reservedProfileRoutes = new Set([
      'about',
      'accounts',
      'business',
      'contact',
      'cookie',
      'cookies',
      'help',
      'home',
      'legal',
      'login',
      'policies',
      'policy',
      'privacy',
      'search',
      'settings',
      'terms',
    ]);

    if (host === 'youtu.be') {
      return false;
    }
    if (host.endsWith('youtube.com')) {
      return first.startsWith('@') || ['c', 'channel', 'user'].includes(first);
    }
    if (host === 'x.com' || host.endsWith('twitter.com')) {
      return segments.length === 1 && !reservedProfileRoutes.has(first) && !['intent', 'share'].includes(first);
    }
    if (host.endsWith('instagram.com')) {
      return (
        segments.length === 1 &&
        !reservedProfileRoutes.has(first) &&
        !['explore', 'p', 'reel', 'reels', 'stories', 'tv'].includes(first)
      );
    }
    if (host.endsWith('linkedin.com')) {
      return ['company', 'in', 'school'].includes(first) && segments.length >= 2;
    }
    if (host.endsWith('facebook.com')) {
      const facebookContentRoutes = new Set([
        'events',
        'groups',
        'live',
        'marketplace',
        'permalink.php',
        'photo.php',
        'photos',
        'posts',
        'reel',
        'reels',
        'story.php',
        'videos',
        'watch',
      ]);
      return (
        !reservedProfileRoutes.has(first) &&
        !['dialog', 'plugins', 'share', 'sharer', 'sharer.php'].includes(first) &&
        !segments.some((segment) => facebookContentRoutes.has(segment.toLowerCase())) &&
        segments.length >= 1
      );
    }
    if (host.endsWith('tiktok.com')) {
      return first.startsWith('@') && segments.length === 1;
    }
    return false;
  } catch {
    return false;
  }
}

function isAutomatedMailbox(email) {
  const localPart = normalizeIdentityText(String(email).split('@')[0]).replace(/ /g, '');
  return /^(?:donotreply|noemail|noreply|notifications?|techsupport|appssupport)$/.test(localPart);
}

function isOperationalMailbox(email) {
  const localPart = normalizeIdentityText(String(email).split('@')[0]).replace(/[^a-z0-9]/g, '');
  return operationalMailboxPattern.test(localPart);
}

function isExplicitEmailAddress(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value ?? ''));
}

function scoreEmailNameMatch(candidateName, email) {
  const tokens = candidateTokens(candidateName);
  if (tokens.length === 0) {
    return 0;
  }
  const localPart = normalizeIdentityText(String(email).split('@')[0]).replace(/ /g, '');
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const allTokens = tokens.join('');

  if (!localPart) {
    return 0;
  }
  if (localPart === allTokens || (localPart.includes(first) && localPart.includes(last))) {
    return 100;
  }
  if (last.length >= 4 && [first[0] + last, first + last[0]].includes(localPart)) {
    return 80;
  }
  if (last.length >= 5 && localPart === last) {
    return 65;
  }
  return 0;
}

function scoreEmailDomainNameMatch(candidateName, email) {
  const tokens = candidateTokens(candidateName);
  if (tokens.length < 2) {
    return 0;
  }

  const domain = normalizeIdentityText(String(email).split('@')[1] ?? '').replace(/ /g, '');
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (!domain || first.length < 3 || last.length < 3) {
    return 0;
  }

  return domain.includes(first) && domain.includes(last) ? 85 : 0;
}

function orcidNameMatchesCandidate(candidateName, orcidName) {
  const candidate = candidateTokens(candidateName);
  const orcid = normalizeIdentityText(orcidName).split(' ').filter(Boolean);
  const first = candidate[0] ?? '';
  const last = candidate[candidate.length - 1] ?? '';

  if (!first || !last || !orcid.includes(last)) {
    return false;
  }

  return orcid.includes(first) || orcid.includes(first[0]);
}

function normalizeComparableUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return String(value ?? '').trim().toLowerCase();
  }
}

function candidateTokens(value) {
  return normalizeIdentityText(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function attributionResult(role, attribution, score, evidence, eligible) {
  const normalizedScore = clampScore(score);
  return {
    role,
    identityAttribution: attribution,
    identityScore: normalizedScore,
    identityConfidence: normalizedScore >= 85 ? 'high' : normalizedScore >= 70 ? 'medium' : 'low',
    identityEvidence: uniqueStrings(evidence),
    eligibleForReview: eligible,
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
