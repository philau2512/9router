const fs = require("fs");
const { PATHS, ensureDirs } = require("../paths");
const { DEFAULTS, stableChannelId } = require("./defaults");

function normalizeModels(models) {
  const list = Array.isArray(models) ? models : DEFAULTS.models;
  const out = [];
  const seen = new Set();
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const displayName = String(m.displayName || m.name || "").trim();
    const routerModel = String(m.routerModel || m.model || "").trim();
    if (!displayName || !routerModel) continue;
    const id = m.id || stableChannelId(displayName, routerModel);
    if (seen.has(id)) continue;
    seen.add(id);
    const contextWindowTokens = Number(m.contextWindowTokens) || 0;
    const maxCompletionTokens = Number(m.maxCompletionTokens) || 0;
    let reasoningEffort = String(m.reasoningEffort ?? "medium")
      .trim()
      .toLowerCase();
    if (!reasoningEffort) reasoningEffort = "medium";
    if (!["low", "medium", "high", "xhigh", "max"].includes(reasoningEffort)) {
      reasoningEffort = "medium";
    }
    let openAIEndpoint = String(
      m.openAIEndpoint || "/v1/chat/completions",
    ).trim();
    if (
      openAIEndpoint !== "/v1/chat/completions" &&
      openAIEndpoint !== "/v1/responses"
    ) {
      openAIEndpoint = "/v1/chat/completions";
    }
    out.push({
      id,
      displayName,
      routerModel,
      contextWindowTokens,
      maxCompletionTokens,
      reasoningEffort,
      openAIEndpoint,
      capabilities: {
        agent: m.capabilities?.agent !== false,
        images: m.capabilities?.images !== false,
        thinking:
          m.capabilities?.thinking !== false ||
          !!reasoningEffort ||
          reasoningEffort === "high",
      },
      source: m.source || undefined,
    });
  }
  // Empty is valid — user curates via ModelSelectModal
  return out;
}

function normalizeConfig(input = {}) {
  const cfg = {
    backendListenAddr:
      String(input.backendListenAddr || DEFAULTS.backendListenAddr).trim() ||
      DEFAULTS.backendListenAddr,
    proxyListenAddr:
      String(input.proxyListenAddr || DEFAULTS.proxyListenAddr).trim() ||
      DEFAULTS.proxyListenAddr,
    routerBaseUrl:
      String(
        input.routerBaseUrl ||
          process.env.CURSOR_LOCAL_ROUTER_BASE ||
          process.env.MITM_ROUTER_BASE ||
          DEFAULTS.routerBaseUrl,
      )
        .trim()
        .replace(/\/+$/, "") || DEFAULTS.routerBaseUrl,
    routerApiKey:
      String(
        input.routerApiKey ||
          process.env.CURSOR_LOCAL_ROUTER_API_KEY ||
          process.env.ROUTER_API_KEY ||
          "",
      ).trim() || "",
    models: normalizeModels(input.models),
    restoreAuthOnStop:
      input.restoreAuthOnStop !== undefined
        ? !!input.restoreAuthOnStop
        : DEFAULTS.restoreAuthOnStop,
    restoreSettingsOnStop:
      input.restoreSettingsOnStop !== undefined
        ? !!input.restoreSettingsOnStop
        : DEFAULTS.restoreSettingsOnStop,
    injectAccountEmail: DEFAULTS.injectAccountEmail,
    injectAuthToken: DEFAULTS.injectAuthToken,
  };
  return cfg;
}

// In-process config cache — avoids disk read on every agent turn
let _cachedConfig = null;
let _cacheTime = 0;
const CONFIG_CACHE_TTL_MS = 5000;

function loadConfig() {
  ensureDirs();
  const now = Date.now();
  if (_cachedConfig && now - _cacheTime < CONFIG_CACHE_TTL_MS) {
    return _cachedConfig;
  }
  try {
    if (fs.existsSync(PATHS.config)) {
      const raw = JSON.parse(fs.readFileSync(PATHS.config, "utf8"));
      _cachedConfig = normalizeConfig(raw);
      _cacheTime = now;
      return _cachedConfig;
    }
  } catch (e) {
    console.warn(`[cursor-local] config load failed: ${e.message}`);
  }
  _cachedConfig = normalizeConfig({});
  _cacheTime = now;
  return _cachedConfig;
}

function saveConfig(partial) {
  ensureDirs();
  const next = normalizeConfig({ ...loadConfig(), ...partial });
  const disk = {
    backendListenAddr: next.backendListenAddr,
    proxyListenAddr: next.proxyListenAddr,
    routerBaseUrl: next.routerBaseUrl,
    models: next.models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      routerModel: m.routerModel,
      contextWindowTokens: m.contextWindowTokens || 0,
      maxCompletionTokens: m.maxCompletionTokens || 0,
      reasoningEffort: m.reasoningEffort || "medium",
      openAIEndpoint: m.openAIEndpoint || "/v1/chat/completions",
      capabilities: m.capabilities,
      source: m.source,
    })),
    restoreAuthOnStop: next.restoreAuthOnStop,
    restoreSettingsOnStop: next.restoreSettingsOnStop,
  };
  fs.writeFileSync(PATHS.config, `${JSON.stringify(disk, null, 2)}\n`);
  // Invalidate cache on write
  _cachedConfig = normalizeConfig(disk);
  _cacheTime = Date.now();
  return _cachedConfig;
}

module.exports = { loadConfig, saveConfig, normalizeConfig, normalizeModels };
