import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { warmupSingleConnection } from "../[id]/test/testUtils.js";

// Cap parallel warmups so many accounts finish faster than pure sequential
// without opening dozens of Codex streams at once.
const WARMUP_BATCH_CONCURRENCY = 3;

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  const poolSize = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

async function warmupOne(id, options) {
  try {
    const conn = await getProviderConnectionById(id);
    if (!conn) {
      console.warn(`[WARMUP] batch: ${id} not found`);
      return {
        connectionId: id,
        valid: false,
        error: "Connection not found",
        testedAt: new Date().toISOString(),
      };
    }

    const data = await warmupSingleConnection(id, options);
    return {
      provider: conn.provider,
      connectionId: id,
      connectionName: conn.name || conn.email || conn.provider,
      valid: data.valid,
      latencyMs: data.latencyMs || 0,
      error: data.error || null,
      testedAt: data.testedAt || new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`[WARMUP] batch: ${id} error: ${error.message}`);
    return {
      connectionId: id,
      valid: false,
      error: error.message,
      testedAt: new Date().toISOString(),
    };
  }
}

// POST /api/providers/warmup-batch - Warmup multiple connections (parallel pool)
export async function POST(request) {
  try {
    const body = await request.json();
    const { connectionIds, options } = body;

    if (!connectionIds || !Array.isArray(connectionIds)) {
      return NextResponse.json(
        { error: "connectionIds array is required" },
        { status: 400 },
      );
    }

    if (connectionIds.length === 0) {
      return NextResponse.json({
        results: [],
        summary: { total: 0, passed: 0, failed: 0 },
        testedAt: new Date().toISOString(),
      });
    }

    const intensity = options?.intensity || "light";
    const concurrency = Math.min(
      WARMUP_BATCH_CONCURRENCY,
      connectionIds.length,
    );
    console.log(
      `[WARMUP] batch start count=${connectionIds.length} intensity=${intensity} concurrency=${concurrency}`,
    );

    const results = await mapWithConcurrency(
      connectionIds,
      concurrency,
      (id) => warmupOne(id, options),
    );

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.valid).length,
      failed: results.filter((r) => !r.valid).length,
      concurrency,
    };
    console.log(
      `[WARMUP] batch done total=${summary.total} passed=${summary.passed} failed=${summary.failed} concurrency=${concurrency}`,
    );

    return NextResponse.json({
      results,
      testedAt: new Date().toISOString(),
      summary,
    });
  } catch (error) {
    console.warn(`[WARMUP] batch failed: ${error.message}`);
    return NextResponse.json({ error: "Batch warmup failed" }, { status: 500 });
  }
}