// Utility to build a unified model row list for a provider, merging
// new-style custom models (stored by providerAlias) with legacy alias-backed models.

function modelType(model) {
  return model?.kind || model?.type || "llm";
}

/**
 * Returns a deduplicated, ordered list of model rows for a provider:
 *   1. New-style custom models (source: "custom")
 *   2. Legacy alias-backed models not already covered (source: "legacyAlias")
 *
 * @param {Object} opts
 * @param {Array}  opts.customModels       - array of custom model objects from /api/models/custom
 * @param {Object} opts.modelAliases       - map of alias → fullModel string (legacy store)
 * @param {string} opts.providerAlias      - provider identifier (e.g. "openai", "ollama")
 * @param {Array}  [opts.builtInModels=[]] - hardcoded models to exclude from the rows
 * @param {string} [opts.type="llm"]       - filter by model type
 * @param {boolean}[opts.includeLegacyAliases=true] - include legacy alias-backed rows
 * @returns {Array} rows with { id, name?, alias?, fullModel, source, type }
 */
export function getProviderCustomModelRows({
  customModels = [],
  modelAliases = {},
  providerAlias,
  builtInModels = [],
  type = "llm",
  includeLegacyAliases = true,
}) {
  const builtInIds = new Set(builtInModels.map((model) => model.id));
  const seenFullModels = new Set();
  const rows = [];

  // 1. New-style custom models stored by provider scope
  for (const model of customModels) {
    if (!model?.id || model.providerAlias !== providerAlias) continue;
    const rowType = modelType(model);
    if (type && rowType !== type) continue;
    if (builtInIds.has(model.id)) continue;

    const fullModel = `${providerAlias}/${model.id}`;
    if (seenFullModels.has(fullModel)) continue;
    seenFullModels.add(fullModel);
    rows.push({
      id: model.id,
      name: model.name || model.id,
      fullModel,
      source: "custom",
      type: rowType,
    });
  }

  if (!includeLegacyAliases) return rows;

  // 2. Legacy alias-backed models (old storage format: alias → providerAlias/modelId)
  const prefix = `${providerAlias}/`;
  for (const [alias, fullModel] of Object.entries(modelAliases || {})) {
    if (typeof fullModel !== "string" || !fullModel.startsWith(prefix))
      continue;
    const id = fullModel.slice(prefix.length);
    if (!id || builtInIds.has(id) || seenFullModels.has(fullModel)) continue;

    seenFullModels.add(fullModel);
    rows.push({
      id,
      alias,
      fullModel,
      source: "legacyAlias",
      type: type || "llm",
    });
  }

  return rows;
}
