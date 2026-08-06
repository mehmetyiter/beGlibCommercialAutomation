import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyHostProspectEventPage } from "./lib/host-prospect-campaign.mjs";

const args = parseArgs(process.argv.slice(2));
const statePath = path.resolve(args.state ?? "exports/host-prospect-state.local.json");
const eventsPath = path.resolve(args.events ?? "contracts/host-prospect/v1/fixtures/events-page.response.json");
const outputPath = path.resolve(args.output ?? statePath);

const state = await readState(statePath);
const page = JSON.parse(await readFile(eventsPath, "utf8"));
const result = applyHostProspectEventPage(state, page, {
  now: args.now ? new Date(args.now) : new Date()
});

if (!result.ok) {
  console.error(`Host prospect event application failed for ${eventsPath}`);
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result.state, null, 2)}\n`);
  console.log(`Private Host prospect state written to ${outputPath}`);
  console.log(`Events read: ${result.summary.eventsRead}`);
  console.log(`Applied: ${result.summary.applied}`);
  console.log(`Duplicate skipped: ${result.summary.skippedDuplicate}`);
  console.log(`Unknown prospect events: ${result.summary.unknownProspectEvents}`);
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
}

async function readState(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { records: [], processedEventIds: [], cursor: null };
    }
    throw error;
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--state") parsed.state = values[++index];
    else if (value === "--events") parsed.events = values[++index];
    else if (value === "--output") parsed.output = values[++index];
    else if (value === "--now") parsed.now = values[++index];
  }
  return parsed;
}
