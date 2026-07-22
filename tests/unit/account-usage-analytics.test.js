import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function source(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

async function withUsageDb(run) {
  const originalDataDir = process.env.DATA_DIR;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-account-usage-"));
  process.env.DATA_DIR = tempDir;
  try {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    await run(db);
  } finally {
    try {
      const { getAdapter } = await import("@/lib/db/driver.js");
      const adapter = await getAdapter();
      adapter?.close?.();
    } catch {}
    if (global._dbAdapter) {
      global._dbAdapter.instance = null;
      global._dbAdapter.initPromise = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  }
}

describe("account usage analytics", () => {
  it("opens the same account-filtered overview from both account entry points", async () => {
    const [providerRow, quotaCard] = await Promise.all([
      source(
        "src/app/(dashboard)/dashboard/providers/[id]/components/ConnectionRow.js",
      ),
      source(
        "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/components/local/provider-connection-card.js",
      ),
    ]);

    expect(providerRow).toContain("View Usage & Analytics");
    expect(providerRow).toContain(
      "/dashboard/usage?tab=overview&connectionId=${encodeURIComponent(connection.id)}",
    );
    expect(quotaCard).toContain("View Usage & Analytics");
    expect(quotaCard).toContain(
      "/dashboard/usage?tab=overview&connectionId=${encodeURIComponent(conn.id)}",
    );
  });

  it("forwards the URL filter through overview REST, chart, and realtime paths", async () => {
    const [statsUi, chartUi, statsRoute, chartRoute, streamRoute] =
      await Promise.all([
        source("src/shared/components/UsageStats.js"),
        source(
          "src/app/(dashboard)/dashboard/usage/components/UsageChart.js",
        ),
        source("src/app/api/usage/stats/route.js"),
        source("src/app/api/usage/chart/route.js"),
        source("src/app/api/usage/stream/route.js"),
      ]);

    expect(statsUi).toContain('searchParams.get("connectionId")');
    expect(statsUi).toContain('params.set("connectionId", connectionId)');
    expect(statsUi).toContain("All accounts");
    expect(chartUi).toContain("connectionId");
    expect(statsRoute).toContain("getUsageStats(period, connectionId)");
    expect(chartRoute).toContain("getChartData(period, connectionId)");
    expect(streamRoute).toContain("getUsageStats(\"all\", connectionId)");
    expect(streamRoute).toContain("getActiveRequests(connectionId)");
  });


  it("returns only the selected account across stats and chart history", async () => {
    await withUsageDb(async ({ saveRequestUsage, getUsageStats, getChartData }) => {
      const timestamp = new Date().toISOString();
      await saveRequestUsage({
        timestamp,
        provider: "alpha",
        model: "model-a",
        connectionId: "account-a",
        tokens: { prompt_tokens: 10, completion_tokens: 5 },
      });
      await saveRequestUsage({
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        provider: "beta",
        model: "model-b",
        connectionId: "account-b",
        tokens: { prompt_tokens: 100, completion_tokens: 50 },
      });

      await new Promise((resolve) => setImmediate(resolve));

      const [allStats, accountStats, allChart, accountChart] = await Promise.all([
        getUsageStats("all"),
        getUsageStats("all", "account-a"),
        getChartData("today"),
        getChartData("today", "account-a"),
      ]);

      expect(allStats.totalRequests).toBe(2);
      expect(accountStats.totalRequests).toBe(1);
      expect(accountStats.totalPromptTokens).toBe(10);
      expect(accountStats.totalCompletionTokens).toBe(5);
      expect(Object.values(accountStats.byProvider)).toHaveLength(1);
      expect(Object.values(accountStats.byProvider)[0].requests).toBe(1);
      expect(accountStats.recentRequests).toHaveLength(1);
      expect(
        accountChart.reduce((sum, bucket) => sum + bucket.tokens, 0),
      ).toBe(15);
      expect(
        allChart.reduce((sum, bucket) => sum + bucket.tokens, 0),
      ).toBe(165);
    });
  });
});