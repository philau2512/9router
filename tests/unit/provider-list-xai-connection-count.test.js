/**
 * Provider list card stats must count sibling connections the same way as
 * the detail page (xai unions grok-cli OAuth).
 */
import { describe, it, expect } from "vitest";
import { getProviderConnectionMatchIds } from "../../src/app/(dashboard)/dashboard/providers/hooks/local/providerConnectionMatch.js";

function getProviderStatsFromConnections(connections, providerId, authType) {
  const authTypes = Array.isArray(authType) ? authType : [authType];
  const matchIds = new Set(getProviderConnectionMatchIds(providerId));
  const providerConnections = connections.filter(
    (c) => matchIds.has(c.provider) && authTypes.includes(c.authType),
  );
  const connected = providerConnections.filter(
    (c) => c.testStatus === "active" || c.testStatus === "success",
  ).length;
  return { connected, total: providerConnections.length };
}

describe("provider list card connection match (xai ↔ grok-cli)", () => {
  it("xai matches both xai and grok-cli ids", () => {
    expect(getProviderConnectionMatchIds("xai")).toEqual(["xai", "grok-cli"]);
  });

  it("other providers stay exact-id", () => {
    expect(getProviderConnectionMatchIds("grok-cli")).toEqual(["grok-cli"]);
    expect(getProviderConnectionMatchIds("kiro")).toEqual(["kiro"]);
  });

  it("xai card shows Connected when only grok-cli OAuth exists", () => {
    const connections = [
      {
        provider: "grok-cli",
        authType: "oauth",
        testStatus: "active",
        isActive: true,
        name: "Morgan Williams",
      },
    ];
    // Old bug: exact provider===xai → total 0 → "No connections"
    const stats = getProviderStatsFromConnections(connections, "xai", "oauth");
    expect(stats.total).toBe(1);
    expect(stats.connected).toBe(1);
  });

  it("grok-cli card still counts its own oauth row", () => {
    const connections = [
      {
        provider: "grok-cli",
        authType: "oauth",
        testStatus: "active",
        isActive: true,
      },
    ];
    const stats = getProviderStatsFromConnections(
      connections,
      "grok-cli",
      "oauth",
    );
    expect(stats.connected).toBe(1);
  });

  it("xai api-key only still counts without requiring grok-cli", () => {
    const connections = [
      {
        provider: "xai",
        authType: "apikey",
        testStatus: "active",
        isActive: true,
      },
    ];
    // OAuth section should not count apikey
    expect(
      getProviderStatsFromConnections(connections, "xai", "oauth").total,
    ).toBe(0);
    // If ever counted as apikey on another card path
    expect(
      getProviderStatsFromConnections(connections, "xai", "apikey").connected,
    ).toBe(1);
  });
});