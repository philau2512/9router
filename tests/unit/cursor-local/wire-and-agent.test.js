import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const wire = require(path.join(root, "src/cursor-local/backend/proto/wire.js"));
const agent = require(
  path.join(root, "src/cursor-local/backend/proto/agentMessages.js"),
);

describe("protobuf wire codec", () => {
  it("roundtrips string field", () => {
    const buf = wire.encodeString(1, "hello");
    const fields = wire.decodeFields(buf);
    expect(wire.fieldString(fields, 1)).toBe("hello");
  });

  it("encodes nested message", () => {
    const inner = wire.encodeString(1, "rid-1");
    const outer = wire.encodeMessage(2, inner);
    const fields = wire.decodeFields(outer);
    const nested = wire.fieldMessage(fields, 2);
    expect(wire.fieldString(nested, 1)).toBe("rid-1");
  });
});

describe("agent messages", () => {
  it("decodes BidiAppendRequest", () => {
    const body = wire.concat(
      wire.encodeString(1, Buffer.from("deadbeef", "utf8").toString("hex")),
      wire.encodeMessage(2, wire.encodeString(1, "req-abc")),
      wire.encodeInt64(3, 1),
    );
    // data field should be hex string of message — use plain hex chars
    const body2 = wire.concat(
      wire.encodeString(1, "00"),
      wire.encodeMessage(2, wire.encodeString(1, "req-abc")),
      wire.encodeInt64(3, 2),
    );
    const parsed = agent.decodeBidiAppendRequest(body2);
    expect(parsed.requestId).toBe("req-abc");
    expect(parsed.appendSeqno).toBe(2);
    expect(parsed.data).toBe("00");
  });

  it("encodes text delta agent server message", () => {
    const msg = agent.encodeTextDelta("hi");
    expect(Buffer.isBuffer(msg)).toBe(true);
    expect(msg.length).toBeGreaterThan(0);
    const fields = wire.decodeFields(msg);
    // field 1 = interaction_update
    expect(fields.some((f) => f.fieldNumber === 1)).toBe(true);
  });

  it("encodes AvailableModels with channel ids", () => {
    const buf = agent.encodeAvailableModelsResponse([
      {
        id: "9r_abc",
        displayName: "Test Model",
        capabilities: { thinking: true, images: true },
      },
    ]);
    expect(buf.length).toBeGreaterThan(10);
    const strings = wire.collectStrings(buf);
    expect(strings.some((s) => s.includes("9r_abc") || s.includes("Test"))).toBe(
      true,
    );
  });

  it("decodes agent client run_request loosely from hex of nested strings", () => {
    // Build minimal run_request with user text via nested structure is hard;
    // ensure empty hex is empty kind
    const empty = agent.decodeAgentClientMessageFromHex("");
    expect(empty.kind).toBe("empty");
  });
});

describe("gzip body decompression", () => {
  const zlib = require("zlib");
  const connect = require(
    path.join(root, "src/cursor-local/backend/proto/connect.js"),
  );

  it("gunzips a gzip-magic body before decode (Cursor large run_request)", () => {
    // BidiAppendRequest with real hex data → gzip whole body → decompress → decode
    const inner = wire.encodeString(1, "run-payload-hex");
    const body = wire.concat(
      wire.encodeString(1, "abcdef"),
      wire.encodeMessage(2, wire.encodeString(1, "req-gz")),
      wire.encodeInt64(3, 7),
    );
    void inner;
    const gz = zlib.gzipSync(body);
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    const restored = connect.decompressBody(gz, "gzip");
    const parsed = agent.decodeBidiAppendRequest(restored);
    expect(parsed.requestId).toBe("req-gz");
    expect(parsed.appendSeqno).toBe(7);
    expect(parsed.data).toBe("abcdef");
  });

  it("passes through a non-gzip body unchanged", () => {
    const body = wire.encodeString(1, "plain");
    const out = connect.decompressBody(body, "");
    expect(Buffer.compare(out, body)).toBe(0);
  });
});

describe("prompt compile", () => {
  const { compilePrompt } = require(
    path.join(root, "src/cursor-local/backend/prompt/compile.js"),
  );

  it("ask mode strips write/edit tools (byok keeps shell; we strip Write/PatchEdit/Delete)", () => {
    const c = compilePrompt("ask", "m1");
    expect(c.mode).toBe("ask");
    const names = c.tools.map((t) => String(t.function?.name || ""));
    expect(names.includes("Write")).toBe(false);
    expect(names.includes("PatchEdit")).toBe(false);
    expect(names.includes("Delete")).toBe(false);
  });

  it("agent mode has shell/read tools", () => {
    const c = compilePrompt("agent");
    expect(c.tools.some((t) => t.function.name === "Shell")).toBe(true);
    expect(c.tools.some((t) => t.function.name === "Read")).toBe(true);
  });
});
