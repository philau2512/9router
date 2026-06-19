// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/localDb";
import { consumeCodexRateLimitResetCredit } from "open-sse/services/usage/codex.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredResult(result) {
  const values = [result?.message, result?.code, result?.raw?.detail, result?.raw?.error]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
}

function getResponseForConsumeResult(result, redeemRequestId) {
  if (result.ok) {
    return Response.json({
      code: result.code,
      reset: true,
      windows_reset: result.windowsReset,
      redeemRequestId,
      credit: result.raw?.credit || null,
    });
  }

  if (result.noCredit) {
    return Response.json({
      code: "no_credit",
      reset: false,
      windows_reset: result.windowsReset,
      message: "No Codex reset credits available.",
    }, { status: 409 });
  }

  return Response.json({
    code: result.code || "unknown_response",
    reset: false,
    windows_reset: result.windowsReset,
    message: result.message || "Codex reset credit consume returned an unexpected response.",
  }, { status: result.status >= 400 && result.status < 500 ? result.status : 502 });
}

export async function POST(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    if (connection.provider !== "codex") {
      return Response.json({ error: "Codex reset credits are only available for Codex connections." }, { status: 400 });
    }

    const isOAuth = connection.authType === "oauth";
    const isAccessToken = connection.authType === "access_token";

    if (!isOAuth && !isAccessToken) {
      return Response.json({ error: "Codex reset credits require an OAuth or access token connection." }, { status: 400 });
    }

    // Resolve proxy config
    const proxyCfg = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyCfg.connectionProxyEnabled === true,
      connectionProxyUrl: proxyCfg.connectionProxyUrl || "",
      connectionNoProxy: proxyCfg.connectionNoProxy || "",
      vercelRelayUrl: proxyCfg.vercelRelayUrl || "",
      strictProxy: false,
    };

    // Refresh token if needed
    const { connection: refreshed } = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    connection = refreshed;

    if (!connection.accessToken) {
      return Response.json({ error: "No access token available. Please re-authorize." }, { status: 401 });
    }

    // Generate a unique redeem request ID for idempotency
    const redeemRequestId = crypto.randomUUID();

    const result = await consumeCodexRateLimitResetCredit(
      connection.accessToken,
      redeemRequestId,
      proxyOptions
    );

    // If auth expired, surface a re-authorize message
    if (!result.ok && isAuthExpiredResult(result)) {
      return Response.json({ error: "Codex session expired. Please re-authorize.", code: "auth_expired" }, { status: 401 });
    }

    return getResponseForConsumeResult(result, redeemRequestId);
  } catch (error) {
    console.log("Codex reset credits error:", error);
    return Response.json({ error: error.message || "Failed to consume reset credit" }, { status: 500 });
  }
}
