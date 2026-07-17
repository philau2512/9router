/**
 * Which connections may appear in ModelSelectModal / combo picker.
 *
 * Rules:
 *  1. Connection must be active (isActive !== false).
 *  2. Built-in provider must still exist in AI_PROVIDERS (delisted e.g. iflow → hide).
 *  3. Custom OpenAI/Anthropic-compatible nodes keep showing when still connected
 *     (they are not in AI_PROVIDERS by design).
 */

import {
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";

export function isCustomCompatibleProviderId(providerId) {
  if (!providerId) return false;
  return (
    isOpenAICompatibleProvider(providerId) ||
    isAnthropicCompatibleProvider(providerId)
  );
}

/**
 * Provider id is selectable in the modal catalog.
 * @param {string} providerId
 */
export function isSelectableProviderId(providerId) {
  if (!providerId) return false;
  if (isCustomCompatibleProviderId(providerId)) return true;
  return Boolean(AI_PROVIDERS[providerId]);
}

/**
 * @param {Array<{ provider?: string, isActive?: boolean }>} connections
 * @param {{ kindFilter?: string|null }} [opts]
 */
export function filterActiveProvidersForModelSelect(
  connections = [],
  { kindFilter = null } = {},
) {
  return (connections || []).filter((c) => {
    if (!c?.provider) return false;
    if (c.isActive === false) return false;
    if (!isSelectableProviderId(c.provider)) return false;

    if (kindFilter) {
      // Custom compatible nodes are LLM-only in the modal.
      if (isCustomCompatibleProviderId(c.provider)) {
        return kindFilter === "llm" || !kindFilter;
      }
      const info = AI_PROVIDERS[c.provider];
      const kinds = info?.serviceKinds || ["llm"];
      return kinds.includes(kindFilter);
    }
    return true;
  });
}