import { describe, it, expect, vi } from "vitest";

const mockProxyAwareFetch = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => mockProxyAwareFetch(...args),
}));

import { U } from "open-sse/services/usage/shared.js";
import { getCodexUsage } from "open-sse/services/usage/codex.js";

describe("Usage Endpoint Resolution & Codex Quota", () => {
  it("resolves usage config for codex from registry", () => {
    const codexUsage = U("codex");
    expect(codexUsage).toBeDefined();
    expect(codexUsage.url).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect(codexUsage.resetCreditsUrl).toBe(
      "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
    );
    expect(codexUsage.resetCreditsConsumeUrl).toBe(
      "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume",
    );
  });

  it("resolves usage config for other providers correctly", () => {
    expect(U("glm").url).toBeDefined();
    expect(U("glm-cn").url).toBeDefined();
    expect(U("qoder").url).toBeDefined();
    expect(U("gemini-cli").quotaUrl).toBeDefined();
  });

  it("fetches codex usage without URL undefined error", async () => {
    mockProxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 15, resets_at: "2026-09-02T00:00:00.000Z" },
          secondary_window: { used_percent: 30, resets_at: "2026-09-08T00:00:00.000Z" },
        },
      }),
    });

    const result = await getCodexUsage("mock_access_token");
    expect(mockProxyAwareFetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer mock_access_token",
        }),
      }),
      null,
    );

    expect(result).toBeDefined();
    expect(result.plan).toBe("plus");
    expect(result.quotas.session).toBeDefined();
    expect(result.quotas.session.used).toBe(15);
    expect(result.quotas.weekly).toBeDefined();
    expect(result.quotas.weekly.used).toBe(30);
  });
});
