/**
 * Endpoint-aware profileArn resolution.
 *
 * Empirically verified against a real Builder ID account (generateAssistantResponse):
 *   endpoint                              omit          AAAACCCCXXXX
 *   runtime.us-east-1.kiro.dev            400           200 OK
 *   codewhisperer.us-east-1.amazonaws     200 OK        403
 *   q.us-east-1.amazonaws                 200 OK        403
 */
import { describe, it, expect } from "vitest";
import {
  resolveKiroRequestProfileArn,
  isKiroDevEndpoint,
  KIRO_DEFAULT_PROFILE_ARNS,
} from "../../open-sse/config/kiroConstants.js";

const KIRO_DEV = "https://runtime.us-east-1.kiro.dev/generateAssistantResponse";
const CW =
  "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse";
const Q = "https://q.us-east-1.amazonaws.com/generateAssistantResponse";
const SHARED_BUILDER = KIRO_DEFAULT_PROFILE_ARNS["builder-id"];
const SHARED_SOCIAL = KIRO_DEFAULT_PROFILE_ARNS.social;

function cred(psd) {
  return { providerSpecificData: psd };
}

describe("isKiroDevEndpoint", () => {
  it("detects kiro.dev hosts", () => {
    expect(isKiroDevEndpoint(KIRO_DEV)).toBe(true);
    expect(isKiroDevEndpoint(CW)).toBe(false);
    expect(isKiroDevEndpoint(Q)).toBe(false);
    expect(isKiroDevEndpoint(undefined)).toBe(false);
  });
});

describe("resolveKiroRequestProfileArn — builder-id (free tier, no own profile)", () => {
  it("sends the shared builder ARN on the kiro.dev surface", () => {
    const c = cred({ authMethod: "builder-id", profileArn: null });
    expect(resolveKiroRequestProfileArn(c, { endpoint: KIRO_DEV })).toBe(
      SHARED_BUILDER,
    );
  });

  it("OMITS the ARN on the amazonaws surfaces", () => {
    const c = cred({ authMethod: "builder-id", profileArn: null });
    expect(resolveKiroRequestProfileArn(c, { endpoint: CW })).toBe("");
    expect(resolveKiroRequestProfileArn(c, { endpoint: Q })).toBe("");
  });

  it("never lets the shared placeholder count as an account-specific ARN", () => {
    // Even if the shared ARN somehow got persisted, it must NOT be treated as
    // the account's own — endpoint rules still apply.
    const c = cred({ authMethod: "builder-id", profileArn: SHARED_BUILDER });
    expect(resolveKiroRequestProfileArn(c, { endpoint: CW })).toBe("");
    expect(resolveKiroRequestProfileArn(c, { endpoint: KIRO_DEV })).toBe(
      SHARED_BUILDER,
    );
  });
});

describe("resolveKiroRequestProfileArn — account-bound / social", () => {
  it("account-specific ARN always wins regardless of endpoint", () => {
    const own = "arn:aws:codewhisperer:us-east-1:444455556666:profile/OWN";
    const c = cred({ authMethod: "idc", profileArn: own });
    expect(resolveKiroRequestProfileArn(c, { endpoint: KIRO_DEV })).toBe(own);
    expect(resolveKiroRequestProfileArn(c, { endpoint: CW })).toBe(own);
  });

  it("social falls back to the shared social profile when no ARN stored", () => {
    const c = cred({ authMethod: "google", profileArn: null });
    expect(resolveKiroRequestProfileArn(c, { endpoint: CW })).toBe(
      SHARED_SOCIAL,
    );
    expect(resolveKiroRequestProfileArn(c, { endpoint: KIRO_DEV })).toBe(
      SHARED_SOCIAL,
    );
  });
});
