import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { allowedCategories, mergeBatches, riskLevelForCategory, slugify } from './lib/openalex-research.mjs';
import { loadLocalEnv } from './lib/local-env.mjs';

const socialClaimBuilders = {
  youtube: (value) => `https://www.youtube.com/channel/${value}`,
  x: (value) => `https://x.com/${cleanHandle(value)}`,
  instagram: (value) => `https://www.instagram.com/${cleanHandle(value)}/`,
  facebook: (value) => `https://www.facebook.com/${cleanHandle(value)}`,
  linkedin: (value) => `https://www.linkedin.com/in/${cleanHandle(value)}`,
  tiktok: (value) => `https://www.tiktok.com/@${cleanHandle(value)}`,
  orcid: (value) => `https://orcid.org/${value}`,
};

const args = parseArgs(process.argv.slice(2));
const localEnv = await loadLocalEnv(args['local-env'] ?? args['env-path'] ?? args['env-file']);
const configPath = resolve(args.config ?? args._[0] ?? 'config/research-waves/wikidata-wave-001.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const outputPath = resolve(args.output ?? `data/${config.waveId ?? 'wikidata-wave'}.local.json`);
const limitPerOccupation = boundedNumber(args.limit ?? args['limit-per-occupation'], config.limitPerOccupation ?? 10, 1, 50);
const offset = boundedNumber(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
const delayMs = boundedNumber(args['delay-ms'], config.delayMs ?? 1500, 0, 60000);
const requestRetries = boundedNumber(args.retries, 2, 0, 5);
const retryDelayMs = boundedNumber(args['retry-delay-ms'], 5000, 250, 60000);
const timeoutMs = boundedNumber(args['timeout-ms'], 20000, 1000, 120000);
const minSitelinks = boundedNumber(args['min-sitelinks'], config.minSitelinks ?? 3, 0, 1000);
const rankBySitelinks = Boolean(args['rank-by-sitelinks'] ?? config.rankBySitelinks);
const batches = [];
const failures = [];

for (const group of config.categories ?? []) {
  const category = allowedCategories.has(group.category) ? group.category : 'thought-leadership';

  for (const occupation of group.occupations ?? []) {
    try {
      const batch = await buildOccupationBatch({
        category,
        occupation,
        limit: limitPerOccupation,
        offset,
        minSitelinks,
        rankBySitelinks,
        waveId: config.waveId,
      });
      batches.push(batch);
    } catch (error) {
      failures.push({
        category,
        occupation: occupation.label,
        qid: occupation.qid,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

if (batches.length === 0) {
  throw new Error(`No Wikidata occupation queries succeeded. Failures: ${failures.map((failure) => failure.message).join('; ')}`);
}

const mergedBatch = mergeBatches({
  batchId: config.waveId ?? `wikidata-${new Date().toISOString().slice(0, 10)}`,
  sourceLabel: config.sourceLabel ?? 'Wikidata occupation discovery',
  notes:
    config.notes ??
    'Generated from Wikidata public occupation metadata. Contact routes are intentionally blocked until manually verified from official or representative sources.',
  batches,
});
mergedBatch.diagnostics = {
  source: 'wikidata-people-discovery',
  occupationsRequested: (config.categories ?? []).reduce((count, group) => count + (group.occupations?.length ?? 0), 0),
  occupationsSucceeded: batches.length,
  failures,
  limitPerOccupation,
  offset,
  minSitelinks,
  rankBySitelinks,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(mergedBatch, null, 2)}\n`, 'utf8');

console.log(`Wikidata people batch written to ${outputPath}`);
console.log(`Occupations scanned: ${batches.length}`);
console.log(`Candidates: ${mergedBatch.candidates.length}`);
console.log(`Limit per occupation: ${limitPerOccupation}`);
console.log(`Offset: ${offset}`);
console.log(`Minimum sitelinks: ${minSitelinks}`);
console.log(`Rank by sitelinks: ${rankBySitelinks ? 'yes' : 'no'}`);
console.log(`Failures: ${failures.length}`);
failures.slice(0, 5).forEach((failure) => {
  console.log(`Failure: ${failure.category}/${failure.occupation} ${failure.qid}: ${failure.message}`);
});

if (localEnv.loaded) {
  console.log(`Loaded local env file: ${localEnv.path} (${localEnv.variables.length} values applied)`);
}

async function buildOccupationBatch({ category, occupation, limit, offset: queryOffset, minSitelinks: minLinks, rankBySitelinks: rankByLinks, waveId }) {
  const rows = await fetchOccupationRows(occupation.qid, limit, queryOffset, minLinks, rankByLinks);
  const people = mergeRows(rows);
  const candidates = people.map((person) => personToCandidate(person, category, occupation));

  return {
    batchId: `${waveId ?? 'wikidata'}-${slugify(occupation.label)}`,
    createdAt: new Date().toISOString(),
    sourceLabel: `Wikidata occupation: ${occupation.label}`,
    researcher: 'beGlib Wikidata occupation worker',
    notes:
      'Generated from Wikidata public metadata. Social and website links are discovery-only and require human identity verification.',
    candidates,
  };
}

async function fetchOccupationRows(occupationQid, limit, queryOffset, minLinks, rankByLinks) {
  const orderClause = rankByLinks ? 'ORDER BY DESC(?sitelinks)' : '';
  const sparql = `
SELECT ?person ?personLabel ?personDescription ?occupationLabel ?countryLabel ?enwiki ?officialWebsite ?youtube ?x ?instagram ?facebook ?linkedin ?tiktok ?orcid WHERE {
  {
    SELECT ?person WHERE {
      ?person wdt:P31 wd:Q5;
              wdt:P106 wd:${occupationQid}.
      ?person wikibase:sitelinks ?sitelinks.
      FILTER(?sitelinks >= ${minLinks})
      FILTER NOT EXISTS { ?person wdt:P570 ?dateOfDeath. }
    }
    ${orderClause}
    LIMIT ${limit}
    OFFSET ${queryOffset}
  }
  ?person wdt:P106 wd:${occupationQid}.
  BIND(wd:${occupationQid} AS ?occupation)
  OPTIONAL { ?person wdt:P27 ?country. }
  OPTIONAL { ?enwiki schema:about ?person; schema:isPartOf <https://en.wikipedia.org/>. }
  OPTIONAL { ?person wdt:P856 ?officialWebsite. }
  OPTIONAL { ?person wdt:P2397 ?youtube. }
  OPTIONAL { ?person wdt:P2002 ?x. }
  OPTIONAL { ?person wdt:P2003 ?instagram. }
  OPTIONAL { ?person wdt:P2013 ?facebook. }
  OPTIONAL { ?person wdt:P6634 ?linkedin. }
  OPTIONAL { ?person wdt:P7085 ?tiktok. }
  OPTIONAL { ?person wdt:P496 ?orcid. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;
  const url = new URL('https://query.wikidata.org/sparql');
  url.searchParams.set('format', 'json');
  url.searchParams.set('query', sparql);

  const payload = await fetchJson(url);
  return payload.results?.bindings ?? [];
}

async function fetchJson(url) {
  for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
    const response = await fetch(url, { headers: requestHeaders(), signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      return response.json();
    }

    const message = `${url.hostname} request failed: ${response.status} ${response.statusText}`;
    const canRetry = isRetryableStatus(response.status) && attempt < requestRetries;
    if (!canRetry) {
      throw new Error(message);
    }

    await sleep(retryDelayMs * (attempt + 1));
  }

  throw new Error(`${url.hostname} request failed after retries.`);
}

function mergeRows(rows) {
  const byId = new Map();

  rows.forEach((row) => {
    const wikidataUrl = row.person?.value;
    const wikidataId = wikidataUrl?.split('/').pop();
    const label = row.personLabel?.value ?? '';
    if (!wikidataId || !label || looksLikeUnresolvedWikidataLabel(label)) {
      return;
    }

    const existing = byId.get(wikidataId) ?? {
      wikidataId,
      wikidataUrl,
      name: label,
      description: row.personDescription?.value ?? '',
      occupationLabel: row.occupationLabel?.value ?? '',
      country: row.countryLabel?.value ?? 'Unknown',
      channels: [],
      sourceUrls: [wikidataUrl],
    };

    addChannel(existing, 'wikidata', 'Wikidata profile', wikidataUrl, true);
    addOptionalChannel(existing, 'wikipedia', 'Wikipedia profile', row.enwiki?.value, false);
    addOptionalChannel(existing, 'website', 'Official website', row.officialWebsite?.value, false);
    addSocialChannel(existing, 'youtube', 'YouTube', row.youtube?.value);
    addSocialChannel(existing, 'x', 'X/Twitter', row.x?.value);
    addSocialChannel(existing, 'instagram', 'Instagram', row.instagram?.value);
    addSocialChannel(existing, 'facebook', 'Facebook', row.facebook?.value);
    addSocialChannel(existing, 'linkedin', 'LinkedIn', row.linkedin?.value);
    addSocialChannel(existing, 'tiktok', 'TikTok', row.tiktok?.value);
    addSocialChannel(existing, 'orcid', 'ORCID', row.orcid?.value);

    byId.set(wikidataId, existing);
  });

  return Array.from(byId.values());
}

function addSocialChannel(person, platform, label, value) {
  if (!value || !socialClaimBuilders[platform]) {
    return;
  }

  addChannel(person, platform, label, socialClaimBuilders[platform](value), false);
}

function addOptionalChannel(person, platform, label, url, verified) {
  if (!url || !isHttpUrl(url)) {
    return;
  }

  addChannel(person, platform, label, url, verified);
}

function addChannel(person, platform, label, url, verified) {
  if (!url || !isHttpUrl(url)) {
    return;
  }

  if (person.channels.some((channel) => channel.platform === platform && channel.url === url)) {
    return;
  }

  person.channels.push({ platform, label, url, verified });
  person.sourceUrls = unique([...person.sourceUrls, url]).slice(0, 20);
}

function personToCandidate(person, category, occupation) {
  const publicSignalCount = person.channels.filter((channel) => !['wikidata', 'wikipedia'].includes(channel.platform)).length;
  const fitScore = clamp(62 + Math.min(publicSignalCount * 4, 20), 0, 92);
  const reachScore = clamp(50 + (person.channels.some((channel) => channel.platform === 'wikipedia') ? 12 : 0) + Math.min(publicSignalCount * 5, 25), 0, 90);

  return {
    id: `wikidata-${person.wikidataId}`,
    name: person.name,
    title: `${person.description || occupation.label} connected to ${occupation.label}`,
    country: person.country,
    languages: ['Unknown'],
    primaryCategory: category,
    subcategories: unique([occupation.label, person.occupationLabel, person.description].filter(Boolean)).slice(0, 6),
    fitScore,
    reachScore,
    status: 'researching',
    consentStatus: 'unknown',
    riskLevel: riskLevelForCategory(category),
    channels: person.channels,
    contactRoutes: [
      {
        type: 'none',
        value: 'No public professional contact route verified by worker',
        sourceUrl: person.wikidataUrl,
        verifiedAt: new Date().toISOString().slice(0, 10),
      },
    ],
    sourceUrls: person.sourceUrls,
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
    rationale: `Wikidata public metadata lists this person as ${occupation.label}. Social/profile links are discovery-only and require human verification before use.`,
  };
}

function requestHeaders() {
  return {
    Accept: 'application/sparql-results+json,application/json',
    'User-Agent':
      process.env.BEGLIB_RESEARCH_USER_AGENT ??
      'beGlibCommercialAutomation/0.1 (wikidata-people-discovery; local private research)',
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function cleanHandle(value) {
  return String(value).replace(/^@/, '').trim();
}

function looksLikeUnresolvedWikidataLabel(value) {
  return /^Q\d+$/i.test(String(value).trim());
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
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

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}
