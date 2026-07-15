import { NextResponse } from "next/server";
import { syncCursorLocalModels } from "@/lib/cursor-local/syncModels";

export const dynamic = "force-dynamic";

/**
 * POST /api/cursor-local/models/sync
 * Body: { replace?: boolean, max?: number }
 * Pull LLM models/aliases/combos from 9Router into cursor-local map.
 */
export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const result = await syncCursorLocalModels({
      replace: body.replace !== false,
      max: body.max,
      includeCatalog: body.includeCatalog !== false,
    });
    return NextResponse.json({
      ok: true,
      count: result.count,
      models: result.models,
      replaced: result.replaced,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e.message || "sync failed" },
      { status: 500 },
    );
  }
}
