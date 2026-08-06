import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPrivateHostProspectRecord,
  upsertPrivateHostProspectRecord
} from "./lib/host-prospect-campaign.mjs";

const args = parseArgs(process.argv.slice(2));
const requestPath = path.resolve(args.request ?? "exports/host-prospect-create-request.local.json");
const responsePath = path.resolve(args.response ?? "contracts/host-prospect/v1/fixtures/create-prospect.response.json");
const statePath = path.resolve(args.state ?? "exports/host-prospect-state.local.json");
const allowedCtaOrigins = valuesFromCsv(args.allowedOrigin ?? process.env.HOST_PROSPECT_ALLOWED_CTA_ORIGINS);

const request = JSON.parse(await readFile(requestPath, "utf8"));
const response = JSON.parse(await readFile(responsePath, "utf8"));
const state = await readState(statePath);
const result = createPrivateHostProspectRecord({
  request,
  response,
  allowedCtaOrigins,
  recordedAt: args.now ? new Date(args.now) : new Date()
});

if (!result.ok) {
  console.error(`Host prospect response recording failed for ${responsePath}`);
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  const nextState = upsertPrivateHostProspectRecord(state, result.record, {
    now: args.now ? new Date(args.now) : new Date()
  });
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
  console.log(`Private Host prospect state written to ${statePath}`);
  console.log("Stored prospect IDs and CTA metadata only; request contact email was not copied into state.");
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

function valuesFromCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--request") parsed.request = values[++index];
    else if (value === "--response") parsed.response = values[++index];
    else if (value === "--state") parsed.state = values[++index];
    else if (value === "--allowed-origin") parsed.allowedOrigin = values[++index];
    else if (value === "--now") parsed.now = values[++index];
  }
  return parsed;
}
