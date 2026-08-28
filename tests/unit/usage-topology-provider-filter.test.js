/**
 * Usage topology provider list must not surface removed/hidden providers
 * that still have stale local DB connections (e.g. iflow after UI delist).
 */
import { describe, it, expect } from "vitest";
import {
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";

// Mirror UsageStats.isLLMProvider — keep logic in sync with that file.
function isLLMProvider(id) {
  if (isOpenAICompatibleProvider(id) || isAnthropicCompatibleProvider(id)) {
    return true;
  }
  const p = AI_PROVIDERS[id];
  if (!p) return false;
  if (!p.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}

function filterTopologyProviders(connections) {
  const seen = new Set();
  return connections.filter((c) => {
    if (c.isActive === false) return false;
    if (!isLLMProvider(c.provider)) return false;
    if (seen.has(c.provider)) return false;
    seen.add(c.provider);
    return true;
  });
}

describe("usage topology hides delisted providers", () => {
  it("iflow is not in AI_PROVIDERS (UI removed) so isLLMProvider is false", () => {
    expect(AI_PROVIDERS.iflow).toBeUndefined();
    expect(isLLMProvider("iflow")).toBe(false);
  });

  it("stale iflow connection does not appear on topology list", () => {
    const connections = [
      {
        provider: "iflow",
        name: "840816789139",
        isActive: true,
      },
      {
        provider: "kiro",
        name: "Kiro Account",
        isActive: true,
      },
      {
        provider: "grok-cli",
        name: "Grok Build",
        isActive: true,
      },
    ];
    const listed = filterTopologyProviders(connections);
    expect(listed.map((c) => c.provider)).toEqual(["kiro", "grok-cli"]);
    expect(listed.some((c) => c.provider === "iflow")).toBe(false);
    expect(listed.some((c) => c.name === "840816789139")).toBe(false);
  });

  it("known LLM providers still pass", () => {
    expect(isLLMProvider("kiro")).toBe(true);
    expect(isLLMProvider("antigravity")).toBe(true);
    expect(isLLMProvider("opencode")).toBe(true);
  });

  it("supports enabled custom compatible providers and filters out disabled ones", () => {
    expect(isLLMProvider("openai-compatible-chat-leokun")).toBe(true);
    expect(isLLMProvider("anthropic-compatible-chat-custom")).toBe(true);

    const connections = [
      {
        provider: "openai-compatible-chat-leokun",
        name: "leokun",
        isActive: true,
      },
      {
        provider: "openai-compatible-chat-vmware",
        name: "Vmware",
        isActive: false,
      },
      {
        provider: "openai-compatible-chat-kirogo",
        name: "KiroGo",
        isActive: false,
      },
    ];
    const listed = filterTopologyProviders(connections);
    expect(listed.map((c) => c.name)).toEqual(["leokun"]);
    expect(listed.some((c) => c.name === "Vmware")).toBe(false);
    expect(listed.some((c) => c.name === "KiroGo")).toBe(false);
  });
});