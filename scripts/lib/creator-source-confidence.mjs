const nameStopWords = new Set(['dr', 'prof', 'professor']);
const topicStopWords = new Set([
  'and',
  'with',
  'from',
  'that',
  'this',
  'public',
  'synthetic',
  'candidate',
  'example',
  'high',
  'active',
  'make',
]);

export function podcastIdentityConfidence(
  candidate,
  label,
  ownerParts,
  evidenceParts,
  suggestionUrl = '',
) {
  const confidence = identityConfidence(candidate, [label, ...evidenceParts], suggestionUrl);

  if (confidence !== 'high' || isKnownCandidateSource(candidate, suggestionUrl)) {
    return confidence;
  }

  const name = getNameParts(candidate.name);
  const normalizedOwners = ownerParts.filter(Boolean).map((owner) => normalizeOwnerName(owner));
  const contextText = normalizeSearchText([label, ...evidenceParts].filter(Boolean).join(' '));
  const ownerNamesCandidate = normalizedOwners.some((owner) => name.fullVariants.includes(owner));
  const explicitlyHostsCandidate = name.fullVariants.some((variant) =>
    [`hosted by ${variant}`, `host ${variant}`, `with ${variant}`, `by ${variant}`].some((phrase) =>
      contextText.includes(phrase),
    ),
  );

  return ownerNamesCandidate || explicitlyHostsCandidate ? 'high' : 'medium';
}

export function youtubeIdentityConfidence({
  candidate,
  label,
  description = '',
  suggestionUrl = '',
  subscriberCount,
  videoCount,
}) {
  const labelConfidence = identityConfidence(candidate, [label], suggestionUrl);
  if (labelConfidence === 'low') {
    return 'low';
  }

  const confidence = identityConfidence(candidate, [label, description], suggestionUrl);

  if (isKnownCandidateSource(candidate, suggestionUrl)) {
    return confidence;
  }

  const normalizedDescription = normalizeSearchText(description);
  const suspiciousContactSignal = [
    'google chat',
    'telegram me',
    'whatsapp me',
    'whatsapp number',
    'contact me privately',
  ].some((phrase) => normalizedDescription.includes(phrase));
  if (suspiciousContactSignal) {
    return 'low';
  }

  const normalizedLabel = normalizeSearchText(splitCamelCase(label));
  const candidateName = getNameParts(candidate.name);
  const exactCandidateLabel = candidateName.fullVariants.some((variant) => normalizedLabel === variant);
  const descriptionNamesCandidate = candidateName.fullVariants.some((variant) =>
    normalizedDescription.includes(variant),
  );
  const explicitOfficialChannelClaim = ['official youtube channel', 'official channel'].some((phrase) =>
    normalizedDescription.includes(phrase),
  );
  const establishedChannel =
    typeof subscriberCount === 'number' &&
    subscriberCount >= 1000 &&
    typeof videoCount === 'number' &&
    videoCount >= 10;

  if (exactCandidateLabel && descriptionNamesCandidate && explicitOfficialChannelClaim && establishedChannel) {
    return 'high';
  }

  if (confidence !== 'high') {
    return confidence;
  }

  if (typeof subscriberCount === 'number' && subscriberCount < 100) {
    return 'medium';
  }

  if (typeof videoCount === 'number' && videoCount < 3) {
    return 'medium';
  }

  if (!normalizedDescription && (typeof subscriberCount !== 'number' || subscriberCount < 10000)) {
    return 'medium';
  }

  return 'high';
}

function normalizeOwnerName(value) {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token, index) => index > 0 || !nameStopWords.has(token))
    .join(' ');
}

