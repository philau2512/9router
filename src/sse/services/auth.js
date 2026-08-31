/**
 * Authentication and Provider Credentials Service
 * Re-exports credentials management and API key validation helpers.
 */

export {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "./provider-credentials.js";

export {
  enforceApiKeyPolicy,
  getApiKeyValue,
  logApiKeyPresence,
  normalizeApiKeyFailureLog,
} from "./api-key-validation.js";

export { buildApiKeyUsageSummaryResponse } from "./api-key-helpers.js";
