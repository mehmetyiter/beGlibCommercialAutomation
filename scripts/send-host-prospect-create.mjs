import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSignedHostProspectRequest,
  executeSignedHostProspectRequest,
  summarizeSignedRequest,
  validateHostProspectApiResponse
} from "./lib/host-prospect-api-client.mjs";
import {
  createPrivateHostProspectRecord,
  upsertPrivateHostProspectRecord
} from "./lib/host-prospect-campaign.mjs";
import { validateHostProspectCreateRequest } from "./lib/host-prospect-contract.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

await loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const requestPath = path.resolve(args.request ?? "exports/host-prospect-create-request.local.json");
const statePath = path.resolve(args.state ?? "exports/host-prospect-state.local.json");
const responseOutputPath = args.responseOutput ? path.resolve(args.responseOutput) : null;
const request = JSON.parse(await readFile(requestPath, "utf8"));
const requestValidation = validateHostProspectCreateRequest(request, { now: new Date(request.requestedAt) });

if (!requestValidation.ok) {
  console.error(`Host prospect create request is invalid for ${requestPath}`);
  requestValidation.errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  const rawBody = JSON.stringify(request);
  const signed = buildSignedHostProspectRequest({
    baseUrl: env("HOST_PROSPECT_API_BASE_URL"),
    keyId: env("HOST_PROSPECT_HMAC_KEY_ID"),
    secret: env("HOST_PROSPECT_HMAC_SECRET"),
    method: "POST",
    pathWithQuery: "/internal/v1/host-prospects",
    body: rawBody,
    idempotencyKey: args.idempotencyKey,
    timestamp: args.timestamp ? Number(args.timestamp) : undefined,
    nonce: args.nonce
  });

  if (!args.live) {
    console.log(JSON.stringify({ dryRun: true, operation: "create", request: summarizeSignedRequest(signed) }, null, 2));
    console.log("No API call was made and no outreach was sent. Pass --live to send this signed internal request.");
  } else {
    const apiResponse = await executeSignedHostProspectRequest(signed);
    if (!apiResponse.ok) {
      console.error(`Host prospect create failed with HTTP ${apiResponse.status}`);
      printApiErrors(apiResponse);
      process.exitCode = 1;
    } else {
      const allowedCtaOrigins = valuesFromCsv(args.allowedOrigin ?? process.env.HOST_PROSPECT_ALLOWED_CTA_ORIGINS);
      const validation = validateHostProspectApiResponse("create", apiResponse.json, { allowedCtaOrigins });
      if (!validation.ok) {
        console.error("Host prospect create response failed contract validation");
        validation.errors.forEach((error) => console.error(`- ${error}`));
        process.exitCode = 1;
      } else {
        const recordResult = createPrivateHostProspectRecord({
          request,
          response: apiResponse.json,
          allowedCtaOrigins
        });
        if (!recordResult.ok) {
          console.error("Host prospect create response could not be reduced to private state");
          recordResult.errors.forEach((error) => console.error(`- ${error}`));
          process.exitCode = 1;
        } else {
          const state = await readState(statePath);
          const nextState = upsertPrivateHostProspectRecord(state, recordResult.record);
          await mkdir(path.dirname(statePath), { recursive: true });
          await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
          if (responseOutputPath) {
            await mkdir(path.dirname(responseOutputPath), { recursive: true });
            await writeFile(responseOutputPath, `${JSON.stringify(apiResponse.json, null, 2)}\n`);
          }
          console.log(`Private Host prospect state written to ${statePath}`);
          console.log("Create response validated and reduced without logging candidate email or response body.");
        }
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

function valuesFromCsv(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
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
    if (value === "--request") parsed.request = values[++index];
    else if (value === "--state") parsed.state = values[++index];
    else if (value === "--response-output") parsed.responseOutput = values[++index];
    else if (value === "--allowed-origin") parsed.allowedOrigin = values[++index];
    else if (value === "--idempotency-key") parsed.idempotencyKey = values[++index];
    else if (value === "--timestamp") parsed.timestamp = values[++index];
    else if (value === "--nonce") parsed.nonce = values[++index];
    else if (value === "--live") parsed.live = true;
  }
  return parsed;
}
