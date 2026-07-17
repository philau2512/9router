/**
 * ModelSelectModal must hide:
 *  - delisted built-ins still in DB (iflow)
 *  - inactive connections (custom provider toggled off)
 */
import { describe, it, expect } from "vitest";
import {
  filterActiveProvidersForModelSelect,
  isSelectableProviderId,
} from "../../src/shared/utils/modelSelectActiveProviders.js";

describe("filterActiveProvidersForModelSelect", () => {
  it("hides delisted iflow even if connection is active", () => {
    expect(isSelectableProviderId("iflow")).toBe(false);
    const out = filterActiveProvidersForModelSelect([
      { provider: "iflow", isActive: true, id: "1" },
      { provider: "kiro", isActive: true, id: "2" },
    ]);
    expect(out.map((c) => c.provider)).toEqual(["kiro"]);
  });

  it("hides inactive custom compatible providers", () => {
    const customId = "openai-compatible-chat-abc";
    expect(isSelectableProviderId(customId)).toBe(true);
    const out = filterActiveProvidersForModelSelect([
      { provider: customId, isActive: false, id: "c1" },
      { provider: "grok-cli", isActive: true, id: "g1" },
    ]);
    expect(out.map((c) => c.provider)).toEqual(["grok-cli"]);
  });

  it("keeps active custom compatible providers", () => {
    const customId = "openai-compatible-chat-xyz";
    const out = filterActiveProvidersForModelSelect([
      { provider: customId, isActive: true, id: "c2" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].provider).toBe(customId);
  });

  it("treats missing isActive as active", () => {
    const out = filterActiveProvidersForModelSelect([
      { provider: "kiro", id: "k1" },
    ]);
    expect(out).toHaveLength(1);
  });
});