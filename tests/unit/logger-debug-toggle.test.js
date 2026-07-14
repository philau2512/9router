import { describe, it, expect, afterEach, vi } from "vitest";

// Verify the runtime debug toggle flips the logger's effective level and that
// debug() output is gated accordingly. ENV_LEVEL is captured at module load,
// so we reset modules between cases to exercise a clean baseline.
afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
  delete process.env.NINE_ROUTER_LOG_LEVEL;
});

describe("logger runtime debug toggle", () => {
  it("isDebugLevel() reflects setDebugEnabled state", async () => {
    const log = await import("../../src/sse/utils/logger.js");
    // Default env is INFO → debug off
    expect(log.isDebugLevel()).toBe(false);

    log.setDebugEnabled(true);
    expect(log.isDebugLevel()).toBe(true);

    log.setDebugEnabled(false);
    expect(log.isDebugLevel()).toBe(false);
  });

  it("debug() emits only when enabled", async () => {
    const log = await import("../../src/sse/utils/logger.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    log.debug("TEST", "should not appear");
    expect(spy).not.toHaveBeenCalled();

    log.setDebugEnabled(true);
    log.debug("TEST", "should appear");
    expect(spy).toHaveBeenCalledTimes(1);

    log.setDebugEnabled(false);
    log.debug("TEST", "gone again");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("restores ENV_LEVEL (DEBUG) when toggled off", async () => {
    process.env.LOG_LEVEL = "DEBUG";
    vi.resetModules();
    const log = await import("../../src/sse/utils/logger.js");
    // Env baseline is DEBUG, so toggling off must NOT silence debug.
    expect(log.isDebugLevel()).toBe(true);

    log.setDebugEnabled(true);
    expect(log.isDebugLevel()).toBe(true);

    log.setDebugEnabled(false);
    // Restores to ENV_LEVEL (DEBUG), not a hardcoded INFO.
    expect(log.isDebugLevel()).toBe(true);
  });
});
