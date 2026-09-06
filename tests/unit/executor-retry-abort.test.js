import { describe, expect, it, vi } from "vitest";
import { throwIfAborted, waitForAbortableDelay } from "../../open-sse/executors/base.js";

describe("executor abortable retry delay", () => {
  it("rejects immediately when the request is aborted during a retry delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const delay = waitForAbortableDelay(10_000, controller.signal);

    controller.abort();
    await expect(delay).rejects.toMatchObject({ name: "AbortError" });
    vi.useRealTimers();
  });

  it("throws an AbortError before starting an aborted retry", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => throwIfAborted(controller.signal)).toThrow(/aborted/i);
  });
});
