/**
 * How to combine static catalog + live /api/providers/{id}/models results.
 *
 * - union (default): static ∪ live by id; live metadata wins on overlap.
 * - live-only: when live is non-empty, available list = live only.
 *   Static IDs missing from live go to `shelvedModels` (UI: Disabled models),
 *   not deleted. Fail-open: empty/null live → static only, no shelved.
 *
 * Kiro ListAvailableModels is account-tier-specific (e.g. external_idp may
 * only expose deepseek/minimax/glm/qwen — not Claude).
 */

/** Provider ids that must prefer live catalog when available. */
export const LIVE_ONLY_MODEL_PROVIDERS = new Set(["kiro"]);

/**
 * @param {string} providerId
 * @returns {boolean}
 */
export function isLiveOnlyModelProvider(providerId) {
  return LIVE_ONLY_MODEL_PROVIDERS.has(providerId);
}

/**
 * Normalize a model row from either static catalog or live API payload.
 * @param {object|string} model
 * @returns {{ id: string } & object | null}
 */
export function normalizeCatalogModel(model) {
  if (model == null) return null;
  if (typeof model === "string") {
    const id = model.trim();
    return id ? { id, name: id } : null;
  }
  if (typeof model !== "object") return null;
  // Prefer stable ids over display name (name often human-readable only).
  const id = model.id || model.model || model.name;
  if (!id || typeof id !== "string") return null;
  return { ...model, id, name: model.name || id };
}

/**
 * Merge static + live model lists for a provider.
 *
 * @param {object} opts
 * @param {string} opts.providerId
 * @param {Array<object|string>|null|undefined} opts.staticModels
 * @param {Array<object|string>|null|undefined} opts.liveModels
 * @returns {{ models: Array<object>, shelvedModels: Array<object> }}
 */
export function mergeProviderModels({
  providerId,
  staticModels = [],
  liveModels = null,
}) {
  const staticList = (staticModels || [])
    .map(normalizeCatalogModel)
    .filter(Boolean);
  const liveList = (liveModels || [])
    .map(normalizeCatalogModel)
    .filter(Boolean)
    .map((m) => ({ ...m, isLive: true }));

  if (liveList.length === 0) {
    return { models: staticList, shelvedModels: [] };
  }

  if (isLiveOnlyModelProvider(providerId)) {
    const liveIds = new Set(liveList.map((m) => m.id));
    // Static catalog IDs this account cannot use → Disabled models strip.
    const shelvedModels = staticList
      .filter((m) => !liveIds.has(m.id))
      .map((m) => ({
        ...m,
        accountUnavailable: true,
      }));
    return { models: liveList, shelvedModels };
  }

  // Union: static base, live overwrites / appends.
  const byId = new Map(staticList.map((m) => [m.id, m]));
  for (const lm of liveList) {
    byId.set(lm.id, { ...(byId.get(lm.id) || {}), ...lm, id: lm.id, isLive: true });
  }
  return { models: Array.from(byId.values()), shelvedModels: [] };
}