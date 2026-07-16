import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { cloneNormalized, collectDiffs, writeSnapshot } from "./baseline-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "providers-baseline.json");

export function providerContract(providers) {
  const contract = JSON.parse(JSON.stringify(providers));
  for (const provider of Object.values(contract)) {
    delete provider.clientSecret;
  }
  return cloneNormalized(contract);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = providerContract(PROVIDERS);

  if (process.argv[2] === "--snapshot") {
    writeSnapshot(snapshotPath, current);
    console.log(`Snapshot ${Object.keys(current).length} providers → ${snapshotPath}`);
    process.exit(0);
  }

  if (!existsSync(snapshotPath)) {
    console.error("❌ No provider baseline. Run --snapshot during a reviewed maintenance update.");
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const diffs = collectDiffs(baseline, current);
  if (diffs.length) {
    console.error(`❌ Provider contract changed (${diffs.length} difference(s)):`);
    diffs.forEach((diff) => console.error(`  ${diff}`));
    process.exit(1);
  }

  console.log(`✅ Provider contract unchanged (${Object.keys(current).length} providers).`);
}
