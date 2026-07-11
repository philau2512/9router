/**
 * Grok CLI / Grok Build usage handler
 *
 * Source of truth: official grok-shell/grok-pager traffic to cli-chat-proxy.grok.com
 *   GET /v1/billing?format=credits
 *   GET /v1/user?include=subscription
 *
 * Observed billing shape (protobuf-json style `{ val: number }`):
 * {
 *   config: {
 *     currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start, end },
 *     onDemandCap: { val },
 *     onDemandUsed: { val },
 *     prepaidBalance: { val },
 *     isUnifiedBillingUser: true,
 *     billingPeriodStart, billingPeriodEnd
 *   }
 * }
 *
 * Exhausted free/promo accounts return cap=0/used=0/prepaid=0 and chat 402s with
 * personal-team-blocked:spending-limit. Paid/sub accounts surface non-zero cap
 * or prepaidBalance; richer credit fields are parsed opportunistically if present.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

const USAGE = U("grok-cli");
// CLIProxyAPI parity: quota needs BOTH billing shapes.
//   /v1/billing?format=credits → Weekly limit (currentPeriod + creditUsagePercent),
//                                 Api usage (productUsage), Pay-as-you-go (onDemandCap)
//   /v1/billing (plain)         → Monthly credits (monthlyLimit / used)
const CREDITS_URL =
  USAGE.url || "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const PLAIN_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const USER_URL = USAGE.userUrl || "https://cli-chat-proxy.grok.com/v1/user?include=subscription";

/** Unwrap protobuf-json `{ val: n }` or plain numbers/strings. */
function unwrapVal(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "val" in value) {
    return toFiniteNumber(value.val, fallback);
  }
  return toFiniteNumber(value, fallback);
}

function buildGrokCliHeaders(accessToken, providerSpecificData = {}) {
  const psd = providerSpecificData || {};
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-identifier": "grok-pager",
    "x-grok-client-version": "0.2.93",
  };
  const email = psd.email;
  const userId = psd.userId || psd.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

