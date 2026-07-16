import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(__dirname, ".."),
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**",
      "tests/**/*.real.test.js",
      "tests/unit/db-benchmark.test.js",
      "tests/unit/embeddings.cloud.test.js",
    ],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      {
        find: /^open-sse\//,
        replacement: resolve(__dirname, "../open-sse") + "/",
      },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
