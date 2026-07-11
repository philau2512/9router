/**
 * Unit tests for extractActiveFromPending helper.
 *
 * Covers: auth providers (byAccount), noAuth providers (byModel),
 * mixed scenarios, deduplication, and zero-count filtering.
 */

import { describe, it, expect } from "vitest";
import { extractActiveFromPending } from "../usage-helpers.js";

describe("extractActiveFromPending", () => {
  it("returns empty array when no pending requests", () => {
    const result = extractActiveFromPending({ byAccount: {}, byModel: {} });
    expect(result).toEqual([]);
  });

  it("extracts auth provider requests from byAccount", () => {
    const pending = {
      byAccount: {
        "conn-123": { "claude-sonnet-4-5 (kiro)": 2 },
      },
      byModel: {},
    };
    const connectionMap = { "conn-123": "My Kiro Account" };
    const result = extractActiveFromPending(pending, connectionMap);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      model: "claude-sonnet-4-5",
      provider: "kiro",
      account: "My Kiro Account",
      count: 2,
    });
  });

  it("extracts noAuth provider requests from byModel (mimo-free)", () => {
    const pending = {
      byAccount: {},
      byModel: {
        "mimo-code-pro-max (mimo-free)": 1,
      },
    };
    const result = extractActiveFromPending(pending, {});

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      model: "mimo-code-pro-max",
      provider: "mimo-free",
      account: "(Free)",
      count: 1,
    });
  });

  it("does not duplicate provider already seen in byAccount when also in byModel", () => {
    // kiro is tracked in both byAccount AND byModel — byModel entry should be skipped
    const pending = {
      byAccount: {
        "conn-abc": { "claude-sonnet (kiro)": 1 },
      },
      byModel: {
        "claude-sonnet (kiro)": 1, // same provider, should be deduped
        "mimo-code-pro-max (mimo-free)": 1, // different provider, should appear
      },
    };
    const result = extractActiveFromPending(pending, {
      "conn-abc": "Kiro Account",
    });

    expect(result).toHaveLength(2);
    const providers = result.map((r) => r.provider);
    expect(providers).toContain("kiro");
    expect(providers).toContain("mimo-free");
    // kiro should only appear once
    expect(providers.filter((p) => p === "kiro")).toHaveLength(1);
  });

  it("filters out entries with count <= 0", () => {
    const pending = {
      byAccount: {
        "conn-xyz": { "gpt-4o (openai)": 0 },
      },
      byModel: {
        "mimo-code-pro-max (mimo-free)": 0,
      },
    };
    const result = extractActiveFromPending(pending, {});
    expect(result).toEqual([]);
  });

  it("uses fallback account name when connectionId not in connectionMap", () => {
    const pending = {
      byAccount: {
        abcdef1234567890: { "claude-opus (kiro)": 1 },
      },
      byModel: {},
    };
    const result = extractActiveFromPending(pending, {});
    expect(result[0].account).toBe("Account abcdef12...");
  });

  it("handles byModel keys without provider parentheses gracefully", () => {
    const pending = {
      byAccount: {},
      byModel: {
        "some-model-no-provider": 1, // no "(provider)" pattern — should be skipped
      },
    };
    const result = extractActiveFromPending(pending, {});
    expect(result).toEqual([]);
  });

  it("handles multiple noAuth providers simultaneously", () => {
    const pending = {
      byAccount: {},
      byModel: {
        "mimo-code-pro-max (mimo-free)": 2,
        "gpt-4o-mini (opencode)": 1,
      },
    };
    const result = extractActiveFromPending(pending, {});
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.provider === "mimo-free")?.count).toBe(2);
    expect(result.find((r) => r.provider === "opencode")?.count).toBe(1);
  });
});
