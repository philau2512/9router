import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const {
  stableChannelId,
  parseListenAddr,
  proxyUrlFromListenAddr,
} = require(path.join(root, "src/cursor-local/config/defaults.js"));

const {
  isWhitelistedRelayHost,
  normalizeHost,
} = require(path.join(root, "src/cursor-local/mitm/whitelist.js"));

describe("cursor-local defaults", () => {
  it("stableChannelId is deterministic and prefixed", () => {
    const a = stableChannelId("Foo", "bar");
    const b = stableChannelId("Foo", "bar");
    const c = stableChannelId("Foo", "baz");
    expect(a).toBe(b);
    expect(a.startsWith("9r_")).toBe(true);
    expect(a).not.toBe(c);
  });

  it("parseListenAddr normalizes host/port", () => {
    expect(parseListenAddr("127.0.0.1:18090").port).toBe(18090);
    expect(parseListenAddr(":18080").host).toBe("127.0.0.1");
    expect(proxyUrlFromListenAddr("127.0.0.1:18080")).toBe(
      "http://127.0.0.1:18080",
    );
  });
});

describe("cursor-local whitelist", () => {
  it("allows api2/api3 and *.cursor.sh", () => {
    expect(isWhitelistedRelayHost("api2.cursor.sh")).toBe(true);
    expect(isWhitelistedRelayHost("api3.cursor.sh:443")).toBe(true);
    expect(isWhitelistedRelayHost("agent.api5.cursor.sh")).toBe(true);
    expect(isWhitelistedRelayHost("example.com")).toBe(false);
    expect(normalizeHost("API2.CURSOR.SH:443")).toBe("api2.cursor.sh");
  });
});
