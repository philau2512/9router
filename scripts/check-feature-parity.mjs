#!/usr/bin/env node
/**
 * Feature-chain parity checker (port/regression guard).
 *
 * Compares required markers from scripts/feature-parity-matrix.json against
 * the worktree (and optionally against an upstream git ref for missing-file
 * context). This catches "history has the commit but content was dropped"
 * failures after large port/refactor commits.
 *
 * Usage:
 *   node scripts/check-feature-parity.mjs
 *   node scripts/check-feature-parity.mjs --ref upstream/master
 *   node scripts/check-feature-parity.mjs --feature kiro-quota-api-key
 *   node scripts/check-feature-parity.mjs --json
 *
 * Exit: 0 all OK, 1 any MISSING, 2 matrix/IO error
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MATRIX_PATH = join(ROOT, "scripts", "feature-parity-matrix.json");

function parseArgs(argv) {
  const out = { ref: null, feature: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref") out.ref = argv[++i];
    else if (a === "--feature") out.feature = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function readWorktree(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

function readGitRef(ref, relPath) {
  if (!ref) return null;
  // git show uses forward slashes in pathspec; normalize for Windows
  const pathSpec = `${ref}:${relPath.replace(/\\/g, "/")}`;
  const r = spawnSync("git", ["show", pathSpec], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout;
}

function checkMarkers(content, mustContain) {
  const missing = [];
  for (const needle of mustContain) {
    if (!content.includes(needle)) missing.push(needle);
  }
  return missing;
}

function loadMatrix() {
  const raw = readFileSync(MATRIX_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.features)) {
    throw new Error("matrix.features must be an array");
  }
  return data;
}

function evaluateFeature(feature, ref) {
  const fileResults = [];
  let status = "OK";

  for (const marker of feature.markers || []) {
    const wt = readWorktree(marker.file);
    const entry = {
      file: marker.file,
      worktree: wt === null ? "MISSING_FILE" : "ok",
      missingMarkers: [],
      upstreamHasFile: null,
    };

    if (wt === null) {
      status = "MISSING";
      if (ref) {
        entry.upstreamHasFile = readGitRef(ref, marker.file) !== null;
      }
    } else {
      entry.missingMarkers = checkMarkers(wt, marker.mustContain || []);
      if (entry.missingMarkers.length > 0) status = "MISSING";
    }

    fileResults.push(entry);
  }

  return {
    id: feature.id,
    title: feature.title,
    layers: feature.layers || [],
    status,
    files: fileResults,
  };
}

function printHuman(results, ref) {
  const missing = results.filter((r) => r.status === "MISSING");
  const ok = results.filter((r) => r.status === "OK");

  console.log("Feature parity check");
  console.log(`  matrix: scripts/feature-parity-matrix.json`);
  console.log(`  worktree: ${ROOT}`);
  if (ref) console.log(`  upstream ref (context only): ${ref}`);
  console.log(`  features: ${results.length}  OK: ${ok.length}  MISSING: ${missing.length}`);
  console.log("");

  for (const r of results) {
    const icon = r.status === "OK" ? "OK" : "MISSING";
    console.log(`[${icon}] ${r.id}`);
    console.log(`       ${r.title}`);
    if (r.status === "MISSING") {
      for (const f of r.files) {
        if (f.worktree === "MISSING_FILE") {
          const up =
            f.upstreamHasFile === true
              ? " (present on upstream ref)"
              : f.upstreamHasFile === false
                ? " (also absent on upstream ref)"
                : "";
          console.log(`       - FILE MISSING: ${f.file}${up}`);
        } else if (f.missingMarkers.length) {
          console.log(`       - ${f.file}`);
          for (const m of f.missingMarkers) {
            console.log(`           missing: ${JSON.stringify(m)}`);
          }
        }
      }
    }
    console.log("");
  }

  if (missing.length) {
    console.log("FAIL — fix missing markers, then re-run.");
    console.log("Hint: after port/refactor, map user bugs into matrix chains, not single files.");
  } else {
    console.log("PASS — all seeded feature chains present in worktree.");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/check-feature-parity.mjs [--ref <git-ref>] [--feature <id>] [--json]`);
    process.exit(0);
  }

  let matrix;
  try {
    matrix = loadMatrix();
  } catch (e) {
    console.error(`Failed to load matrix: ${e.message}`);
    process.exit(2);
  }

  let features = matrix.features;
  if (args.feature) {
    features = features.filter((f) => f.id === args.feature);
    if (!features.length) {
      console.error(`Unknown feature id: ${args.feature}`);
      process.exit(2);
    }
  }

  const results = features.map((f) => evaluateFeature(f, args.ref));
  const failed = results.some((r) => r.status === "MISSING");

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: !failed,
          ref: args.ref,
          results,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(results, args.ref);
  }

  process.exit(failed ? 1 : 0);
}

main();