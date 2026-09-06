import { NextResponse } from "next/server";
import { handleNativeJsonRpc } from "@/lib/mcp/nativeMcpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  try {
    const body = await request.json();
    handleNativeJsonRpc(sessionId, body);
    return new Response(null, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
