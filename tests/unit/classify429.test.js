import { describe, it, expect } from "vitest";
import {
  parseRetryAfter,
  parseDurationText,
  SOFT_RATE_LIMIT_THRESHOLD_MS,
  SOFT_RETRY_WAIT_CAP_MS,
  MAX_SOFT_RETRY,
} from "../../open-sse/config/errorConfig.js";
import {
  classify429,
  decideSoftRetry,
} from "../../open-sse/services/accountFallback.js";

describe("parseDurationText", () => {
  it("parses ms tokens", () => {
    expect(parseDurationText("quota will reset after 479ms")).toBe(479);
  });
  it("parses h/m/s compound durations", () => {
    expect(parseDurationText("reset after 1h43m56s")).toBe(
      ((1 * 60 + 43) * 60 + 56) * 1000,
    );
  });
  it("parses plain seconds", () => {
    expect(parseDurationText("try again in 3s")).toBe(3000);
  });
  it("returns null when no duration token", () => {
    expect(parseDurationText("rate limited")).toBeNull();
  });
});

describe("parseRetryAfter", () => {
  it("prefers absolute resetsAtMs", () => {
    const ms = parseRetryAfter({ resetsAtMs: Date.now() + 2000 });
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThanOrEqual(2000);
  });
  it("reads Retry-After header in seconds", () => {
    const ms = parseRetryAfter({ headers: { "Retry-After": "4" } });
    expect(ms).toBe(4000);
  });
  it("reads body quotaResetDelay (ms)", () => {
    expect(parseRetryAfter({ body: { quotaResetDelay: 1500 } })).toBe(1500);
  });
  it("falls back to message duration text", () => {
    expect(parseRetryAfter({ message: "quota will reset after 2s" })).toBe(
      2000,
    );
  });
});

describe("classify429", () => {
  it("classifies RESOURCE_EXHAUSTED as quotaExhausted", () => {
    const r = classify429(429, {
      message: "error: RESOURCE_EXHAUSTED QUOTA_EXHAUSTED",
    });
    expect(r.kind).toBe("quotaExhausted");
  });
  it("classifies xAI free-usage-exhausted as quotaExhausted", () => {
    const r = classify429(429, {
      message: "subscription:free-usage-exhausted",
    });
    expect(r.kind).toBe("quotaExhausted");
  });
  it("classifies a short reset window as softRateLimit", () => {
    const r = classify429(429, { body: { quotaResetDelay: "479ms" } });
    expect(r.kind).toBe("softRateLimit");
    expect(r.retryAfterMs).toBeLessThanOrEqual(SOFT_RATE_LIMIT_THRESHOLD_MS);
  });
  it("classifies a long reset window as rateLimited (no same-auth retry)", () => {
    const r = classify429(429, { message: "quota will reset after 3h" });
    expect(r.kind).toBe("rateLimited");
  });
  it("classifies an unknown 429 as rateLimited", () => {
    const r = classify429(429, { message: "too many requests" });
    expect(r.kind).toBe("rateLimited");
  });
});

describe("decideSoftRetry", () => {
  it("retries same auth for soft rate limit, capping the wait", () => {
    const d = decideSoftRetry(429, { body: { quotaResetDelay: "4s" } }, 0);
    expect(d.action).toBe("retry-same-auth");
    expect(d.waitMs).toBeLessThanOrEqual(SOFT_RETRY_WAIT_CAP_MS);
  });
  it("stops retrying after MAX_SOFT_RETRY", () => {
    const d = decideSoftRetry(
      429,
      { body: { quotaResetDelay: "400ms" } },
      MAX_SOFT_RETRY,
    );
    expect(d.action).toBe("fallback");
  });
  it("never retries quota-exhausted", () => {
    const d = decideSoftRetry(429, { message: "RESOURCE_EXHAUSTED" }, 0);
    expect(d.action).toBe("fallback");
  });
  it("never retries non-429", () => {
    const d = decideSoftRetry(500, { message: "server error" }, 0);
    expect(d.action).toBe("fallback");
  });
});
