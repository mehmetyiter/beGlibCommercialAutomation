import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const creatorPlatforms = ['youtube', 'podcast', 'x', 'instagram', 'tiktok', 'linkedin', 'newsletter'];

const args = parseArgs(process.argv.slice(2));
const inputPath = resolve(args.input ?? args._[0] ?? 'data/openalex-wave-001-broad-experts.local/_merged-wave.local.json');
const batch = JSON.parse(await readFile(inputPath, 'utf8'));
const allCandidates = Array.isArray(batch.candidates) ? batch.candidates : [];
const categoryFilter = args.categories
  ? new Set(String(args.categories).split(',').map((category) => category.trim()).filter(Boolean))
  : null;
const candidateLimit = boundedNumber(args.limit, allCandidates.length, 1, allCandidates.length || 1);
const selectedCandidates = allCandidates
  .filter((candidate) => !categoryFilter || categoryFilter.has(candidate.primaryCategory))
  .slice(0, candidateLimit);
const defaultSlug = slugify(batch.batchId ?? 'research-batch');
const markdownPath = resolve(args.output ?? `exports/${defaultSlug}-creator-signal-review.local.md`);
const jsonPath = resolve(args['json-output'] ?? `exports/${defaultSlug}-creator-signal-review.local.json`);
const items = selectedCandidates.map((candidate) => buildReviewItem(candidate));
const reviewPackage = {
  reviewId: `${defaultSlug}-creator-signal-review`,
  createdAt: new Date().toISOString(),
  sourceBatchId: batch.batchId ?? null,
  sourceLabel: batch.sourceLabel ?? null,
  sourceFile: inputPath,
  mode: 'creator-signal-review',
  summary: {
    inputCandidates: allCandidates.length,
    selectedCandidates: selectedCandidates.length,
    withYoutubeSignal: items.filter((item) => item.currentSignals.hasYoutubeShow).length,
    withPodcastSignal: items.filter((item) => item.currentSignals.hasPodcast).length,
    highSignalGaps: items.filter((item) => item.priority === 'high').length,
  },
  rules: [
    'Use only public profile, channel, podcast, RSS, newsletter, or platform pages that are allowed by source terms.',
    'Do not infer follower counts; record visible public counts only when verified.',
    'Do not collect private messages, private emails, login-only data, scraped hidden data, or audience data behind technical restrictions.',
    'Creator/media signals update prioritization only. They do not approve outreach.',
    'Keep operational review output in ignored local files or a private database.',
  ],
  items,
};

await mkdir(dirname(markdownPath), { recursive: true });
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(reviewPackage, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(reviewPackage), 'utf8');

console.log(`Creator signal review JSON written to ${jsonPath}`);
console.log(`Creator signal review checklist written to ${markdownPath}`);
console.log(`Candidates: ${reviewPackage.summary.selectedCandidates}`);
console.log(`High signal gaps: ${reviewPackage.summary.highSignalGaps}`);

function buildReviewItem(candidate) {
  const currentSignals = {
    hasPodcast: Boolean(candidate.influenceSignals?.hasPodcast || hasChannel(candidate, 'podcast')),
    hasYoutubeShow: Boolean(candidate.influenceSignals?.hasYoutubeShow || hasChannel(candidate, 'youtube')),
    activePlatforms: unique([
      ...(candidate.influenceSignals?.activePlatforms ?? []),
      ...(candidate.channels ?? []).map((channel) => channel.platform),
    ]).filter((platform) => creatorPlatforms.includes(platform)),
  };
  const hasCoreMediaSignal = currentSignals.hasPodcast || currentSignals.hasYoutubeShow;
  const priority = hasCoreMediaSignal ? 'medium' : 'high';

  return {
    candidateId: candidate.id,
    name: candidate.name,
    title: candidate.title,
    category: candidate.primaryCategory,
    country: candidate.country,
    priority,
    currentSignals,
    currentChannels: (candidate.channels ?? []).filter((channel) => creatorPlatforms.includes(channel.platform)),
    sourceHints: (candidate.sourceUrls ?? []).slice(0, 8),
    searchQueries: buildSearchQueries(candidate),
    platformTargets: buildPlatformTargets(candidate),
    reviewChecks: buildReviewChecks(candidate),
    outcomeFields: [
      'candidateId',
      'outcomeStatus',
      'verifiedAt',
      'channels',
      'influenceSignals',
      'sourceUrls',
      'reviewerNotes',
    ],
    reviewOutcome: buildEmptyOutcome(candidate),
  };
}

