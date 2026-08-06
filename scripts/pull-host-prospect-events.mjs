import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSignedHostProspectRequest,
  executeSignedHostProspectRequest,
  summarizeSignedRequest,
  validateHostProspectApiResponse
} from "./lib/host-prospect-api-client.mjs";
import { applyHostProspectEventPage } from "./lib/host-prospect-campaign.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

await loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const statePath = path.resolve(args.state ?? "exports/host-prospect-state.local.json");
const state = await readState(statePath);
const query = new URLSearchParams();
const cursor = args.after ?? state.cursor;
if (cursor) query.set("after", cursor);
if (args.limit) query.set("limit", args.limit);
const pathWithQuery = `/internal/v1/host-prospect-events${query.toString() ? `?${query.toString()}` : ""}`;
const signed = buildSignedHostProspectRequest({
  baseUrl: env("HOST_PROSPECT_API_BASE_URL"),
  keyId: env("HOST_PROSPECT_HMAC_KEY_ID"),
  secret: env("HOST_PROSPECT_HMAC_SECRET"),
  method: "GET",
  pathWithQuery,
  timestamp: args.timestamp ? Number(args.timestamp) : undefined,
  nonce: args.nonce
});

if (!args.live) {
  console.log(JSON.stringify({ dryRun: true, operation: "events", request: summarizeSignedRequest(signed) }, null, 2));
  console.log("No API call was made. Pass --live to pull and apply the signed event page.");
} else {
  const apiResponse = await executeSignedHostProspectRequest(signed);
  if (!apiResponse.ok) {
    console.error(`Host prospect event pull failed with HTTP ${apiResponse.status}`);
    printApiErrors(apiResponse);
    process.exitCode = 1;
  } else {
    const validation = validateHostProspectApiResponse("events", apiResponse.json);
    if (!validation.ok) {
      console.error("Host prospect event page failed contract validation");
      validation.errors.forEach((error) => console.error(`- ${error}`));
      process.exitCode = 1;
    } else {
      const apply = applyHostProspectEventPage(state, apiResponse.json);
      if (!apply.ok) {
        console.error("Host prospect event page could not be applied");
        apply.errors.forEach((error) => console.error(`- ${error}`));
        process.exitCode = 1;
      } else {
        await mkdir(path.dirname(statePath), { recursive: true });
        await writeFile(statePath, `${JSON.stringify(apply.state, null, 2)}\n`);
        console.log(`Private Host prospect state written to ${statePath}`);
        console.log(`Events read: ${apply.summary.eventsRead}`);
        console.log(`Applied: ${apply.summary.applied}`);
        console.log(`Duplicate skipped: ${apply.summary.skippedDuplicate}`);
        console.log(`Unknown prospect events: ${apply.summary.unknownProspectEvents}`);
      }
    }
  }
}

async function readState(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], processedEventIds: [], cursor: null };
    throw error;
  }
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function printApiErrors(apiResponse) {
  if (apiResponse.json && typeof apiResponse.json === "object") {
    const code = apiResponse.json.code ? ` ${apiResponse.json.code}` : "";
    const message = apiResponse.json.message ? `: ${apiResponse.json.message}` : "";
    console.error(`- API error${code}${message}`);
  } else if (apiResponse.errors) {
    apiResponse.errors.forEach((error) => console.error(`- ${error}`));
  }
}

function parseArgs(values) {
  const parsed = { live: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--state") parsed.state = values[++index];
    else if (value === "--after") parsed.after = values[++index];
    else if (value === "--limit") parsed.limit = values[++index];
    else if (value === "--timestamp") parsed.timestamp = values[++index];
    else if (value === "--nonce") parsed.nonce = values[++index];
    else if (value === "--live") parsed.live = true;
  }
  return parsed;
}
