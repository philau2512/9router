import { NextResponse } from "next/server";
import { sendToChild, findPlugin } from "@/lib/mcp/stdioSseBridge";
import { handleNativeJsonRpc } from "@/lib/mcp/nativeMcpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NATIVE_PLUGINS = new Set(["9router", "search", "default"]);

export async function POST(request, { params }) {
  const { plugin } = await params;
  const isNative = NATIVE_PLUGINS.has(plugin);

  if (!isNative && !findPlugin(plugin)) {
    return NextResponse.json(
      { error: `Unknown plugin: ${plugin}` },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  try {
    const body = await request.json();
    if (isNative) {
      handleNativeJsonRpc(sessionId, body);
    } else {
      sendToChild(plugin, body);
    }
    return new Response(null, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

