import { NextResponse } from "next/server";
import { startCursorLocal, getCursorLocalStatus } from "@/lib/cursor-local/manager";
import { getSettings } from "@/lib/localDb";
import { getApiKeys } from "@/lib/db/repos/apiKeysRepo";

/** Pick first active 9router API key for cursor-local → /v1 auth. */
async function resolveRouterApiKey(provided) {
  if (provided) return provided;
  // env already set in process (e.g. CLI sets ROUTER_API_KEY)
  const envKey = process.env.ROUTER_API_KEY || process.env.CURSOR_LOCAL_ROUTER_API_KEY;
  if (envKey) return envKey;
  // Pull from DB — first active key, same logic as MITM manager
  try {
    const keys = await getApiKeys();
    const active = (keys || []).find((k) => k.isActive !== false && k.key);
    if (active?.key) return active.key;
  } catch {
    /* DB may not have keys; continue without */
  }
  return "";
}

export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const apiKey = await resolveRouterApiKey(body.apiKey || undefined);

    const status = await startCursorLocal({
      sudoPassword: body.sudoPassword || undefined,
      apiKey: apiKey || undefined,
      routerBase: body.routerBase || undefined,
      getSettings,
    });
    return NextResponse.json({
      ok: true,
      status,
      hasApiKey: !!apiKey,
    });
  } catch (e) {
    const status = e.code === "CURSOR_LOCAL_MUTEX" ? 409 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: e.message || "start failed",
        code: e.code || "START_FAILED",
        status: await getCursorLocalStatus().catch(() => null),
      },
      { status },
    );
  }
}
