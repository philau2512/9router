import { describe, it, expect } from "vitest";
import {
  parseGrokCliBilling,
  parsePlainGrokBilling,
  buildMergedGrokQuotas,
} from "../../open-sse/services/usage/grok-cli.js";

// Real depleted plain-shape payload (from the /v1/billing response the user
// captured): monthlyLimit/used/onDemandCap all 0, monthly billing period.
const plainDepleted = {
  config: {
    monthlyLimit: { val: 0 },
    used: { val: 0 },
    onDemandCap: { val: 0 },
    billingPeriodStart: "2026-07-01T00:00:00+00:00",
    billingPeriodEnd: "2026-08-01T00:00:00+00:00",
    history: [
      { billingCycle: { year: 2026, month: 6 }, totalUsed: { val: 0 } },
    ],
  },
};

describe("parseGrokCliBilling — plain /v1/billing shape", () => {
  it("renders Monthly credits even when depleted ($0/$0) instead of hiding the table", () => {
    const parsed = parseGrokCliBilling(plainDepleted);
    expect(parsed.quotas).toBeTruthy();
    expect(Object.keys(parsed.quotas).length).toBeGreaterThan(0);
    expect(parsed.quotas["Monthly credits"]).toBeTruthy();
    // Depleted monthly bar resets at the billing period end.
    expect(parsed.quotas["Monthly credits"].resetAt).toContain("2026-08-01");
  });

  it("reports Pay-as-you-go Disabled when onDemandCap is 0", () => {
    const parsed = parseGrokCliBilling(plainDepleted);
    expect(parsed.payAsYouGo).toBe("Disabled");
  });

  it("reports Pay-as-you-go Enabled and a Monthly bar when there is a cap/limit", () => {
    const parsed = parsePlainGrokBilling({
      monthlyLimit: { val: 100 },
      used: { val: 40 },
      onDemandCap: { val: 50 },
      billingPeriodEnd: "2026-08-01T00:00:00+00:00",
    });
    expect(parsed.payAsYouGo).toBe("Enabled");
    const monthly = parsed.quotas["Monthly credits"];
    expect(monthly.total).toBe(100);
    expect(monthly.used).toBe(40);
    expect(monthly.remainingPercentage).toBeCloseTo(60);
  });

  it("adds a Weekly limit row when currentPeriod is present", () => {
    const parsed = parsePlainGrokBilling({
      monthlyLimit: { val: 0 },
      used: { val: 0 },
      onDemandCap: { val: 0 },
      billingPeriodEnd: "2026-08-01T00:00:00+00:00",
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        end: "2026-07-12T13:33:00+00:00",
      },
    });
    expect(parsed.quotas["Weekly limit"]).toBeTruthy();
    expect(parsed.quotas["Weekly limit"].resetAt).toContain("2026-07-12");
  });
});

describe("parseGrokCliBilling — credits shape (regression)", () => {
  it("still parses the ?format=credits shape (On-demand bar)", () => {
    const parsed = parseGrokCliBilling({
      config: {
        onDemandCap: { val: 20 },
        onDemandUsed: { val: 5 },
        billingPeriodEnd: "2026-08-01T00:00:00+00:00",
      },
    });
    expect(parsed.quotas["On-demand"]).toBeTruthy();
    expect(parsed.quotas["On-demand"].total).toBe(20);
    // Plain-shape-only field must NOT appear on the credits branch.
    expect(parsed.quotas["Monthly credits"]).toBeUndefined();
  });
});

describe("buildMergedGrokQuotas — two-endpoint parity with CLIProxyAPI", () => {
  // Real captured payloads (miller_sandraj account).
  const credits = {
    config: {
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-07-11T09:58:19.527397+00:00",
        end: "2026-07-18T09:58:19.527397+00:00",
      },
      creditUsagePercent: 59.0,
      onDemandCap: { val: 0 },
      onDemandUsed: { val: 0 },
      productUsage: [{ product: "Api", usagePercent: 59.0 }],
      isUnifiedBillingUser: true,
      prepaidBalance: { val: 0 },
    },
  };
  const plain = {
    config: {
      monthlyLimit: { val: 4000 },
      used: { val: 353 },
      onDemandCap: { val: 0 },
      billingPeriodStart: "2026-07-01T00:00:00+00:00",
      billingPeriodEnd: "2026-08-01T00:00:00+00:00",
      history: [],
    },
  };

  it("produces Weekly limit + Api usage + Monthly credits with correct percentages", () => {
    const m = buildMergedGrokQuotas(credits, plain, null);
    // Weekly limit: 59% used → 41% remaining, resets 07/18.
    expect(m.quotas["Weekly limit"].used).toBe(59);
    expect(Math.round(m.quotas["Weekly limit"].remainingPercentage)).toBe(41);
    expect(m.quotas["Weekly limit"].resetAt).toContain("2026-07-18");
    // Api usage: 59% used.
    expect(m.quotas["Api usage"].used).toBe(59);
    // Monthly credits: 353/4000 → 91% remaining, resets 08/01.
    expect(m.quotas["Monthly credits"].total).toBe(4000);
    expect(m.quotas["Monthly credits"].used).toBe(353);
    expect(Math.round(m.quotas["Monthly credits"].remainingPercentage)).toBe(
      91,
    );
    expect(m.quotas["Monthly credits"].resetAt).toContain("2026-08-01");
    expect(m.payAsYouGo).toBe("Disabled");
  });

  it("fails open: only credits shape available → still shows weekly/api", () => {
    const m = buildMergedGrokQuotas(credits, null, null);
    expect(m.quotas["Weekly limit"]).toBeTruthy();
    expect(m.quotas["Api usage"]).toBeTruthy();
    expect(m.quotas["Monthly credits"]).toBeUndefined();
  });

  it("fails open: only plain shape available → still shows monthly credits", () => {
    const m = buildMergedGrokQuotas(null, plain, null);
    expect(m.quotas["Monthly credits"]).toBeTruthy();
    expect(m.quotas["Weekly limit"]).toBeUndefined();
  });
});
