import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildHostProspectCreateRequest } from "./lib/host-prospect-campaign.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(args.input ?? "examples/host-prospect-campaign-member.synthetic.json");
const outputPath = path.resolve(args.output ?? "exports/host-prospect-create-request.local.json");
const now = args.now ? new Date(args.now) : new Date();

const input = JSON.parse(await readFile(inputPath, "utf8"));
const result = buildHostProspectCreateRequest(input, { now });

if (!result.ok) {
  console.error(`Host prospect request preparation failed for ${inputPath}`);
  result.errors.forEach((error) => console.error(`- ${error}`));
  if (result.warnings.length > 0) {
    console.error("Warnings:");
    result.warnings.forEach((warning) => console.error(`- ${warning}`));
  }
  process.exitCode = 1;
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result.request, null, 2)}\n`);
  console.log(`Host prospect create request written to ${outputPath}`);
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
  console.log("No API call was made and no outreach was sent.");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--input") parsed.input = values[++index];
    else if (value === "--output") parsed.output = values[++index];
    else if (value === "--now") parsed.now = values[++index];
  }
  return parsed;
}
