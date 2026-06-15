import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const inputPath = resolve(process.argv[2] ?? 'examples/research-batch.synthetic.json');
const outputPath = resolve(getArg('--output') ?? defaultOutputPath(inputPath));
const batch = JSON.parse(await readFile(inputPath, 'utf8'));
const tasks = buildTasks(batch.candidates ?? []);
const markdown = renderMarkdown(batch, tasks);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, markdown, 'utf8');

console.log(`Verification checklist written to ${outputPath}`);
console.log(`Tasks: ${tasks.length}`);

function buildTasks(candidates) {
  return candidates.flatMap((candidate) => {
    const candidateTasks = [];
    const hasUsableRoute = (candidate.contactRoutes ?? []).some((route) =>
      ['public-business-email', 'representative-email', 'contact-form'].includes(route.type),
    );
    const blocked = candidate.status === 'do-not-contact' || candidate.consentStatus === 'opted-out';

    if (blocked) {
      candidateTasks.push({
        candidate,
        priority: 'urgent',
        task: 'Confirm suppression status and retain only minimum do-not-contact record.',
      });
      return candidateTasks;
    }

    if ((candidate.channels ?? []).some((channel) => !channel.verified)) {
      candidateTasks.push({
        candidate,
        priority: 'high',
        task: 'Verify identity match across unverified social/media channels.',
      });
    }

    if (!hasUsableRoute) {
      candidateTasks.push({
        candidate,
        priority: 'high',
        task: 'Find official professional contact route, representative page, or contact form.',
      });
    }

    if (candidate.consentStatus === 'unknown') {
      candidateTasks.push({
        candidate,
        priority: 'medium',
        task: 'Confirm jurisdiction, consent basis, and opt-out language before outreach.',
      });
    }

    if (candidate.riskLevel === 'high' || candidate.primaryCategory === 'religion') {
      candidateTasks.push({
        candidate,
        priority: 'high',
        task: 'Complete sensitive-category review before approving any draft.',
      });
    }

    return candidateTasks;
  });
}

function renderMarkdown(batch, tasks) {
  const lines = [
    `# Verification Checklist: ${batch.batchId ?? 'research-batch'}`,
    '',
    `Source: ${batch.sourceLabel ?? 'Unknown'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    'Real contact details, private notes, and message history should stay out of this exported checklist unless the file remains local.',
    '',
  ];

  tasks.forEach(({ candidate, priority, task }) => {
    lines.push(`- [ ] **${priority.toUpperCase()}** ${candidate.name}: ${task}`);
    (candidate.sourceUrls ?? []).slice(0, 3).forEach((sourceUrl) => {
      lines.push(`  - Source: ${sourceUrl}`);
    });
  });

  if (tasks.length === 0) {
    lines.push('No verification tasks generated.');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function defaultOutputPath(input) {
  const slug = input
    .split('/')
    .pop()
    ?.replace(/\.json$/i, '')
    .replace(/\.local$/i, '');

  return `exports/${slug ?? 'research-batch'}-verification.local.md`;
}
