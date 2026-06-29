/**
 * Usage Fetcher barrel — routes to provider-specific modules.
 *
 * Actual implementations live in:
 *   - ./usage/utils.js         (shared constants, parseResetTime)
 *   - ./usage/github.js        (GitHub Copilot)
 *   - ./usage/gemini.js        (Gemini CLI)
 *   - ./usage/antigravity.js   (Antigravity / Cloud Code)
 *   - ./usage/claude.js        (Claude OAuth + legacy)
 *   - ./usage/codex.js         (Codex / OpenAI)
 *   - ./usage/kiro.js          (Kiro / AWS CodeWhisperer)
 *   - ./usage/minimax.js       (MiniMax Token/Coding Plan)
 *   - ./usage/misc.js          (Qwen, iFlow, Ollama, GLM)
 */

import { getGitHubUsage } from "./usage/github.js";
import { getGeminiUsage } from "./usage/gemini.js";
import { getAntigravityUsage } from "./usage/antigravity.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage } from "./usage/codex.js";
import { getKiroUsage } from "./usage/kiro.js";
import { getMiniMaxUsage } from "./usage/minimax.js";
import {
  getQwenUsage,
  getIflowUsage,
  getOllamaUsage,
  getGlmUsage,
} from "./usage/misc.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { getCodeBuddyCnUsage } from "./usage/codebuddy-cn.js";

// Vercel AI Gateway credits endpoint
// Returns { balance: "95.50", total_used: "4.50" } (USD as decimal strings).
const VERCEL_AI_GATEWAY_CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
export async function getUsageForProvider(connection, proxyOptions = null) {
  const { provider, accessToken, apiKey, providerSpecificData, projectId } =
    connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  switch (provider) {
    case "github":
      return await getGitHubUsage(
        accessToken,
        providerSpecificData,
        proxyOptions,
      );
    case "gemini-cli":
      return await getGeminiUsage(
        accessToken,
        providerDataWithProjectId,
        proxyOptions,
      );
    case "antigravity":
      return await getAntigravityUsage(
        accessToken,
        providerSpecificData,
        proxyOptions,
      );
    case "claude":
      return await getClaudeUsage(accessToken, proxyOptions);
    case "codex":
      return await getCodexUsage(accessToken, proxyOptions);
    case "kiro":
      return await getKiroUsage(
        accessToken,
        providerSpecificData,
        proxyOptions,
      );
    case "qwen":
      return await getQwenUsage(accessToken, providerSpecificData);
    case "iflow":
      return await getIflowUsage(accessToken);
    case "ollama":
      return await getOllamaUsage(accessToken);
    case "glm":
    case "glm-cn":
      return await getGlmUsage(apiKey, provider, proxyOptions);
    case "minimax":
    case "minimax-cn":
      return await getMiniMaxUsage(apiKey, provider, proxyOptions);
    case "qoder":
      return await getQoderUsage(accessToken, proxyOptions);
    case "vercel-ai-gateway":
      return await getVercelAiGatewayUsage(apiKey, proxyOptions);
    case "codebuddy-cn":
      return await getCodeBuddyCnUsage(
        accessToken,
        apiKey,
        providerSpecificData,
        proxyOptions,
      );
    default:
      return { message: `Usage API not implemented for ${provider}` };
  }
}

async function getVercelAiGatewayUsage(apiKey, proxyOptions = null) {
  if (!apiKey)
    return { message: "Vercel AI Gateway usage unavailable: no API key" };
  try {
    const response = await proxyAwareFetch(
      VERCEL_AI_GATEWAY_CREDITS_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { message: "Vercel AI Gateway API key invalid or expired." };
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const trimmed = errorText ? `: ${errorText.slice(0, 200)}` : "";
      return {
        message: `Vercel AI Gateway credits API error (${response.status})${trimmed}`,
      };
    }

    const data = await response.json();
    const balance = Number(data?.balance) || 0;
    const totalUsed = Number(data?.total_used) || 0;
    const MONTHLY_CREDIT = 5;
    const remainingPercentage = (balance / MONTHLY_CREDIT) * 100;

    if (balance <= 0 && totalUsed <= 0) {
      return {
        plan: "Pay-as-you-go",
        message:
          "Vercel AI Gateway connected. No credit allocation found (BYOK or unfunded account).",
        quotas: {},
      };
    }

    return {
      plan: "Pay-as-you-go",
      quotas: {
        "Used (USD)": {
          used: totalUsed,
          total: 0,
          remaining: 0,
          remainingPercentage: 100,
          unlimited: true,
        },
        "Remaining (USD)": {
          used: balance,
          total: MONTHLY_CREDIT,
          remaining: balance,
          remainingPercentage,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    return { message: `Vercel AI Gateway error: ${error.message}` };
  }
}

async function getQoderUsage(accessToken, proxyOptions = null) {
  if (!accessToken)
    return { message: "Qoder usage unavailable: no access token" };
  try {
    const response = await proxyAwareFetch(
      "https://openapi.qoder.sh/api/v2/quota/usage",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok)
      return {
        message: `Qoder connected. Usage fetch returned ${response.status}.`,
      };
    const body = await response.json().catch(() => null);
    if (!body)
      return { message: "Qoder connected. Usage response was not JSON." };

    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    const expiresAtMs =
      Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
        ? Number(body.expiresAt)
        : null;
    const resetAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;

    return {
      quotas: {
        user: {
          total: Number(userQuota.total) || 0,
          used: Number(userQuota.used) || 0,
          remaining: Number(userQuota.remaining) || 0,
          unit: userQuota.unit || "credits",
          resetAt,
        },
        organization: {
          total: Number(orgQuota.total) || 0,
          used: Number(orgQuota.used) || 0,
          remaining: Number(orgQuota.remaining) || 0,
          unit: orgQuota.unit || "credits",
          resetAt,
        },
      },
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    return {
      message: `Qoder connected. Unable to fetch usage: ${error.message}`,
    };
  }
}
