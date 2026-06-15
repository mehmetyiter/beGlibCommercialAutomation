import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputPath = resolve(args.input ?? args._[0] ?? 'data/openalex-wave-001-broad-experts.local/_merged-wave.local.json');
const batch = JSON.parse(await readFile(inputPath, 'utf8'));
const allCandidates = Array.isArray(batch.candidates) ? batch.candidates : [];
const categoryFilter = args.categories
  ? new Set(String(args.categories).split(',').map((category) => category.trim()).filter(Boolean))
  : null;
const candidateLimit = Number(args.limit ?? allCandidates.length);
const selectedCandidates = allCandidates
  .filter((candidate) => !categoryFilter || categoryFilter.has(candidate.primaryCategory))
  .slice(0, Number.isFinite(candidateLimit) ? candidateLimit : allCandidates.length);
const includeWikidata = Boolean(args.wikidata);
const wikidataLimit = boundedNumber(args['wikidata-limit'], 3, 1, 5);
const delayMs = boundedNumber(args['delay-ms'], 100, 0, 5000);
const defaultSlug = slugify(batch.batchId ?? 'research-batch');
const markdownPath = resolve(args.output ?? `exports/${defaultSlug}-official-source-review.local.md`);
const jsonPath = resolve(args['json-output'] ?? `exports/${defaultSlug}-official-source-review.local.json`);
const items = [];

for (const candidate of selectedCandidates) {
  const item = buildReviewItem(candidate);

  if (includeWikidata) {
    item.wikidata = await fetchWikidataSuggestions(candidate, wikidataLimit);
    await delay(delayMs);
  }

  items.push(item);
}

const reviewPackage = {
  reviewId: `${defaultSlug}-official-source-review`,
  createdAt: new Date().toISOString(),
  sourceBatchId: batch.batchId ?? null,
  sourceLabel: batch.sourceLabel ?? null,
  sourceFile: inputPath,
  mode: includeWikidata ? 'official-source-review-with-wikidata-suggestions' : 'official-source-review',
  summary: {
    inputCandidates: allCandidates.length,
    selectedCandidates: selectedCandidates.length,
    highPriority: items.filter((item) => item.priority === 'high').length,
    urgentPriority: items.filter((item) => item.priority === 'urgent').length,
    sensitiveReviewRequired: items.filter((item) => item.sensitivityFlags.length > 0).length,
    wikidataEnabled: includeWikidata,
  },
  rules: [
    'Do not treat discovery metadata as contact permission.',
    'Use only official, professional, or representative sources for contact routes.',
    'Do not guess emails or infer address patterns.',
    'Do not collect private, breached, login-only, or technically restricted data.',
    'Keep all operational review output in ignored local files or a private database.',
  ],
  items,
};

await mkdir(dirname(markdownPath), { recursive: true });
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(reviewPackage, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(reviewPackage), 'utf8');

console.log(`Official source review JSON written to ${jsonPath}`);
console.log(`Official source review checklist written to ${markdownPath}`);
console.log(`Candidates: ${reviewPackage.summary.selectedCandidates}`);
console.log(`High priority: ${reviewPackage.summary.highPriority}`);
console.log(`Sensitive review required: ${reviewPackage.summary.sensitiveReviewRequired}`);

