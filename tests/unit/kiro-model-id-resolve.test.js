/**
 * Offline guards for Kiro model-id shaping before generateAssistantResponse.
 * Live account catalog is separate (scripts/test-kiro-account.mjs).
 */
import { describe, expect, it } from "vitest";
import { resolveKiroModel } from "../../open-sse/config/kiroConstants.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

describe("kiro model id resolve", () => {
  it("strips -thinking / -agentic fictions before upstream", () => {
    expect(resolveKiroModel("claude-opus-4.8-thinking")).toEqual({
      upstream: "claude-opus-4.8",
      agentic: false,
      thinking: true,
    });
    expect(resolveKiroModel("claude-opus-4.8-agentic")).toEqual({
      upstream: "claude-opus-4.8",
      agentic: true,
      thinking: false,
    });
    expect(resolveKiroModel("claude-opus-4.8-thinking-agentic")).toEqual({
      upstream: "claude-opus-4.8",
      agentic: true,
      thinking: true,
    });
  });

  it("keeps dotted opus/sonnet ids as-is (no extra rewrite)", () => {
    expect(resolveKiroModel("claude-opus-4.8").upstream).toBe("claude-opus-4.8");
    expect(resolveKiroModel("claude-sonnet-4.5").upstream).toBe(
      "claude-sonnet-4.5",
    );
  });

  it("openai-to-kiro dash→dot normalization pattern matches Claude Code ids", () => {
    // Mirrors openai-to-kiro.js buildKiroPayload normalize
    const normalize = (model) =>
      model.replace(
        /^(claude-(?:opus|sonnet|haiku|3-\d+)-\d+)-(\d+)$/,
        "$1.$2",
      );
    expect(normalize("claude-sonnet-4-6")).toBe("claude-sonnet-4.6");
    expect(normalize("claude-opus-4-8")).toBe("claude-opus-4.8");
    // already dotted stays
    expect(normalize("claude-opus-4.8")).toBe("claude-opus-4.8");
  });

  it("static kr catalog has no upstreamModelId override for opus 4.8", () => {
    // If this ever gains an override, chatCore getModelUpstreamId must stay in sync
    // with resolveKiroModel strip logic.
    const up = getModelUpstreamId("kr", "claude-opus-4.8");
    expect(up === "claude-opus-4.8" || up === "claude-opus-4.8").toBe(true);
  });
});