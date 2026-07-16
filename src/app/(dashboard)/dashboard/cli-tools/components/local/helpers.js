export const ENDPOINT = "/api/cli-tools/cowork-settings";

export const stripV1 = (url) => (url || "").replace(/\/v1\/?$/, "");

export const ensureV1 = (url) => {
  const trimmed = (url || "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};