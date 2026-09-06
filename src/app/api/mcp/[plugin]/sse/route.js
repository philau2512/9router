import {
  registerSession,
  unregisterSession,
  findPlugin,
} from "@/lib/mcp/stdioSseBridge";
import {
  registerNativeSession,
  unregisterNativeSession,
} from "@/lib/mcp/nativeMcpServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NATIVE_PLUGINS = new Set(["9router", "search", "default"]);

export async function GET(request, { params }) {
  const { plugin } = await params;
  const isNative = NATIVE_PLUGINS.has(plugin);

  if (!isNative && !findPlugin(plugin)) {
    return new Response(`Unknown plugin: ${plugin}`, { status: 404 });
  }

  const encoder = new TextEncoder();
  let sid;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => controller.enqueue(encoder.encode(chunk));
      sid = isNative
        ? registerNativeSession(send)
        : registerSession(plugin, send);

      // MCP SSE handshake: tell client where to POST messages.
      send(
        `event: endpoint\ndata: /api/mcp/${plugin}/message?sessionId=${sid}\n\n`,
      );
    },
    cancel() {
      if (sid) {
        if (isNative) {
          unregisterNativeSession(sid);
        } else {
          unregisterSession(plugin, sid);
        }
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
