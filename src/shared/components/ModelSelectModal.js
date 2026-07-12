"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import ProviderIcon from "./ProviderIcon";
import CapacityBadges from "./CapacityBadges";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  getProviderAlias,
} from "@/shared/constants/providers";
import {
  applyLiveCatalogToChips,
  parseProviderModelsPayload,
  pickFirstActiveConnectionByProvider,
} from "@/shared/utils/liveModelsForSelectModal";

// Provider order: OAuth first, then Free Tier, then API Key (matches dashboard/providers)
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

// Providers that need no auth — always show in model selector
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(
  (id) => FREE_PROVIDERS[id].noAuth,
);

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = [],
  title = "Select Model",
  modelAliases = {},
  kindFilter = null,
  addedModelValues = [],
  closeOnSelect = true,
}) {
  // Filter activeProviders by serviceKinds when kindFilter set (e.g. "webSearch", "webFetch")
  const filteredActiveProviders = useMemo(() => {
    if (!kindFilter) return activeProviders;
    return activeProviders.filter((p) => {
      const info = AI_PROVIDERS[p.provider];
      const kinds = info?.serviceKinds || ["llm"];
      return kinds.includes(kindFilter);
    });
  }, [activeProviders, kindFilter]);
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [disabledModels, setDisabledModels] = useState({});
  // null = live not settled yet (show static); object after settle (fail-open empty {})
  const [liveModelsByProviderId, setLiveModelsByProviderId] = useState(null);
  const [liveModelsLoading, setLiveModelsLoading] = useState(false);
  // vision/reasoning badges (eye/brain) for each model chip
  const { getCaps } = useModelCaps();

  const fetchCombos = useCallback(async () => {
    try {
      const res = await fetch("/api/combos");
      if (!res.ok) throw new Error(`Failed to fetch combos: ${res.status}`);
      const data = await res.json();
      setCombos(data.combos || []);
    } catch (error) {
      console.error("Error fetching combos:", error);
      setCombos([]);
    }
  }, []);

  const fetchProviderNodes = useCallback(async () => {
    try {
      const res = await fetch("/api/provider-nodes");
      if (!res.ok)
        throw new Error(`Failed to fetch provider nodes: ${res.status}`);
      const data = await res.json();
      setProviderNodes(data.nodes || []);
    } catch (error) {
      console.error("Error fetching provider nodes:", error);
      setProviderNodes([]);
    }
  }, []);

  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/custom");
      if (!res.ok)
        throw new Error(`Failed to fetch custom models: ${res.status}`);
      const data = await res.json();
      setCustomModels(data.models || []);
    } catch (error) {
      console.error("Error fetching custom models:", error);
      setCustomModels([]);
    }
  }, []);

  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/disabled");
      if (!res.ok)
        throw new Error(`Failed to fetch disabled models: ${res.status}`);
      const data = await res.json();
      setDisabledModels(data.disabled || {});
    } catch (error) {
      console.error("Error fetching disabled models:", error);
      setDisabledModels({});
    }
  }, []);

  // Live catalog per provider (first active connection wins). Fail-open → {}.
  const fetchLiveModels = useCallback(
    async (signal) => {
      const byProvider = pickFirstActiveConnectionByProvider(activeProviders);
      if (byProvider.size === 0) {
        if (!signal?.aborted) {
          setLiveModelsByProviderId({});
          setLiveModelsLoading(false);
        }
        return;
      }

      setLiveModelsLoading(true);
      try {
        const entries = await Promise.all(
          [...byProvider.entries()].map(async ([providerId, conn]) => {
            try {
              const res = await fetch(`/api/providers/${conn.id}/models`, {
                cache: "no-store",
                signal,
              });
              if (!res.ok) return [providerId, []];
              const data = await res.json().catch(() => ({}));
              return [providerId, parseProviderModelsPayload(data)];
            } catch (err) {
              if (err?.name === "AbortError") return [providerId, null];
              return [providerId, []];
            }
          }),
        );

        if (signal?.aborted) return;

        const next = {};
        for (const [providerId, models] of entries) {
          if (Array.isArray(models) && models.length > 0) {
            next[providerId] = models;
          }
        }
        setLiveModelsByProviderId(next);
      } finally {
        if (!signal?.aborted) setLiveModelsLoading(false);
      }
    },
    [activeProviders],
  );

  const fetchOpenData = useCallback(() => {
    void fetchCombos();
    void fetchProviderNodes();
    void fetchCustomModels();
    void fetchDisabledModels();
  }, [fetchCombos, fetchProviderNodes, fetchCustomModels, fetchDisabledModels]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const timer = setTimeout(() => {
      fetchOpenData();
    }, 0);

    // Reset live state each open so static shows until fetch settles (no empty flash).
    setLiveModelsByProviderId(null);
    setLiveModelsLoading(false);
    const ac = new AbortController();
    void fetchLiveModels(ac.signal);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [isOpen, fetchOpenData, fetchLiveModels]);

  const allProviders = useMemo(
    () => ({
      ...OAUTH_PROVIDERS,
      ...FREE_PROVIDERS,
      ...FREE_TIER_PROVIDERS,
      ...APIKEY_PROVIDERS,
    }),
    [],
  );

  // Group models by provider with priority order
  const groupedModels = useMemo(() => {
    const groups = {};

    // Kinds where the provider IS the model (no per-model selection needed)
    const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
    // Kinds that map via getModelKind (kind || type)
    const TYPED_KINDS = new Set([
      "image",
      "tts",
      "stt",
      "embedding",
      "imageToText",
    ]);
    // For these kinds, providers without hardcoded models can still be picked (provider-as-model fallback)
    const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

    // Filter a models[] array by kindFilter (keep only matching kind)
    const filterByKind = (models) => {
      // No kindFilter means the LLM selector. Keep custom models visible because
      // they may expose typed capabilities while still being selectable as chat models.
      if (!kindFilter)
        return models.filter(
          (m) =>
            m.isPlaceholder ||
            m.isCustom ||
            !getModelKind(m) ||
            getModelKind(m) === "llm",
        );
      if (!TYPED_KINDS.has(kindFilter)) return models;
      return models.filter(
        (m) => m.isPlaceholder || getModelKind(m) === kindFilter,
      );
    };

    // Get all active provider IDs from connections (filtered by kindFilter if set)
    const activeConnectionIds = filteredActiveProviders.map((p) => p.provider);

    // No-auth providers: filter by kindFilter as well
    const noAuthIds = kindFilter
      ? NO_AUTH_PROVIDER_IDS.filter((id) =>
          (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(kindFilter),
        )
      : NO_AUTH_PROVIDER_IDS;

    // Only show connected providers (including both standard and custom)
    const providerIdsToShow = new Set([
      ...activeConnectionIds, // Only connected providers
      ...noAuthIds, // No-auth providers (kind-filtered)
    ]);

    // Sort by PROVIDER_ORDER
    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId) => {
      const alias = getProviderAlias(providerId);
      const providerInfo = allProviders[providerId] || {
        name: providerId,
        color: "#666",
      };
      const isCustomProvider =
        isOpenAICompatibleProvider(providerId) ||
        isAnthropicCompatibleProvider(providerId);

      // For provider-as-model kinds (webSearch/webFetch): emit a single entry where value === providerId
      if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
        groups[providerId] = {
          name: providerInfo.name,
          alias,
          color: providerInfo.color,
          models: [
            { id: providerId, name: providerInfo.name, value: providerId },
          ],
        };
        return;
      }

      if (providerInfo.passthroughModels) {
        const aliasModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${alias}/`, ""),
            name: aliasName,
            value: fullModel,
          }));

        // For typed kinds, only include hardcoded typed models (aliases are typically LLM-only and lack type info)
        let combined = aliasModels;
        if (kindFilter && TYPED_KINDS.has(kindFilter)) {
          combined = getModelsByProviderId(providerId)
            .filter((m) => getModelKind(m) === kindFilter)
            .map((m) => ({
              id: m.id,
              name: m.name,
              value: `${alias}/${m.id}`,
              kind: getModelKind(m),
            }));
          // Fallback: provider-as-model when no hardcoded models match (tts/image/webFetch only)
          if (
            combined.length === 0 &&
            ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)
          ) {
            const supports = (providerInfo.serviceKinds || ["llm"]).includes(
              kindFilter,
            );
            if (supports)
              combined = [
                { id: providerId, name: providerInfo.name, value: alias },
              ];
          }
        } else if (!kindFilter) {
          // LLM context: merge hardcoded LLM models
          const hardcodedModels = getModelsByProviderId(providerId)
            .filter((m) => !getModelKind(m) || getModelKind(m) === "llm")
            .map((m) => ({
              id: m.id,
              name: m.name,
              value: `${alias}/${m.id}`,
              kind: getModelKind(m),
            }));
          const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));
          const filteredAliases = aliasModels.filter(
            (m) => !hardcodedIds.has(m.id),
          );
          combined = [...hardcodedModels, ...filteredAliases];
        }

        // Live catalog (union for passthrough providers when fetch settled)
        if (!kindFilter && liveModelsByProviderId) {
          combined = applyLiveCatalogToChips({
            providerId,
            valuePrefix: alias,
            staticChips: combined,
            liveModels: liveModelsByProviderId[providerId] || null,
          });
        }

        if (combined.length > 0) {
          // Check for custom name from providerNodes (for compatible providers)
          const matchedNode = providerNodes.find(
            (node) => node.id === providerId,
          );
          const displayName = matchedNode?.name || providerInfo.name;

          groups[providerId] = {
            name: displayName,
            alias: alias,
            color: providerInfo.color,
            models: combined,
          };
        }
      } else if (isCustomProvider) {
        // Custom (openai/anthropic-compatible) providers are LLM-only — skip for typed media kinds
        if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
        // Find connection object to get prefix synchronously without waiting for providerNodes fetch
        const connection = activeProviders.find(
          (p) => p.provider === providerId,
        );
        const matchedNode = providerNodes.find(
          (node) => node.id === providerId,
        );
        const displayName =
          connection?.name || matchedNode?.name || providerInfo.name;
        const nodePrefix =
          connection?.providerSpecificData?.prefix ||
          matchedNode?.prefix ||
          providerId;

        // Aliases are stored using the raw providerId as key (e.g. "openai-compatible-chat-<uuid>/glm-4.7"),
        // so we must filter by providerId, not by the display prefix.
        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
          }));

        // Merge custom models registered via /api/models/custom for this provider
        // providerAlias in DB uses the raw providerId, not the display prefix
        const registeredCustom = customModels
          .filter((m) => m.providerAlias === providerId)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${nodePrefix}/${m.id}`,
            isCustom: true,
          }));
        const seen = new Set(nodeModels.map((m) => m.value));
        const mergedModels = [
          ...nodeModels,
          ...registeredCustom.filter((m) => !seen.has(m.value)),
        ];

        // Always show compatible providers that are connected, even with no aliases.
        // When no aliases exist, show a placeholder so users know it's available.
        let modelsToShow =
          mergedModels.length > 0
            ? mergedModels
            : [
                {
                  id: `__placeholder__${providerId}`,
                  name: `${nodePrefix}/model-id`,
                  value: `${nodePrefix}/model-id`,
                  isPlaceholder: true,
                },
              ];

        // Live OpenAI/Anthropic-compatible catalog: union discovered model ids
        if (liveModelsByProviderId) {
          const liveMerged = applyLiveCatalogToChips({
            providerId,
            valuePrefix: nodePrefix,
            staticChips: mergedModels,
            liveModels: liveModelsByProviderId[providerId] || null,
          });
          if (liveMerged.length > 0) {
            modelsToShow = liveMerged;
          }
        }

        groups[providerId] = {
          name: displayName,
          alias: nodePrefix,
          color: providerInfo.color,
          models: modelsToShow,
          isCustom: true,
          hasModels: modelsToShow.some((m) => !m.isPlaceholder),
        };
      } else {
        const hardcodedModels = getModelsByProviderId(providerId);
        const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));

        // Custom models: if no hardcoded models (e.g. openrouter), show all aliases for this provider
        // Otherwise only show aliases where aliasName === modelId ("Add Model" button pattern)
        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = Object.entries(modelAliases)
          .filter(
            ([aliasName, fullModel]) =>
              fullModel.startsWith(`${alias}/`) &&
              (hasHardcoded
                ? aliasName === fullModel.replace(`${alias}/`, "")
                : true) &&
              !hardcodedIds.has(fullModel.replace(`${alias}/`, "")),
          )
          .map(([aliasName, fullModel]) => {
            const modelId = fullModel.replace(`${alias}/`, "");
            return {
              id: modelId,
              name: aliasName,
              value: fullModel,
              isCustom: true,
            };
          });

        // Custom models registered via /api/models/custom (provider "Add Model" button)
        const customAliasIds = new Set(customAliasModels.map((m) => m.id));
        const customRegisteredModels = customModels
          .filter(
            (m) =>
              m.providerAlias === alias &&
              !hardcodedIds.has(m.id) &&
              !customAliasIds.has(m.id),
          )
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${alias}/${m.id}`,
            isCustom: true,
          }));

        const merged = [
          ...hardcodedModels.map((m) => ({
            id: m.id,
            name: m.name,
            value: `${alias}/${m.id}`,
            kind: getModelKind(m),
          })),
          ...customAliasModels,
          ...customRegisteredModels,
        ];
        // Dedupe by value (alias may equal hardcoded id, causing React key collision)
        const seen = new Set();
        let allModels = filterByKind(
          merged.filter((m) => {
            if (seen.has(m.value)) return false;
            seen.add(m.value);
            return true;
          }),
        );

        // Live catalog: kiro = live-only when live non-empty; others = union.
        // While liveModelsByProviderId is null (in flight), keep static (no empty flash).
        if (liveModelsByProviderId) {
          allModels = filterByKind(
            applyLiveCatalogToChips({
              providerId,
              valuePrefix: alias,
              staticChips: allModels,
              liveModels: liveModelsByProviderId[providerId] || null,
            }),
          );
        }

        // Provider-as-model fallback: providers that support the kind but have no hardcoded models
        // can still be picked (value = providerAlias). Skips embedding (always needs model).
        if (
          allModels.length === 0 &&
          kindFilter &&
          ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)
        ) {
          const supports = (providerInfo.serviceKinds || ["llm"]).includes(
            kindFilter,
          );
          if (supports) {
            allModels = [
              { id: providerId, name: providerInfo.name, value: alias },
            ];
          }
        }

        if (allModels.length > 0) {
          groups[providerId] = {
            name: providerInfo.name,
            alias: alias,
            color: providerInfo.color,
            models: allModels,
          };
        }
      }
    });

    // Filter out disabled models per provider (disabled keyed by storage alias OR providerId)
    Object.entries(groups).forEach(([providerId, group]) => {
      const aliasKey = getProviderAlias(providerId);
      const disabledIds = new Set([
        ...(disabledModels[aliasKey] || []),
        ...(disabledModels[providerId] || []),
      ]);
      if (disabledIds.size === 0) return;
      group.models = group.models.filter((m) => !disabledIds.has(m.id));
      if (group.models.length === 0) delete groups[providerId];
    });

    return groups;
  }, [
    filteredActiveProviders,
    modelAliases,
    allProviders,
    providerNodes,
    customModels,
    disabledModels,
    kindFilter,
    activeProviders,
    liveModelsByProviderId,
  ]);

  // Filter combos by search query (and hide combos when kindFilter is set — combos are LLM-only by design)
  const filteredCombos = useMemo(() => {
    if (kindFilter) return [];
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter((c) => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery, kindFilter]);

  // Sort models alphabetically, with added models floated to top
  const sortModels = useCallback(
    (models) => {
      const added = models
        .filter((m) => addedModelValues.includes(m.value))
        .sort((a, b) => a.name.localeCompare(b.name));
      const rest = models
        .filter((m) => !addedModelValues.includes(m.value))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [...added, ...rest];
    },
    [addedModelValues],
  );

  // Normalize for search: "openrouter_gpt_4" / "gpt-4" → comparable tokens
  const normalizeSearchText = useCallback((text) => {
    return String(text || "")
      .toLowerCase()
      .replace(/[/_.:-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }, []);

  const modelMatchesQuery = useCallback(
    (model, query, normalizedQuery) => {
      if (!query) return true;
      const name = String(model?.name || "").toLowerCase();
      const id = String(model?.id || "").toLowerCase();
      const value = String(model?.value || "").toLowerCase();
      // Exact substring on raw fields (covers live-fetched ids / full alias paths)
      if (
        name.includes(query) ||
        id.includes(query) ||
        value.includes(query)
      ) {
        return true;
      }
      // Soft match: ignore _ - / separators so "gpt 4" hits openrouter_gpt_4_o
      const soft = normalizeSearchText(
        [model?.name, model?.id, model?.value].filter(Boolean).join(" "),
      );
      return soft.includes(normalizedQuery);
    },
    [normalizeSearchText],
  );

  // Filter models by search query (static + live chips share the same fields)
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const normalizedQuery = normalizeSearchText(query);

    const filtered = {};
    Object.entries(groupedModels).forEach(([providerId, group]) => {
      let models = group.models;
      if (query) {
        const providerNameMatches =
          group.name.toLowerCase().includes(query) ||
          normalizeSearchText(group.name).includes(normalizedQuery);
        const aliasMatches =
          String(group.alias || "")
            .toLowerCase()
            .includes(query) ||
          normalizeSearchText(group.alias).includes(normalizedQuery);

        const matched = models.filter((m) =>
          modelMatchesQuery(m, query, normalizedQuery),
        );

        if (matched.length > 0) {
          models = matched;
        } else if (providerNameMatches || aliasMatches) {
          // Provider name hit → keep full list so users can browse large live catalogs
          models = group.models;
        } else {
          return;
        }
      }
      filtered[providerId] = {
        ...group,
        models: sortModels(models),
      };
    });

    return filtered;
  }, [
    groupedModels,
    searchQuery,
    sortModels,
    normalizeSearchText,
    modelMatchesQuery,
  ]);

  const handleSelect = (model) => {
    const value = model?.value || model?.name || model;
    const isAdded = addedModelValues.includes(value);

    if (isAdded && onDeselect) {
      onDeselect(model);
    } else {
      onSelect(model);
    }

    if (closeOnSelect) {
      onClose();
      setSearchQuery("");
    }
  };

  const handleModalClose = useCallback(() => {
    onClose();
    setSearchQuery("");
  }, [onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      title={title}
      size="full"
      className="p-4! max-h-[92vh]"
      footer={null}
    >
      {/* Info bar */}
      <div className="flex items-center gap-2 mb-3 px-2.5 py-2 bg-primary/8 border border-primary/20 rounded-lg text-xs text-text-muted">
        <span
          className="material-symbols-outlined text-primary shrink-0"
          style={{ fontSize: "14px" }}
        >
          info
        </span>
        <span>
          Click to add, click again to remove. Changes are saved automatically.
        </span>
      </div>

      {/* Search — covers static + live-fetched name / id / full path */}
      <div className="mb-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search models, ids, or providers…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            className="w-full pl-10 pr-3 py-2.5 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        {liveModelsLoading && (
          <p className="mt-1.5 text-[11px] text-text-muted">
            Refreshing provider models… search works on live results when ready.
          </p>
        )}
        {!liveModelsLoading && searchQuery.trim() && (
          <p className="mt-1.5 text-[11px] text-text-muted">
            {
              Object.values(filteredGroups).reduce(
                (n, g) => n + (g.models?.length || 0),
                0,
              )
            }{" "}
            models match
          </p>
        )}
      </div>

      {/* Models grouped by provider — taller viewport for large live catalogs */}
      <div className="max-h-[min(62vh,640px)] overflow-y-auto space-y-4 pr-1 custom-scrollbar">
        {/* Combos section - always first */}
        {filteredCombos.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <span className="material-symbols-outlined text-primary text-[14px]">
                layers
              </span>
              <span className="text-xs font-medium text-primary">Combos</span>
              <span className="text-[10px] text-text-muted">
                ({filteredCombos.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCombos.map((combo) => {
                const isSelected = selectedModel === combo.name;
                return (
                  <button
                    key={combo.id}
                    onClick={() =>
                      handleSelect({
                        id: combo.name,
                        name: combo.name,
                        value: combo.name,
                      })
                    }
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer flex items-center gap-1
                      ${
                        isSelected
                          ? "bg-primary text-white border-primary"
                          : addedModelValues.includes(combo.name)
                            ? "bg-primary border-primary text-white hover:bg-primary-hover"
                            : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {addedModelValues.includes(combo.name) && (
                      <span
                        className="material-symbols-outlined leading-none"
                        style={{ fontSize: "10px" }}
                      >
                        check
                      </span>
                    )}
                    {combo.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Provider models */}
        {Object.entries(filteredGroups).map(([providerId, group]) => (
          <div key={providerId}>
            {/* Provider header */}
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <ProviderIcon
                src={`/providers/${providerId}.png`}
                alt={group.name}
                size={14}
                fallbackText={(group.name || providerId)
                  .slice(0, 2)
                  .toUpperCase()}
                fallbackColor={group.color}
              />
              <span className="text-xs font-medium text-primary">
                {group.name}
              </span>
              <span className="text-[10px] text-text-muted">
                ({group.models.length})
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {group.models.map((model) => {
                const isSelected = selectedModel === model.value;
                const isPlaceholder = model.isPlaceholder;
                const isAdded = addedModelValues.includes(model.value);
                return (
                  <button
                    key={model.value}
                    onClick={() => handleSelect(model)}
                    title={
                      isPlaceholder
                        ? "Select to pre-fill, then edit model ID in the input"
                        : model.value
                    }
                    className={`
                      px-3 py-1.5 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer text-left flex items-start gap-1.5
                      ${
                        isPlaceholder
                          ? "border-dashed border-border text-text-muted hover:border-primary/50 hover:text-primary bg-surface italic"
                          : isSelected
                            ? "bg-primary text-white border-primary"
                            : isAdded
                              ? "bg-primary border-primary text-white hover:bg-primary-hover"
                              : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {isAdded && !isPlaceholder && (
                      <span
                        className="material-symbols-outlined leading-none mt-0.5 shrink-0"
                        style={{ fontSize: "10px" }}
                      >
                        check
                      </span>
                    )}
                    <span className="flex flex-col min-w-0">
                      <span className="truncate block font-semibold text-[11px] leading-tight">
                        {isPlaceholder ? (
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[11px]">
                              edit
                            </span>
                            {model.name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <span className="truncate">{model.name}</span>
                            <CapacityBadges
                              caps={getCaps(model.value)}
                              size={12}
                              colorOverride={
                                isSelected || isAdded
                                  ? "text-white/80"
                                  : undefined
                              }
                            />
                          </span>
                        )}
                      </span>
                      {!isPlaceholder && (
                        <span
                          className={`text-[9px] font-mono mt-0.5 block truncate leading-none ${
                            isSelected || isAdded
                              ? "text-white/70"
                              : "text-text-muted"
                          }`}
                        >
                          {model.id}
                          {model.isCustom && (
                            <span
                              className={`ml-1 text-[8px] px-1 py-0.2 rounded font-sans uppercase font-bold ${
                                isSelected || isAdded
                                  ? "bg-white/20 text-white"
                                  : "bg-black/5 dark:bg-white/5 text-text-muted"
                              }`}
                            >
                              custom
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(filteredGroups).length === 0 &&
          filteredCombos.length === 0 && (
            <div className="text-center py-4 text-text-muted">
              <span className="material-symbols-outlined text-2xl mb-1 block">
                search_off
              </span>
              <p className="text-xs">No models found</p>
            </div>
          )}
      </div>
    </Modal>
  );
}

ModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  onDeselect: PropTypes.func,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    }),
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
  kindFilter: PropTypes.string,
  addedModelValues: PropTypes.arrayOf(PropTypes.string),
  closeOnSelect: PropTypes.bool,
};
