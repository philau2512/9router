import { describe, expect, it } from "vitest";

import { buildAntigravityEmptyStopContinuation } from "../../open-sse/executors/antigravity.js";

describe("Antigravity empty STOP continuation", () => {
  it("appends a continue user turn while preserving the existing session and history", () => {
    const original = {
      request: {
        sessionId: "same-antigravity-session",
        contents: [{ role: "user", parts: [{ text: "initial task" }] }],
      },
    };

    const continuation = buildAntigravityEmptyStopContinuation(original);

    expect(continuation).not.toBe(original);
    expect(continuation.request).not.toBe(original.request);
    expect(continuation.request.sessionId).toBe("same-antigravity-session");
    expect(continuation.request.contents).toEqual([
      { role: "user", parts: [{ text: "initial task" }] },
      { role: "user", parts: [{ text: "continue" }] },
    ]);
    expect(original.request.contents).toHaveLength(1);
  });
});
