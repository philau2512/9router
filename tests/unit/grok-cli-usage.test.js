import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import {
  buildMergedGrokQuotas,
  parseGrokCliBilling,
} from "../../open-sse/services/usage/grok-cli.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CREDITS_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-08T00:00:00+00:00",
      end: "2026-07-15T00:00:00+00:00",
    },
    creditUsagePercent: 35,
    productUsage: [{ product: "Api", usagePercent: 35 }],
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    isUnifiedBillingUser: true,
  },
};

const PLAIN_BILLING = {
  config: {
    monthlyLimit: { val: 1000 },
    used: { val: 275 },
    onDemandCap: { val: 0 },
    billingPeriodStart: "2026-07-01T00:00:00+00:00",
    billingPeriodEnd: "2026-08-01T00:00:00+00:00",
  },
};

const FREE_CREDITS_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-08T00:00:00+00:00",
      end: "2026-07-15T00:00:00+00:00",
    },
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    isUnifiedBillingUser: true,
  },
};

const FREE_PLAIN_BILLING = {
  config: {
    monthlyLimit: { val: 0 },
    used: { val: 0 },
    onDemandCap: { val: 0 },
    billingPeriodStart: "2026-07-01T00:00:00+00:00",
    billingPeriodEnd: "2026-08-01T00:00:00+00:00",
  },
};

const USER_PROFILE = {
  userId: "d84768dd-224d-4052-ba49-0d336fa9160c",
  email: "user@example.com",
  hasGrokCodeAccess: true,
  subscriptionTier: null,
};

describe("grok-cli registry usage flag", () => {
  it("exposes transport.usage urls", () => {
    const cfg = PROVIDERS["grok-cli"];
    expect(cfg.usage?.url).toContain("/v1/billing");
    expect(cfg.usage?.userUrl).toContain("/v1/user");
  });

  it("is listed in USAGE_SUPPORTED_PROVIDERS", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("grok-cli");
  });
});

describe("Grok CLI billing normalization", () => {
  it("keeps the plain billing parser available for legacy single-shape payloads", () => {
    const parsed = parseGrokCliBilling(PLAIN_BILLING, USER_PROFILE);
    expect(parsed.plan).toBe("Grok Code");
    expect(parsed.quotas["Monthly credits"]).toMatchObject({
      used: 275,
      total: 1000,
      remainingPercentage: 72.5,
      resetAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("merges credit and plain billing into weekly, API, and monthly quota rows", () => {
    const parsed = buildMergedGrokQuotas(
      CREDITS_BILLING,
      PLAIN_BILLING,
      USER_PROFILE,
    );
    expect(parsed.plan).toBe("Grok Code");
    expect(parsed.quotas["Weekly limit"]).toMatchObject({
      used: 35,
      total: 100,
      remainingPercentage: 65,
    });
    expect(parsed.quotas["Api usage"]).toMatchObject({
      used: 35,
      total: 100,
      remainingPercentage: 65,
    });
    expect(parsed.quotas["Monthly credits"]).toMatchObject({
      used: 275,
      total: 1000,
      remainingPercentage: 72.5,
    });
  });

  it("does not invent a SuperGrok bar when the free-tier response has no percentage", () => {
    const parsed = buildMergedGrokQuotas(
      FREE_CREDITS_BILLING,
      FREE_PLAIN_BILLING,
      USER_PROFILE,
    );
    expect(parsed.noCreditAllotment).toBe(true);
    expect(parsed.quotas["Weekly limit"]).toMatchObject({ unknown: true });
    expect(parsed.quotas["Monthly credits"]).toMatchObject({
      unknown: true,
      format: "currency",
    });
  });
});

describe("getUsageForProvider(grok-cli)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses credits billing, plain billing, and user profile requests", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(CREDITS_BILLING))
      .mockResolvedValueOnce(jsonResponse(PLAIN_BILLING))
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
      providerSpecificData: {
        email: "user@example.com",
        userId: "d84768dd-224d-4052-ba49-0d336fa9160c",
      },
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Grok Code");
    expect(usage.quotas["Weekly limit"].remainingPercentage).toBe(65);
    expect(usage.quotas["Monthly credits"]).toMatchObject({
      used: 275,
      total: 1000,
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);

    const [creditsUrl, creditsOptions] = proxyAwareFetch.mock.calls[0];
    const [plainUrl] = proxyAwareFetch.mock.calls[1];
    const [userUrl] = proxyAwareFetch.mock.calls[2];
    expect(creditsUrl).toContain("/v1/billing?format=credits");
    expect(plainUrl).toMatch(/\/v1\/billing$/);
    expect(userUrl).toContain("/v1/user?include=subscription");
    expect(creditsOptions.headers.Authorization).toBe("Bearer test-token");
    expect(creditsOptions.headers["x-xai-token-auth"]).toBe("xai-grok-cli");
    expect(creditsOptions.headers["x-grok-client-version"]).toBe("0.2.99");
    expect(creditsOptions.headers["x-grok-client-identifier"]).toBe("grok-shell");
    expect(creditsOptions.headers["x-userid"]).toBe(
      "d84768dd-224d-4052-ba49-0d336fa9160c",
    );
  });

  it("reports expiration only when both billing endpoints reject the token", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "expired",
    });

    expect(usage.message).toMatch(/expired|re-authorize/i);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("falls back to plain billing pay-as-you-go when credits billing is unavailable", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          config: {
            ...PLAIN_BILLING.config,
            onDemandCap: { val: 25 },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
    });

    expect(usage.payAsYouGo).toBe("Enabled");
    expect(usage.quotas["Monthly credits"]).toMatchObject({
      used: 275,
      total: 1000,
    });
  });

  it("renders free-tier unknown rows instead of a blocking message", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(FREE_CREDITS_BILLING))
      .mockResolvedValueOnce(jsonResponse(FREE_PLAIN_BILLING))
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["Weekly limit"]).toMatchObject({ unknown: true });
    expect(usage.quotas["Monthly credits"]).toMatchObject({ unknown: true });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });
});

describe("parseQuotaData(grok-cli)", () => {
  it("forwards remainingPercentage for dashboard bars", () => {
    const rows = parseQuotaData("grok-cli", {
      plan: "Grok Code",
      quotas: {
        "Weekly limit": {
          used: 35,
          total: 100,
          remainingPercentage: 65,
          resetAt: "2026-07-15T00:00:00.000Z",
        },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Weekly limit",
      used: 35,
      total: 100,
      remainingPercentage: 65,
    });
  });
});