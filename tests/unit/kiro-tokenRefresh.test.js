import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We mock providers.js to make sure fetchKiroProfileArn is missing
vi.mock("../../src/lib/oauth/providers.js", () => {
  return {
    // fetchKiroProfileArn is intentionally missing here
  };
});

describe("kiro/token-refresh wrapper", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("refreshKiroToken works even when fetchKiroProfileArn is missing in providers.js", async () => {
    // Mock fetch for AWS SSO OIDC Token Endpoint
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes("amazonaws.com/token")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            accessToken: "mocked-access-token-123",
            refreshToken: "mocked-refresh-token-rotated",
            expiresIn: 3600,
          }),
          json: async () => ({
            accessToken: "mocked-access-token-123",
            refreshToken: "mocked-refresh-token-rotated",
            expiresIn: 3600,
          }),
        };
      }
      return { ok: false, status: 404, text: async () => "Not Found" };
    });

    const mod = await import("../../open-sse/services/tokenRefresh.js");
    
    const providerSpecificData = {
      clientId: "mock-client-id",
      clientSecret: "mock-client-secret",
      region: "us-east-1",
      authMethod: "builder-id"
    };

    const out = await mod.refreshKiroToken(
      "mock-refresh-token",
      providerSpecificData,
      null,
      null,
      true
    );

    // Assertions
    expect(out).toEqual({
      accessToken: "mocked-access-token-123",
      refreshToken: "mocked-refresh-token-rotated",
      expiresIn: 3600,
    });
  });
});
