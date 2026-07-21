import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  clearAntigravityModelCache,
  resolveAntigravityModels,
} from "../../open-sse/services/antigravityModels.js";
import { GET } from "../../src/app/api/providers/[id]/models/route.js";
import { getProviderConnectionById } from "../../src/lib/db/index.js";

vi.mock("../../src/lib/db/index.js", () => ({
  getProviderConnectionById: vi.fn(),
  isOpenAICompatibleProvider: vi.fn().mockReturnValue(false),
  getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue(null),
}));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const credentials = {
  accessToken: "test-token-123",
  connectionId: "conn-refresh-test",
  providerSpecificData: { project_id: "test-project" },
};

describe("Provider models 5-minute cache & forceRefresh verification", () => {
  beforeEach(() => {
    clearAntigravityModelCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearAntigravityModelCache();
  });

  it("caches dynamic models and returns cached data on second call without forceRefresh", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        jsonResponse({
          models: { "gemini-3.5-flash-low": { displayName: "Initial Model" } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          models: { "gemini-3.5-flash-low": { displayName: "Refreshed Model" } },
        }),
      );

    // Call 1: First fetch hits network
    const res1 = await resolveAntigravityModels(credentials);
    expect(res1).toEqual({
      models: [
        { id: "gemini-3.5-flash-low", name: "Initial Model", isLive: true },
      ],
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

    // Call 2: Second call without forceRefresh MUST return cached data without hitting network
    const res2 = await resolveAntigravityModels(credentials);
    expect(res2).toEqual({
      models: [
        { id: "gemini-3.5-flash-low", name: "Initial Model", isLive: true },
      ],
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1); // Network calls stay 1!

    // Call 3: Call with forceRefresh: true MUST bypass cache and issue fresh network call
    const res3 = await resolveAntigravityModels(credentials, { forceRefresh: true });
    expect(res3).toEqual({
      models: [
        { id: "gemini-3.5-flash-low", name: "Refreshed Model", isLive: true },
      ],
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2); // Network calls increased to 2!
  });

  it("API route GET /api/providers/[id]/models parses ?refresh=true and passes forceRefresh: true to custom resolver", async () => {
    getProviderConnectionById.mockResolvedValueOnce({
      id: "ag-conn-1",
      provider: "antigravity",
      accessToken: "token-abc",
      providerSpecificData: {},
    });

    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        models: { "gemini-3-flash-agent": { displayName: "Gemini 3.5 Flash High" } },
      }),
    );

    const req = new Request("http://localhost:3000/api/providers/ag-conn-1/models?refresh=true");
    const res = await GET(req, { params: Promise.resolve({ id: "ag-conn-1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.provider).toBe("antigravity");
    expect(data.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gemini-3-flash-agent", isLive: true }),
      ]),
    );
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});