function resolvePlan(user, config) {
  const tier = typeof user?.subscriptionTier === "string" ? user.subscriptionTier.trim() : "";
  if (tier) {
    return tier
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (user?.hasGrokCodeAccess === true) return "Grok Code";
  if (config?.isUnifiedBillingUser === true) return "Grok Build";
  return "Grok Build";
}

function makeQuota({ used, total, resetAt, unlimited = false }) {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  // Do NOT set absolute `remaining` — QuotaTable's getRemainingPercentage treats
  // `remaining` as a 0–100 percentage (same trap as Qoder credits).
  if (unlimited || safeTotal === 0) {
    return {
      used: safeUsed,
      total: 0,
      remainingPercentage: unlimited ? 100 : 0,
      resetAt: resetAt || null,
      unlimited: true,
    };
  }
  const remaining = Math.max(0, safeTotal - safeUsed);
  const remainingPercentage = (remaining / safeTotal) * 100;
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

/** Build a percentage-window quota row from a "used %" value (0-100). */
function percentUsedQuota(usedPercent, resetAt) {
  const used = Math.max(0, Math.min(100, Math.round(toFiniteNumber(usedPercent, 0))));
  return {
    used,
    total: 100,
    remainingPercentage: Math.max(0, 100 - used),
    resetAt: resetAt || null,
    unlimited: false,
  };
}

/**
 * Parse the `?format=credits` shape into the credit-window rows:
 *   config: {
 *     currentPeriod: { type: "...WEEKLY", start, end },
 *     creditUsagePercent: 59.0,
 *     productUsage: [{ product: "Api", usagePercent: 59.0 }],
 *     onDemandCap: { val }, onDemandUsed: { val }, prepaidBalance: { val },
 *   }
 * Returns { quotas: { "Weekly limit", "Api usage" }, payAsYouGo }.
 */
export function parseGrokCreditsShape(config = {}) {
  const quotas = {};
  const weeklyReset = parseResetTime(config.currentPeriod?.end);

  // Weekly limit — overall credit usage over the rolling weekly window.
  if (config.creditUsagePercent !== undefined || config.currentPeriod) {
    quotas["Weekly limit"] = percentUsedQuota(
      config.creditUsagePercent,
      weeklyReset,
    );
  }

  // Api usage — per-product usage (find the Api product, else first entry).
  if (Array.isArray(config.productUsage) && config.productUsage.length > 0) {
    const api =
      config.productUsage.find(
        (p) => String(p?.product || "").toLowerCase() === "api",
      ) || config.productUsage[0];
    if (api && api.usagePercent !== undefined) {
      quotas["Api usage"] = percentUsedQuota(api.usagePercent, weeklyReset);
    }
  }

  const onDemandCap = unwrapVal(config.onDemandCap, NaN);
  const payAsYouGo =
    Number.isFinite(onDemandCap) && onDemandCap > 0 ? "Enabled" : "Disabled";

  return { quotas, payAsYouGo };
}

/**
 * Merge the credits shape (weekly/api/pay-as-you-go) with the plain shape
 * (monthly credits) into the ordered rows CLIProxyAPI shows:
 *   Weekly limit → Api usage → Monthly credits.
 * Either input may be null (fail-open); whatever is available renders.
 */
export function buildMergedGrokQuotas(creditsBilling, plainBilling, user = null) {
  const creditsConfig = creditsBilling?.config || creditsBilling || {};
  const plainConfig = plainBilling?.config || plainBilling || {};

  const { quotas: creditQuotas, payAsYouGo } =
    parseGrokCreditsShape(creditsConfig);

  const quotas = {};
  if (creditQuotas["Weekly limit"]) quotas["Weekly limit"] = creditQuotas["Weekly limit"];
  if (creditQuotas["Api usage"]) quotas["Api usage"] = creditQuotas["Api usage"];

  // Monthly credits from the plain shape (monthlyLimit / used, in credit units).
  if (plainConfig.monthlyLimit !== undefined || plainConfig.used !== undefined) {
    const monthlyLimit = unwrapVal(plainConfig.monthlyLimit, 0);
    const monthlyUsed = unwrapVal(plainConfig.used, 0);
    quotas["Monthly credits"] = makeQuota({
      used: monthlyUsed,
      total: monthlyLimit,
      resetAt: parseResetTime(plainConfig.billingPeriodEnd),
    });
  }

  const finiteBars = Object.values(quotas).filter((q) => q.unlimited !== true);
  const exhausted =
    finiteBars.length > 0 &&
    finiteBars.every((q) => (q.remainingPercentage ?? 100) <= 0);

  return {
    plan: resolvePlan(user, creditsConfig.isUnifiedBillingUser ? creditsConfig : plainConfig),
    quotas,
    payAsYouGo,
    exhausted,
  };
}

/**
 * Parse the plain `/v1/billing` shape (grok-shell/grok-pager default, no
 * `?format=credits`). Observed:
 *   config: {
 *     monthlyLimit: { val }, used: { val }, onDemandCap: { val },
 *     billingPeriodStart, billingPeriodEnd,
 *     currentPeriod?: { type: "...WEEKLY", start, end },  // not always present
 *     history: [{ billingCycle, includedUsed, onDemandUsed, totalUsed }]
 *   }
 * Renders three UI rows to match the official pager: Weekly limit, Pay as you
 * go, Monthly credits. Always emits at least "Monthly credits" so a depleted
 * ($0.00/$0.00) account still shows the table instead of being hidden.
 */
export function parsePlainGrokBilling(config, user = null, periodEnd = null) {
  const quotas = {};

  // Monthly credits — from monthlyLimit/used. Always present (even 0/0) so the
  // dashboard renders instead of hiding the table on a depleted account.
  const monthlyLimit = unwrapVal(config.monthlyLimit, 0);
  const monthlyUsed = unwrapVal(config.used, 0);
  quotas["Monthly credits"] = makeQuota({
    used: monthlyUsed,
    total: monthlyLimit,
    resetAt: periodEnd || parseResetTime(config.billingPeriodEnd),
  });

  // Weekly limit — rolling usage window. Only present in some payloads via
  // currentPeriod (or user.rateLimits). Show it when we have data; otherwise
  // emit an unknown/unlimited-style row so the label still appears like the CLI.
  const weekly = config.currentPeriod || user?.currentPeriod || user?.rateLimits?.weekly;
  if (weekly && typeof weekly === "object") {
    const wTotal = unwrapVal(weekly.limit ?? weekly.total ?? weekly.cap, NaN);
    const wUsed = unwrapVal(weekly.used ?? weekly.consumed, NaN);
    const wReset = parseResetTime(weekly.end || weekly.resetAt || weekly.reset);
    if (Number.isFinite(wTotal) && wTotal > 0) {
      quotas["Weekly limit"] = makeQuota({
        used: Number.isFinite(wUsed) ? wUsed : 0,
        total: wTotal,
        resetAt: wReset,
      });
    } else {
      // Data present but no numeric allotment → unknown row ("Used --").
      quotas["Weekly limit"] = {
        used: 0,
        total: 0,
        remainingPercentage: 100,
        resetAt: wReset,
        unlimited: true,
      };
    }
  }

  const onDemandCap = unwrapVal(config.onDemandCap, NaN);
  const payAsYouGo =
    Number.isFinite(onDemandCap) && onDemandCap > 0 ? "Enabled" : "Disabled";

  // Exhausted when every finite (non-unlimited) bar is at 0% remaining.
  const finiteBars = Object.values(quotas).filter((q) => q.unlimited !== true);
  const exhausted =
    finiteBars.length > 0 &&
    finiteBars.every((q) => (q.remainingPercentage ?? 100) <= 0);

  return {
    plan: resolvePlan(user, config),
    quotas,
    periodEnd: periodEnd || parseResetTime(config.billingPeriodEnd),
    payAsYouGo,
    exhausted,
    rawConfig: config,
  };
}

/**
 * Map billing JSON → normalized quotas object for the dashboard.
 * Returns { quotas, periodEnd, exhaustedHint } or empty quotas when nothing usable.
 */
export function parseGrokCliBilling(billing, user = null) {
  const root = billing && typeof billing === "object" ? billing : {};
  const config =
    root.config && typeof root.config === "object" && !Array.isArray(root.config)
      ? root.config
      : root;

  const periodEnd =
    parseResetTime(config.billingPeriodEnd) ||
    parseResetTime(config.currentPeriod?.end) ||
    parseResetTime(root.billingPeriodEnd) ||
    null;

  // Shape detection: the plain `/v1/billing` response (grok-shell/grok-pager)
  // carries monthlyLimit/used/billingPeriodStart, unlike the `?format=credits`
  // shape (onDemandCap>0 / prepaidBalance / currentPeriod). The plain shape used
  // to fall through to `quotas={}` → dashboard hid the table. Handle it here so
  // Weekly limit + Monthly credits + Pay as you go render like the official CLI.
  const isPlainShape =
    config.monthlyLimit !== undefined ||
    config.billingPeriodStart !== undefined ||
    Array.isArray(config.history);
  if (isPlainShape) {
    return parsePlainGrokBilling(config, user, periodEnd);
  }

  const quotas = {};

  // Primary: on-demand spending window (subscription / promo credits)
  const onDemandCap = unwrapVal(config.onDemandCap ?? root.onDemandCap, NaN);
  const onDemandUsed = unwrapVal(config.onDemandUsed ?? root.onDemandUsed, NaN);
  if (Number.isFinite(onDemandCap) && onDemandCap > 0) {
    const used = Number.isFinite(onDemandUsed) ? Math.max(0, onDemandUsed) : 0;
    quotas["On-demand"] = makeQuota({
      used,
      total: onDemandCap,
      resetAt: periodEnd,
    });
  } else if (Number.isFinite(onDemandCap) && onDemandCap === 0 && Number.isFinite(onDemandUsed)) {
    // Cap 0 is the exhausted free/promo state (chat returns 402 spending-limit).
    // UI treats total===0 as unlimited, so use a synthetic 1/1 depleted row.
    quotas["On-demand"] = {
      used: 1,
      total: 1,
      remainingPercentage: 0,
      resetAt: periodEnd,
      unlimited: false,
    };
  }

  // Prepaid top-up balance (remaining credits; no fixed allotment known)
  const prepaid = unwrapVal(config.prepaidBalance ?? root.prepaidBalance, NaN);
  if (Number.isFinite(prepaid) && prepaid > 0) {
    // Show full bar against the current balance (0 spent of this remaining pot).
    quotas["Prepaid"] = {
      used: 0,
      total: prepaid,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: false,
    };
  }

  // Opportunistic richer credit envelopes (future / other account types)
  const creditBags = [
    root.credits,
    root.creditBalance,
    root.usage,
    config.credits,
    config.includedCredits,
    config.subscriptionCredits,
  ].filter((bag) => bag && typeof bag === "object" && !Array.isArray(bag));

  for (const bag of creditBags) {
    const total = unwrapVal(
      bag.total ?? bag.limit ?? bag.cap ?? bag.allocation ?? bag.amount,
      NaN,
    );
    const used = unwrapVal(bag.used ?? bag.spent ?? bag.consumed, NaN);
    const remaining = unwrapVal(bag.remaining ?? bag.balance ?? bag.left, NaN);
    if (Number.isFinite(total) && total > 0) {
      const resolvedUsed = Number.isFinite(used)
        ? used
        : Number.isFinite(remaining)
          ? Math.max(0, total - remaining)
          : 0;
      if (!quotas.Credits) {
        quotas.Credits = makeQuota({
          used: resolvedUsed,
          total,
          resetAt: parseResetTime(bag.resetAt || bag.resetsAt || bag.end) || periodEnd,
        });
      }
    } else if (Number.isFinite(remaining) && remaining >= 0 && !quotas.Credits) {
      quotas.Credits = {
        used: 0,
        total: remaining > 0 ? remaining : 1,
        remainingPercentage: remaining > 0 ? 100 : 0,
        resetAt: periodEnd,
        unlimited: false,
      };
    }
  }

  // Exhausted when every finite quota bar is at 0% remaining
  const exhausted =
    Object.keys(quotas).length > 0 &&
    Object.values(quotas).every(
      (q) => q.unlimited !== true && (q.remainingPercentage ?? 100) <= 0,
    );

  return {
    plan: resolvePlan(user, config),
    quotas,
    periodEnd,
    exhausted,
    rawConfig: config,
  };
}

/**
 * @param {string} accessToken
 * @param {object|null} providerSpecificData
 * @param {object|null} proxyOptions
 */
export async function getGrokCliUsage(accessToken, providerSpecificData = null, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Grok CLI access token not available." };
  }

  const headers = buildGrokCliHeaders(accessToken, providerSpecificData);
  const getJson = async (url) => {
    try {
      const res = await proxyAwareFetch(url, { method: "GET", headers }, proxyOptions);
      if (res.status === 401 || res.status === 403) return { authError: true };
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  };

  try {
    // CLIProxyAPI parity: hit BOTH billing shapes + the user profile in parallel.
    //   credits shape → Weekly limit + Api usage + Pay-as-you-go
    //   plain shape   → Monthly credits
    const [creditsBilling, plainBilling, userJson] = await Promise.all([
      getJson(CREDITS_URL),
      getJson(PLAIN_URL),
      getJson(USER_URL),
    ]);

    if (creditsBilling?.authError && plainBilling?.authError) {
      return { message: "Grok CLI authentication expired. Please re-authorize." };
    }

    const credits =
      creditsBilling && !creditsBilling.authError ? creditsBilling : null;
    const plain = plainBilling && !plainBilling.authError ? plainBilling : null;
    const user = userJson && !userJson.authError ? userJson : null;

    if (!credits && !plain) {
      return { message: "Grok CLI billing response was not available." };
    }

    const merged = buildMergedGrokQuotas(credits, plain, user);

    if (!merged.quotas || Object.keys(merged.quotas).length === 0) {
      // Fall back to the single-shape parser (covers older/edge payloads).
      const parsed = parseGrokCliBilling(credits || plain, user);
      if (!parsed.quotas || Object.keys(parsed.quotas).length === 0) {
        return {
          plan: parsed.plan,
          message:
            "Grok Build connected, but no credit allotment was returned. Free promo may be exhausted — upgrade at https://grok.com/supergrok or add credits at https://grok.com/?_s=usage.",
          quotas: {},
        };
      }
      const fb = { plan: parsed.plan, quotas: parsed.quotas };
      if (parsed.payAsYouGo) fb.payAsYouGo = parsed.payAsYouGo;
      return fb;
    }

    const result = { plan: merged.plan, quotas: merged.quotas };
    if (merged.payAsYouGo) result.payAsYouGo = merged.payAsYouGo;
    return result;
  } catch (error) {
    return { message: `Grok CLI usage error: ${error.message}` };
  }
}
