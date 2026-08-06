import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { redactExpiredHostProspectCtas } from "./lib/host-prospect-campaign.mjs";

const args = parseArgs(process.argv.slice(2));
const statePath = path.resolve(args.state ?? "exports/host-prospect-state.local.json");
const outputPath = path.resolve(args.output ?? statePath);
const state = JSON.parse(await readFile(statePath, "utf8"));
const result = redactExpiredHostProspectCtas(state, {
  now: args.now ? new Date(args.now) : new Date(),
  terminalRetentionDays: numberArg(args.terminalRetentionDays, 30),
  expiredRetentionDays: numberArg(args.expiredRetentionDays, 30)
});

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result.state, null, 2)}\n`);
console.log(`Private Host prospect state written to ${outputPath}`);
console.log(`Records: ${result.summary.records}`);
console.log(`CTA redacted: ${result.summary.redacted}`);

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--state") parsed.state = values[++index];
    else if (value === "--output") parsed.output = values[++index];
    else if (value === "--now") parsed.now = values[++index];
    else if (value === "--terminal-retention-days") parsed.terminalRetentionDays = values[++index];
    else if (value === "--expired-retention-days") parsed.expiredRetentionDays = values[++index];
  }
  return parsed;
}
