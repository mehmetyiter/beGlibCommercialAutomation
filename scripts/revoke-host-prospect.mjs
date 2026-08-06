import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSignedHostProspectRequest,
  executeSignedHostProspectRequest,
  summarizeSignedRequest,
  validateHostProspectApiResponse
} from "./lib/host-prospect-api-client.mjs";
import { validateHostProspectRevokeRequest } from "./lib/host-prospect-contract.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";

await loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const prospectId = args.prospectId;
const request = {
  contractVersion: "1.0",
  reasonCode: args.reasonCode ?? "operator_revoked"
};
const validation = validateHostProspectRevokeRequest(request);

if (!prospectId) {
  console.error("--prospect-id is required");
  process.exitCode = 1;
} else if (!validation.ok) {
  console.error("Host prospect revoke request is invalid");
  validation.errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  const rawBody = JSON.stringify(request);
  const signed = buildSignedHostProspectRequest({
    baseUrl: env("HOST_PROSPECT_API_BASE_URL"),
    keyId: env("HOST_PROSPECT_HMAC_KEY_ID"),
    secret: env("HOST_PROSPECT_HMAC_SECRET"),
    method: "POST",
    pathWithQuery: `/internal/v1/host-prospects/${encodeURIComponent(prospectId)}/revoke`,
    body: rawBody,
    idempotencyKey: args.idempotencyKey,
    timestamp: args.timestamp ? Number(args.timestamp) : undefined,
    nonce: args.nonce
  });

  if (!args.live) {
    console.log(JSON.stringify({ dryRun: true, operation: "revoke", request: summarizeSignedRequest(signed) }, null, 2));
    console.log("No API call was made. Pass --live to send this signed revoke request.");
  } else {
    const apiResponse = await executeSignedHostProspectRequest(signed);
    if (!apiResponse.ok) {
      console.error(`Host prospect revoke failed with HTTP ${apiResponse.status}`);
      printApiErrors(apiResponse);
      process.exitCode = 1;
    } else {
      const responseValidation = validateHostProspectApiResponse("revoke", apiResponse.json);
      if (!responseValidation.ok) {
        console.error("Host prospect revoke response failed contract validation");
        responseValidation.errors.forEach((error) => console.error(`- ${error}`));
        process.exitCode = 1;
      } else {
        if (args.responseOutput) {
          await writeFile(path.resolve(args.responseOutput), `${JSON.stringify(apiResponse.json, null, 2)}\n`);
        }
        console.log("Revoke response validated. Pull events to advance local campaign state authoritatively.");
      }
    }
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
    if (value === "--prospect-id") parsed.prospectId = values[++index];
    else if (value === "--reason-code") parsed.reasonCode = values[++index];
    else if (value === "--response-output") parsed.responseOutput = values[++index];
    else if (value === "--idempotency-key") parsed.idempotencyKey = values[++index];
    else if (value === "--timestamp") parsed.timestamp = values[++index];
    else if (value === "--nonce") parsed.nonce = values[++index];
    else if (value === "--live") parsed.live = true;
  }
  return parsed;
}
