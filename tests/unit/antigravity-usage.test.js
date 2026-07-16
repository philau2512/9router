import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import {
  ANTIGRAVITY_USAGE_ENDPOINTS,
} from "../../open-sse/providers/antigravity-provider-metadata.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const request = {
  provider: "antigravity",
  accessToken: "ag-token",
};
const proxyOptions = { proxy: "http://proxy.test" };

describe("Antigravity usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses canonical endpoints and maps only supported quota models including image", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        jsonResponse({
          cloudaicompanionProject: "ag-project",
          currentTier: { name: "Pro" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          models: {
            "gemini-3-flash": {
              displayName: "Gemini Flash",
              quotaInfo: { remainingFraction: 0.75, resetTime: "2026-07-17T00:00:00Z" },
            },
            "gemini-3.1-flash-image": {
              quotaInfo: { remainingFraction: 0.5, resetTime: "2026-07-17T00:00:00Z" },
            },
            internal: { isInternal: true, quotaInfo: { remainingFraction: 1 } },
            unknown: { quotaInfo: { remainingFraction: 1 } },
            missing: {},
          },
        }),
      );

    const usage = await getUsageForProvider(request, proxyOptions);

    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      ANTIGRAVITY_USAGE_ENDPOINTS.loadProjectApiUrl,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer ag-token" }),
        body: expect.stringContaining('"mode":1'),
      }),
      proxyOptions,
    );
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      ANTIGRAVITY_USAGE_ENDPOINTS.quotaApiUrl,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ project: "ag-project" }),
      }),
      proxyOptions,
    );
    expect(usage).toMatchObject({ plan: "Pro" });
    expect(usage.quotas["gemini-3-flash"]).toMatchObject({
      used: 250,
      total: 1000,
      remainingPercentage: 75,
      displayName: "Gemini Flash",
    });
    expect(usage.quotas["gemini-3.1-flash-image"]).toMatchObject({
      used: 500,
      total: 1000,
    });
    expect(usage.quotas).not.toHaveProperty("internal");
    expect(usage.quotas).not.toHaveProperty("unknown");
    expect(usage.quotas).not.toHaveProperty("missing");
  });

  it("normalizes project objects returned by loadCodeAssist", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        jsonResponse({ cloudaicompanionProject: { id: " project-object " } }),
      )
      .mockResolvedValueOnce(jsonResponse({ models: {} }));

    await getUsageForProvider(request, proxyOptions);

    expect(proxyAwareFetch).toHaveBeenLastCalledWith(
      ANTIGRAVITY_USAGE_ENDPOINTS.quotaApiUrl,
      expect.objectContaining({ body: JSON.stringify({ project: "project-object" }) }),
      proxyOptions,
    );
  });

  it("omits invalid project object IDs from quota payloads", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ cloudaicompanionProject: { id: 123 } }))
      .mockResolvedValueOnce(jsonResponse({ models: {} }));

    await getUsageForProvider(request, proxyOptions);

    expect(proxyAwareFetch).toHaveBeenLastCalledWith(
      ANTIGRAVITY_USAGE_ENDPOINTS.quotaApiUrl,
      expect.objectContaining({ body: "{}" }),
      proxyOptions,
    );
  });

  it("continues quota lookup without a project when subscription lookup fails", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ models: {} }));

    const usage = await getUsageForProvider(request, proxyOptions);

    expect(proxyAwareFetch).toHaveBeenLastCalledWith(
      ANTIGRAVITY_USAGE_ENDPOINTS.quotaApiUrl,
      expect.objectContaining({ body: "{}" }),
      proxyOptions,
    );
    expect(usage).toMatchObject({ plan: "Unknown", quotas: {} });
  });

  it.each([
    [401, "authentication expired"],
    [403, "access forbidden"],
  ])("fails open for quota HTTP %i", async (status, message) => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}, status));

    await expect(getUsageForProvider(request)).resolves.toEqual({
      message: expect.stringContaining(message),
      quotas: {},
    });
  });

  it("returns a safe message for quota HTTP and network failures", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(getUsageForProvider(request)).resolves.toEqual({
      message: "Antigravity error: Antigravity API error: 500",
    });

    vi.clearAllMocks();
    proxyAwareFetch
      .mockRejectedValueOnce(new Error("subscription unavailable"))
      .mockRejectedValueOnce(new Error("quota unavailable"));
    await expect(getUsageForProvider(request)).resolves.toEqual({
      message: "Antigravity error: quota unavailable",
    });
  });
});
