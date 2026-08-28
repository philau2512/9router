import {
  registerNativeSession,
  unregisterNativeSession,
} from "@/lib/mcp/nativeMcpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let sid;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => controller.enqueue(encoder.encode(chunk));
      sid = registerNativeSession(send);

      // MCP SSE handshake: tell client where to POST messages.
      send(`event: endpoint\ndata: /api/mcp/message?sessionId=${sid}\n\n`);
    },
    cancel() {
      if (sid) {
        unregisterNativeSession(sid);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