function buildReviewItem(candidate) {
  const hasUsableRoute = (candidate.contactRoutes ?? []).some((route) =>
    ['public-business-email', 'representative-email', 'contact-form'].includes(route.type),
  );
  const blocked = candidate.status === 'do-not-contact' || candidate.consentStatus === 'opted-out';
  const sensitivityFlags = buildSensitivityFlags(candidate);
  const priority = blocked ? 'urgent' : sensitivityFlags.length > 0 || !hasUsableRoute ? 'high' : 'medium';

  return {
    candidateId: candidate.id,
    name: candidate.name,
    title: candidate.title,
    category: candidate.primaryCategory,
    country: candidate.country,
    priority,
    reviewStatus: blocked ? 'suppression-review' : 'needs-human-review',
    sensitivityFlags,
    currentBlockers: buildCurrentBlockers(candidate, hasUsableRoute),
    existingEvidence: {
      sourceUrls: (candidate.sourceUrls ?? []).slice(0, 8),
      channels: (candidate.channels ?? []).map((channel) => ({
        platform: channel.platform,
        label: channel.label,
        url: channel.url,
        verified: Boolean(channel.verified),
      })),
      contactRoutes: (candidate.contactRoutes ?? []).map((route) => ({
        type: route.type,
        sourceUrl: route.sourceUrl,
        verifiedAt: route.verifiedAt,
      })),
    },
    searchQueries: buildSearchQueries(candidate),
    officialSourceTargets: buildOfficialSourceTargets(candidate.primaryCategory),
    approvedContactRoutes: [
      'Public professional email on an official site or institution page',
      'Representative, agent, press, booking, publisher, or media-office route',
      'Official contact form tied to the person, practice, institution, or organization',
      'Public business profile route where platform terms allow use for professional inquiry',
    ],
    disallowedCollection: [
      'Guessed email patterns',
      'Private personal email addresses not published for professional contact',
      'Breached, purchased, scraped, or hidden contact data',
      'Login-only data or data behind technical restrictions',
      'Social DMs unless the profile explicitly invites professional contact',
    ],
    reviewChecks: buildReviewChecks(candidate),
    outcomeFields: [
      'outcomeStatus',
      'officialProfileUrl',
      'officialContactRouteType',
      'officialContactRouteValue',
      'contactRouteSourceUrl',
      'verifiedAt',
      'jurisdiction',
      'suppressionStatus',
      'sensitiveCategoryReviewStatus',
      'reviewerNotes',
    ],
    reviewOutcome: buildEmptyReviewOutcome(candidate),
  };
}

function buildEmptyReviewOutcome(candidate) {
  return {
    candidateId: candidate.id,
    outcomeStatus: 'pending',
    officialProfileUrl: '',
    officialContactRouteType: '',
    officialContactRouteValue: '',
    contactRouteSourceUrl: '',
    verifiedAt: '',
    jurisdiction: candidate.country === 'Unknown' ? '' : candidate.country,
    suppressionStatus: 'unknown',
    sensitiveCategoryReviewStatus: buildSensitivityFlags(candidate).length > 0 ? 'pending' : 'not-required',
    reviewerNotes: '',
  };
}

function buildSensitivityFlags(candidate) {
  const flags = [];

  if (['psychology', 'therapy', 'medicine'].includes(candidate.primaryCategory)) {
    flags.push('health-or-mental-health');
  }

  if (candidate.primaryCategory === 'religion') {
    flags.push('religion');
  }

  if (candidate.riskLevel === 'high') {
    flags.push('high-risk');
  }

  return Array.from(new Set(flags));
}

function buildCurrentBlockers(candidate, hasUsableRoute) {
  const blockers = [];

  if (!hasUsableRoute) {
    blockers.push('No verified public professional or representative contact route.');
  }

  if (candidate.consentStatus === 'unknown') {
    blockers.push('Consent or lawful outreach basis is unknown.');
  }

  if (candidate.riskLevel === 'high') {
    blockers.push('High-risk or sensitive category review is required.');
  }

  if (candidate.status === 'do-not-contact' || candidate.consentStatus === 'opted-out') {
    blockers.push('Suppression or opt-out status blocks all outreach.');
  }

  return blockers;
}