export function identityConfidence(candidate, textParts, suggestionUrl = '') {
  const text = normalizeSearchText(textParts.filter(Boolean).join(' '));
  const labelText = normalizeSearchText(splitCamelCase(textParts[0] ?? ''));
  const name = getNameParts(candidate.name);
  const topicOverlap = hasTopicOverlap(candidate, text);

  if (hasNonOwnedCreatorSignal(textParts)) {
    return 'low';
  }

  if (isKnownCandidateSource(candidate, suggestionUrl)) {
    return 'high';
  }

  if (!name.first || !name.last || name.first === name.last) {
    return 'low';
  }

  const exactFullName = name.fullVariants.some((variant) => text.includes(variant));
  const exactFullNameInLabel = name.fullVariants.some((variant) => labelText.includes(variant));
  const firstAndLast = tokenInText(text, name.first) && tokenInText(text, name.last);
  const firstAndLastInLabel = tokenInText(labelText, name.first) && tokenInText(labelText, name.last);
  const lastNameOnlyWithTopic = tokenInText(text, name.last) && topicOverlap;

  if ((exactFullNameInLabel || firstAndLastInLabel) && topicOverlap) {
    return 'high';
  }

  if (exactFullName || (firstAndLast && topicOverlap)) {
    return 'medium';
  }

  if (firstAndLast || lastNameOnlyWithTopic) {
    return 'low';
  }

  return 'low';
}

function isKnownCandidateSource(candidate, suggestionUrl) {
  if (!suggestionUrl) {
    return false;
  }

  const knownSourceUrls = [
    ...(candidate.sourceUrls ?? []),
    ...(candidate.channels ?? []).map((channel) => channel.url),
  ];

  return knownSourceUrls.some(
    (knownUrl) => normalizeSourceUrl(knownUrl) === normalizeSourceUrl(suggestionUrl),
  );
}

export function hasNonOwnedCreatorSignal(textParts) {
  const [label = '', ...evidence] = textParts;
  const normalizedLabel = normalizeSearchText(splitCamelCase(label));
  const normalizedEvidence = normalizeSearchText(evidence.filter(Boolean).join(' '));
  const unofficialLabelTokens = new Set([
    'archive',
    'archives',
    'compilation',
    'fan',
    'fans',
    'fanpage',
    'reupload',
    'reuploads',
    'restored',
    'topic',
    'tribute',
    'unofficial',
    'vevo',
  ]);
  const labelTokens = normalizedLabel.split(' ').filter(Boolean);

  if (labelTokens.some((token) => unofficialLabelTokens.has(token))) {
    return true;
  }

  return [
    'fan channel',
    'fan account',
    'fan page',
    'fan made',
    'unofficial channel',
    'not affiliated',
    'my favorite singer',
    'my favourite singer',
    'dedicated to videos of',
  ].some((phrase) => normalizedEvidence.includes(phrase));
}

function splitCamelCase(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function normalizeSourceUrl(value) {
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

function getNameParts(name) {
  const tokens = normalizeSearchText(name)
    .split(' ')
    .filter((token) => token.length > 1 && !nameStopWords.has(token));
  const substantialTokens = tokens.filter((token) => token.length > 2);
  const first = substantialTokens[0] ?? '';
  const last = substantialTokens[substantialTokens.length - 1] ?? '';
  const fullVariants = new Set();

  if (first && last) {
    fullVariants.add(`${first} ${last}`);
    fullVariants.add(tokens.join(' '));
  }

  return { first, last, fullVariants: Array.from(fullVariants) };
}

function hasTopicOverlap(candidate, text) {
  const topicTokens = topicText(candidate)
    .split(' ')
    .filter((token) => token.length > 3 && !topicStopWords.has(token));

  return topicTokens.some((token) => tokenInText(text, token));
}

function topicText(candidate) {
  return normalizeSearchText(
    [
      candidate.title,
      candidate.primaryCategory,
      ...(candidate.subcategories ?? []),
      ...(candidate.influenceSignals?.notableSignals ?? []),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function tokenInText(text, token) {
  return new RegExp(`(?:^| )${escapeRegExp(token)}(?: |$)`).test(text);
}

function normalizeSearchText(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
