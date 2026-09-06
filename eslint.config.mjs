import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  {
    ignores: [
      "**/.next/**",
      "**/.next-cli-build/**",
      "**/out/**",
      "**/build/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.agents/**",
      "**/.claude/**",
      "**/cli/app/**",
      "next-env.d.ts",
    ],
  },

  {
    files: ["open-sse/**/*.js", "src/**/*.js", "cli/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        globalThis: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        Headers: "readonly",
        Response: "readonly",
        Request: "readonly",
        DOMException: "readonly",
        AbortController: "readonly",
        URL: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },

  ...nextVitals,

  // Anonymous default exports are the standard pattern in these directories:
  // registry configs, handler adapters, DB migrations, postcss configs.
  {
    files: [
      "open-sse/providers/registry/*.js",
      "open-sse/providers/REGISTRY_TEMPLATE.js",
      "open-sse/handlers/ttsProviders/*.js",
      "open-sse/handlers/embeddingProviders/*.js",
      "src/lib/db/migrations/*.js",
      "postcss.config.mjs",
      "gitbook/postcss.config.mjs",
    ],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
]);
