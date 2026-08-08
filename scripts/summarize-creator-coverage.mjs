import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Creator-signal coverage by country and category, read from a built dossier export.
 *
 * Discovery keeps everything it finds, but a suggestion that fails identity attribution lands
 * in `quarantinedChannels` and is deliberately excluded from the candidate's channel list and
 * star score. That is correct — it is not the candidate's channel until a human says so — but
 * in aggregate it made the work invisible: a thousand podcast discoveries looked like nothing
 * had been found. This report counts both sides so a scan's yield can be seen per market and
 * per category, and so gaps ("this country was never scanned") are distinguishable from
 * misses ("it was scanned and nothing matched").
 */
const CREATOR_PLATFORMS = ['podcast', 'youtube', 'newsletter'];

const args = parseArgs(process.argv.slice(2));
const dossierPath = resolve(args.dossier ?? args._[0] ?? 'exports/all-waves-discovery-dossiers.local.json');
const outputPath = resolve(args.output ?? 'exports/creator-coverage-summary.local.json');
const markdownPath = resolve(args['markdown-output'] ?? 'exports/creator-coverage-summary.local.md');
const countryFilter = listArg(args.countries ?? args.country).map((value) => value.toLowerCase());
const topCountries = boundedNumber(args['top-countries'], 25, 1, 500);
const topCategories = boundedNumber(args['top-categories'], 40, 1, 500);

const dossierPackage = JSON.parse(await readFile(dossierPath, 'utf8'));
const dossiers = (dossierPackage.dossiers ?? []).filter(
  (dossier) => countryFilter.length === 0 || countryFilter.includes(String(dossier.country ?? '').toLowerCase()),
);

const byCountry = new Map();
const byCategory = new Map();
const totals = emptyBucket();

for (const dossier of dossiers) {
  const country = String(dossier.country ?? '').trim() || 'Unknown';
  const category = String(dossier.category ?? '').trim() || 'unknown';
  const counted = countDossier(dossier);

  addBucket(totals, counted);
  addBucket(ensure(byCountry, country), counted);
  addBucket(ensure(byCategory, category), counted);
}

const summary = {
  reviewId: 'creator-coverage-summary',
  createdAt: new Date().toISOString(),
  sourceFile: dossierPath,
  countryFilter,
  candidates: dossiers.length,
  totals,
  byCountry: rank(byCountry, topCountries),
  byCategory: rank(byCategory, topCategories),
  note:
    'Quarantined creator signals are discovered records that failed automatic identity attribution. They are retained in full and wait for a human decision in the dashboard; they are not counted as candidate channels and do not affect discovery stars.',
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(summary), 'utf8');

console.log(`Creator coverage JSON written to ${outputPath}`);
console.log(`Creator coverage markdown written to ${markdownPath}`);
console.log(`Candidates: ${summary.candidates}`);

for (const platform of CREATOR_PLATFORMS) {
  console.log(
    `${platform}: ${totals[platform].accepted} accepted, ${totals[platform].quarantined} awaiting review, ${totals[platform].candidates} candidates with a signal`,
  );
}

function emptyBucket() {
  const bucket = { candidates: 0 };

  for (const platform of CREATOR_PLATFORMS) {
    bucket[platform] = { accepted: 0, quarantined: 0, candidates: 0 };
  }

  return bucket;
}

function countDossier(dossier) {
  const bucket = emptyBucket();
  bucket.candidates = 1;

  for (const platform of CREATOR_PLATFORMS) {
    const accepted = (dossier.discoveryChannels ?? []).filter((channel) => channel.platform === platform).length;
    const quarantined = (dossier.quarantinedChannels ?? []).filter((channel) => channel.platform === platform).length;

    bucket[platform] = {
      accepted,
      quarantined,
      candidates: accepted + quarantined > 0 ? 1 : 0,
    };
  }

  return bucket;
}

function ensure(map, key) {
  if (!map.has(key)) {
    map.set(key, emptyBucket());
  }

  return map.get(key);
}

function addBucket(target, source) {
  target.candidates += source.candidates;

  for (const platform of CREATOR_PLATFORMS) {
    target[platform].accepted += source[platform].accepted;
    target[platform].quarantined += source[platform].quarantined;
    target[platform].candidates += source[platform].candidates;
  }
}

function signalTotal(bucket) {
  return CREATOR_PLATFORMS.reduce(
    (count, platform) => count + bucket[platform].accepted + bucket[platform].quarantined,
    0,
  );
}

function rank(map, limit) {
  return Array.from(map.entries())
    .map(([key, bucket]) => ({ key, ...bucket, signals: signalTotal(bucket) }))
    .sort((left, right) => right.signals - left.signals || left.key.localeCompare(right.key))
    .slice(0, limit);
}

function renderMarkdown(report) {
  const lines = [
    '# Creator signal coverage',
    '',
    `Generated: ${report.createdAt}`,
    `Source: ${report.sourceFile}`,
    `Candidates: ${report.candidates}`,
    '',
    report.note,
    '',
    '## Totals',
    '',
    '| Platform | Accepted | Awaiting review | Candidates with a signal |',
    '| --- | --- | --- | --- |',
    ...CREATOR_PLATFORMS.map(
      (platform) =>
        `| ${platform} | ${report.totals[platform].accepted} | ${report.totals[platform].quarantined} | ${report.totals[platform].candidates} |`,
    ),
    '',
    '## By country',
    '',
    tableHeader(),
    ...report.byCountry.map(rowFor),
    '',
    '## By category',
    '',
    tableHeader(),
    ...report.byCategory.map(rowFor),
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function tableHeader() {
  return [
    '| Key | Candidates | Podcast (ok/review) | YouTube (ok/review) | Newsletter (ok/review) |',
    '| --- | --- | --- | --- | --- |',
  ].join('\n');
}

function rowFor(entry) {
  return `| ${entry.key} | ${entry.candidates} | ${entry.podcast.accepted}/${entry.podcast.quarantined} | ${entry.youtube.accepted}/${entry.youtube.quarantined} | ${entry.newsletter.accepted}/${entry.newsletter.quarantined} |`;
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

function listArg(value) {
  if (value === undefined || value === true) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value ?? fallback);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}
