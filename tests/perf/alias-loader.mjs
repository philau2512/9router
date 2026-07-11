// Minimal ESM resolve hook so the perf harness can `node`-run modules that use
// the `@/` -> `src/` path alias (mirrors vitest.config.js `resolve.alias`).
// Only `@/` is mapped; everything else falls through to the default resolver.
//
// Usage: node --import ./tests/perf/alias-loader.mjs tests/perf/translate-bench.mjs

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = pathResolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const srcRoot = pathResolve(repoRoot, "src");

const hookSource = `
  const srcRoot = ${JSON.stringify(srcRoot)};
  const { pathToFileURL } = await import("node:url");
  const { join } = await import("node:path");
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "@" || specifier.startsWith("@/")) {
      const rest = specifier === "@" ? "" : specifier.slice(2);
      const target = pathToFileURL(join(srcRoot, rest)).href;
      return { url: target, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`;

register(
  `data:text/javascript,${encodeURIComponent(hookSource)}`,
  pathToFileURL("./"),
);
