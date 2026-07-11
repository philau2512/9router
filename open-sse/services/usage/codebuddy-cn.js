/**
 * CodeBuddy CN usage handler
 *
 * Scoped to the "codebuddy-cn" provider — a future codebuddy-ai (intl)
 * variant would get its own handler, so keep this CN-only.
 *
 * Quota lives behind a Tencent billing endpoint (POST, payload wrapped
 * under data.Response.Data). It mixes two credit types:
 *
 *  - Refill / base ("基础体验包"): recurring allowance whose cycle resets long
 *    before the resource expires (CycleEndTime << DeductionEndTime).
 *    Live numbers in the *Cycle* fields; resetAt = next monthly refresh.
 *  - Bonus ("活动赠送包"): one-shot credits that expire at CycleEndTime.
 *    Numbers in the plain Capacity fields.
 *
 * One quota row per package, soonest-expiring first.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDERS } from "../../config/providers.js";
import { parseResetTime } from "./utils.js";

const PROVIDER_ID = "codebuddy-cn";

// Prefer the *Precise string fields (exact value), fall back to numeric ones.
function num(precise, plain) {
  const n = Number(precise ?? plain);
  return Number.isFinite(n) ? n : 0;
}

// Label a refill pack by its cycle length (Monthly is the common CodeBuddy case).
function refillCadence(acc) {
  const start = parseResetTime(acc.CycleStartTime);
  const end = parseResetTime(acc.CycleEndTime);
  if (start && end) {
    const days =
      (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily";
    if (days <= 10) return "Weekly";
  }
  return "Monthly";
}

export async function getCodeBuddyCnUsage(
  accessToken,
  apiKey,
  providerSpecificData,
  proxyOptions = null,
) {
  const token = accessToken || apiKey;
  if (!token) {
    return { message: "CodeBuddy CN credential not available." };
  }

  try {
    const usageUrl = PROVIDERS[PROVIDER_ID]?.usageUrl;
    const response = await proxyAwareFetch(
      usageUrl,
      {
        method: "POST",
        headers: {
          ...(PROVIDERS[PROVIDER_ID]?.headers || {}),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { message: "CodeBuddy CN credential invalid or expired." };
    }
    if (!response.ok) {
      return {
        message: `CodeBuddy CN quota API error (${response.status}).`,
      };
    }

    const json = await response.json();
    if (json?.code !== 0) {
      return {
        message: `CodeBuddy CN quota error: ${json?.msg || "unknown"}`,
      };
    }

    const data = json?.data?.Response?.Data || {};
    const accounts = Array.isArray(data.Accounts) ? data.Accounts : [];
    if (accounts.length === 0) {
      return { message: "CodeBuddy CN connected. No credit package found." };
    }

    const cycleEndMs = (acc) => {
      const r = parseResetTime(acc.CycleEndTime);
      return r ? new Date(r).getTime() : Number.POSITIVE_INFINITY;
    };
    // Refill packs roll into a new cycle before the resource expires; bonus
    // packs end exactly at expiry. >2d gap = refill.
    const REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;
    const isRefill = (acc) => {
      const ce = cycleEndMs(acc);
      // Normalize DeductionEndTime to ms: API may return Unix seconds (~1.7e9) while
      // cycleEndMs() produces ms (~1.7e12). Values < 1e11 are treated as seconds.
      const deRaw = Number(acc.DeductionEndTime);
      const de = deRaw > 0 && deRaw < 1e11 ? deRaw * 1000 : deRaw;
      return (
        Number.isFinite(ce) && Number.isFinite(de) && de - ce > REFILL_GAP_MS
      );
    };
    const byExpiry = (a, b) => cycleEndMs(a) - cycleEndMs(b);

    const refills = accounts.filter(isRefill).sort(byExpiry);
    const bonuses = accounts.filter((a) => !isRefill(a)).sort(byExpiry);

    const quotas = {};
    // Refill packs: cadence-labelled, using the *Cycle* balance, resetting at
    // the next refresh.
    const seenRefill = {};
    refills.forEach((acc) => {
      const base = refillCadence(acc);
      seenRefill[base] = (seenRefill[base] || 0) + 1;
      const name = seenRefill[base] > 1 ? `${base} ${seenRefill[base]}` : base;
      quotas[name] = {
        used: num(acc.CycleCapacityUsedPrecise, acc.CycleCapacityUsed),
        total: num(acc.CycleCapacitySizePrecise, acc.CycleCapacitySize),
        resetAt: parseResetTime(acc.CycleEndTime),
        unlimited: false,
      };
    });
    // Bonus packs: lifetime Capacity balance; resetAt = expiry date.
    bonuses.forEach((acc, i) => {
      quotas[`Bonus Pack ${i + 1}`] = {
        used: num(acc.CapacityUsedPrecise, acc.CapacityUsed),
        total: num(acc.CapacitySizePrecise, acc.CapacitySize),
        resetAt: parseResetTime(acc.CycleEndTime),
        unlimited: false,
      };
    });

    const basePkg = refills[0] || accounts[0] || {};
    const plan =
      basePkg.PackageName || basePkg.SubProductName || "CodeBuddy CN";

    return { plan, quotas };
  } catch (error) {
    return { message: `CodeBuddy CN error: ${error.message}` };
  }
}
