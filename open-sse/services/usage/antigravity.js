/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { CLIENT_METADATA, parseResetTime } from "./utils.js";
import { normalizeCloudCodeProjectId } from "./shared.js";
import {
  ANTIGRAVITY_USAGE_ENDPOINTS,
  ANTIGRAVITY_USAGE_MODEL_IDS,
} from "../../providers/antigravity-provider-metadata.js";
import { ANTIGRAVITY_IDE_USER_AGENT } from "../../providers/shared.js";

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(
  accessToken,
  proxyOptions = null,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const response = await proxyAwareFetch(
      ANTIGRAVITY_USAGE_ENDPOINTS.loadProjectApiUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
          "Content-Type": "application/json",
          "x-request-source": "local", // MITM bypass
        },
        body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
        signal: controller.signal,
      },
      proxyOptions,
    );

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get Antigravity project ID from subscription info
 */
async function getAntigravityProjectId(accessToken) {
  try {
    const info = await getAntigravitySubscriptionInfo(accessToken);
    return info?.cloudaicompanionProject || null;
  } catch {
    return null;
  }
}

export async function getAntigravityUsage(
  accessToken,
  providerSpecificData,
  proxyOptions = null,
) {
  try {
    // Fetch subscription info once — reuse for both projectId and plan
    const subscriptionInfo = await getAntigravitySubscriptionInfo(
      accessToken,
      proxyOptions,
    );
    const projectId = normalizeCloudCodeProjectId(
      subscriptionInfo?.cloudaicompanionProject,
    );

    // Fetch quota data with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    let response;
    try {
      response = await proxyAwareFetch(
        ANTIGRAVITY_USAGE_ENDPOINTS.quotaApiUrl,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
            "Content-Type": "application/json",
            "X-Client-Name": "antigravity",
            "X-Client-Version": "1.107.0",
            "x-request-source": "local", // MITM bypass
          },
          body: JSON.stringify({
            ...(projectId ? { project: projectId } : {}),
          }),
          signal: controller.signal,
        },
        proxyOptions,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 403) {
      return {
        message: "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {},
      };
    }

    if (response.status === 401) {
      return {
        message:
          "Antigravity quota API authentication expired. Chat may still work.",
        quotas: {},
      };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();
    const quotas = {};

    // Parse model quotas (inspired by vscode-antigravity-cockpit)
    if (data.models) {
      for (const [modelKey, info] of Object.entries(data.models)) {
        // Skip models without quota info
        if (!info.quotaInfo) {
          continue;
        }

        // Skip internal models and models outside the static Antigravity catalog.
        if (info.isInternal || !ANTIGRAVITY_USAGE_MODEL_IDS.has(modelKey)) {
          continue;
        }

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const remainingPercentage = remainingFraction * 100;

        // Convert percentage to used/total for UI compatibility
        const total = 1000; // Normalized base
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        // Use modelKey as key (matches PROVIDER_MODELS id)
        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: info.displayName || modelKey,
        };
      }
    }

    return {
      plan: subscriptionInfo?.currentTier?.name || "Unknown",
      quotas,
      subscriptionInfo,
    };
  } catch (error) {
    console.error("[Antigravity Usage] Error:", error.message, error.cause);
    return { message: `Antigravity error: ${error.message}` };
  }
}
