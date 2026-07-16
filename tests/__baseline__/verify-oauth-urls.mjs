import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OAUTH_ENDPOINTS } from "../../open-sse/config/appConstants.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { cloneNormalized, collectDiffs, writeSnapshot } from "./baseline-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "oauth-urls-baseline.json");
const providerOAuthFields = [
  "tokenUrl",
  "authUrl",
  "authorizeUrl",
  "deviceCodeUrl",
  "refreshUrl",
  "clientId",
];
const providerEndpoints = Object.fromEntries(
  Object.entries(PROVIDERS)
    .map(([providerId, provider]) => [
      providerId,
      Object.fromEntries(
        providerOAuthFields
          .filter((field) => provider[field] !== undefined)
          .map((field) => [field, provider[field]]),
      ),
    ])
    .filter(([, endpoints]) => Object.keys(endpoints).length > 0),
);
const current = cloneNormalized({
  oauthEndpoints: OAUTH_ENDPOINTS,
  providerEndpoints,
});

if (process.argv[2] === "--snapshot") {
  writeSnapshot(snapshotPath, current);
  console.log(`Snapshot OAuth configuration for ${Object.keys(providerEndpoints).length} providers → ${snapshotPath}`);
  process.exit(0);
}

if (!existsSync(snapshotPath)) {
  console.error("❌ No OAuth baseline. Run --snapshot during a reviewed maintenance update.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(snapshotPath, "utf8"));
const diffs = collectDiffs(baseline, current);
if (diffs.length) {
  console.error(`❌ OAuth contract changed (${diffs.length} difference(s)):`);
  diffs.forEach((diff) => console.error(`  ${diff}`));
  process.exit(1);
}

console.log(`✅ OAuth contract unchanged (${Object.keys(providerEndpoints).length} providers).`);
