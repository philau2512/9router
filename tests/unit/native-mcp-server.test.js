import { describe, it, expect, vi } from "vitest";
import {
  registerNativeSession,
  unregisterNativeSession,
  handleNativeJsonRpc,
} from "../../src/lib/mcp/nativeMcpServer.js";

describe("Native 9Router MCP Server", () => {
  it("handles initialize and returns server info", async () => {
    const messages = [];
    const sid = registerNativeSession((msg) => messages.push(msg));

    await handleNativeJsonRpc(sid, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });

    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("event: message\ndata: ");
    const data = JSON.parse(messages[0].replace("event: message\ndata: ", "").trim());
    expect(data.id).toBe(1);
    expect(data.result.serverInfo.name).toBe("9router-mcp");
    expect(data.result.capabilities.tools).toBeDefined();

    unregisterNativeSession(sid);
  });

  it("lists all tools in tools/list", async () => {
    const messages = [];
    const sid = registerNativeSession((msg) => messages.push(msg));

    await handleNativeJsonRpc(sid, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    expect(messages.length).toBe(1);
    const data = JSON.parse(messages[0].replace("event: message\ndata: ", "").trim());
    expect(data.id).toBe(2);
    expect(data.result.tools).toBeInstanceOf(Array);
    const toolNames = data.result.tools.map((t) => t.name);
    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("check_provider_status");
    expect(toolNames).toContain("list_available_models");
    expect(toolNames).toContain("generate_image");

    unregisterNativeSession(sid);
  });

  it("handles ping method", async () => {
    const messages = [];
    const sid = registerNativeSession((msg) => messages.push(msg));

    await handleNativeJsonRpc(sid, {
      jsonrpc: "2.0",
      id: 3,
      method: "ping",
    });

    expect(messages.length).toBe(1);
    const data = JSON.parse(messages[0].replace("event: message\ndata: ", "").trim());
    expect(data.id).toBe(3);
    expect(data.result).toEqual({});

    unregisterNativeSession(sid);
  });

  it("returns error for unknown tool call", async () => {
    const messages = [];
    const sid = registerNativeSession((msg) => messages.push(msg));

    await handleNativeJsonRpc(sid, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "non_existent_tool", arguments: {} },
    });

    expect(messages.length).toBe(1);
    const data = JSON.parse(messages[0].replace("event: message\ndata: ", "").trim());
    expect(data.id).toBe(4);
    expect(data.result.isError).toBe(true);

    unregisterNativeSession(sid);
  });
});
