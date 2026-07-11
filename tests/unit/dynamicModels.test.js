import { describe, it, expect, vi } from "vitest";
import {
  fetchWithFallback,
  credentialCacheKey,
} from "../../open-sse/services/dynamicModels.js";

describe("fetchWithFallback", () => {
  it("returns the fetcher value and caches it", async () => {
    const cache = new Map();
    const fetcher = vi.fn(async () => ({ models: [{ id: "a" }] }));
    const first = await fetchWithFallback({ cache, key: "k", fetcher });
    expect(first.models[0].id).toBe("a");
    // Second call within TTL must hit cache (fetcher not called again).
    const second = await fetchWithFallback({ cache, key: "k", fetcher });
    expect(second.models[0].id).toBe("a");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns null when the fetcher throws (fallback to hardcoded)", async () => {
    const cache = new Map();
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await fetchWithFallback({ cache, key: "k", fetcher });
    expect(result).toBeNull();
  });

  it("returns null when the fetcher yields null (no cache poisoning)", async () => {
    const cache = new Map();
    const fetcher = vi.fn(async () => null);
    const result = await fetchWithFallback({ cache, key: "k", fetcher });
    expect(result).toBeNull();
    expect(cache.has("k")).toBe(false);
  });

  it("bypasses cache with forceRefresh", async () => {
    const cache = new Map();
    const fetcher = vi.fn(async () => ({ models: [] , v: Math.random() }));
    await fetchWithFallback({ cache, key: "k", fetcher });
    await fetchWithFallback({ cache, key: "k", fetcher, forceRefresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("credentialCacheKey", () => {
  it("discriminates by connectionId", () => {
    const a = credentialCacheKey("codex", { connectionId: "c1" });
    const b = credentialCacheKey("codex", { connectionId: "c2" });
    expect(a).not.toBe(b);
  });
  it("never returns a bare provider key without a discriminator", () => {
    const k = credentialCacheKey("codex", { accessToken: "xxxxxxxxxxxxxxxxyyyy" });
    expect(k.startsWith("codex:")).toBe(true);
    expect(k).not.toBe("codex:");
  });
});
