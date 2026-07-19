import { getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { setDebugEnabled } from "@/sse/utils/logger";
import { setRequestLogsEnabled } from "open-sse/utils/requestLogger.js";

let initialized = false;

export async function ensureOutboundProxyInitialized() {
  if (initialized) return true;

  try {
    const settings = await getSettings();
    applyOutboundProxyEnv(settings);
    // Sync the runtime debug-log level from persisted settings at boot so the
    // Settings "Debug Logging" toggle survives restarts (env still wins if the
    // toggle was never turned on).
    if (settings.debugLogEnabled) setDebugEnabled(true);
    // Sync deep request file-logs (ENABLE_REQUEST_LOGS / logs/) from settings
    setRequestLogsEnabled(!!settings.enableRequestLogs);
    initialized = true;
  } catch (error) {
    console.error("[ServerInit] Error initializing outbound proxy:", error);
  }

  return initialized;
}

// Defer init so HTTP server accepts connections first
setImmediate(() => {
  ensureOutboundProxyInitialized().catch(console.log);
});

export default ensureOutboundProxyInitialized;
