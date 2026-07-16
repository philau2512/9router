import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { providerContract } from "./verify-providers.mjs";
import { writeSnapshot } from "./baseline-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "providers-baseline.json");

const contract = providerContract(PROVIDERS);
writeSnapshot(snapshotPath, contract);
console.log(`Snapshot ${Object.keys(contract).length} providers → ${snapshotPath}`);