function buildSearchQueries(candidate) {
  const name = quoted(candidate.name);
  const topic = candidate.subcategories?.[0] ? quoted(candidate.subcategories[0]) : '';
  const base = [
    `${name} official website`,
    `${name} official profile`,
    `${name} contact`,
    topic ? `${name} ${topic}` : '',
  ];

  const categoryQueries = {
    academia: [`${name} university profile`, `${name} faculty profile`, `${name} lab website`],
    arts: [`${name} official artist website`, `${name} management contact`, `${name} press contact`],
    education: [`${name} education speaker`, `${name} course creator`, `${name} official profile`],
    journalism: [`${name} author profile`, `${name} newsroom profile`, `${name} press contact`],
    medicine: [`${name} hospital profile`, `${name} clinic contact`, `${name} medical education speaker`],
    podcast: [`${name} podcast official website`, `${name} podcast host contact`, `${name} booking contact`],
    psychology: [`${name} psychology profile`, `${name} public psychology speaker`, `${name} institution profile`],
    religion: [`${name} organization profile`, `${name} interfaith speaker`, `${name} official contact`],
    science: [`${name} science communication`, `${name} university profile`, `${name} lab website`],
    technology: [`${name} technology speaker`, `${name} developer profile`, `${name} official website`],
    therapy: [`${name} therapy profile`, `${name} practice contact`, `${name} mental health speaker`],
    'thought-leadership': [`${name} speaker profile`, `${name} official website`, `${name} booking contact`],
    youtube: [`${name} YouTube channel official`, `${name} creator website`, `${name} management contact`],
  };

  return unique([...base, ...(categoryQueries[candidate.primaryCategory] ?? [])]).slice(0, 8);
}

function buildOfficialSourceTargets(category) {
  const commonTargets = [
    'Official personal website',
    'Institution, employer, lab, studio, publisher, or organization profile',
    'Representative, agency, booking, speaker, press, or media-office page',
    'Official contact form',
  ];

  const categoryTargets = {
    medicine: ['Hospital, clinic, university, public-health, or medical-practice profile'],
    psychology: ['University, clinic, practice, professional association, or public-education profile'],
    therapy: ['Practice, clinic, professional directory, institution, or representative page'],
    religion: ['Official institution, organization, foundation, interfaith, or speaker profile'],
    youtube: ['Official channel about page and linked creator or management site'],
    podcast: ['Official podcast site, RSS owner page, host profile, or network page'],
    arts: ['Official artist site, gallery, studio, label, publisher, or management page'],
    journalism: ['Newsroom, publisher, author page, press page, or representative profile'],
  };

  return unique([...commonTargets, ...(categoryTargets[category] ?? [])]);
}

function buildReviewChecks(candidate) {
  const checks = [
    'Confirm the official source matches name, field, and known source evidence.',
    'Prefer representative or organization routes over personal contact details.',
    'Record source URL, route type, verification date, country or jurisdiction, and reviewer note.',
    'Check suppression list before approving any route.',
  ];

  if (['psychology', 'therapy', 'medicine'].includes(candidate.primaryCategory)) {
    checks.push('Confirm copy and routing do not imply diagnosis, treatment, medical advice, or patient outcomes.');
    checks.push('Require health or mental-health sensitive-category review before campaign staging.');
  }

  if (candidate.primaryCategory === 'religion') {
    checks.push('Require sensitive-category review before campaign staging.');
  }

  return checks;
}

async function fetchWikidataSuggestions(candidate, limit) {
  try {
    const searchUrl = new URL('https://www.wikidata.org/w/api.php');
    searchUrl.searchParams.set('action', 'wbsearchentities');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('language', 'en');
    searchUrl.searchParams.set('search', candidate.name);
    searchUrl.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 5)));

    const searchResponse = await fetch(searchUrl, { headers: requestHeaders() });
    if (!searchResponse.ok) {
      throw new Error(`Wikidata search failed: ${searchResponse.status} ${searchResponse.statusText}`);
    }

    const searchPayload = await searchResponse.json();
    const matches = Array.isArray(searchPayload.search) ? searchPayload.search : [];
    const ids = matches.map((match) => match.id).filter(Boolean);

    if (ids.length === 0) {
      return { status: 'no-match', suggestions: [] };
    }

    const entityUrl = new URL('https://www.wikidata.org/w/api.php');
    entityUrl.searchParams.set('action', 'wbgetentities');
    entityUrl.searchParams.set('format', 'json');
    entityUrl.searchParams.set('ids', ids.join('|'));
    entityUrl.searchParams.set('props', 'claims|descriptions|sitelinks');

    const entityResponse = await fetch(entityUrl, { headers: requestHeaders() });
    if (!entityResponse.ok) {
      throw new Error(`Wikidata entity lookup failed: ${entityResponse.status} ${entityResponse.statusText}`);
    }

    const entityPayload = await entityResponse.json();
    const entities = entityPayload.entities ?? {};

    return {
      status: 'suggested',
      suggestions: matches.map((match) => {
        const entity = entities[match.id] ?? {};
        return {
          wikidataId: match.id,
          label: match.label,
          description: entity.descriptions?.en?.value ?? match.description ?? null,
          wikidataUrl: `https://www.wikidata.org/wiki/${match.id}`,
          wikipediaUrl: entity.sitelinks?.enwiki?.title
            ? `https://en.wikipedia.org/wiki/${encodeURIComponent(entity.sitelinks.enwiki.title.replaceAll(' ', '_'))}`
            : null,
          officialWebsites: extractOfficialWebsites(entity),
          verificationNote: 'Suggestion only. Human identity match is required before using any source.',
        };
      }),
    };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      suggestions: [],
    };
  }
}

