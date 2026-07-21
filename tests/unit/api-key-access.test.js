import { describe, expect, it } from "vitest";
import {
  assertApiKeyAccess,
  assertApiKeyAccessBatch,
  isApiKeyAccessUnrestricted,
} from "@/sse/services/api-key-access.js";

const target = (provider, model) => ({ provider, model });

describe("API key access allowlist", () => {
  it("keeps existing keys unrestricted when lists are absent or empty", () => {
    expect(isApiKeyAccessUnrestricted({})).toBe(true);
    expect(isApiKeyAccessUnrestricted({ allowedProviders: [], allowedModels: [] })).toBe(true);
    expect(assertApiKeyAccess({}, target("openai", "gpt-4o"))).toEqual({ ok: true });
  });

  it("allows every model of an allowed provider", () => {
    const key = { allowedProviders: ["claude"], allowedModels: [] };

    expect(assertApiKeyAccess(key, target("claude", "sonnet"))).toEqual({ ok: true });
    expect(assertApiKeyAccess(key, target("openai", "gpt-4o"))).toMatchObject({
      ok: false,
      code: "provider_not_allowed",
    });
  });

  it("allows only explicitly listed canonical models", () => {
    const key = { allowedProviders: [], allowedModels: ["openai/gpt-4o"] };

    expect(assertApiKeyAccess(key, target("openai", "gpt-4o"))).toEqual({ ok: true });
    expect(assertApiKeyAccess(key, target("openai", "gpt-4.1"))).toMatchObject({
      ok: false,
      code: "model_not_allowed",
    });
  });

  it("uses OR semantics when both allowlists are present", () => {
    const key = {
      allowedProviders: ["claude"],
      allowedModels: ["openai/gpt-4o"],
    };

    expect(assertApiKeyAccess(key, target("claude", "sonnet"))).toEqual({ ok: true });
    expect(assertApiKeyAccess(key, target("openai", "gpt-4o"))).toEqual({ ok: true });
    expect(assertApiKeyAccess(key, target("openai", "gpt-4.1"))).toMatchObject({
      ok: false,
      code: "access_not_allowed",
    });
  });

  it("rejects a combo when any resolved member is not allowed", () => {
    const key = { allowedProviders: ["claude"], allowedModels: [] };

    expect(
      assertApiKeyAccessBatch(key, [
        target("claude", "sonnet"),
        target("openai", "gpt-4o"),
      ]),
    ).toMatchObject({ ok: false, code: "provider_not_allowed" });
  });
});