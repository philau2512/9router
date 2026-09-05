import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { GeminiCLIExecutor } from "../../open-sse/executors/gemini-cli.js";

describe("Gemini CLI credential refresh", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses the connection proxy for OAuth refresh", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-access", expires_in: 3600 }),
    });
    const executor = new GeminiCLIExecutor();
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.test" };

    await expect(executor.refreshCredentials({ refreshToken: "refresh", projectId: "project" }, null, proxyOptions)).resolves.toEqual({
      accessToken: "new-access",
      refreshToken: "refresh",
      expiresIn: 3600,
      projectId: "project",
    });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
      proxyOptions,
    );
  });
});
