/**
 * Provider ids whose connections count toward a dashboard card / toggle.
 * Keep in sync with detail-page matchProviders (xai unions grok-cli OAuth).
 */
export function getProviderConnectionMatchIds(providerId) {
  if (providerId === "xai") return ["xai", "grok-cli"];
  return [providerId];
}