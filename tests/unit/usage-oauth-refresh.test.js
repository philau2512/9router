// Usage quota path must refresh OAuth via oauthCredentialManager (not only executor map).
// Regression: provider "xai" uses DefaultExecutor without a hard-coded refresher, so
// refreshAndUpdateCredentials used to skip/fail silently and call billing with a dead token.
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProviderConnection = vi.fn(async (_id, data) => data);
const getProviderConnectionById = vi.fn();
const getUsageForProvider = vi.fn(async () => ({ quotas: {} }));
const shouldRefreshCredentials = vi.fn();
const refreshProviderCredentials = vi.fn();
const isUnrecoverableRefreshError = vi.fn(() => false);
const getExecutor = vi.fn();

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: (...args) => getProviderConnectionById(...args),
  updateProviderConnection: (...args) => updateProviderConnection(...args),
}));
vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: (...args) => getUsageForProvider(...args),
}));
vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: (...args) => getExecutor(...args),
}));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  shouldRefreshCredentials: (...args) => shouldRefreshCredentials(...args),
  refreshProviderCredentials: (...args) => refreshProviderCredentials(...args),
}));
vi.mock("open-sse/services/tokenRefresh.js", () => ({
  isUnrecoverableRefreshError: (...args) => isUnrecoverableRefreshError(...args),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
}));

const load = () => import("../../src/app/api/usage/[connectionId]/route.js");

describe("usage OAuth refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isUnrecoverableRefreshError.mockReturnValue(false);
  });

  it("xai expired token → refreshProviderCredentials + persist new accessToken", async () => {
    const { refreshAndUpdateCredentials } = await load();
    const connection = {
      id: "conn-xai-1",
      provider: "xai",
      authType: "oauth",
      accessToken: "old-token",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      lastRefreshAt: "2026-07-12T00:03:10.800Z",
      providerSpecificData: { email: "a@b.com" },
    };

    shouldRefreshCredentials.mockReturnValue(true);
    refreshProviderCredentials.mockResolvedValue({
      accessToken: "new-token",
      refreshToken: "rt2",
      expiresIn: 3600,
      lastRefreshAt: new Date().toISOString(),
    });

    const result = await refreshAndUpdateCredentials(connection, false, null);

    expect(getExecutor).not.toHaveBeenCalled();
    expect(shouldRefreshCredentials).toHaveBeenCalledWith(
      "xai",
      expect.objectContaining({
        connectionId: "conn-xai-1",
        refreshToken: "rt",
      }),
    );
    expect(refreshProviderCredentials).toHaveBeenCalledWith(
      "xai",
      expect.objectContaining({ accessToken: "old-token" }),
      console,
    );
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-xai-1",
      expect.objectContaining({
        accessToken: "new-token",
        refreshToken: "rt2",
      }),
    );
    expect(result.refreshed).toBe(true);
    expect(result.connection.accessToken).toBe("new-token");
  });

  it("force=true skips needs check and still refreshes", async () => {
    const { refreshAndUpdateCredentials } = await load();
    shouldRefreshCredentials.mockReturnValue(false);
    refreshProviderCredentials.mockResolvedValue({
      accessToken: "forced-token",
      expiresIn: 1200,
    });

    const result = await refreshAndUpdateCredentials(
      {
        id: "c2",
        provider: "grok-cli",
        accessToken: "t",
        refreshToken: "rt",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      true,
      null,
    );

    expect(shouldRefreshCredentials).not.toHaveBeenCalled();
    expect(refreshProviderCredentials).toHaveBeenCalled();
    expect(result.refreshed).toBe(true);
    expect(result.connection.accessToken).toBe("forced-token");
  });
});