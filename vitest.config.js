import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "open-sse": resolve(__dirname, "open-sse"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**",
      "**/tests/unit/db-benchmark.test.js",
      "**/tests/unit/embeddings.cloud.test.js",
      "**/*.real.test.js",
    ],
  },
});
