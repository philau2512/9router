import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  clearAntigravityModelCache,
  resolveAntigravityModels,
} from "../../open-sse/services/antigravityModels.js";
import {
  ANTIGRAVITY_BASE_URLS,
  ANTIGRAVITY_OPERATIONS,
} from "../../open-sse/providers/antigravity-provider-metadata.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const credentials = {
  accessToken: "ag-token",
  connectionId: "ag-models-test",
  providerSpecificData: { project_id: " project-id ", projectId: "ignored" },
};

describe("Antigravity live model catalog", () => {
  beforeEach(() => {
    clearAntigravityModelCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearAntigravityModelCache();
  });

  it("fails open without an access token", async () => {
    await expect(resolveAntigravityModels()).resolves.toBeNull();
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("uses canonical production URL, project_id precedence, and filters catalog entries", async () => {
    const proxyOptions = { proxy: "http://proxy.test" };
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        models: {
          " gemini-3-flash ": { displayName: "Gemini Flash" },
          tab_flash_lite_preview: { displayName: "Skip" },
          "gemini-3.1-flash-image": {},
          " ": { displayName: "Blank" },
        },
      }),
    );

    const result = await resolveAntigravityModels(credentials, { proxyOptions });

    expect(result).toEqual({
      models: [
        { id: "gemini-3-flash", name: "Gemini Flash", isLive: true },
        { id: "gemini-3.1-flash-image", name: "gemini-3.1-flash-image", isLive: true },
      ],
    });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      `${ANTIGRAVITY_BASE_URLS[0]}${ANTIGRAVITY_OPERATIONS.fetchAvailableModels}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer ag-token" }),
        body: JSON.stringify({ project: "project-id" }),
      }),
      proxyOptions,
    );
  });

  it("falls through production failures to a later endpoint", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockRejectedValueOnce(new Error("daily unreachable"))
      .mockResolvedValueOnce(
        jsonResponse({ models: { "gemini-3-flash": { displayName: "Fallback" } } }),
      );

    await expect(resolveAntigravityModels(credentials)).resolves.toEqual({
      models: [{ id: "gemini-3-flash", name: "Fallback", isLive: true }],
    });
    expect(proxyAwareFetch.mock.calls.map(([url]) => url)).toEqual(
      ANTIGRAVITY_BASE_URLS.map(
        (base) => `${base}${ANTIGRAVITY_OPERATIONS.fetchAvailableModels}`,
      ),
    );
  });

  it("treats invalid or empty catalog responses as fallback candidates", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockRejectedValue(new Error("bad json")) })
      .mockResolvedValueOnce(
        jsonResponse({ models: { tab_flash_lite_preview: { displayName: "Skip" } } }),
      )
      .mockResolvedValueOnce(jsonResponse({ models: {} }));

    await expect(resolveAntigravityModels(credentials)).resolves.toBeNull();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("caches by credential and supports force refresh and explicit clearing", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ models: { first: {} } }))
      .mockResolvedValueOnce(jsonResponse({ models: { refreshed: {} } }))
      .mockResolvedValueOnce(jsonResponse({ models: { cleared: {} } }));

    await expect(resolveAntigravityModels(credentials)).resolves.toEqual({
      models: [{ id: "first", name: "first", isLive: true }],
    });
    await expect(resolveAntigravityModels(credentials)).resolves.toEqual({
      models: [{ id: "first", name: "first", isLive: true }],
    });
    await expect(
      resolveAntigravityModels(credentials, { forceRefresh: true }),
    ).resolves.toEqual({ models: [{ id: "refreshed", name: "refreshed", isLive: true }] });
    clearAntigravityModelCache();
    await expect(resolveAntigravityModels(credentials)).resolves.toEqual({
      models: [{ id: "cleared", name: "cleared", isLive: true }],
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("does not share cached catalogs across connections", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ models: { one: {} } }))
      .mockResolvedValueOnce(jsonResponse({ models: { two: {} } }));

    await resolveAntigravityModels(credentials);
    await expect(
      resolveAntigravityModels({ ...credentials, connectionId: "other-connection" }),
    ).resolves.toEqual({ models: [{ id: "two", name: "two", isLive: true }] });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  });
});
