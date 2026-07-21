import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getApiKeyValidationInfo: vi.fn(),
  evaluateApiKeyLimitState: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => mocks);

const { requireValidApiKey } = await import(
  "@/sse/services/api-key-validation.js"
);

function request(apiKey = null) {
  return new Request("http://localhost/v1/chat/completions", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
}

describe("optional API-key policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.evaluateApiKeyLimitState.mockResolvedValue({
      enabled: false,
      exceeded: false,
    });
  });

  it("keeps local requests open when no key is supplied", async () => {
    const result = await requireValidApiKey(request());

    expect(result).toMatchObject({ ok: true, keyInfo: null });
    expect(mocks.getApiKeyValidationInfo).not.toHaveBeenCalled();
  });

  it("loads key policy and budget state when optional mode receives a valid key", async () => {
    const keyInfo = { id: "key-1", allowedProviders: ["claude"] };
    mocks.getApiKeyValidationInfo.mockResolvedValue({ valid: true, apiKey: keyInfo });

    const result = await requireValidApiKey(request("sk-local"));

    expect(result).toMatchObject({ ok: true, apiKey: "sk-local", keyInfo });
    expect(mocks.evaluateApiKeyLimitState).toHaveBeenCalledWith(keyInfo);
  });

  it("leaves an invalid supplied key unenforced in optional mode", async () => {
    mocks.getApiKeyValidationInfo.mockResolvedValue({
      valid: false,
      reason: "not_found",
      apiKey: null,
    });

    const result = await requireValidApiKey(request("invalid"));

    expect(result).toMatchObject({
      ok: true,
      apiKey: "invalid",
      keyInfo: null,
    });
  });
});