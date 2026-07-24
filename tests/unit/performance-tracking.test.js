/**
 * Performance tracking test - verify timing metrics structure
 */

import { describe, it, expect, vi } from "vitest";
import { deduplicateRecentRequests } from "@/lib/db/repos/usage/usage-helpers.js";
import {
  buildStreamPerformance,
  createSSETransformStreamWithLogger,
  isNonEmptyVisibleText,
} from "../../open-sse/utils/stream.js";

describe("Performance tracking", () => {
  it("should parse performance from DB rows", () => {
    const mockRows = [
      {
        timestamp: "2024-01-01T00:00:00Z",
        model: "gpt-4",
        provider: "openai",
        tokens: JSON.stringify({
          prompt_tokens: 100,
          completion_tokens: 50,
        }),
        cost: 0.05,
        performance: JSON.stringify({
          firstTokenMs: 234,
          tokensPerSecond: 125.5,
        }),
      },
    ];

    const result = deduplicateRecentRequests(mockRows, 20);

    expect(result).toHaveLength(1);
    expect(result[0].performance).toBeTruthy();
    expect(result[0].performance.firstTokenMs).toBe(234);
    expect(result[0].performance.tokensPerSecond).toBe(125.5);
  });

  it("should handle missing performance data gracefully", () => {
    const mockRows = [
      {
        timestamp: "2024-01-01T00:00:00Z",
        model: "gpt-4",
        provider: "openai",
        tokens: JSON.stringify({
          prompt_tokens: 100,
          completion_tokens: 50,
        }),
        cost: 0.05,
        performance: null,
      },
    ];

    const result = deduplicateRecentRequests(mockRows, 20);

    expect(result).toHaveLength(1);
    expect(result[0].performance).toBeNull();
  });

  it("should handle performance as pre-parsed object", () => {
    const mockRows = [
      {
        timestamp: "2024-01-01T00:00:00Z",
        model: "gpt-4",
        provider: "openai",
        tokens: {
          prompt_tokens: 100,
          completion_tokens: 50,
        },
        cost: 0.05,
        performance: {
          firstTokenMs: 456,
          tokensPerSecond: 89.3,
        },
      },
    ];

    const result = deduplicateRecentRequests(mockRows, 20);

    expect(result).toHaveLength(1);
    expect(result[0].performance).toBeTruthy();
    expect(result[0].performance.firstTokenMs).toBe(456);
    expect(result[0].performance.tokensPerSecond).toBe(89.3);
  });

  it("should validate performance metrics structure", () => {
    const validPerformance = {
      firstTokenMs: 234,
      tokensPerSecond: 125.5,
    };

    expect(validPerformance.firstTokenMs).toBeTypeOf("number");
    expect(validPerformance.tokensPerSecond).toBeTypeOf("number");
    expect(validPerformance.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(validPerformance.tokensPerSecond).toBeGreaterThan(0);
    expect(Number.isFinite(validPerformance.firstTokenMs)).toBe(true);
    expect(Number.isFinite(validPerformance.tokensPerSecond)).toBe(true);
  });

  it("should handle malformed performance JSON", () => {
    const mockRows = [
      {
        timestamp: "2024-01-01T00:00:00Z",
        model: "gpt-4",
        provider: "openai",
        tokens: JSON.stringify({
          prompt_tokens: 100,
          completion_tokens: 50,
        }),
        cost: 0.05,
        performance: "invalid json {",
      },
    ];

    const result = deduplicateRecentRequests(mockRows, 20);

    expect(result).toHaveLength(1);
    // Should fallback to null on parse error
    expect(result[0].performance).toBeNull();
  });

  it("should preserve performance through deduplication", () => {
    const mockRows = [
      {
        timestamp: "2024-01-01T00:00:00Z",
        model: "gpt-4",
        provider: "openai",
        tokens: JSON.stringify({
          prompt_tokens: 100,
          completion_tokens: 50,
        }),
        cost: 0.05,
        performance: JSON.stringify({
          firstTokenMs: 234,
          tokensPerSecond: 125.5,
        }),
      },
      {
        timestamp: "2024-01-01T00:00:00Z", // Same timestamp
        model: "gpt-4",
        provider: "openai",
        tokens: JSON.stringify({
          prompt_tokens: 100,
          completion_tokens: 50,
        }),
        cost: 0.05,
        performance: JSON.stringify({
          firstTokenMs: 456, // Different but should be deduped
          tokensPerSecond: 99.9,
        }),
      },
    ];

    const result = deduplicateRecentRequests(mockRows, 20);

    // Should deduplicate to 1 entry
    expect(result).toHaveLength(1);
    expect(result[0].performance).toBeTruthy();
  });

  it("should calculate realistic TPS values", () => {
    // Test realistic TPS calculation scenarios
    const scenarios = [
      { tokens: 50, durationMs: 1000, expectedTPS: 50 },
      { tokens: 100, durationMs: 500, expectedTPS: 200 },
      { tokens: 25, durationMs: 250, expectedTPS: 100 },
      { tokens: 200, durationMs: 2000, expectedTPS: 100 },
    ];

    scenarios.forEach(({ tokens, durationMs, expectedTPS }) => {
      const calculatedTPS = tokens / (durationMs / 1000);
      expect(calculatedTPS).toBe(expectedTPS);
    });
  });

  it("should format performance for UI display", () => {
    const performance = {
      firstTokenMs: 234,
      tokensPerSecond: 125.567,
    };

    // Test formatting logic (similar to UsageStats.js)
    const roundedTPS = Math.round(performance.tokensPerSecond);
    const formatDuration = (ms) => {
      if (ms < 1000) return `${Math.round(ms)}ms`;
      return `${(ms / 1000).toFixed(1)}s`;
    };

    expect(roundedTPS).toBe(126);
    expect(formatDuration(234)).toBe("234ms");
    expect(formatDuration(1234)).toBe("1.2s");
  });

  it("anchors TTFT to request entry, not transform create time", () => {
    // Bug: measuring from transform create after upstream headers → ~8ms TTFT
    const requestStartTime = 1_000_000;
    const firstTokenTime = 1_004_500; // 4.5s later — real provider wait
    const endTime = 1_005_500; // +1s generation (captured at flush, not setImmediate)
    const performance = buildStreamPerformance({
      requestStartTime,
      firstTokenTime,
      endTime,
      outTokens: 20,
    });

    expect(performance.firstTokenMs).toBe(4500);
    expect(performance.tokensPerSecond).toBe(20); // 20 tokens / 1s gen window
    expect(performance.durationMs).toBe(5500);
  });

  it("returns null when first token or out tokens missing", () => {
    expect(
      buildStreamPerformance({
        requestStartTime: 1,
        firstTokenTime: null,
        endTime: 100,
        outTokens: 10,
      }),
    ).toBeNull();
    expect(
      buildStreamPerformance({
        requestStartTime: 1,
        firstTokenTime: 50,
        endTime: 100,
        outTokens: 0,
      }),
    ).toBeNull();
  });

  it("records first visible text from Codex Responses deltas", async () => {
    const complete = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: response.output_text.delta\ndata: ${JSON.stringify({
              type: "response.output_text.delta",
              delta: "Hello",
            })}\n\n`,
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            `event: response.completed\ndata: ${JSON.stringify({
              type: "response.completed",
              response: {
                usage: { input_tokens: 10, output_tokens: 5 },
              },
            })}\n\n`,
          ),
        );
        controller.close();
      },
    });

    const output = stream.pipeThrough(
      createSSETransformStreamWithLogger(
        "openai-responses",
        "openai-responses",
        "codex",
        null,
        null,
        "gpt-5.6-terra",
        "codex-connection",
        {},
        complete,
        null,
        null,
        500,
      ),
    );
    const reader = output.getReader();
    while (!(await reader.read()).done) {}
    await new Promise((resolve) => setImmediate(resolve));

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Hello" }),
      expect.any(Object),
      expect.any(Number),
      expect.objectContaining({
        firstTokenMs: expect.any(Number),
        tokensPerSecond: expect.any(Number),
      }),
    );
  });

  it("treats only non-empty visible text as first-text TTFT candidates", () => {
    expect(isNonEmptyVisibleText("hello")).toBe(true);
    expect(isNonEmptyVisibleText("  ok  ")).toBe(true);
    expect(isNonEmptyVisibleText("")).toBe(false);
    expect(isNonEmptyVisibleText("   ")).toBe(false);
    expect(isNonEmptyVisibleText(null)).toBe(false);
    expect(isNonEmptyVisibleText(undefined)).toBe(false);
    expect(isNonEmptyVisibleText(0)).toBe(false);
  });

  it("uses flush endAt not a later deferred clock for gen t/s", () => {
    // setImmediate delay must not inflate generate window
    const performance = buildStreamPerformance({
      requestStartTime: 1000,
      firstTokenTime: 2000,
      endTime: 2500, // flush-time endAt
      outTokens: 10,
    });
    expect(performance.tokensPerSecond).toBe(20); // 10 / 0.5s
    expect(performance.durationMs).toBe(1500);
  });
});