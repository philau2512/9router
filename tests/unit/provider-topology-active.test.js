/**
 * FE regression: usage topology edge glow across provider id / alias mismatches.
 *
 * Covers:
 *  - credential siblings: xai ↔ grok-cli
 *  - short aliases: kr↔kiro, cc↔claude, ag↔antigravity, gcli↔grok-cli
 *  - no false merge across unrelated providers (mimo-free vs xiaomi-mimo)
 */
import { describe, it, expect } from "vitest";
import {
  expandTopologyProviderIds,
  buildActiveProviderSet,
  buildProviderMatchSet,
  countActiveProviderGroups,
  isTopologyProviderActive,
  TOPOLOGY_PROVIDER_ALIASES,
} from "../../src/app/(dashboard)/dashboard/usage/components/topologyActiveMatch.js";
import { buildLayout } from "../../src/app/(dashboard)/dashboard/usage/components/topologyLayout.js";

describe("topologyActiveMatch — generic alias / sibling expand", () => {
  it.each([
    ["xai", "grok-cli"],
    ["grok-cli", "xai"],
    ["gcli", "grok-cli"],
    ["gb", "xai"],
    ["kr", "kiro"],
    ["kiro", "kr"],
    ["cc", "claude"],
    ["claude", "cc"],
    ["ag", "antigravity"],
    ["cx", "codex"],
    ["gc", "gemini-cli"],
    ["oc", "opencode"],
    ["ds", "deepseek"],
  ])("expands %s so it matches graph node %s", (from, to) => {
    const expanded = expandTopologyProviderIds(from);
    expect(expanded).toContain(from.toLowerCase());
    expect(expanded).toContain(to.toLowerCase());
    expect(isTopologyProviderActive(to, new Set([from.toLowerCase()]))).toBe(
      true,
    );
  });

  it("does not merge unrelated providers", () => {
    // mimo-free (free tier) must not light xiaomi-mimo / paid mimo
    const free = expandTopologyProviderIds("mimo-free");
    expect(free).toContain("mimo-free");
    expect(free).not.toContain("xiaomi-mimo");
    expect(free).not.toContain("mimo");

    const kiro = buildActiveProviderSet([{ provider: "kiro" }]);
    expect(isTopologyProviderActive("antigravity", kiro)).toBe(false);
    expect(isTopologyProviderActive("claude", kiro)).toBe(false);
  });

  it("buildActiveProviderSet maps stream alias onto connection id node", () => {
    // Real shape: pending may track short alias if request used alias prefix
    const active = buildActiveProviderSet([
      { provider: "kr", model: "claude-sonnet-4-5", account: "Kiro" },
    ]);
    expect(active.has("kr")).toBe(true);
    expect(active.has("kiro")).toBe(true);
  });

  it("countActiveProviderGroups does not inflate for alias expand", () => {
    const active = buildActiveProviderSet([{ provider: "cc" }]);
    expect(active.size).toBeGreaterThan(1);
    expect(countActiveProviderGroups(active)).toBe(1);

    const multi = buildActiveProviderSet([
      { provider: "xai" },
      { provider: "kiro" },
    ]);
    expect(countActiveProviderGroups(multi)).toBe(2);
  });

  it("buildProviderMatchSet expands last/error provider the same way", () => {
    expect(buildProviderMatchSet("ag").has("antigravity")).toBe(true);
    expect(buildProviderMatchSet("xai").has("grok-cli")).toBe(true);
  });

  it("unknown provider still exact-matches", () => {
    expect(expandTopologyProviderIds("my-custom-openai")).toEqual([
      "my-custom-openai",
    ]);
    expect(
      isTopologyProviderActive(
        "my-custom-openai",
        new Set(["my-custom-openai"]),
      ),
    ).toBe(true);
  });

  it("TOPOLOGY_PROVIDER_ALIASES is bidirectional within each group", () => {
    for (const [key, group] of Object.entries(TOPOLOGY_PROVIDER_ALIASES)) {
      expect(group).toContain(key);
      for (const member of group) {
        expect(TOPOLOGY_PROVIDER_ALIASES[member]).toEqual(group);
      }
    }
  });
});

describe("buildLayout active edge animation (multi-provider)", () => {
  it("animates grok-cli edge when active stream reports xai", () => {
    const providers = [
      { provider: "grok-cli", name: "Grok CLI (Grok Build)" },
      { provider: "kiro", name: "Kiro AI" },
      { provider: "antigravity", name: "Antigravity" },
    ];
    const activeSet = buildActiveProviderSet([{ provider: "xai" }]);
    const { nodes, edges } = buildLayout(
      providers,
      activeSet,
      new Set(),
      new Set(),
    );

    expect(nodes.find((n) => n.id === "provider-grok-cli")?.data.active).toBe(
      true,
    );
    expect(nodes.find((n) => n.id === "provider-kiro")?.data.active).toBe(
      false,
    );
    expect(edges.find((e) => e.id === "e-provider-grok-cli")?.animated).toBe(
      true,
    );
    expect(edges.find((e) => e.id === "e-provider-grok-cli")?.style?.stroke).toBe(
      "#22c55e",
    );
    expect(nodes.find((n) => n.id === "router")?.data.activeCount).toBe(1);
  });

  it("animates kiro edge when pending uses short alias kr", () => {
    const providers = [
      { provider: "kiro", name: "Kiro AI" },
      { provider: "claude", name: "Claude" },
    ];
    const activeSet = buildActiveProviderSet([{ provider: "kr" }]);
    const { nodes, edges } = buildLayout(
      providers,
      activeSet,
      new Set(),
      new Set(),
    );
    expect(nodes.find((n) => n.id === "provider-kiro")?.data.active).toBe(true);
    expect(edges.find((e) => e.id === "e-provider-kiro")?.animated).toBe(true);
    expect(nodes.find((n) => n.id === "provider-claude")?.data.active).toBe(
      false,
    );
  });

  it("animates claude edge when pending uses alias cc", () => {
    const providers = [{ provider: "claude", name: "Claude" }];
    const activeSet = buildActiveProviderSet([{ provider: "cc" }]);
    const { edges } = buildLayout(providers, activeSet, new Set(), new Set());
    expect(edges.find((e) => e.id === "e-provider-claude")?.animated).toBe(
      true,
    );
  });

  it("lights reverse direction: active grok-cli against xai node", () => {
    const providers = [{ provider: "xai", name: "xAI (Grok)" }];
    const activeSet = buildActiveProviderSet([{ provider: "grok-cli" }]);
    const { nodes, edges } = buildLayout(
      providers,
      activeSet,
      new Set(),
      new Set(),
    );
    expect(nodes.find((n) => n.id === "provider-xai")?.data.active).toBe(true);
    expect(edges.find((e) => e.id === "e-provider-xai")?.animated).toBe(true);
  });

  it("exact match still works for non-sibling providers", () => {
    const providers = [
      { provider: "kiro", name: "Kiro AI" },
      { provider: "antigravity", name: "Antigravity" },
    ];
    const activeSet = buildActiveProviderSet([{ provider: "kiro" }]);
    const { nodes, edges } = buildLayout(
      providers,
      activeSet,
      new Set(),
      new Set(),
    );
    expect(nodes.find((n) => n.id === "provider-kiro")?.data.active).toBe(true);
    expect(edges.find((e) => e.id === "e-provider-kiro")?.animated).toBe(true);
    expect(
      nodes.find((n) => n.id === "provider-antigravity")?.data.active,
    ).toBe(false);
  });
});