export const allowedCategories = new Set([
  'science',
  'arts',
  'youtube',
  'podcast',
  'thought-leadership',
  'religion',
  'psychology',
  'therapy',
  'medicine',
  'academia',
  'journalism',
  'education',
  'technology',
  'sports',
  'fitness',
  'wellness',
  'lifestyle',
  'product',
  'gaming',
  'security',
  'environment',
  'climate',
  'sustainability',
  'humanitarian',
  'social-impact',
  'humanities',
  'social-science',
  'ethics',
  'public-intellectual',
  'music',
  'audio',
  'performance',
  'travel',
  'outdoor',
  'hospitality',
  'aviation',
  'maritime',
  'craft',
  'maker',
  'woodworking',
  'ceramics',
  'metalwork',
  'textile',
  'jewelry',
  'home-lifestyle',
  'fashion',
  'beauty',
  'style',
  'personal-care',
  'modeling',
]);

export async function buildOpenAlexBatch(options) {
  const perPage = Math.min(Math.max(Number(options.limit ?? 10), 1), 50);
  const category = allowedCategories.has(options.category) ? options.category : 'academia';
  const sourceUrl = new URL('https://api.openalex.org/works');
  sourceUrl.searchParams.set('search', options.query);
  sourceUrl.searchParams.set('per-page', String(Math.min(perPage * 2, 100)));

  if (process.env.OPENALEX_MAILTO) {
    sourceUrl.searchParams.set('mailto', process.env.OPENALEX_MAILTO);
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`OpenAlex request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const authors = collectAuthors(payload.results ?? [], options.query, category);
  const candidates = authors.slice(0, perPage).map((author) => authorToCandidate(author, options.query, category));

  if (candidates.length === 0) {
    throw new Error(`No person-like OpenAlex candidates found for query "${options.query}". Try a narrower research topic.`);
  }

  return {
    batchId: `openalex-${slugify(options.query)}-${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    sourceLabel: options.sourceLabel ?? `OpenAlex works search: ${options.query}`,
    researcher: 'beGlib research worker',
    notes:
      'Generated from OpenAlex public works metadata. No email addresses were collected. Contact routes are intentionally blocked until manually verified from official sources.',
    candidates,
  };
}

export function mergeBatches({ batchId, sourceLabel, notes, batches }) {
  const byId = new Map();

  batches.forEach((batch) => {
    (batch.candidates ?? []).forEach((candidate) => {
      const existing = byId.get(candidate.id);
      if (!existing) {
        byId.set(candidate.id, candidate);
        return;
      }

      byId.set(candidate.id, {
        ...existing,
        subcategories: unique([...existing.subcategories, ...candidate.subcategories]).slice(0, 8),
        sourceUrls: unique([...existing.sourceUrls, ...candidate.sourceUrls]).slice(0, 12),
        fitScore: Math.max(existing.fitScore, candidate.fitScore),
        reachScore: Math.max(existing.reachScore, candidate.reachScore),
        rationale: `${existing.rationale} Additional query match: ${candidate.subcategories[0]}.`,
      });
    });
  });

  return {
    batchId,
    createdAt: new Date().toISOString(),
    sourceLabel,
    researcher: 'beGlib research wave runner',
    notes,
    candidates: Array.from(byId.values()).sort(
      (left, right) => right.reachScore - left.reachScore || right.fitScore - left.fitScore,
    ),
  };
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

function collectAuthors(works, query, category) {
  const byKey = new Map();

  works.forEach((work) => {
    const topics = Array.isArray(work.topics) ? work.topics.map((topic) => topic.display_name).filter(Boolean) : [];
    const sourceUrls = [work.id, work.doi].filter(Boolean);

    (work.authorships ?? []).forEach((authorship) => {
      const author = authorship.author ?? {};
      const name = normalizeName(author.display_name);
      const authorId = author.id;

      if (!looksLikePersonName(name)) {
        return;
      }

      const key = authorId ?? name.toLowerCase();
      const institutions = (authorship.institutions ?? []).filter((institution) => institution.display_name);
      const existing = byKey.get(key) ?? {
        id: authorId,
        name,
        orcid: author.orcid,
        institutions: [],
        topics: [],
        sourceUrls: [],
        evidenceTitles: [],
        aggregateCitations: 0,
        worksSeen: 0,
      };

      existing.orcid = existing.orcid ?? author.orcid;
      existing.institutions = mergeByName(existing.institutions, institutions);
      existing.topics = unique([...existing.topics, ...topics]).slice(0, 6);
      existing.sourceUrls = unique([...existing.sourceUrls, ...sourceUrls]).slice(0, 8);
      existing.evidenceTitles = unique([...existing.evidenceTitles, work.title].filter(Boolean)).slice(0, 4);
      existing.aggregateCitations += Number(work.cited_by_count ?? 0);
      existing.worksSeen += 1;

      byKey.set(key, existing);
    });
  });

  return Array.from(byKey.values()).sort((a, b) => {
    const bScore = b.aggregateCitations + b.worksSeen * 250 + (b.orcid ? 150 : 0);
    const aScore = a.aggregateCitations + a.worksSeen * 250 + (a.orcid ? 150 : 0);
    return bScore - aScore;
  });
}

function authorToCandidate(author, query, category) {
  const institution = author.institutions[0];
  const country = getCountryName(institution?.country_code);
  const openAlexId = author.id ? author.id.split('/').pop() : slugify(author.name);
  const topics = author.topics.length > 0 ? author.topics : [query];
  const sourceUrls = unique([author.id, author.orcid, ...author.sourceUrls].filter(Boolean));
  const fitScore = clamp(62 + Math.min(author.worksSeen * 6, 18) + (topics.length >= 2 ? 8 : 0), 0, 94);
  const reachScore = clamp(45 + Math.round(Math.log10(author.aggregateCitations + 1) * 14), 0, 92);

  return {
    id: `openalex-${openAlexId}`,
    name: author.name,
    title: `${institution?.display_name ?? 'OpenAlex-indexed'} researcher connected to ${query}`,
    country,
    languages: ['Unknown'],
    primaryCategory: category,
    subcategories: unique([query, ...topics]).slice(0, 5),
    fitScore,
    reachScore,
    status: 'researching',
    consentStatus: 'unknown',
    riskLevel: ['medicine', 'psychology', 'therapy', 'religion'].includes(category) ? 'high' : 'medium',
    channels: [
      {
        platform: 'openalex',
        label: 'OpenAlex profile',
        url: author.id ?? sourceUrls[0],
        verified: true,
      },
      ...(author.orcid
        ? [
            {
              platform: 'orcid',
              label: 'ORCID',
              url: author.orcid,
              verified: true,
            },
          ]
        : []),
    ],
    contactRoutes: [
      {
        type: 'none',
        value: 'No public professional contact route verified by worker',
        sourceUrl: author.id ?? sourceUrls[0],
        verifiedAt: new Date().toISOString().slice(0, 10),
      },
    ],
    sourceUrls,
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
    rationale: `OpenAlex public metadata links this person to ${topics.slice(0, 3).join(', ')}. Manual official-source review is required before any outreach.`,
  };
}

function looksLikePersonName(name) {
  if (!name || name.length < 4 || name.length > 80) {
    return false;
  }

  if (/[:–—]|\b(review|analysis|dashboard|study|using|systematic|proceedings)\b/i.test(name)) {
    return false;
  }

  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.length <= 6 && parts.every((part) => /^[\p{L}.'-]+$/u.test(part));
}

function normalizeName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
}

function mergeByName(left, right) {
  const byName = new Map(left.map((item) => [item.display_name, item]));
  right.forEach((item) => byName.set(item.display_name, item));
  return Array.from(byName.values()).slice(0, 4);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCountryName(countryCode) {
  if (!countryCode) {
    return 'Unknown';
  }

  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}