function extractOfficialWebsites(entity) {
  const claims = entity.claims?.P856 ?? [];
  return claims
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter((value) => typeof value === 'string')
    .slice(0, 5);
}

function requestHeaders() {
  return {
    'user-agent':
      process.env.BEGLIB_RESEARCH_USER_AGENT ??
      'beGlibCommercialAutomation/0.1 (official-source-review; local private research)',
  };
}

function renderMarkdown(reviewPackage) {
  const lines = [
    `# Official Source Review: ${reviewPackage.sourceBatchId ?? reviewPackage.reviewId}`,
    '',
    `Source: ${reviewPackage.sourceLabel ?? 'Unknown'}`,
    `Generated: ${reviewPackage.createdAt}`,
    `Candidates: ${reviewPackage.summary.selectedCandidates}`,
    `Sensitive review required: ${reviewPackage.summary.sensitiveReviewRequired}`,
    '',
    'This checklist is for discovery verification only. Do not use it as outreach approval.',
    '',
    '## Guardrails',
    '',
    ...reviewPackage.rules.map((rule) => `- ${rule}`),
    '',
  ];

  reviewPackage.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.name}`);
    lines.push('');
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Country: ${item.country}`);
    lines.push(`- Priority: ${item.priority.toUpperCase()}`);
    lines.push(`- Status: ${item.reviewStatus}`);

    if (item.sensitivityFlags.length > 0) {
      lines.push(`- Sensitive flags: ${item.sensitivityFlags.join(', ')}`);
    }

    if (item.currentBlockers.length > 0) {
      lines.push('- Current blockers:');
      item.currentBlockers.forEach((blocker) => lines.push(`  - ${blocker}`));
    }

    lines.push('- Existing evidence:');
    item.existingEvidence.sourceUrls.slice(0, 4).forEach((sourceUrl) => lines.push(`  - ${sourceUrl}`));

    lines.push('- Search queries:');
    item.searchQueries.forEach((query) => lines.push(`  - ${query}`));

    lines.push('- Official source targets:');
    item.officialSourceTargets.forEach((target) => lines.push(`  - ${target}`));

    if (item.wikidata) {
      lines.push(`- Wikidata status: ${item.wikidata.status}`);
      item.wikidata.suggestions.slice(0, 3).forEach((suggestion) => {
        lines.push(`  - ${suggestion.label ?? suggestion.wikidataId}: ${suggestion.wikidataUrl}`);
        (suggestion.officialWebsites ?? []).forEach((website) => lines.push(`    - Official website claim: ${website}`));
      });
    }

    lines.push('- Review checks:');
    item.reviewChecks.forEach((check) => lines.push(`  - [ ] ${check}`));

    lines.push('- Review outcome template:');
    Object.entries(item.reviewOutcome).forEach(([key, value]) => {
      lines.push(`  - ${key}: ${value}`);
    });
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value.startsWith('--')) {
      const key = value.slice(2);
      if (!next || next.startsWith('--')) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        index += 1;
      }
    } else {
      parsed._.push(value);
    }
  }

  return parsed;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function quoted(value) {
  return `"${String(value).replaceAll('"', '').trim()}"`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}
