import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getProxyPools: vi.fn(),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

vi.mock("@/models", () => ({ getProxyPools: mocks.getProxyPools }));

vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function activeConnection(provider) {
  return {
    id: `${provider}-connection`,
    provider,
    isActive: true,
    priority: 1,
    providerSpecificData: {},
  };
}

describe("provider credential selection concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      proxyPoolId: null,
      vercelRelayUrl: "",
      connectionProxyHeadersTimeoutMs: null,
    });
  });

  it("allows independent provider pools to select credentials concurrently", async () => {
    const codexConnections = deferred();
    const geminiConnections = deferred();
    mocks.getProviderConnections.mockImplementation(({ provider }) => {
      if (provider === "codex") return codexConnections.promise;
      if (provider === "gemini") return geminiConnections.promise;
      throw new Error(`unexpected provider: ${provider}`);
    });

    const { getProviderCredentials } =
      await import("../../src/sse/services/provider-credentials.js");
    const codexRequest = getProviderCredentials("codex");
    const geminiRequest = getProviderCredentials("gemini");

    await vi.waitFor(() => {
      expect(mocks.getProviderConnections).toHaveBeenCalledTimes(2);
    });

    codexConnections.resolve([activeConnection("codex")]);
    geminiConnections.resolve([activeConnection("gemini")]);

    await expect(codexRequest).resolves.toMatchObject({
      connectionId: "codex-connection",
    });
    await expect(geminiRequest).resolves.toMatchObject({
      connectionId: "gemini-connection",
    });
  });

  it("serializes selections within the same provider pool", async () => {
    const initialConnections = deferred();
    mocks.getProviderConnections.mockImplementation(() => initialConnections.promise);

    const { getProviderCredentials } =
      await import("../../src/sse/services/provider-credentials.js");
    const firstRequest = getProviderCredentials("codex");

    await vi.waitFor(() => {
      expect(mocks.getProviderConnections).toHaveBeenCalledTimes(1);
    });

    const secondRequest = getProviderCredentials("codex");
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.getProviderConnections).toHaveBeenCalledTimes(1);

    initialConnections.resolve([activeConnection("codex")]);

    await expect(firstRequest).resolves.toMatchObject({
      connectionId: "codex-connection",
    });
    await expect(secondRequest).resolves.toMatchObject({
      connectionId: "codex-connection",
    });
    expect(mocks.getProviderConnections).toHaveBeenCalledTimes(2);
  });

  it("uses request settings without a second settings lookup", async () => {
    mocks.getProviderConnections.mockResolvedValue([activeConnection("codex")]);
    const settings = { fallbackStrategy: "fill-first" };
    const { getProviderCredentials } =
      await import("../../src/sse/services/provider-credentials.js");

    await expect(getProviderCredentials("codex", null, null, { settings })).resolves.toMatchObject({
      connectionId: "codex-connection",
    });
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("keeps round-robin state in memory while its database write is pending", async () => {
    const connections = [
      { ...activeConnection("codex"), id: "first", lastUsedAt: "2026-01-01T00:00:00.000Z", consecutiveUseCount: 3 },
      { ...activeConnection("codex"), id: "second" },
    ];
    const persistence = deferred();
    mocks.getProviderConnections.mockResolvedValue(connections);
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 });
    mocks.updateProviderConnection.mockReturnValue(persistence.promise);

    const { getProviderCredentials } =
      await import("../../src/sse/services/provider-credentials.js");
    await expect(getProviderCredentials("codex")).resolves.toMatchObject({
      connectionId: "second",
    });
    await expect(getProviderCredentials("codex")).resolves.toMatchObject({
      connectionId: "second",
    });

    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    persistence.resolve();
  });

  it("serializes pending round-robin writes for the same connection", async () => {
    const connections = [
      { ...activeConnection("codex"), id: "first", lastUsedAt: "2026-01-01T00:00:00.000Z", consecutiveUseCount: 0 },
    ];
    const firstWrite = deferred();
    const secondWrite = deferred();
    mocks.getProviderConnections.mockResolvedValue(connections);
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 });
    mocks.updateProviderConnection
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);

    const { getProviderCredentials } =
      await import("../../src/sse/services/provider-credentials.js");
    await getProviderCredentials("codex");
    await getProviderCredentials("codex");

    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    firstWrite.resolve();
    await vi.waitFor(() => expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(2));
    secondWrite.resolve();
  });

  it("serializes xai and grok-cli because they share the Grok CLI credential pool", async () => {
    const initialConnections = deferred();
    mocks.getProviderConnections.mockImplementation(() => initialConnections.promise);

    const { getProviderCredentials } =
      await import("../../src/sse/services/provider-credentials.js");
    const xaiRequest = getProviderCredentials("xai");

    await vi.waitFor(() => {
      expect(mocks.getProviderConnections).toHaveBeenCalledTimes(2);
    });

    const grokCliRequest = getProviderCredentials("grok-cli");
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.getProviderConnections).toHaveBeenCalledTimes(2);

    initialConnections.resolve([activeConnection("grok-cli")]);

    await expect(xaiRequest).resolves.toMatchObject({
      connectionId: "grok-cli-connection",
    });
    await expect(grokCliRequest).resolves.toMatchObject({
      connectionId: "grok-cli-connection",
    });
    expect(mocks.getProviderConnections).toHaveBeenCalledTimes(3);
  });
});