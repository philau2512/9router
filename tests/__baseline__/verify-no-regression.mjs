import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const baselineDir = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(baselineDir, "..", "..");

function failConfiguration(message) {
  console.error(`❌ Baseline configuration error: ${message}`);
  process.exit(2);
}

function normalizeKnownFail(line) {
  return line.trim().replaceAll("\\", "/");
}

function relativeTestPath(filePath) {
  if (typeof filePath !== "string" || !filePath) {
    throw new Error("test result is missing a file path");
  }

  const normalizedInput = filePath.replaceAll("\\", "/");
  if (normalizedInput.startsWith("tests/")) return normalizedInput;

  const inputPath = normalizedInput.match(/^[A-Za-z]:\//)
    ? normalizedInput
    : filePath;
  const relativePath = relative(repositoryRoot, inputPath).replaceAll(sep, "/");

  if (!relativePath || relativePath === ".." || relativePath.startsWith("../")) {
    throw new Error(`test result path is outside repository: ${filePath}`);
  }

  return relativePath;
}

export function collectFailureIds(report) {
  if (!report || !Array.isArray(report.testResults)) {
    throw new Error("expected a Vitest JSON report with testResults[]");
  }

  const failures = [];
  for (const fileResult of report.testResults) {
    const testPath = relativeTestPath(fileResult.name);
    const assertions = fileResult.assertionResults;

    if (!Array.isArray(assertions)) {
      throw new Error(`test result ${testPath} is missing assertionResults[]`);
    }

    for (const assertion of assertions) {
      if (assertion.status === "failed") {
        failures.push(`${testPath} :: ${assertion.fullName || assertion.title}`);
      }
    }

    if (
      fileResult.status === "failed" &&
      !assertions.some((assertion) => assertion.status === "failed")
    ) {
      failures.push(`${testPath} :: [collection/setup failure]`);
    }
  }

  return failures.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const resultsPath = process.argv[2];
  if (!resultsPath) failConfiguration("missing Vitest JSON report path");

  let report;
  try {
    report = JSON.parse(readFileSync(resultsPath, "utf8"));
  } catch (error) {
    failConfiguration(`cannot read JSON report: ${error.message}`);
  }

  let nowFails;
  try {
    nowFails = collectFailureIds(report);
  } catch (error) {
    failConfiguration(error.message);
  }

  const knownFails = new Set(
    readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
      .split("\n")
      .map(normalizeKnownFail)
      .filter((line) => line && !line.startsWith("#")),
  );
  const regressions = nowFails.filter((failure) => !knownFails.has(failure));

  if (regressions.length) {
    console.error(`\n❌ Regression gate rejected ${regressions.length} unapproved failure(s):\n`);
    regressions.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }

  console.log(
    `✅ No unapproved regression. current failures=${nowFails.length}, approved failures=${knownFails.size}`,
  );
}