function hasChannel(candidate, platform) {
  return (candidate.channels ?? []).some((channel) => channel.platform === platform);
}

function buildSearchQueries(candidate) {
  const name = quoted(candidate.name);
  const topic = candidate.subcategories?.[0] ? quoted(candidate.subcategories[0]) : '';
  const base = [
    `${name} YouTube channel`,
    `${name} podcast`,
    `${name} interview`,
    `${name} newsletter`,
    `${name} X Twitter`,
    `${name} LinkedIn`,
    topic ? `${name} ${topic} YouTube` : '',
    topic ? `${name} ${topic} podcast` : '',
  ];

  const categoryQueries = {
    medicine: [`${name} medical education YouTube`, `${name} public health podcast`],
    psychology: [`${name} psychology podcast`, `${name} mental health YouTube`],
    therapy: [`${name} therapy podcast`, `${name} relationship YouTube`],
    religion: [`${name} theology podcast`, `${name} interfaith YouTube`],
    technology: [`${name} developer YouTube`, `${name} technology podcast`],
    arts: [`${name} artist interview`, `${name} studio YouTube`],
    journalism: [`${name} journalist podcast`, `${name} media interview`],
  };

  return unique([...base, ...(categoryQueries[candidate.primaryCategory] ?? [])]).slice(0, 10);
}

function buildPlatformTargets(candidate) {
  const common = [
    'Official YouTube channel or channel linked from official site',
    'Podcast show page, network page, RSS feed, or official episode archive',
    'X profile with public audience/activity signal',
    'LinkedIn public profile or creator page',
    'Newsletter page such as Substack, Beehiiv, Buttondown, ConvertKit, or official site newsletter',
    'Instagram or TikTok public creator profile when relevant',
  ];

  if (candidate.primaryCategory === 'youtube') {
    return ['Official YouTube channel about page', ...common];
  }

  if (candidate.primaryCategory === 'podcast') {
    return ['Official podcast page or RSS feed', ...common];
  }

  return common;
}

function buildReviewChecks(candidate) {
  const checks = [
    'Confirm the channel/profile belongs to the same person.',
    'Prefer channels linked from official websites, institutions, podcast pages, or verified profiles.',
    'Record public follower/subscriber counts only when visibly available and date-stamped.',
    'Do not use private, login-only, scraped hidden, or inferred audience data.',
    'Do not treat social/profile discovery as permission to contact.',
  ];

  if (['psychology', 'therapy', 'medicine'].includes(candidate.primaryCategory)) {
    checks.push('For health or mental-health content, avoid claims about diagnosis, treatment, or outcomes.');
  }

  return checks;
}

function buildEmptyOutcome(candidate) {
  return {
    candidateId: candidate.id,
    outcomeStatus: 'pending',
    verifiedAt: '',
    channels: [],
    influenceSignals: {
      hasPodcast: false,
      hasYoutubeShow: false,
      activePlatforms: [],
      notableSignals: [],
    },
    sourceUrls: [],
    reviewerNotes: '',
  };
}

function renderMarkdown(reviewPackage) {
  const lines = [
    `# Creator Signal Review: ${reviewPackage.sourceBatchId ?? reviewPackage.reviewId}`,
    '',
    `Source: ${reviewPackage.sourceLabel ?? 'Unknown'}`,
    `Generated: ${reviewPackage.createdAt}`,
    `Candidates: ${reviewPackage.summary.selectedCandidates}`,
    '',
    'This checklist is for creator/media prioritization only. It does not approve outreach.',
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
    lines.push(`- Current creator platforms: ${item.currentSignals.activePlatforms.join(', ') || 'none'}`);
    lines.push('- Search queries:');
    item.searchQueries.forEach((query) => lines.push(`  - ${query}`));
    lines.push('- Platform targets:');
    item.platformTargets.forEach((target) => lines.push(`  - ${target}`));
    lines.push('- Review checks:');
    item.reviewChecks.forEach((check) => lines.push(`  - [ ] ${check}`));
    lines.push('- Review outcome template:');
    lines.push(`  - ${JSON.stringify(item.reviewOutcome)}`);
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

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
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
