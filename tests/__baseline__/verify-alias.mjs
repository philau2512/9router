import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  PROVIDER_ALIASES,
  resolveProviderAlias,
} from "../../open-sse/services/model.js";
import {
  PROVIDER_ID_TO_ALIAS,
  PROVIDER_MODELS,
} from "../../open-sse/config/providerModels.js";
import { cloneNormalized, collectDiffs, writeSnapshot } from "./baseline-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "alias-baseline.json");
const aliasTokens = Array.from(
  new Set([...Object.keys(PROVIDER_ALIASES), ...Object.keys(PROVIDER_ID_TO_ALIAS)]),
).sort();
const current = cloneNormalized({
  aliasToId: Object.fromEntries(
    aliasTokens.map((alias) => [alias, resolveProviderAlias(alias)]),
  ),
  idToAlias: PROVIDER_ID_TO_ALIAS,
  modelKeys: Object.keys(PROVIDER_MODELS).sort(),
});

if (process.argv[2] === "--snapshot") {
  writeSnapshot(snapshotPath, current);
  console.log(`Snapshot alias resolution for ${aliasTokens.length} aliases → ${snapshotPath}`);
  process.exit(0);
}

if (!existsSync(snapshotPath)) {
  console.error("❌ No alias baseline. Run --snapshot during a reviewed maintenance update.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(snapshotPath, "utf8"));
const diffs = collectDiffs(baseline, current);
if (diffs.length) {
  console.error(`❌ Alias contract changed (${diffs.length} difference(s)):`);
  diffs.forEach((diff) => console.error(`  ${diff}`));
  process.exit(1);
}

console.log(`✅ Alias contract unchanged (${aliasTokens.length} aliases).`);
