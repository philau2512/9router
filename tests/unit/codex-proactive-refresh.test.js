import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnectionById = vi.fn();
const getProviderConnections = vi.fn();
const updateProviderConnection = vi.fn(async (_id, updates) => updates);
const getAccessToken = vi.fn();

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnectionById: (...args) => getProviderConnectionById(...args),
  getProviderConnections: (...args) => getProviderConnections(...args),
  updateProviderConnection: (...args) => updateProviderConnection(...args),
}));

vi.mock("open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: vi.fn(),
  invalidateProjectId: vi.fn(),
  removeConnection: vi.fn(),
}));

vi.mock("open-sse/services/tokenRefresh.js", () => ({
  TOKEN_EXPIRY_BUFFER_MS: 300_000,
  refreshAccessToken: vi.fn(),
  refreshClaudeOAuthToken: vi.fn(),
  refreshGoogleToken: vi.fn(),
  refreshQwenToken: vi.fn(),
  refreshCodexToken: vi.fn(),
  refreshIflowToken: vi.fn(),
  refreshGitHubToken: vi.fn(),
  refreshCopilotToken: vi.fn(),
  getAccessToken: (...args) => getAccessToken(...args),
  refreshTokenByProvider: vi.fn(),
  formatProviderCredentials: vi.fn(),
  getAllAccessTokens: vi.fn(),
  refreshKiroToken: vi.fn(),
  getRefreshLeadMs: vi.fn(() => 300_000),
  isUnrecoverableRefreshError: (result) =>
    result?.error === "unrecoverable_refresh_error",
}));

vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: vi.fn(),
  shouldRefreshCredentials: vi.fn(),
}));

const load = () => import("../../src/sse/services/tokenRefresh.js");

const connection = {
  id: "codex-connection-1",
  provider: "codex",
  refreshToken: "refresh-token",
  expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  providerSpecificData: { autoRefreshEnabled: true },
};

describe("Codex proactive refresh", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects enabled connections expiring within the 5-hour window", async () => {
    const {
      CODEX_PROACTIVE_REFRESH_LEAD_MS,
      isCodexAutoRefreshCandidate,
    } = await load();
    const now = Date.now();

    expect(CODEX_PROACTIVE_REFRESH_LEAD_MS).toBe(5 * 60 * 60 * 1000);
    expect(
      isCodexAutoRefreshCandidate(
        {
          ...connection,
          expiresAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isCodexAutoRefreshCandidate(
        {
          ...connection,
          expiresAt: new Date(now + 5 * 60 * 60 * 1000 + 1).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });

  it("retries temporary Codex refresh failures before persisting a token", async () => {
    getProviderConnectionById.mockResolvedValue(connection);
    getAccessToken
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 86_400,
      });
    const { refreshCodexConnection } = await load();

    const refresh = refreshCodexConnection(connection);
    await vi.runAllTimersAsync();
    const result = await refresh;

    expect(getAccessToken).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      ok: true,
      connectionId: connection.id,
      accessToken: "new-access-token",
    });
    expect(updateProviderConnection).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      }),
    );
  });

  it("does not retry an unrecoverable Codex refresh token", async () => {
    getProviderConnectionById.mockResolvedValue(connection);
    getAccessToken.mockResolvedValue({
      error: "unrecoverable_refresh_error",
      code: "invalid_grant",
    });
    const { refreshCodexConnection } = await load();

    const result = await refreshCodexConnection(connection);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, unrecoverable: true });
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });
});