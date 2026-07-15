const { stableChannelId } = require("./defaults");
const { loadConfig } = require("./loadConfig");

const REASONING_EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const OPENAI_ENDPOINTS = [
  "/v1/chat/completions",
  "/v1/responses",
];

function listModels(cfg) {
  const c = cfg || loadConfig();
  return c.models || [];
}

function findModelEntry(modelId, cfg) {
  const models = listModels(cfg);
  const id = String(modelId || "").trim();
  if (!id || id === "default" || id === "auto" || id === "fast") {
    return models[0] || null;
  }
  let hit = models.find((m) => m.id === id);
  if (hit) return hit;
  hit = models.find(
    (m) => String(m.displayName || "").toLowerCase() === id.toLowerCase(),
  );
  if (hit) return hit;
  hit = models.find((m) => m.routerModel === id);
  if (hit) return hit;
  // variant channelId:effort
  if (id.includes(":")) {
    const base = id.split(":")[0];
    return findModelEntry(base, cfg);
  }
  return null;
}

function resolveRouterModel(modelId, cfg) {
  const hit = findModelEntry(modelId, cfg);
  if (hit?.routerModel) return hit.routerModel;
  const id = String(modelId || "").trim();
  if (!id || id === "default" || id === "auto" || id === "fast") {
    return listModels(cfg)[0]?.routerModel || "default";
  }
  if (id.includes(":")) return id.split(":")[0];
  return id;
}

function ensureIds(models) {
  return (models || []).map((m) => ({
    ...m,
    id: m.id || stableChannelId(m.displayName, m.routerModel),
  }));
}

module.exports = {
  listModels,
  findModelEntry,
  resolveRouterModel,
  ensureIds,
  stableChannelId,
  REASONING_EFFORTS,
  OPENAI_ENDPOINTS,
};
