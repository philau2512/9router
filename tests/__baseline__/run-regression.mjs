import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve, sep } from "node:path";

if (process.env.RUN_REAL === "1") {
  console.error("❌ Baseline runs do not allow RUN_REAL=1.");
  process.exit(2);
}

const baselineDir = dirname(fileURLToPath(import.meta.url));
const testsDir = resolve(baselineDir, "..");
const repositoryRoot = resolve(testsDir, "..");
const reportPath = resolve(baselineDir, "current.json");
const vitestEntrypoint = resolve(
  testsDir,
  "node_modules",
  "vitest",
  "vitest.mjs",
);

if (!existsSync(vitestEntrypoint)) {
  console.error(`❌ Local Vitest entrypoint not found: ${vitestEntrypoint}`);
  process.exit(2);
}

const vitestResult = spawnSync(
  process.execPath,
  [
    vitestEntrypoint,
    "run",
    "--config",
    resolve(testsDir, "vitest.config.js"),
    "--reporter=json",
    "--outputFile",
    reportPath,
  ],
  { cwd: repositoryRoot, stdio: "inherit", env: process.env },
);

if (!existsSync(reportPath)) {
  console.error("❌ Vitest did not create the requested JSON report.");
  process.exit(vitestResult.status || 2);
}

const rawReport = JSON.parse(readFileSync(reportPath, "utf8"));
const normalizePath = (filePath) => {
  const normalized = String(filePath || "").replaceAll("\\", "/");
  if (normalized.startsWith("tests/")) return normalized;

  const relativePath = relative(repositoryRoot, filePath).replaceAll(sep, "/");
  if (!relativePath || relativePath === ".." || relativePath.startsWith("../")) {
    throw new Error(`Vitest reported a path outside the repository: ${filePath}`);
  }
  return relativePath;
};
const normalizedReport = {
  testResults: (rawReport.testResults || [])
    .map((fileResult) => ({
      name: normalizePath(fileResult.name),
      status: fileResult.status,
      message: fileResult.message || "",
      assertionResults: (fileResult.assertionResults || [])
        .map((assertion) => ({
          fullName: assertion.fullName || assertion.title || "[unnamed test]",
          status: assertion.status,
        }))
        .sort((left, right) => left.fullName.localeCompare(right.fullName)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name)),
};
writeFileSync(reportPath, `${JSON.stringify(normalizedReport, null, 2)}\n`);

const verifyResult = spawnSync(
  process.execPath,
  [resolve(baselineDir, "verify-no-regression.mjs"), reportPath],
  { cwd: testsDir, stdio: "inherit", env: process.env },
);

process.exit(verifyResult.status ?? vitestResult.status ?? 1);
