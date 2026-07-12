/**
 * Helpers for ModelSelectModal live catalog merge.
 * Fail-open: empty/null live leaves static chips unchanged.
 */

import {
  mergeProviderModels,
  normalizeCatalogModel,
  isLiveOnlyModelProvider,
} from "./mergeProviderModels.js";

/**
 * Parse GET /api/providers/{id}/models JSON body into a raw model array.
 * @param {unknown} data
 * @returns {Array}
 */
export function parseProviderModelsPayload(data) {
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

/**
 * First active connection per provider (multi-account: first wins).
 * @param {Array<{ id?: string, provider?: string, isActive?: boolean }>} connections
 * @returns {Map<string, { id: string, provider: string }>}
 */
export function pickFirstActiveConnectionByProvider(connections) {
  const map = new Map();
  for (const conn of connections || []) {
    if (!conn?.provider || !conn?.id) continue;
    if (conn.isActive === false) continue;
    if (!map.has(conn.provider)) {
      map.set(conn.provider, { id: conn.id, provider: conn.provider });
    }
  }
  return map;
}

/**
 * Normalize live API rows to catalog shape `{ id, name }`.
 * @param {Array} raw
 * @returns {Array<{ id: string, name: string }>}
 */
export function normalizeLiveCatalogList(raw) {
  return (raw || []).map(normalizeCatalogModel).filter(Boolean);
}

/**
 * Merge static modal chips with live catalog for one provider.
 *
 * @param {object} opts
 * @param {string} opts.providerId
 * @param {string} opts.valuePrefix - prefix for chip.value (`alias` or compatible node prefix)
 * @param {Array<{ id: string, name?: string, value?: string, kind?: string, isCustom?: boolean, isPlaceholder?: boolean }>} opts.staticChips
 * @param {Array|{ id: string, name?: string }[]|null|undefined} opts.liveModels - null/empty → fail-open static
 * @returns {Array}
 */
export function applyLiveCatalogToChips({
  providerId,
  valuePrefix,
  staticChips = [],
  liveModels = null,
}) {
  const chips = (staticChips || []).filter((m) => m && !m.isPlaceholder);
  const liveList = normalizeLiveCatalogList(liveModels);

  if (liveList.length === 0) {
    return staticChips || [];
  }

  const staticForMerge = chips.map((m) => ({
    id: m.id,
    name: m.name || m.id,
    kind: m.kind,
    isCustom: m.isCustom,
  }));

  const { models: merged } = mergeProviderModels({
    providerId,
    staticModels: staticForMerge,
    liveModels: liveList,
  });

  const customById = new Map(
    chips.filter((m) => m.isCustom).map((m) => [m.id, m]),
  );
  const kindById = new Map(
    chips.filter((m) => m.kind).map((m) => [m.id, m.kind]),
  );

  const prefix = valuePrefix || "";
  const out = merged.map((m) => {
    const custom = customById.get(m.id);
    return {
      id: m.id,
      name: m.name || m.id,
      value: prefix ? `${prefix}/${m.id}` : m.id,
      kind: m.kind || kindById.get(m.id) || custom?.kind,
      ...(custom?.isCustom ? { isCustom: true } : {}),
    };
  });

  // Live-only drops static not in live; keep user-registered custom chips.
  if (isLiveOnlyModelProvider(providerId)) {
    const seen = new Set(out.map((m) => m.id));
    for (const c of chips) {
      if (c.isCustom && !seen.has(c.id)) {
        out.push(c);
        seen.add(c.id);
      }
    }
  }

  return out;
}