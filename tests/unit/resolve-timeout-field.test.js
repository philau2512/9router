import { describe, it, expect } from "vitest";
import {
  resolveTimeoutField,
  CONNECTION_TIMEOUT_MAX_MS,
  STALL_TIMEOUT_MAX_MS,
} from "@/lib/providerNormalization.js";

// resolveTimeoutField encodes the three-state contract for the compatible-provider
// timeout knobs: undefined = keep existing, null = clear, number = clamp+set.
describe("resolveTimeoutField", () => {
  it("returns undefined when the field is absent from the body (keep existing)", () => {
    expect(resolveTimeoutField(undefined, CONNECTION_TIMEOUT_MAX_MS)).toBe(
      undefined,
    );
  });

  it("returns null for empty string and explicit null (clear)", () => {
    expect(resolveTimeoutField(null, CONNECTION_TIMEOUT_MAX_MS)).toBe(null);
    expect(resolveTimeoutField("", CONNECTION_TIMEOUT_MAX_MS)).toBe(null);
  });

  it("treats garbage (NaN, <=0, non-number) as clear (null)", () => {
    expect(resolveTimeoutField("abc", CONNECTION_TIMEOUT_MAX_MS)).toBe(null);
    expect(resolveTimeoutField(0, CONNECTION_TIMEOUT_MAX_MS)).toBe(null);
    expect(resolveTimeoutField(-5, CONNECTION_TIMEOUT_MAX_MS)).toBe(null);
    expect(resolveTimeoutField(NaN, CONNECTION_TIMEOUT_MAX_MS)).toBe(null);
  });

  it("keeps a valid number below the cap unchanged", () => {
    expect(resolveTimeoutField(5000, CONNECTION_TIMEOUT_MAX_MS)).toBe(5000);
    expect(resolveTimeoutField("30000", STALL_TIMEOUT_MAX_MS)).toBe(30000);
  });

  it("clamps values above the cap down to the max", () => {
    expect(resolveTimeoutField(999999999, CONNECTION_TIMEOUT_MAX_MS)).toBe(
      CONNECTION_TIMEOUT_MAX_MS,
    );
    expect(resolveTimeoutField(999999999, STALL_TIMEOUT_MAX_MS)).toBe(
      STALL_TIMEOUT_MAX_MS,
    );
  });

  it("exposes the agreed caps (120s connect / 10min stall)", () => {
    expect(CONNECTION_TIMEOUT_MAX_MS).toBe(120000);
    expect(STALL_TIMEOUT_MAX_MS).toBe(600000);
  });
});
