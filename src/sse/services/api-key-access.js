function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeApiKeyAllowlist(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeValue).filter(Boolean))];
}

export function getCanonicalModelId({ provider, model }) {
  const normalizedProvider = normalizeValue(provider);
  const normalizedModel = normalizeValue(model);
  return normalizedProvider && normalizedModel
    ? `${normalizedProvider}/${normalizedModel}`
    : "";
}

export function isApiKeyAccessUnrestricted(keyInfo) {
  return (
    normalizeApiKeyAllowlist(keyInfo?.allowedProviders).length === 0 &&
    normalizeApiKeyAllowlist(keyInfo?.allowedModels).length === 0
  );
}

export function getApiKeyAccessDecision(keyInfo, target) {
  if (!keyInfo || isApiKeyAccessUnrestricted(keyInfo)) {
    return { ok: true };
  }

  const provider = normalizeValue(target?.provider);
  const model = getCanonicalModelId(target || {});
  const allowedProviders = normalizeApiKeyAllowlist(keyInfo.allowedProviders);
  const allowedModels = normalizeApiKeyAllowlist(keyInfo.allowedModels);

  if (allowedProviders.includes(provider) || allowedModels.includes(model)) {
    return { ok: true };
  }

  const code =
    allowedProviders.length > 0 && allowedModels.length === 0
      ? "provider_not_allowed"
      : allowedModels.length > 0 && allowedProviders.length === 0
        ? "model_not_allowed"
        : "access_not_allowed";

  return {
    ok: false,
    code,
    message: `API key is not allowed to access ${model || "this model"}`,
  };
}

export function assertApiKeyAccess(keyInfo, target) {
  return getApiKeyAccessDecision(keyInfo, target);
}

export function assertApiKeyAccessBatch(keyInfo, targets) {
  for (const target of targets || []) {
    const decision = assertApiKeyAccess(keyInfo, target);
    if (!decision.ok) return decision;
  }
  return { ok: true };
}

export async function filterApiKeyAccessibleModels(
  keyInfo,
  entries,
  resolveTargets,
) {
  if (isApiKeyAccessUnrestricted(keyInfo)) return entries;

  const visibility = await Promise.all(
    entries.map(async (entry) => {
      const targets = await resolveTargets(entry);
      return targets.length > 0 && assertApiKeyAccessBatch(keyInfo, targets).ok;
    }),
  );

  return entries.filter((_, index) => visibility[index]);
}
